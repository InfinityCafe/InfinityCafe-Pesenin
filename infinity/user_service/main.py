import os
import socket
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, status, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Boolean
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.declarative import declarative_base
from dotenv import load_dotenv

from passlib.context import CryptContext
from jose import JWTError, jwt

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "your-super-secret-key-that-is-long-and-random")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60))

# Use bcrypt_sha256 to avoid the 72-byte truncation issue and ensure compatibility
# with different bcrypt backends. Keep bcrypt as fallback for verifying existing hashes.
pwd_context = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated="auto")

DATABASE_URL = os.getenv("DATABASE_URL_USER")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL_USER environment variable not set")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

app = FastAPI(
    title="User Service API",
    description="Service untuk manajemen pengguna dan otentikasi Infinity Cafe",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://kitchen.gikstaging.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"]
)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False, default="user")  # possible values: admin, user
    is_active = Column(Boolean, nullable=False, default=True)

class UserCreate(BaseModel):
    username: str
    password: str
    role: Optional[str] = "user"

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifikasi password polos dengan hash di database."""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Membuat hash dari password."""
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Membuat JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_db():
    """Dependency function untuk mendapatkan sesi database."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(token: str, db: Session):
    """
    Fungsi untuk memverifikasi JWT token dan mendapatkan user
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.username == token_data.username).first()
    if user is None:
        raise credentials_exception
    return user


def require_admin(authorization: str = Header(None), db: Session = Depends(get_db)):
    """Dependency to ensure the caller is an admin. Expects standard Authorization: Bearer <token> header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid Authorization header")
    raw = authorization.split(" ")[1]
    current = get_current_user(raw, db)
    if getattr(current, "role", "") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return current

@app.get("/health", tags=["Utility"])
def health_check():
    """Endpoint untuk cek status service."""
    return {"status": "ok", "service": "user_service"}

@app.post("/auth/verify_token", summary="Verifikasi JWT Token", tags=["Authentication"])
def verify_token(authorization: str = Header(None), db: Session = Depends(get_db)):
    """
    Endpoint untuk memverifikasi JWT token dari header Authorization
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak ditemukan atau format salah"
        )
    
    token = authorization.split(" ")[1] if len(authorization.split(" ")) > 1 else None
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak valid"
        )
    
    user = get_current_user(token, db)
    return {
        "status": "success",
        "message": "Token valid",
        "data": {
            "id": user.id,
            "username": user.username,
            "role": getattr(user, "role", "user"),
            "is_active": bool(getattr(user, "is_active", 1))
        }
    }

@app.post("/register", summary="Registrasi Pengguna Baru", tags=["Authentication"])
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    """Endpoint untuk membuat pengguna baru."""
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username sudah terdaftar")
    
    hashed_password = get_password_hash(user.password)
    role = getattr(user, "role", "user") or "user"
    new_user = User(username=user.username, hashed_password=hashed_password, role=role, is_active=1)
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {"status": "success", "message": f"Pengguna '{user.username}' berhasil dibuat."}


@app.post("/login", response_model=Token, summary="Login Pengguna", tags=["Authentication"])
def login_for_access_token(form_data: UserLogin, db: Session = Depends(get_db)):
    """
    Endpoint untuk login. Memverifikasi username dan password,
    lalu mengembalikan JWT token jika berhasil.
    """
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username atau password salah",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username atau password salah",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not bool(getattr(user, "is_active", True)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")
        
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "role": getattr(user, "role", "user")},
        expires_delta=access_token_expires,
    )
    
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/admin/create_user", summary="Admin: create user", tags=["Admin"])
def admin_create_user(new_user: UserCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Admin endpoint to create a user with optional role."""
    db_user = db.query(User).filter(User.username == new_user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username sudah terdaftar")
    hashed_password = get_password_hash(new_user.password)
    role = getattr(new_user, "role", "user") or "user"
    created = User(username=new_user.username, hashed_password=hashed_password, role=role, is_active=1)
    db.add(created)
    db.commit()
    db.refresh(created)
    return {"status": "success", "message": f"User '{new_user.username}' dibuat dengan role '{role}'"}


class ChangePasswordRequest(BaseModel):
    username: str
    new_password: str


@app.post("/admin/change_password", summary="Admin: change user password", tags=["Admin"])
def admin_change_password(req: ChangePasswordRequest, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.hashed_password = get_password_hash(req.new_password)
    db.add(user)
    db.commit()
    return {"status": "success", "message": f"Password untuk '{req.username}' telah diubah."}


class DisableUserRequest(BaseModel):
    username: str
    disable: Optional[bool] = None


@app.post("/admin/status_user", summary="Admin: enable/disable user", tags=["Admin"])
def admin_disable_user(req: DisableUserRequest, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if req.disable is None:
        user.is_active = not bool(getattr(user, "is_active", True))
    else:
        user.is_active = False if req.disable else True

    db.add(user)
    db.commit()
    state = "disabled" if not bool(getattr(user, "is_active", True)) else "enabled"
    return {"status": "success", "message": f"User '{req.username}' {state}."}

Base.metadata.create_all(bind=engine)

def create_initial_admin():
    admin_user = os.getenv("ADMIN_USERNAME")
    admin_pass = os.getenv("ADMIN_PASSWORD")
    if not admin_user or not admin_pass:
        return
    db = SessionLocal()
    try:
        existing = db.query(User).first()
        if existing:
            return
        hashed = get_password_hash(admin_pass)
        u = User(username=admin_user, hashed_password=hashed, role="admin", is_active=1)
        db.add(u)
        db.commit()
    finally:
        db.close()

create_initial_admin()

hostname = socket.gethostname()
try:
    local_ip = socket.gethostbyname(hostname)
except socket.gaierror:
    local_ip = "127.0.0.1"
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ user_service sudah running di http://{local_ip}:8005")