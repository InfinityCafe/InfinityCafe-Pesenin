# menu_service.py

from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, Integer, Boolean, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import List
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

class Menu(Base):
    __tablename__ = "menus"
    menu_id = Column(String, primary_key=True, index=True)
    menu_name = Column(String, index=True)
    menu_price = Column(Integer)
    isAvail = Column(Boolean, default=True)

class MenuSuggestion(Base):
    __tablename__ = "menu_suggestions"
    usulan_id = Column(String, primary_key=True, index=True)
    menu_name = Column(String)
    customer_name = Column(String)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(jakarta_tz))

Base.metadata.create_all(bind=engine)

class MenuItem(BaseModel):
    menu_name: str
    menu_price: int
    isAvail: bool

    model_config = {
        "from_attributes": True
    }

class SuggestionItem(BaseModel):
    menu_name: str
    customer_name: str

    model_config = {
        "from_attributes": True
    }

class SuggestionOut(BaseModel):
    usulan_id: str
    menu_name: str
    customer_name: str
    timestamp: datetime

    model_config = {
        "from_attributes": True
    }

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def generate_menu_id():
    return f"MENU{uuid.uuid4().hex[:8].upper()}"

def generate_usulan_id():
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    unique = uuid.uuid4().hex[:6].upper()
    return f"USL{timestamp}{unique}"

@app.post("/menu", summary="Tambah menu", tags=["Menu"], operation_id="add menu")
def create_menu_item(item: MenuItem, db: Session = Depends(get_db)):
    """Menambahkan menu baru ke daftar menu utama."""
    existing = db.query(Menu).filter(Menu.menu_name == item.menu_name).first()
    if existing:
        return {
            "message": "Pantun: Pergi pagi naik delman, menu ini udah ada kawan 🐴",
            "status": "duplicate"
        }
    menu_id = generate_menu_id()
    db_item = Menu(menu_id=menu_id, **item.dict())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return {
        "message": "Ide fresh kaya kopi pagi! Menu berhasil ditambahkan ☕✨",
        "item": db_item,
        "status": "success"
    }

@app.get("/menu", summary="Daftar menu tersedia", tags=["Menu"], response_model=List[MenuItem], operation_id="list menu")
def get_menu(db: Session = Depends(get_db)):
    """Mengambil semua menu yang masih tersedia (isAvail=True)."""
    menus = db.query(Menu).filter(Menu.isAvail == True).all()
    return menus

@app.get("/menu/{menu_id}", summary="Lihat detail menu", tags=["Menu"], response_model=MenuItem, operation_id="get menu avail")
def get_menu_item(menu_id: str, db: Session = Depends(get_db)):
    """Mengambil informasi detail dari sebuah menu berdasarkan ID."""
    item = db.query(Menu).filter(Menu.menu_id == menu_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return item

@app.put("/menu/{menu_id}", summary="Update menu", tags=["Menu"], operation_id="update menu")
def update_menu_item(menu_id: str, item: MenuItem, db: Session = Depends(get_db)):
    """Memperbarui informasi dari menu berdasarkan ID."""
    db_item = db.query(Menu).filter(Menu.menu_id == menu_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    for field, value in item.dict().items():
        setattr(db_item, field, value)
    db.commit()
    db.refresh(db_item)
    return {"message": "Menu updated", "item": db_item}

@app.delete("/menu/{menu_id}", summary="Hapus menu", tags=["Menu"], operation_id="delete Menu")
def delete_menu_item(menu_id: str, db: Session = Depends(get_db)):
    """Menghapus menu dari database berdasarkan ID."""
    db_item = db.query(Menu).filter(Menu.menu_id == menu_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    db.delete(db_item)
    db.commit()
    return {"message": "Menu deleted"}

@app.post("/menu_suggestion", summary="Ajukan usulan menu", tags=["usulan menu"], operation_id="add usulan menu")
def suggest_menu(item: SuggestionItem, db: Session = Depends(get_db)):
    """Menambahkan usulan menu dari customer jika belum ada di menu utama maupun daftar usulan."""
    exist_main = db.query(Menu).filter(Menu.menu_name == item.menu_name).first()
    exist_suggested = db.query(MenuSuggestion).filter(MenuSuggestion.menu_name == item.menu_name).first()
    if exist_main or exist_suggested:
        return {
            "message": "Pantun: Ke pasar beli ketela, menu ini sudah ada ternyata 😅",
            "status": "duplicate"
        }
    usulan_id = generate_usulan_id()
    suggestion = MenuSuggestion(
        usulan_id=usulan_id,
        menu_name=item.menu_name,
        customer_name=item.customer_name
    )
    db.add(suggestion)
    db.commit()
    return {
        "message": "Langit cerah, hati lega — usulan kamu bisa jadi tren menu selanjutnya 🌟",
        "usulan_id": usulan_id,
        "status": "success"
    }

@app.get("/menu_suggestion", summary="Lihat semua usulan", tags=["Usulan Menu"], response_model=List[SuggestionOut], operation_id="list usulan menu")
def get_suggestions(db: Session = Depends(get_db)):
    """Menampilkan seluruh usulan menu terbaru dari pelanggan."""
    return db.query(MenuSuggestion).order_by(MenuSuggestion.timestamp.desc()).all()

@app.get("/health", summary="Health check", tags=["Utility"])
def health_check():
    """Cek apakah service menu sedang berjalan."""
    return {"status": "ok", "service": "menu_service"}

hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ menu_service sudah running di http://{local_ip}:8001 Operation Added ")

mcp.setup_server()