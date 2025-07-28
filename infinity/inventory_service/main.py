#inventory_service.py
from dotenv import load_dotenv
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi_mcp import FastApiMCP
from pytz import timezone as pytz_timezone
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text, Enum as SQLEnum
from fastapi import Depends
from pydantic import BaseModel, Field, validator, root_validator

import requests
import enum
import socket
import logging
import os
import json
from datetime import datetime


load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL_INVENTORY")
MENU_SERVICE_URL = os.getenv("MENU_SERVICE_URL", "http://menu_service:8003")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

app = FastAPI(
    title="Ingredient Service API",
    description="Service untuk mengelola bahan-bahan Infinity Cafe.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mcp = FastApiMCP(app, name="Server MCP Infinity", description="Server MCP Infinity Descr",
    include_operations=["add ingredient", "list ingredients", "update ingredient", "delete ingredient", "ingredient status", "ingredient stream"]
)
mcp.mount(mount_path="/mcp", transport="sse")
jakarta_tz = pytz_timezone('Asia/Jakarta')


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        
# subscribers = set()

class StockCategory (enum.Enum):
    Ingredient = "ingredient"
    Packaging = "packaging"
    
class UnitType(enum.Enum):
    Gram = "gram"
    Milliliter = "milliliter"
    Piece = "piece"
    
class Inventory(Base):
    __tablename__ = "inventories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)  
    current_quantity = Column(Float, default=0)
    minimum_quantity = Column(Float, default=0)
    category = Column(SQLEnum(StockCategory), index=True)
    unit = Column(SQLEnum(UnitType), index=True)

class InventoryOutbox(Base):
    __tablename__ = "inventory_outbox"
    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String, index=True)
    payload = Column(Text, nullable=False)
    processed = Column(Boolean, default=False)
    processed_at = Column(DateTime, nullable=True)
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    error_message = Column(Text, nullable=True)

class ValidateIngredientRequest(BaseModel):
    name: str
    current_quantity: float
    minimum_quantity: float
    category: StockCategory
    unit: UnitType
    
    @validator('name')
    def name_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError("Nama bahan tidak boleh kosong")
        # Uncomment the following line if you want to return a JSON response instead of raising an error
            # return JSONResponse(status_code=200, content={"status": "error", "message": "Name cannot be empty", "data": None})
        return v.strip()
    
    @root_validator
    def check_quantities(cls, values):
        current_quantity = values.get('current_quantity', 0)
        minimum_quantity = values.get('minimum_quantity', 0)

        if current_quantity < 0 or minimum_quantity < 0:
            # return JSONResponse(status_code=200, content={"status": "error", "message": "Quantity values must be non-negative", "data": None})
            raise ValueError("Jumlah bahan tidak boleh negatif")
        if current_quantity < minimum_quantity:
            # return JSONResponse(status_code=200, content={"status": "error", "message": "Current quantity cannot be less than minimum quantity", "data": None})
            raise ValueError("Jumlah bahan saat ini tidak boleh kurang dari jumlah bahan minimum")
        return values

class UpdateIngredientRequest(ValidateIngredientRequest):
    id: int = Field(..., description="ID bahan yang akan diupdate")
    name: str = Field(..., description="Nama bahan yang akan diupdate")
    current_quantity: float = Field(..., description="Jumlah bahan saat ini telah terupdate")
    minimum_quantity: float = Field(..., description="Jumlah bahan minimum saat ini telah terupdate")
    category: StockCategory = Field(..., description="Kategori bahan saat ini telah terupdate")
    unit: UnitType = Field(..., description="Satuan bahan saat ini telah terupdate")
    
# Model untuk request cek status stok bahan
class CheckStockStatusRequest(BaseModel):
    menu_name: str = Field(..., description="Nama menu untuk mengecek status stok bahan")
    quantity: int = Field(..., description="Jumlah bahan yang diperlukan untuk menu tersebut")
    
    @validator('menu_name')
    def menu_name_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError("Nama menu tidak boleh kosong")
        return v.strip()

