# menu_service.py

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, validator, Field, ValidationError
from sqlalchemy import create_engine, Column, String, Integer, Boolean, DateTime, Table, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship, joinedload
from typing import List, Optional
import os
from dotenv import load_dotenv
import logging
import socket
import uuid
from datetime import datetime
from pytz import timezone as pytz_timezone
jakarta_tz = pytz_timezone('Asia/Jakarta')

from fastapi_mcp import FastApiMCP
import uvicorn
from fastapi import APIRouter
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL_MENU")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

app = FastAPI(
    title="Menu Service API",
    description="Manajemen menu dan usulan menu untuk Infinity Cafe",
    version="1.0.0"
)

# Custom Exception Handlers untuk n8n compatibility
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Custom handler untuk menangani validasi error, merubah error status menjadi 200 untuk memastikan flow n8n tetap berjalan."""
    first_error = exc.errors()[0]
    field_location = " -> ".join(map(str, first_error['loc']))
    error_message = first_error['msg']
    
    full_message = f"Data tidak valid pada field '{field_location}': {error_message}"

    return JSONResponse(
        status_code=200,
        content={
            "status": "error",
            "message": full_message,
            "data": {"details": exc.errors()}
        },
    )

@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    """Custom handler untuk ValueError dari Pydantic validators, merubah status menjadi 200 untuk kompatibilitas n8n."""
    return JSONResponse(
        status_code=200,
        content={
            "status": "error",
            "message": f"Validasi gagal: {str(exc)}",
            "data": {"error_type": "value_error"}
        }
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Custom handler untuk HTTPException, merubah status menjadi 200 untuk kompatibilitas n8n jika error adalah validation related."""
    # Jika error adalah validation related (400, 404), ubah ke 200
    if exc.status_code in [400, 404]:
        return JSONResponse(
            status_code=200,
            content={
                "status": "error",
                "message": exc.detail,
                "data": {"error_type": "business_logic_error", "original_status": exc.status_code}
            }
        )
    
    # Untuk error lain (500, dll), biarkan status asli
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "status": "error",
            "message": exc.detail,
            "data": {"error_type": "http_error", "original_status": exc.status_code}
        }
    )

# Tambah CORS middleware di sini
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# other_router = APIRouter(prefix="/gateway")    
# app.include_router(other_router)

mcp = FastApiMCP(app,name="Server MCP Infinity",
        description="Server MCP Infinity Descr",
        # describe_all_responses=True,
        # describe_full_response_schema=True,
        # include_tags=["Menu","Utility","Usulan Menu"],
        include_operations=["add menu","list menu","update menu","delete menu", "get menu avail", "add usulan menu", "list usulan menu"]
        )

mcp.mount(mount_path="/mcp",transport="sse")

menu_item_flavor_association = Table(
    'menu_item_flavor_association', Base.metadata,
    Column('menu_item_id', String, ForeignKey('menu_items.id'), primary_key=True),
    Column('flavor_id', String, ForeignKey('flavors.id'), primary_key=True)
)

class MenuItem(Base):
    __tablename__ = "menu_items"
    id = Column(String, primary_key=True, index=True)
    base_name = Column(String, index=True, unique=True)
    base_price = Column(Integer)
    isAvail = Column(Boolean, default=True)

    flavors = relationship(
        "Flavor",
        secondary=menu_item_flavor_association,
        back_populates="menu_items"
    )

class Flavor(Base):
    __tablename__ = "flavors"
    id = Column(String, primary_key=True, index=True)
    flavor_name = Column(String, unique=True, index=True)
    additional_price = Column(Integer, default=0)
    
    menu_items = relationship(
        "MenuItem",
        secondary=menu_item_flavor_association,
        back_populates="flavors"
    )

class MenuSuggestion(Base):
    __tablename__ = "menu_suggestions"
    usulan_id = Column(String, primary_key=True, index=True)
    menu_name = Column(String)
    customer_name = Column(String)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(jakarta_tz))

Base.metadata.create_all(bind=engine)

class FlavorBase(BaseModel):
    flavor_name: str = Field(..., min_length=1, description="Nama flavor tidak boleh kosong")
    additional_price: Optional[int] = Field(default=0, ge=0, description="Harga tambahan tidak boleh negatif, default 0 jika tidak diisi")

