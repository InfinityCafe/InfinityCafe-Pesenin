# menu_service.py

from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
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
    flavor_name: str
    additional_price: int = 0

class FlavorCreate(FlavorBase):
    pass

class FlavorOut(FlavorBase):
    id: str
    model_config = { "from_attributes": True }

class MenuItemBase(BaseModel):
    base_name: str
    base_price: int
    isAvail: bool = True

class MenuItemCreate(MenuItemBase):
    flavor_ids: List[str] = []

class MenuItemOut(MenuItemBase):
    id: str
    flavors: List[FlavorOut] = []
    model_config = { "from_attributes": True }

class SuggestionItem(BaseModel):
    menu_name: str
    customer_name: str
    model_config = { "from_attributes": True }

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

@app.post("/flavors", summary="Tambah Varian Rasa Baru", tags=["Flavor"], response_model=FlavorOut, operation_id="add flavor")
def create_flavor(flavor: FlavorCreate, db: Session = Depends(get_db)):
    """Menambahkan varian rasa baru ke database."""
    db_flavor = db.query(Flavor).filter(Flavor.flavor_name == flavor.flavor_name).first()
    if db_flavor:
        raise HTTPException(status_code=400, detail="Rasa dengan nama ini sudah ada")
    
    new_flavor = Flavor(id=generate_id("FLAV", 6), **flavor.dict())
    db.add(new_flavor)
    db.commit()
    db.refresh(new_flavor)
    return new_flavor

@app.get("/flavors", summary="Lihat Semua Varian Rasa", tags=["Flavor"], response_model=List[FlavorOut], operation_id="list flavors")
def get_all_flavors(db: Session = Depends(get_db)):
    """Mengambil semua varian rasa yang tersedia."""
    return db.query(Flavor).all()

@app.post("/menu", summary="Tambah Menu Baru", tags=["Menu"], response_model=MenuItemOut, operation_id="add menu")
def create_menu_item(item: MenuItemCreate, db: Session = Depends(get_db)):
    """Menambahkan menu dasar baru dan menautkannya dengan varian rasa."""
    existing = db.query(MenuItem).filter(MenuItem.base_name == item.base_name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Menu dengan nama '{item.base_name}' sudah ada.")
    
    flavors = db.query(Flavor).filter(Flavor.id.in_(item.flavor_ids)).all()
    if len(flavors) != len(item.flavor_ids):
        raise HTTPException(status_code=404, detail="Satu atau lebih ID rasa tidak ditemukan.")

    db_item = MenuItem(id=generate_id("MENU"), base_name=item.base_name, base_price=item.base_price, isAvail=item.isAvail)
    db_item.flavors.extend(flavors)
    
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

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
    exist_main = db.query(MenuItem).filter(MenuItem.base_name == item.menu_name).first()
    exist_suggested = db.query(MenuSuggestion).filter(MenuSuggestion.menu_name == item.menu_name).first()
    if exist_main or exist_suggested:
        return {"message": "Pantun: Ke pasar beli ketela, menu ini sudah ada ternyata 😅", "status": "duplicate"}
    
    suggestion = MenuSuggestion(usulan_id=generate_id("USL", 12), **item.dict())
    db.add(suggestion)
    db.commit()
    return {"message": "Langit cerah, hati lega — usulan kamu bisa jadi tren menu selanjutnya 🌟", "usulan_id": suggestion.usulan_id, "status": "success"}

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