# Fungsi helper untuk outbox
def create_outbox_event(db: Session, event_type: str, payload: dict):
    outbox_event = InventoryOutbox(
        event_type=event_type,
        payload=json.dumps(payload)
    )
    db.add(outbox_event)
    return outbox_event

def process_outbox_events(db: Session):
    """Memproses outbox events yang belum terkirim"""
    
    # Ambil events yang belum diproses dan masih bisa di-retry
    unprocessed_events = db.query(InventoryOutbox).filter(
        InventoryOutbox.processed == False,
        InventoryOutbox.retry_count < InventoryOutbox.max_retries
    ).all()
    
    for event in unprocessed_events:
        try:
            payload = json.loads(event.payload)
            
            if event.event_type == "ingredient_added":
                response = requests.post(
                    "http://menu_service:8003/receive_ingredient",
                    json=payload,
                    timeout=5
                )
                response.raise_for_status()
                
            elif event.event_type == "ingredient_updated":
                response = requests.put(
                    "http://menu_service:8003/update_ingredient",
                    json=payload,
                    timeout=5
                )
                response.raise_for_status()
            elif event.event_type == "ingredient_deleted":
                response = requests.delete(
                    f"http://menu_service:8003/delete_ingredient/{payload['id']}",
                    timeout=5
                )
                response.raise_for_status()
            
            event.processed = True
            event.processed_at = datetime.now(jakarta_tz)
            event.error_message = None
            
            logging.info(f"✅ Outbox event {event.id} berhasil diproses")
            
        except Exception as e:
            event.retry_count += 1
            event.error_message = str(e)
            
            if event.retry_count >= event.max_retries:
                logging.error(f"❌ Outbox event {event.id} gagal setelah {event.max_retries} percobaan: {e}")
            else:
                logging.warning(f"⚠️ Outbox event {event.id} gagal, akan dicoba lagi ({event.retry_count}/{event.max_retries}): {e}")
    
    db.commit()

# Endpoint untuk memproses outbox secara manual (untuk debugging)
@app.post("/admin/process_outbox", tags=["Admin"])
def manual_process_outbox(db: Session = Depends(get_db)):
    """Memproses outbox events secara manual"""
    process_outbox_events(db)
    return {"message": "Outbox events processed"}

# Endpoint untuk melihat status outbox
@app.get("/admin/outbox_status", tags=["Admin"])
def get_outbox_status(db: Session = Depends(get_db)):
    """Melihat status outbox events"""
    total_events = db.query(InventoryOutbox).count()
    processed_events = db.query(InventoryOutbox).filter(InventoryOutbox.processed == True).count()
    failed_events = db.query(InventoryOutbox).filter(
        InventoryOutbox.processed == False,
        InventoryOutbox.retry_count >= InventoryOutbox.max_retries
    ).count()
    
    return {
        "total_events": total_events,
        "processed_events": processed_events,
        "failed_events": failed_events,
        "pending_events": total_events - processed_events - failed_events
    }
@app.get("/list_ingredients", summary="Daftar bahan", tags=["Inventory"], operation_id="list ingredients")
def list_ingredients(db: Session = Depends(get_db)):
    """Mengambil daftar semua bahan yang ada di inventory."""
    ingredients = db.query(Inventory).all()
    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": "Daftar bahan berhasil diambil",
        "data": [ingredient.__dict__ for ingredient in ingredients]
    })