class FlavorCreate(FlavorBase):
    @validator('flavor_name')
    def validate_flavor_name(cls, v):
        if not v or v.strip() == "":
            raise ValueError('Nama flavor tidak boleh kosong atau hanya spasi')
        return v.strip()
    
    @validator('additional_price')
    def validate_additional_price(cls, v):
        if v is None:
            return 0  # Default value jika tidak diisi
        if v < 0:
            raise ValueError('Harga tambahan tidak boleh negatif')
        return v

class FlavorOut(FlavorBase):
    id: str
    model_config = { "from_attributes": True }

class MenuItemBase(BaseModel):
    base_name: str = Field(..., min_length=1, description="Nama menu tidak boleh kosong")
    base_price: int = Field(..., gt=0, description="Harga harus lebih dari 0")
    isAvail: bool = True

class MenuItemCreate(MenuItemBase):
    flavor_ids: List[str] = Field(default=[], description="ID flavor untuk menu (opsional)")
    
    @validator('base_name')
    def validate_base_name(cls, v):
        if not v or v.strip() == "":
            raise ValueError('Nama menu tidak boleh kosong atau hanya spasi')
        return v.strip()
    
    @validator('base_price')
    def validate_base_price(cls, v):
        if v is None or v <= 0:
            raise ValueError('Harga harus lebih dari 0')
        return v
    
    @validator('flavor_ids')
    def validate_flavor_ids(cls, v):
        if v is None:
            return []
        # Validasi setiap flavor_id tidak kosong jika ada
        for flavor_id in v:
            if not flavor_id or flavor_id.strip() == "":
                raise ValueError('Flavor ID tidak boleh kosong')
        return v

class MenuItemOut(MenuItemBase):
    id: str
    flavors: List[FlavorOut] = []
    model_config = { "from_attributes": True }

class SuggestionItem(BaseModel):
    menu_name: str = Field(..., min_length=1, description="Nama menu usulan tidak boleh kosong")
    customer_name: str = Field(..., min_length=1, description="Nama customer tidak boleh kosong")
    model_config = { "from_attributes": True }
    
    @validator('menu_name')
    def validate_menu_name(cls, v):
        if not v or v.strip() == "":
            raise ValueError('Nama menu usulan tidak boleh kosong atau hanya spasi')
        return v.strip()
    
    @validator('customer_name')
    def validate_customer_name(cls, v):
        if not v or v.strip() == "":
            raise ValueError('Nama customer tidak boleh kosong atau hanya spasi')
        return v.strip()

class SuggestionOut(BaseModel):
    usulan_id: str
    menu_name: str
    customer_name: str
    timestamp: datetime
    model_config = { "from_attributes": True }

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def generate_id(prefix: str, length: int = 8):
    return f"{prefix.upper()}{uuid.uuid4().hex[:length].upper()}"

@app.post("/flavors", summary="Tambah Varian Rasa Baru", tags=["Flavor"], operation_id="add flavor")
def create_flavor(flavor: FlavorCreate, db: Session = Depends(get_db)):
    """Menambahkan varian rasa baru ke database."""
    
    # Validasi tambahan untuk memastikan data tidak kosong
    if not flavor.flavor_name or flavor.flavor_name.strip() == "":
        raise HTTPException(status_code=400, detail="Nama flavor tidak boleh kosong")
    
    # Set default price jika None
    price = flavor.additional_price if flavor.additional_price is not None else 0
    
    if price < 0:
        raise HTTPException(status_code=400, detail="Harga tambahan tidak boleh negatif")
    
    # Cek apakah nama flavor sudah ada
    db_flavor = db.query(Flavor).filter(Flavor.flavor_name == flavor.flavor_name.strip()).first()
    if db_flavor:
        raise HTTPException(status_code=400, detail="Rasa dengan nama ini sudah ada")
    
    new_flavor = Flavor(
        id=generate_id("FLAV", 6), 
        flavor_name=flavor.flavor_name.strip(),
        additional_price=price
    )
    db.add(new_flavor)
    db.commit()
    db.refresh(new_flavor)
    
    return {
        "status": "success",
        "message": "Flavor berhasil ditambahkan",
        "data": {
            "id": new_flavor.id,
            "flavor_name": new_flavor.flavor_name,
            "additional_price": new_flavor.additional_price
        }
    }

