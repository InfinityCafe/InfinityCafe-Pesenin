import os
import socket
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, status, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.declarative import declarative_base
from dotenv import load_dotenv

from passlib.context import CryptContext
from jose import JWTError, jwt

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "your-super-secret-key-that-is-long-and-random")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

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

class UserCreate(BaseModel):
    username: str
    password: str

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
            "username": user.username
        }
    }

@app.post("/register", summary="Registrasi Pengguna Baru", tags=["Authentication"])
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    """Endpoint untuk membuat pengguna baru."""
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username sudah terdaftar")
    
    hashed_password = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_password)
    
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
        
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

Base.metadata.create_all(bind=engine)

hostname = socket.gethostname()
try:
    local_ip = socket.gethostbyname(hostname)
except socket.gaierror:
    local_ip = "127.0.0.1"
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ user_service sudah running di http://{local_ip}:8005")