@app.post("/add_ingredient", summary="Tambah bahan baru", tags=["Inventory"], operation_id="add ingredient")
def add_ingredient(req: ValidateIngredientRequest, db: Session = Depends(get_db)):
    """Menambahkan stok bahan baru."""
    new_ingredient = Inventory(
        name=req.name,
        current_quantity=req.current_quantity,
        minimum_quantity=req.minimum_quantity,
        category=req.category,
        unit=req.unit
    )
    db.add(new_ingredient)
    db.commit()
    db.refresh(new_ingredient)
    # Buat event outbox untuk penambahan
    outbox_event = create_outbox_event(db, "ingredient_added", {
        "id": new_ingredient.id,
        "name": new_ingredient.name,
        "current_quantity": new_ingredient.current_quantity,
        "minimum_quantity": new_ingredient.minimum_quantity,
        "category": new_ingredient.category.value,
        "unit": new_ingredient.unit.value
    })
    db.add(outbox_event)
    db.commit()
    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": f"Bahan '{new_ingredient.name}' berhasil ditambahkan",
        "data": {
            "id": new_ingredient.id,
            "name": new_ingredient.name,
            "current_quantity": new_ingredient.current_quantity,
            "minimum_quantity": new_ingredient.minimum_quantity,
            "category": new_ingredient.category,
            "unit": new_ingredient.unit
        }
    })

@app.put("/update_ingredient", summary="Update bahan", tags=["Inventory"], operation_id="update ingredient")
def update_ingredient(req: UpdateIngredientRequest, db: Session = Depends(get_db)):
    """Mengupdate informasi bahan yang sudah ada."""
    ingredient = db.query(Inventory).filter(Inventory.id == req.id).first()
    if not ingredient:
        return {"error": "Bahan tidak ditemukan"}
    ingredient.name = req.name
    ingredient.current_quantity = req.current_quantity
    ingredient.minimum_quantity = req.minimum_quantity
    ingredient.category = req.category
    ingredient.unit = req.unit
    db.commit()
    db.refresh(ingredient)
    # Buat event outbox untuk update
    outbox_event = create_outbox_event(db, str(ingredient.id), "ingredient_updated", {
        "id": ingredient.id,
        "name": ingredient.name,
        "current_quantity": ingredient.current_quantity,
        "minimum_quantity": ingredient.minimum_quantity,
        "category": ingredient.category,
        "unit": ingredient.unit
    })
    db.add(outbox_event)
    db.commit()
    # Proses outbox events
    process_outbox_events(db)
    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": f"Bahan '{ingredient.name}' berhasil diupdate",
        "data": {
            "id": ingredient.id,
            "name": ingredient.name,
            "current_quantity": ingredient.current_quantity,
            "minimum_quantity": ingredient.minimum_quantity,
            "category": ingredient.category,
            "unit": ingredient.unit
        }
    })

@app.get("/health", summary="Health check", tags=["Utility"])
def health_check():
    """Cek status hidup service."""
    return {"status": "ok", "service": "inventory_service"}

@app.delete("/delete_ingredient/{ingredient_id}", summary="Hapus bahan", tags=["Inventory"], operation_id="delete ingredient")
def delete_ingredient(ingredient_id: int, db: Session = Depends(get_db)):
    """Menghapus bahan berdasarkan ID."""
    ingredient = db.query(Inventory).filter(Inventory.id == ingredient_id).first()
    if not ingredient:
        return JSONResponse(status_code=404, content={
            "status": "error",
            "message": "Bahan tidak ditemukan",
            "data": None
        })
    
    db.delete(ingredient)
    db.commit()
    
    # Buat event outbox untuk penghapusan
    outbox_event = create_outbox_event(db, str(ingredient.id), "ingredient_deleted", {"id": ingredient.id})
    db.add(outbox_event)
    db.commit()
    
    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": f"Bahan '{ingredient.name}' berhasil dihapus",
        "data": None
    })
@app.post("/stock_status", summary="Cek status stok bahan", tags=["Inventory"], operation_id="check stock status")
def check_stock_status(req: CheckStockStatusRequest, db: Session = Depends(get_db)):
    """Endpoint untuk mengecek status stok bahan."""
    try :
        # Mengirim data json dari inventory_service ke menu_service agar dapat mendapatkan recipe dari setiap makanan/minuman
        response = requests.post(
            f"{MENU_SERVICE_URL}/",
        )
hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ inventory_service sudah running di http://{local_ip}:8005 ")
logging.info("Dokumentasi API tersedia di http://{local_ip}:8005/docs")

mcp.setup_server()