@app.get("/flavors", summary="Lihat Semua Varian Rasa", tags=["Flavor"], response_model=List[FlavorOut], operation_id="list flavors")
def get_all_flavors(db: Session = Depends(get_db)):
    """Mengambil semua varian rasa yang tersedia."""
    return db.query(Flavor).all()

@app.post("/menu", summary="Tambah Menu Baru", tags=["Menu"], operation_id="add menu")
def create_menu_item(item: MenuItemCreate, db: Session = Depends(get_db)):
    """Menambahkan menu dasar baru dan menautkannya dengan varian rasa."""
    
    # Validasi tambahan untuk memastikan data tidak kosong
    if not item.base_name or item.base_name.strip() == "":
        raise HTTPException(status_code=400, detail="Nama menu tidak boleh kosong")
    
    if item.base_price is None or item.base_price <= 0:
        raise HTTPException(status_code=400, detail="Harga menu harus diisi dan lebih dari 0")
    
    # Validasi setiap flavor_id tidak kosong jika ada
    if item.flavor_ids:
        for flavor_id in item.flavor_ids:
            if not flavor_id or flavor_id.strip() == "":
                raise HTTPException(status_code=400, detail="Flavor ID tidak boleh kosong")
    
    # Cek apakah nama menu sudah ada
    existing = db.query(MenuItem).filter(MenuItem.base_name == item.base_name.strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Menu dengan nama '{item.base_name}' sudah ada.")
    
    # Validasi semua flavor_ids ada di database jika ada yang diinputkan
    if item.flavor_ids:
        flavors = db.query(Flavor).filter(Flavor.id.in_(item.flavor_ids)).all()
        if len(flavors) != len(item.flavor_ids):
            missing_ids = set(item.flavor_ids) - {f.id for f in flavors}
            raise HTTPException(status_code=404, detail=f"Flavor ID tidak ditemukan: {', '.join(missing_ids)}")
    else:
        flavors = []

    # Buat menu baru
    db_item = MenuItem(
        id=generate_id("MENU"), 
        base_name=item.base_name.strip(), 
        base_price=item.base_price, 
        isAvail=item.isAvail
    )
    
    # Tambahkan flavors jika ada
    if flavors:
        db_item.flavors.extend(flavors)
    
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    
    return {
        "status": "success",
        "message": "Menu berhasil ditambahkan",
        "data": {
            "id": db_item.id,
            "base_name": db_item.base_name,
            "base_price": db_item.base_price,
            "isAvail": db_item.isAvail,
            "flavors": [{"id": f.id, "flavor_name": f.flavor_name, "additional_price": f.additional_price} for f in db_item.flavors]
        }
    }

@app.get("/menu", summary="Daftar Menu Tersedia", tags=["Menu"], response_model=List[MenuItemOut], operation_id="list menu")
def get_menu(db: Session = Depends(get_db)):
    """Mengambil semua menu yang tersedia beserta varian rasanya."""
    menus = db.query(MenuItem).options(joinedload(MenuItem.flavors)).filter(MenuItem.isAvail == True).all()
    return menus

@app.get("/menu/{menu_id}", summary="Lihat Detail Menu", tags=["Menu"], response_model=MenuItemOut, operation_id="get menu by id")
def get_menu_item(menu_id: str, db: Session = Depends(get_db)):
    """Mengambil informasi detail dari sebuah menu berdasarkan ID."""
    item = db.query(MenuItem).options(joinedload(MenuItem.flavors)).filter(MenuItem.id == menu_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Menu item tidak ditemukan")
    return item

@app.get("/menu/by_name/{base_name}/flavors", summary="Dapatkan rasa untuk menu tertentu by Name", tags=["Menu"], response_model=List[FlavorOut])
def get_flavors_for_menu_by_name(base_name: str, db: Session = Depends(get_db)):
    """Mengembalikan daftar rasa yang tersedia untuk menu tertentu berdasarkan namanya."""
    menu_item = db.query(MenuItem).options(joinedload(MenuItem.flavors)).filter(MenuItem.base_name == base_name).first()
    
    if not menu_item:
        raise HTTPException(status_code=404, detail=f"Menu dengan nama '{base_name}' tidak ditemukan.")
    
    return menu_item.flavors

@app.put("/menu/{menu_id}", summary="Update Menu", tags=["Menu"], response_model=MenuItemOut, operation_id="update menu")
def update_menu_item(menu_id: str, item: MenuItemCreate, db: Session = Depends(get_db)):
    """Memperbarui informasi dari menu berdasarkan ID, termasuk varian rasanya."""
    db_item = db.query(MenuItem).options(joinedload(MenuItem.flavors)).filter(MenuItem.id == menu_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Menu item tidak ditemukan")
    
    db_item.base_name = item.base_name
    db_item.base_price = item.base_price
    db_item.isAvail = item.isAvail
    
    flavors = db.query(Flavor).filter(Flavor.id.in_(item.flavor_ids)).all()
    if len(flavors) != len(item.flavor_ids):
        raise HTTPException(status_code=404, detail="Satu atau lebih ID rasa tidak ditemukan.")
    db_item.flavors = flavors
    
    db.commit()
    db.refresh(db_item)
    return db_item

@app.delete("/menu/{menu_id}", summary="Hapus Menu", tags=["Menu"], operation_id="delete menu")
def delete_menu_item(menu_id: str, db: Session = Depends(get_db)):
    """Menghapus menu dari database berdasarkan ID."""
    db_item = db.query(MenuItem).filter(MenuItem.id == menu_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Menu item tidak ditemukan")
    db.delete(db_item)
    db.commit()
    return {"message": "Menu berhasil dihapus"}

@app.post("/menu_suggestion", summary="Ajukan Usulan Menu", tags=["Usulan Menu"], operation_id="add usulan menu")
def suggest_menu(item: SuggestionItem, db: Session = Depends(get_db)):
    """Menambahkan usulan menu dari customer."""
    try:
        # Validasi tambahan untuk memastikan data tidak kosong
        if not item.menu_name or item.menu_name.strip() == "":
            return {
                "status": "error",
                "message": "Nama menu usulan tidak boleh kosong",
                "data": None
            }
        
        if not item.customer_name or item.customer_name.strip() == "":
            return {
                "status": "error",
                "message": "Nama customer tidak boleh kosong", 
                "data": None
            }
        
        # Cek apakah menu sudah ada di menu utama atau usulan
        exist_main = db.query(MenuItem).filter(MenuItem.base_name == item.menu_name.strip()).first()
        exist_suggested = db.query(MenuSuggestion).filter(MenuSuggestion.menu_name == item.menu_name.strip()).first()
        if exist_main or exist_suggested:
            return {
                "status": "duplicate",
                "message": "Pantun: Ke pasar beli ketela, menu ini sudah ada ternyata 😅",
                "data": None
            }
        
        suggestion = MenuSuggestion(
            usulan_id=generate_id("USL", 12), 
            menu_name=item.menu_name.strip(),
            customer_name=item.customer_name.strip()
        )
        db.add(suggestion)
        db.commit()
        
        return {
            "status": "success",
            "message": "Langit cerah, hati lega — usulan kamu bisa jadi tren menu selanjutnya 🌟",
            "data": {
                "usulan_id": suggestion.usulan_id,
                "menu_name": suggestion.menu_name,
                "customer_name": suggestion.customer_name
            }
        }
    except Exception as e:
        db.rollback()
        return {
            "status": "error",
            "message": f"Gagal menyimpan usulan menu: {str(e)}",
            "data": None
        }

@app.get("/menu_suggestion", summary="Lihat Semua Usulan", tags=["Usulan Menu"], response_model=List[SuggestionOut], operation_id="list usulan menu")
def get_suggestions(db: Session = Depends(get_db)):
    """Menampilkan seluruh usulan menu terbaru dari pelanggan."""
    return db.query(MenuSuggestion).order_by(MenuSuggestion.timestamp.desc()).all()

@app.get("/health", summary="Health Check", tags=["Utility"])
def health_check():
    """Cek apakah service menu sedang berjalan."""
    return {"status": "ok", "service": "menu_service"}

hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ menu_service sudah running di http://{local_ip}:8001 Operation Added ")
logging.info("Dokumentasi API tersedia di http://{local_ip}:8001/docs")

mcp.setup_server()