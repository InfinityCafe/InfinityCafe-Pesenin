from dotenv import load_dotenv
from fastapi.responses import JSONResponse
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi_mcp import FastApiMCP
from pydantic import BaseModel, Field, model_validator, field_validator
from typing import Optional
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, Text, Enum as SQLEnum, ForeignKey, func, and_
from sqlalchemy.orm import sessionmaker, declarative_base, Session, relationship
from sqlalchemy.exc import SQLAlchemyError
from pytz import timezone as pytz_timezone

last_debug_info = []
from datetime import datetime
import enum, os, json, logging, requests, math, socket, threading, time

jakarta_tz = pytz_timezone('Asia/Jakarta')

def format_jakarta_time(dt):
    """Format datetime to Jakarta timezone string"""
    if dt is None:
        return "Unknown"
    
    if dt.tzinfo is not None:
        jakarta_dt = dt.astimezone(jakarta_tz)
    else:
        utc_dt = pytz_timezone('UTC').localize(dt)
        jakarta_dt = utc_dt.astimezone(jakarta_tz)
    
    return jakarta_dt.strftime("%d/%m/%Y %H:%M:%S")

def get_jakarta_isoformat(dt):
    """Get datetime in Jakarta timezone ISO format"""
    if dt is None:
        return None
    
    if dt.tzinfo is not None:
        jakarta_dt = dt.astimezone(jakarta_tz)
    else:
        utc_dt = pytz_timezone('UTC').localize(dt)
        jakarta_dt = utc_dt.astimezone(jakarta_tz)
    
    return jakarta_dt.isoformat()

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL_INVENTORY")
MENU_SERVICE_URL = os.getenv("MENU_SERVICE_URL", "http://menu_service:8003")

if not DATABASE_URL:
    raise RuntimeError("Env DATABASE_URL_INVENTORY belum diset. Pastikan variabel environment tersedia di container.")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5, max_overflow=10)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

app = FastAPI(
    title="Inventory Service - Simplified",
    description="Service untuk mengelola stok Infinity Cafe (Versi Sederhana).",
    version="2.0.0"
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

class StockCategory(str, enum.Enum):
    packaging = "packaging"
    ingredients = "ingredients"
    coffee_flavors = "coffee_flavors"
    squash_flavors = "squash_flavors" 
    milk_shake_flavors = "milk_shake_flavors"

class UnitType(str, enum.Enum):
    gram = "gram"
    milliliter = "milliliter"
    piece = "piece"

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

class ConsumptionLog(Base):
    __tablename__ = "consumption_log"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    order_id = Column(String, index=True, unique=True)
    per_menu_payload = Column(Text)                 
    per_ingredient_payload = Column(Text, nullable=True)  
    consumed = Column(Boolean, default=False)
    rolled_back = Column(Boolean, default=False)    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(jakarta_tz))

class FlavorMapping(Base):
    __tablename__ = "flavor_mapping"
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    flavor_name = Column(String, index=True, unique=True)  
    ingredient_id = Column(Integer, ForeignKey('inventories.id'))  
    quantity_per_serving = Column(Float, default=25)  
    unit = Column(SQLEnum(UnitType), default=UnitType.milliliter) 
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(jakarta_tz))
    
    ingredient = relationship("Inventory", backref="flavor_mappings")

class ValidateIngredientRequest(BaseModel):
    name: str
    current_quantity: float
    minimum_quantity: float
    category: StockCategory
    unit: UnitType

    @field_validator('category', 'unit', mode='before')
    @classmethod
    def normalize_enum(cls, v):
        if isinstance(v, str):
            return v.lower().strip()
        return v
    
    @field_validator('category', 'unit', mode='after')
    @classmethod
    def lowercase_enum(cls, v):
        return v.value if isinstance(v, enum.Enum) else str(v).lower()

    @field_validator('name')
    @classmethod
    def name_not_blank(cls, v: str):
        if not v or not v.strip():
            raise ValueError("Nama bahan tidak boleh kosong")
        return v.strip()

    @model_validator(mode='after')
    def validate_qty(self):
        if self.current_quantity is None or self.minimum_quantity is None:
            raise ValueError("Jumlah harus diisi")
        if self.current_quantity < 0 or self.minimum_quantity < 0:
            raise ValueError("Jumlah tidak boleh negatif")
        if self.current_quantity < self.minimum_quantity:
            raise ValueError("Current quantity tidak boleh kurang dari minimum")
        return self

class UpdateIngredientRequest(ValidateIngredientRequest):
    id: int = Field(..., description="ID bahan yang akan diupdate")

class BatchStockItem(BaseModel):
    menu_name: str
    quantity: int = Field(gt=0)
    preference: Optional[str] = ""

class FlavorMappingRequest(BaseModel):
    flavor_name: str = Field(..., description="Nama flavor (e.g., 'Irish Max')")
    ingredient_id: int = Field(..., description="ID ingredient yang akan digunakan")
    quantity_per_serving: float = Field(25, description="Jumlah per porsi (25ml syrup atau 30g powder)")
    unit: UnitType = Field(UnitType.milliliter, description="Unit: milliliter, gram, atau piece")
    
    @field_validator('flavor_name')
    @classmethod
    def name_not_blank(cls, v: str):
        if not v or not v.strip():
            raise ValueError("Nama flavor tidak boleh kosong")
        return v.strip()

class FlavorMappingResponse(BaseModel):
    id: int
    flavor_name: str
    ingredient_id: int
    ingredient_name: str
    quantity_per_serving: float
    unit: str
    created_at: str

class BatchStockRequest(BaseModel):
    order_id: str
    items: list[BatchStockItem]

class BatchStockResponse(BaseModel):
    can_fulfill: bool
    shortages: list = Field(default_factory=list)
    partial_suggestions: list = Field(default_factory=list)
    details: list = Field(default_factory=list)
    debug_info: list = Field(default_factory=list)

def create_outbox_event(db: Session, event_type: str, payload: dict):
    outbox_event = InventoryOutbox(
        event_type=event_type,
        payload=json.dumps(payload)
    )
    db.add(outbox_event)
    return outbox_event

def process_outbox_events(db: Session):
    unprocessed = db.query(InventoryOutbox).filter(
        InventoryOutbox.processed.is_(False),
        InventoryOutbox.retry_count < InventoryOutbox.max_retries
    ).all()
    for ev in unprocessed:
        try:
            payload = json.loads(ev.payload)
            if ev.event_type == "ingredient_added":
                r = requests.post(f"{MENU_SERVICE_URL}/receive_ingredient_event", json=payload, timeout=5)
                r.raise_for_status()
            elif ev.event_type == "ingredient_updated":
                r = requests.put(f"{MENU_SERVICE_URL}/update_ingredient_event", json=payload, timeout=5)
                r.raise_for_status()
            elif ev.event_type == "ingredient_deleted":
                r = requests.delete(f"{MENU_SERVICE_URL}/delete_ingredient_event/{payload['id']}", timeout=5)
                r.raise_for_status()
            ev.processed = True
            ev.processed_at = datetime.now(jakarta_tz)
            ev.error_message = None
            logging.info(f"✅ Outbox {ev.id} {ev.event_type} terkirim")
        except Exception as e:
            ev.retry_count += 1
            ev.error_message = str(e)
            logging.warning(f"⚠️ Outbox {ev.id} gagal ({ev.retry_count}/{ev.max_retries}): {e}")
    db.commit()

@app.post("/admin/process_outbox", tags=["Admin"])
def manual_outbox(db: Session = Depends(get_db)):
    try:
        process_outbox_events(db)
        return JSONResponse(status_code=200, content={
            "status": "success", 
            "message": "Outbox events berhasil diproses", 
            "data": None
        })
    except Exception as e:
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Gagal memproses outbox events: {str(e)}", 
            "data": None
        })

@app.get("/admin/outbox_status", tags=["Admin"])
def outbox_status(db: Session = Depends(get_db)):
    try:
        total = db.query(InventoryOutbox).count()
        processed = db.query(InventoryOutbox).filter(InventoryOutbox.processed.is_(True)).count()
        failed = db.query(InventoryOutbox).filter(
            InventoryOutbox.processed.is_(False),
            InventoryOutbox.retry_count >= InventoryOutbox.max_retries
        ).count()
        
        status_data = {
            "total": total,
            "processed": processed,
            "failed": failed,
            "pending": total - processed - failed
        }
        
        return JSONResponse(status_code=200, content={
            "status": "success",
            "message": f"Status outbox: {total} total, {status_data['pending']} pending",
            "data": status_data
        })
        
    except Exception as e:
        return JSONResponse(status_code=200, content={
            "status": "error",
            "message": f"Gagal mengambil status outbox: {str(e)}",
            "data": None
        })

@app.get("/list_ingredients", summary="Daftar bahan", tags=["Inventory"], operation_id="list ingredients")
def list_ingredients(db: Session = Depends(get_db)):
    try:
        rows = db.query(Inventory).order_by(Inventory.id.asc()).all()
        ingredients_data = [
            {
                "id": r.id,
                "name": r.name,
                "current_quantity": r.current_quantity,
                "minimum_quantity": r.minimum_quantity,
                "category": r.category.value,
                "unit": r.unit.value
            } for r in rows
        ]
        
        return JSONResponse(status_code=200, content={
            "status": "success",
            "message": f"Berhasil mengambil {len(ingredients_data)} data bahan",
            "data": ingredients_data
        })
        
    except Exception as e:
        return JSONResponse(status_code=200, content={
            "status": "error",
            "message": f"Gagal mengambil data bahan: {str(e)}",
            "data": None
        })

@app.post("/add_ingredient", summary="Tambah bahan baru", tags=["Inventory"], operation_id="add ingredient")
def add_ingredient(req: ValidateIngredientRequest, db: Session = Depends(get_db)):
    print(f"🚀 DEBUG: Starting add_ingredient for: {req.name}")
    logging.info(f"🚀 DEBUG: Starting add_ingredient for: {req.name}")
    try:
        ing = Inventory(
            name=req.name,
            current_quantity=req.current_quantity,
            minimum_quantity=req.minimum_quantity,
            category=req.category,
            unit=req.unit
        )
        print(f"📝 DEBUG: Created inventory object: {ing.name} - {ing.category} - {ing.unit}")
        logging.info(f"📝 DEBUG: Created inventory object: {ing.name} - {ing.category} - {ing.unit}")
        db.add(ing)
        db.commit()
        db.refresh(ing)
        print(f"💾 DEBUG: Saved to database with ID: {ing.id}")
        logging.info(f"💾 DEBUG: Saved to database with ID: {ing.id}")
        
        create_outbox_event(db, "ingredient_added", {
            "id": ing.id,
            "name": ing.name,
            "current_quantity": ing.current_quantity,
            "minimum_quantity": ing.minimum_quantity,
            "category": ing.category.value,
            "unit": ing.unit.value
        })
        
        print(f"🔍 DEBUG: Checking auto-flavor-mapping for {ing.name}: category={ing.category}, unit={ing.unit}")
        logging.info(f"🔍 DEBUG: Checking auto-flavor-mapping for {ing.name}: category={ing.category}, unit={ing.unit}")
        
        if (ing.category == StockCategory.ingredient and 
            ing.unit in [UnitType.milliliter, UnitType.gram]):
            
            print(f"🎯 DEBUG: Conditions met for auto-flavor-mapping: {ing.name}")
            logging.info(f"🎯 DEBUG: Conditions met for auto-flavor-mapping: {ing.name}")
            
            try:
                existing_flavor = db.query(FlavorMapping).filter(FlavorMapping.flavor_name == ing.name).first()
                if existing_flavor:
                    logging.info(f"⚠️ DEBUG: Flavor mapping for '{ing.name}' already exists, skipping")
                else:
                    default_quantity = 25 if ing.unit == UnitType.milliliter else 30
                    
                    flavor_mapping = FlavorMapping(
                        flavor_name=ing.name,
                        ingredient_id=ing.id,
                        quantity_per_serving=default_quantity,
                        unit=ing.unit
                    )
                    db.add(flavor_mapping)
                    logging.info(f"✅ Auto-created flavor mapping: {ing.name} -> ID {ing.id} ({default_quantity}{ing.unit.value})")
                
            except Exception as flavor_error:
                logging.warning(f"⚠️ Failed to auto-create flavor mapping for {ing.name}: {flavor_error}")
        else:
            logging.info(f"⏭️ DEBUG: Skipping auto-flavor-mapping for {ing.name} - conditions not met")
        
        db.commit()
        process_outbox_events(db)
        
        return {
            "status": "success", 
            "message": f"Bahan '{ing.name}' berhasil ditambahkan", 
            "data": {
                "id": ing.id,
                "name": ing.name,
                "current_quantity": ing.current_quantity,
                "minimum_quantity": ing.minimum_quantity,
                "category": ing.category.value,
                "unit": ing.unit.value
            }
        }
        
    except Exception as e:
        db.rollback()
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Gagal menambahkan bahan: {str(e)}", 
            "data": None
        })

@app.post("/add_flavor_mapping", summary="Tambah mapping flavor ke ingredient", tags=["Flavor Management"])
def add_flavor_mapping(req: FlavorMappingRequest, db: Session = Depends(get_db)):
    """Menambahkan mapping flavor baru ke ingredient yang sudah ada"""
    try:
        ingredient = db.query(Inventory).filter(Inventory.id == req.ingredient_id).first()
        if not ingredient:
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": f"Ingredient dengan ID {req.ingredient_id} tidak ditemukan",
                "data": None
            })
        
        existing = db.query(FlavorMapping).filter(FlavorMapping.flavor_name == req.flavor_name).first()
        if existing:
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": f"Flavor '{req.flavor_name}' sudah ada dalam mapping",
                "data": None
            })
        
        mapping = FlavorMapping(
            flavor_name=req.flavor_name,
            ingredient_id=req.ingredient_id,
            quantity_per_serving=req.quantity_per_serving,
            unit=req.unit
        )
        db.add(mapping)
        db.commit()
        db.refresh(mapping)
        
        return {
            "status": "success",
            "message": f"Flavor mapping '{req.flavor_name}' berhasil ditambahkan",
            "data": {
                "id": mapping.id,
                "flavor_name": mapping.flavor_name,
                "ingredient_id": mapping.ingredient_id,
                "ingredient_name": ingredient.name,
                "quantity_per_serving": mapping.quantity_per_serving,
                "unit": mapping.unit.value,
                "created_at": get_jakarta_isoformat(mapping.created_at)
            }
        }
        
    except Exception as e:
        db.rollback()
        return JSONResponse(status_code=200, content={
            "status": "error",
            "message": f"Gagal menambahkan flavor mapping: {str(e)}",
            "data": None
        })

@app.get("/debug/flavor_mappings", summary="Debug flavor mappings", tags=["Debug"])
def debug_flavor_mappings(db: Session = Depends(get_db)):
    """Debug endpoint untuk flavor mappings"""
    try:
        total_count = db.query(FlavorMapping).count()
        
        mappings = db.query(FlavorMapping).all()
        
        debug_info = []
        for i, mapping in enumerate(mappings):
            try:
                ingredient = db.query(Inventory).filter(Inventory.id == mapping.ingredient_id).first()
                debug_info.append({
                    "index": i,
                    "mapping_id": mapping.id,
                    "flavor_name": mapping.flavor_name,
                    "ingredient_id": mapping.ingredient_id,
                    "ingredient_found": ingredient is not None,
                    "ingredient_name": ingredient.name if ingredient else "NOT_FOUND",
                    "created_at_is_none": mapping.created_at is None,
                    "created_at_raw": str(mapping.created_at),
                    "unit_is_none": mapping.unit is None,
                    "unit_value": mapping.unit.value if mapping.unit else "NO_UNIT"
                })
            except Exception as e:
                debug_info.append({
                    "index": i,
                    "error": str(e),
                    "mapping_id": getattr(mapping, 'id', 'NO_ID')
                })
        
        return {
            "status": "debug_success",
            "total_mappings": total_count,
            "processed_mappings": len(debug_info),
            "debug_data": debug_info
        }
        
    except Exception as e:
        return {
            "status": "debug_error",
            "message": str(e),
            "traceback": str(e.__class__.__name__)
        }

@app.get("/list_flavor_mappings", summary="Daftar semua flavor mapping", tags=["Flavor Management"])
def list_flavor_mappings(db: Session = Depends(get_db)):
    """Menampilkan semua flavor mapping yang tersedia"""
    try:
        mappings = db.query(FlavorMapping).all()
        
        data = []
        for mapping in mappings:
            ingredient = db.query(Inventory).filter(Inventory.id == mapping.ingredient_id).first()
            ingredient_name = ingredient.name if ingredient else "Unknown"
            
            data.append({
                "id": mapping.id,
                "flavor_name": mapping.flavor_name,
                "ingredient_id": mapping.ingredient_id,
                "ingredient_name": ingredient_name,
                "quantity_per_serving": mapping.quantity_per_serving,
                "unit": mapping.unit.value if mapping.unit else "unknown",
                "created_at": format_jakarta_time(mapping.created_at) if mapping.created_at else "Unknown"
            })
        
        return {
            "status": "success",
            "message": f"Ditemukan {len(data)} flavor mapping",
            "data": data
        }
        
    except Exception as e:
        return JSONResponse(status_code=200, content={
            "status": "error",
            "message": f"Gagal mengambil flavor mapping: {str(e)}",
            "data": []
        })

@app.delete("/delete_flavor_mapping/{mapping_id}", summary="Hapus flavor mapping", tags=["Flavor Management"])
def delete_flavor_mapping(mapping_id: int, db: Session = Depends(get_db)):
    """Menghapus flavor mapping berdasarkan ID"""
    try:
        mapping = db.query(FlavorMapping).filter(FlavorMapping.id == mapping_id).first()
        if not mapping:
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": f"Flavor mapping dengan ID {mapping_id} tidak ditemukan",
                "data": None
            })
        
        flavor_name = mapping.flavor_name
        db.delete(mapping)
        db.commit()
        
        return {
            "status": "success",
            "message": f"Flavor mapping '{flavor_name}' berhasil dihapus",
            "data": None
        }
        
    except Exception as e:
        db.rollback()
        return JSONResponse(status_code=200, content={
            "status": "error",
            "message": f"Gagal menghapus flavor mapping: {str(e)}",
            "data": None
        })

@app.put("/update_flavor_mapping/{mapping_id}", summary="Update flavor mapping", tags=["Flavor Management"])
def update_flavor_mapping(mapping_id: int, req: FlavorMappingRequest, db: Session = Depends(get_db)):
    """Mengupdate flavor mapping yang sudah ada"""
    try:
        mapping = db.query(FlavorMapping).filter(FlavorMapping.id == mapping_id).first()
        if not mapping:
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": f"Flavor mapping dengan ID {mapping_id} tidak ditemukan",
                "data": None
            })
        
        ingredient = db.query(Inventory).filter(Inventory.id == req.ingredient_id).first()
        if not ingredient:
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": f"Ingredient dengan ID {req.ingredient_id} tidak ditemukan",
                "data": None
            })
        
        existing = db.query(FlavorMapping).filter(
            FlavorMapping.flavor_name == req.flavor_name,
            FlavorMapping.id != mapping_id
        ).first()
        if existing:
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": f"Flavor '{req.flavor_name}' sudah digunakan oleh mapping lain",
                "data": None
            })
        
        mapping.flavor_name = req.flavor_name
        mapping.ingredient_id = req.ingredient_id
        mapping.quantity_per_serving = req.quantity_per_serving
        mapping.unit = req.unit
        
        db.commit()
        db.refresh(mapping)
        
        return {
            "status": "success",
            "message": f"Flavor mapping berhasil diupdate",
            "data": {
                "id": mapping.id,
                "flavor_name": mapping.flavor_name,
                "ingredient_id": mapping.ingredient_id,
                "ingredient_name": ingredient.name,
                "quantity_per_serving": mapping.quantity_per_serving,
                "unit": mapping.unit.value,
                "created_at": format_jakarta_time(mapping.created_at) if mapping.created_at else "Unknown"
            }
        }
        
    except Exception as e:
        db.rollback()
        return JSONResponse(status_code=200, content={
            "status": "error",
            "message": f"Gagal mengupdate flavor mapping: {str(e)}",
            "data": None
        })

@app.put("/update_ingredient", summary="Update bahan", tags=["Inventory"], operation_id="update ingredient")
def update_ingredient(req: UpdateIngredientRequest, db: Session = Depends(get_db)):
    ing = db.query(Inventory).filter(Inventory.id == req.id).first()
    if not ing:
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": "Bahan tidak ditemukan", 
            "data": None
        })
    
    try:
        ing.name = req.name
        ing.current_quantity = req.current_quantity
        ing.minimum_quantity = req.minimum_quantity
        ing.category = req.category
        ing.unit = req.unit
        db.commit()
        
        create_outbox_event(db, "ingredient_updated", {
            "id": ing.id,
            "name": ing.name,
            "current_quantity": ing.current_quantity,
            "minimum_quantity": ing.minimum_quantity,
            "category": ing.category.value,
            "unit": ing.unit.value
        })
        db.commit()
        process_outbox_events(db)
        
        return JSONResponse(status_code=200, content={
            "status": "success", 
            "message": f"Bahan '{ing.name}' berhasil diupdate", 
            "data": {
                "id": ing.id,
                "name": ing.name,
                "current_quantity": ing.current_quantity,
                "minimum_quantity": ing.minimum_quantity,
                "category": ing.category.value,
                "unit": ing.unit.value
            }
        })
        
    except Exception as e:
        db.rollback()
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Gagal mengupdate bahan: {str(e)}", 
            "data": None
        })

@app.delete("/delete_ingredient/{ingredient_id}", summary="Hapus bahan", tags=["Inventory"], operation_id="delete ingredient")
def delete_ingredient(ingredient_id: int, db: Session = Depends(get_db)):
    try:
        ing = db.query(Inventory).filter(Inventory.id == ingredient_id).first()
        if not ing:
            return JSONResponse(status_code=200, content={
                "status": "error", 
                "message": "Bahan tidak ditemukan", 
                "data": None
            })
        
        name = ing.name
        ingredient_data = {
            "id": ing.id,
            "name": ing.name,
            "current_quantity": ing.current_quantity,
            "minimum_quantity": ing.minimum_quantity,
            "category": ing.category.value,
            "unit": ing.unit.value
        }
        
        db.delete(ing)
        db.commit()
        
        create_outbox_event(db, "ingredient_deleted", {"id": ingredient_id, "name": name})
        db.commit()
        process_outbox_events(db)
        
        return JSONResponse(status_code=200, content={
            "status": "success", 
            "message": f"Bahan '{name}' berhasil dihapus", 
            "data": ingredient_data
        })
        
    except Exception as e:
        db.rollback()
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Gagal menghapus bahan: {str(e)}", 
            "data": None
        })

@app.get("/health", summary="Health check", tags=["Utility"])
def health():
    return JSONResponse(status_code=200, content={
        "status": "success", 
        "message": "Inventory service berjalan dengan baik", 
        "data": {
            "service": "inventory_service",
            "timestamp": datetime.now(jakarta_tz).isoformat()
        }
    })

@app.post("/stock/check", summary="Cek ketersediaan stok", tags=["Stock Management"])
def check_stock(req: BatchStockRequest, db: Session = Depends(get_db)):
    """Cek ketersediaan stok untuk pesanan (tanpa mengubah stok)"""
    try:
        result = check_and_consume(req, db, consume=False)
        
        if result.can_fulfill:
            return {
                "success": True,
                "message": "Stok tersedia untuk semua pesanan",
                "order_id": req.order_id,
                "can_process": True
            }
        else:
            return {
                "success": False, 
                "message": "Stok tidak mencukupi",
                "order_id": req.order_id,
                "can_process": False,
                "missing_items": [s.get("ingredient_name", "Unknown") for s in result.shortages]
            }
    except Exception as e:
        return {"success": False, "message": f"Error: {str(e)}", "can_process": False}


@app.post("/stock/check_availability", summary="Cek ketersediaan stok untuk order (format baru)", tags=["Stock Management"])
def check_availability(req: BatchStockRequest, db: Session = Depends(get_db)):
    """Cek ketersediaan stok untuk pesanan dengan format response yang sesuai order_service"""
    try:
        result = check_and_consume(req, db, consume=False)
        
        if result.can_fulfill:
            return {
                "can_fulfill": True,
                "success": True,
                "message": "Stok tersedia untuk semua pesanan",
                "order_id": req.order_id
            }
        else:
            formatted_shortages = []
            for shortage in result.shortages:
                formatted_shortages.append({
                    "ingredient_id": shortage.get("ingredient_id", "unknown"),
                    "required": shortage.get("required", 0),
                    "available": shortage.get("available", 0),
                    "ingredient_name": shortage.get("ingredient_name", "Unknown")
                })
            
            return {
                "can_fulfill": False,
                "success": False,
                "message": "Stok tidak mencukupi",
                "order_id": req.order_id,
                "shortages": formatted_shortages
            }
    except Exception as e:
        logging.error(f"Error in check_availability: {e}")
        return {
            "can_fulfill": False,
            "success": False, 
            "message": f"Error checking availability: {str(e)}",
            "order_id": req.order_id
        }


@app.post("/stock/consume", summary="Konsumsi stok untuk pesanan", tags=["Stock Management"])  
def consume_stock(req: BatchStockRequest, db: Session = Depends(get_db)):
    """Kurangi stok untuk pesanan yang sudah dikonfirmasi"""
    try:
        result = check_and_consume(req, db, consume=True)
        
        if result.can_fulfill:
            return {
                "success": True,
                "message": "Stok berhasil dikurangi",
                "order_id": req.order_id,
                "processed": True
            }
        else:
            return {
                "success": False,
                "message": "Tidak dapat memproses - stok tidak cukup", 
                "order_id": req.order_id,
                "processed": False
            }
    except Exception as e:
        return {"success": False, "message": f"Error: {str(e)}", "processed": False}

@app.get("/stock/alerts", summary="Ingredient yang butuh restock", tags=["Stock Management"])
def get_stock_alerts(db: Session = Depends(get_db)):
    """Daftar ingredient yang perlu direstock (format sederhana)"""
    
    inventories = db.query(Inventory).all()
    
    alerts = {
        "critical": [],  
        "low": [],       
        "ok": []         
    }
    
    for inv in inventories:
        item = {
            "id": inv.id,
            "name": inv.name,
            "current": inv.current_quantity,
            "minimum": inv.minimum_quantity,
            "unit": inv.unit.value
        }
        
        if inv.current_quantity <= 0:
            item["status"] = "HABIS"
            alerts["critical"].append(item)
        elif inv.current_quantity < inv.minimum_quantity:
            item["status"] = "RENDAH"
            alerts["low"].append(item)
        else:
            item["status"] = "AMAN"
            alerts["ok"].append(item)
    
    critical_count = len(alerts["critical"])
    low_count = len(alerts["low"])
    
    if critical_count > 0:
        message = f"URGENT: {critical_count} ingredient habis!"
    elif low_count > 0:
        message = f"WARNING: {low_count} ingredient butuh restock"
    else:
        message = "Semua stok dalam kondisi baik"
    
    return {
        "success": True,
        "message": message,
        "summary": {
            "critical": critical_count,
            "low": low_count, 
            "ok": len(alerts["ok"])
        },
        "alerts": alerts
    }

class StockAddRequest(BaseModel):
    ingredient_id: int = Field(..., description="ID ingredient yang akan ditambah stoknya")
    add_quantity: float = Field(..., gt=0, description="Jumlah stok yang akan ditambahkan (harus positif)")
    reason: Optional[str] = Field("Penambahan stok manual", description="Alasan penambahan stok")

class MinimumStockRequest(BaseModel):
    ingredient_id: int = Field(..., description="ID ingredient")
    new_minimum: float = Field(..., ge=0, description="Batas minimum baru (tidak boleh negatif)")
    reason: Optional[str] = Field("Update batas minimum", description="Alasan perubahan batas minimum")

class BulkStockAddRequest(BaseModel):
    items: list[StockAddRequest] = Field(..., min_length=1, description="Daftar ingredient untuk penambahan stok")


@app.post("/stock/update/{ingredient_id}", summary="Update stok ingredient", tags=["Stock Management"])
def update_ingredient_stock(
    ingredient_id: int,
    new_quantity: float,
    reason: str = "Manual update",
    db: Session = Depends(get_db)
):
    """Update stok ingredient secara manual"""
    
    ingredient = db.query(Inventory).filter(Inventory.id == ingredient_id).first()
    if not ingredient:
        return {"success": False, "message": "Ingredient tidak ditemukan"}
    
    try:
        old_quantity = ingredient.current_quantity
        ingredient.current_quantity = new_quantity
        db.commit()
        
        return {
            "success": True,
            "message": f"Stok {ingredient.name} berhasil diupdate",
            "ingredient": ingredient.name,
            "old_quantity": old_quantity,
            "new_quantity": new_quantity,
            "unit": ingredient.unit.value,
            "reason": reason
        }
    except Exception as e:
        db.rollback()
        return {"success": False, "message": f"Error: {str(e)}"}

class StockRequestPayload(BaseModel):
    order_id: str
    items: list[BatchStockItem]

@app.post("/stock/check_and_consume", 
          response_model=BatchStockResponse, 
          tags=["⚠️ Legacy Endpoints"], 
          operation_id="check and consume stock",
          deprecated=True,
          summary="[DEPRECATED] Gunakan /stock/check_availability atau /stock/consume")
def check_and_consume(
    req: BatchStockRequest,
    db: Session = Depends(get_db),
    consume: bool = Query(True, description="DEPRECATED: Gunakan endpoint terpisah yang lebih jelas")
):
    
    global last_debug_info 
    debug_info = []  
    
    existing = db.query(ConsumptionLog).filter(ConsumptionLog.order_id == req.order_id).first()
    if existing and existing.consumed and not existing.rolled_back:
        return BatchStockResponse(
            can_fulfill=True,
            shortages=[],
            partial_suggestions=[],
            details=json.loads(existing.per_menu_payload)
        )

    try:
        resp = requests.post(
            f"{MENU_SERVICE_URL}/recipes/batch",
            json={"menu_names": [i.menu_name for i in req.items]},
            timeout=6
        )
        resp.raise_for_status()
        recipes = resp.json().get("recipes", {})
    except Exception as e:
        return BatchStockResponse(can_fulfill=False, shortages=[{"error": f"Gagal ambil resep: {e}"}], partial_suggestions=[], details=[], debug_info=[])

    need_map = {} 
    per_menu_detail = []
    shortages = []
    
    for it in req.items:
        r_items = recipes.get(it.menu_name, [])
        per_menu_detail.append({
            "menu_name": it.menu_name,
            "recipe_count": len(r_items),
            "requested_qty": it.quantity
        })
        if not r_items:
            shortages.append({"reason": "Menu tanpa resep", "menu_name": it.menu_name})
        
        for r in r_items:
            ing_id = r["ingredient_id"]
            need_map.setdefault(ing_id, {"needed": 0, "unit": r["unit"], "menus": set()})
            need_map[ing_id]["needed"] += r["quantity"] * it.quantity
            need_map[ing_id]["menus"].add(it.menu_name)
        
        preference = it.preference or ""  
        print(f"🔍 DEBUG: Checking preference for {it.menu_name}: '{preference}'")
        debug_info.append(f"Checking preference for {it.menu_name}: '{preference}'")
        if preference:
            flavor_mapping = db.query(FlavorMapping).filter(
                FlavorMapping.flavor_name == preference
            ).first()
            
            if flavor_mapping:
                flavor_id = flavor_mapping.ingredient_id
                flavor_qty = flavor_mapping.quantity_per_serving  
                flavor_unit = flavor_mapping.unit.value  
                
                if it.menu_name in ["Milkshake"] or "milkshake" in it.menu_name.lower():
                    if flavor_mapping.unit == UnitType.gram:
                        flavor_qty = max(flavor_qty, 30)
                elif "squash" in it.menu_name.lower():
                    if flavor_mapping.unit == UnitType.milliliter:
                        flavor_qty = min(flavor_qty, 20)
                elif any(keyword in it.menu_name.lower() for keyword in ["custom", "special", "premium"]):
                    if flavor_mapping.unit == UnitType.milliliter:
                        flavor_qty = flavor_qty * 1.4  
                
                need_map.setdefault(flavor_id, {"needed": 0, "unit": flavor_unit, "menus": set()})
                need_map[flavor_id]["needed"] += flavor_qty * it.quantity
                need_map[flavor_id]["menus"].add(f"{it.menu_name} ({preference})")
                
                print(f"🎯 DEBUG: Added flavor {preference} (ID:{flavor_id}) {flavor_qty}{flavor_unit} for {it.menu_name}")
                debug_info.append(f"Added flavor {preference} (ID:{flavor_id}) {flavor_qty}{flavor_unit} for {it.menu_name}")
            else:
                print(f"⚠️ DEBUG: Flavor '{preference}' tidak ditemukan dalam mapping untuk menu {it.menu_name}")
                debug_info.append(f"Flavor '{preference}' tidak ditemukan dalam mapping untuk menu {it.menu_name}")

    inv_map = {}
    if need_map:
        ids = list(need_map.keys())
        invs = db.query(Inventory).filter(Inventory.id.in_(ids)).with_for_update().all()
        inv_map = {i.id: i for i in invs}
        
    out_of_stock_items = [] 
    for ing_id, data in need_map.items():
        inv = inv_map.get(ing_id)
        available = inv.current_quantity if inv else 0
        
        if available <= 0:
            out_of_stock_items.append({
                "ingredient_id": ing_id,
                "ingredient_name": inv.name if inv else f"ID-{ing_id}",
                "required": data["needed"],
                "available": 0,
                "unit": data["unit"],
                "menus": list(data["menus"]),
                "status": "HABIS TOTAL"
            })
        elif available < data["needed"]:
            shortages.append({
                "ingredient_id": ing_id,
                "ingredient_name": inv.name if inv else f"ID-{ing_id}",
                "required": data["needed"],
                "available": available,
                "unit": data["unit"],
                "menus": list(data["menus"]),
                "status": "STOK KURANG"
            })
    
    if out_of_stock_items:
        out_of_stock_names = [item["ingredient_name"] for item in out_of_stock_items]
        return BatchStockResponse(
            can_fulfill=False,
            shortages=out_of_stock_items + shortages,
            partial_suggestions=[],
            details=per_menu_detail,
            debug_info=[f"❌ PESANAN DITOLAK: Stok habis untuk {', '.join(out_of_stock_names)}"]
        )

    if shortages:
        shortage_messages = []
        for shortage in shortages:
            if shortage.get("status") == "STOK KURANG":
                shortage_messages.append(
                    f"{shortage['ingredient_name']}: perlu {shortage['required']}{shortage['unit']}, "
                    f"tersedia {shortage['available']}{shortage['unit']}"
                )
        
        partial = []
        for it in req.items:
            r_items = recipes.get(it.menu_name, [])
            if not r_items:
                continue
            max_make = math.inf
            for r in r_items:
                inv = inv_map.get(r["ingredient_id"])
                if not inv or r["quantity"] <= 0:
                    max_make = 0
                    break
                if inv.current_quantity <= 0:
                    max_make = 0
                    break
                possible = math.floor(inv.current_quantity / r["quantity"])
                if possible < max_make:
                    max_make = possible
                if max_make == 0:
                    break
            if max_make < it.quantity:
                partial.append({
                    "menu_name": it.menu_name,
                    "requested": it.quantity,
                    "can_make": int(max_make)
                })
        
        error_message = "Stok tidak mencukupi. "
        if shortage_messages:
            error_message += "Detail kekurangan: " + "; ".join(shortage_messages[:3])  
            if len(shortage_messages) > 3:
                error_message += f" dan {len(shortage_messages) - 3} item lainnya"
        
        return BatchStockResponse(
            can_fulfill=False,
            shortages=shortages,
            partial_suggestions=partial,
            details=per_menu_detail,
            debug_info=[error_message]
        )

    if not consume:
        if not existing:
            db.add(ConsumptionLog(
                order_id=req.order_id,
                per_menu_payload=json.dumps(per_menu_detail),
                consumed=False
            ))
            db.commit()
        last_debug_info = debug_info
        return BatchStockResponse(can_fulfill=True, shortages=[], partial_suggestions=[], details=per_menu_detail, debug_info=debug_info)

    per_ing_detail = []
    try:
        for ing_id, data in need_map.items():
            inv = inv_map[ing_id]
            if inv.current_quantity <= 0:
                raise ValueError(f"❌ GAGAL: {inv.name} stok habis ({inv.current_quantity}) - tidak dapat memproses pesanan")
            if inv.current_quantity < data["needed"]:
                raise ValueError(f"❌ GAGAL: {inv.name} stok tidak cukup - perlu {data['needed']}, tersedia {inv.current_quantity}")
        
        for ing_id, data in need_map.items():
            inv = inv_map[ing_id]
            before = inv.current_quantity
            deducted = data["needed"]
            
            inv.current_quantity -= deducted
            
            if inv.current_quantity < 0:
                raise ValueError(f"❌ FATAL: Stok {inv.name} menjadi negatif ({inv.current_quantity}) setelah dikurangi {deducted}")
            
            per_ing_detail.append({
                "ingredient_id": ing_id,
                "ingredient_name": inv.name,
                "deducted": data["needed"],
                "before": before,
                "after": inv.current_quantity,
                "unit": data["unit"]
            })
        if existing:
            existing.per_menu_payload = json.dumps(per_menu_detail)
            existing.per_ingredient_payload = json.dumps(per_ing_detail)
            existing.consumed = True
        else:
            db.add(ConsumptionLog(
                order_id=req.order_id,
                per_menu_payload=json.dumps(per_menu_detail),
                per_ingredient_payload=json.dumps(per_ing_detail),
                consumed=True
            ))
        db.commit()
        logging.info(f"✅ Stok berhasil dikonsumsi untuk order {req.order_id}: {len(per_ing_detail)} ingredients")
        last_debug_info = debug_info
        return BatchStockResponse(can_fulfill=True, shortages=[], partial_suggestions=[], details=per_menu_detail, debug_info=debug_info)
    except Exception as e:
        db.rollback()
        logging.error(f"❌ Gagal konsumsi stok untuk order {req.order_id}: {e}")
        return BatchStockResponse(can_fulfill=False, shortages=[{"error": f"Gagal konsumsi stok: {e}"}], partial_suggestions=[], details=[], debug_info=debug_info)

@app.post("/stock/rollback/{order_id}", summary="Rollback stok yang sudah dikonsumsi", tags=["Stock Management"])
def rollback_stock(order_id: str, db: Session = Depends(get_db)):
    """Mengembalikan stok yang sudah dikonsumsi untuk order yang dibatalkan"""
    
    log = db.query(ConsumptionLog).filter(ConsumptionLog.order_id == order_id).first()
    if not log or not log.consumed:
        return {"success": False, "message": "Tidak ada konsumsi untuk order ini"}
    if log.rolled_back:
        return {"success": True, "message": "Sudah pernah di-rollback"}
    
    try:
        per_ing = json.loads(log.per_ingredient_payload or "[]")
        restored_count = 0
        
        for detail in per_ing:
            ingredient = db.query(Inventory).filter(
                Inventory.id == detail["ingredient_id"]
            ).first()
            if ingredient:
                ingredient.current_quantity += detail["deducted"]
                restored_count += 1
        
        log.rolled_back = True
        db.commit()
        
        return {
            "success": True,
            "message": f"Rollback berhasil untuk order {order_id}",
            "restored_ingredients": restored_count
        }
    except Exception as e:
        db.rollback()
        return {"success": False, "message": f"Error rollback: {str(e)}"}

@app.get("/flavors", summary="Daftar flavor yang tersedia", tags=["Utility"])
def get_available_flavors(db: Session = Depends(get_db)):
    """Daftar flavor yang bisa digunakan untuk pesanan - diambil dinamis dari database"""
    try:
        flavors = db.query(FlavorMapping.flavor_name).distinct().all()
        flavor_list = [flavor[0] for flavor in flavors]
        flavor_list.sort()
        
        return {
            "success": True,
            "total_flavors": len(flavor_list),
            "flavors": flavor_list
        }
    except Exception as e:
        logging.error(f"Error getting flavors from database: {e}")
        return {
            "success": True,
            "total_flavors": 22,
            "flavors": [
                "Butterscotch", "French Mocha", "Roasted Almond", "Creme Brulee",
                "Irish", "Havana", "Salted Caramel", "Mangga", "Permenkaret",
                "Tiramisu", "Redvelvet", "Strawberry", "Vanilla", "Chocolate",
                "Taro", "Milktea", "Banana", "Alpukat", "Green Tea", "Markisa",
                "Melon", "Nanas"
            ],
            "note": "Fallback data - database error occurred"
        }

@app.get("/flavors/detailed", summary="Daftar flavor dengan detail ingredient", tags=["Utility"])
def get_detailed_flavors(db: Session = Depends(get_db)):
    """Daftar flavor lengkap dengan detail ingredient yang digunakan"""
    try:
        flavor_details = db.query(
            FlavorMapping.flavor_name,
            FlavorMapping.ingredient_id,
            FlavorMapping.quantity_per_serving,
            FlavorMapping.unit,
            Inventory.name.label('ingredient_name'),
            Inventory.category
        ).join(
            Inventory, FlavorMapping.ingredient_id == Inventory.id
        ).all()
        
        flavors_list = []
        for detail in flavor_details:
            flavors_list.append({
                "flavor_name": detail.flavor_name,
                "ingredient_info": {
                    "ingredient_id": detail.ingredient_id,
                    "ingredient_name": detail.ingredient_name,
                    "quantity_per_serving": detail.quantity_per_serving,
                    "unit": detail.unit.value,
                    "category": detail.category.value
                }
            })
        
        flavors_list.sort(key=lambda x: x['flavor_name'])
        
        return {
            "success": True,
            "total_flavors": len(flavors_list),
            "flavors": flavors_list
        }
        
    except Exception as e:
        logging.error(f"Error getting detailed flavors: {e}")
        return {
            "success": False,
            "message": f"Error retrieving flavor details: {str(e)}",
            "flavors": []
        }

@app.get("/flavors/ingredient/{ingredient_id}", summary="Daftar flavor untuk ingredient tertentu", tags=["Utility"])
def get_flavors_for_ingredient(ingredient_id: int, db: Session = Depends(get_db)):
    """Daftar flavor yang menggunakan ingredient tertentu"""
    try:
        flavors = db.query(FlavorMapping.flavor_name).filter(
            FlavorMapping.ingredient_id == ingredient_id
        ).distinct().all()
        
        ingredient = db.query(Inventory).filter(Inventory.id == ingredient_id).first()
        if not ingredient:
            return {
                "success": False,
                "message": f"Ingredient ID {ingredient_id} tidak ditemukan",
                "available_flavors": []
            }
        
        flavor_list = [flavor[0] for flavor in flavors]
        flavor_list.sort()
        
        return {
            "success": True,
            "ingredient_id": ingredient_id,
            "ingredient_name": ingredient.name,
            "total_flavors": len(flavor_list),
            "available_flavors": flavor_list
        }
        
    except Exception as e:
        logging.error(f"Error getting flavors for ingredient {ingredient_id}: {e}")
        return {
            "success": False,
            "message": f"Error retrieving flavors for ingredient {ingredient_id}: {str(e)}",
            "available_flavors": []
        }

@app.get("/history", summary="History penggunaan stok", tags=["Stock Management"])
def get_stock_history(
    order_id: str = Query(None, description="Filter by order ID"),
    limit: int = Query(20, description="Jumlah record maksimal"),
    db: Session = Depends(get_db)
):
    """History penggunaan stok dengan filter yang berfungsi"""
    
    query = db.query(ConsumptionLog)
    
    if order_id:
        query = query.filter(ConsumptionLog.order_id == order_id)
    
    logs = query.order_by(ConsumptionLog.created_at.desc()).limit(limit).all()
    
    result = []
    for log in logs:
        ingredient_count = 0
        if log.per_ingredient_payload:
            try:
                ingredient_count = len(json.loads(log.per_ingredient_payload))
            except:
                ingredient_count = 0
        
        result.append({
            "order_id": log.order_id,
            "date": format_jakarta_time(log.created_at).replace("/", "/").replace(" ", " ")[:16],
            "consumed": log.consumed,
            "rolled_back": log.rolled_back,
            "ingredients_affected": ingredient_count,
            "status": "DIKONSUMSI" if log.consumed else "PENDING"
        })
    
    return {
        "success": True,
        "total_records": len(result),
        "filter_applied": order_id if order_id else "None",
        "history": result
    }

@app.get("/order/{order_id}/ingredients", summary="Detail konsumsi bahan untuk order tertentu", tags=["Order Analysis"])
def get_order_ingredients_detail(order_id: str, db: Session = Depends(get_db)):
    """
    Menampilkan detail bahan-bahan yang digunakan untuk membuat pesanan tertentu
    termasuk jumlah yang dikonsumsi per bahan
    """
    try:
        logging.info(f"🔍 DEBUG: Starting get_order_ingredients_detail for {order_id}")
        
        log = db.query(ConsumptionLog).filter(ConsumptionLog.order_id == order_id).first()
        
        if not log:
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": f"Order ID '{order_id}' tidak ditemukan dalam log konsumsi",
                "data": None
            })
        
        logging.info(f"🔍 DEBUG: Found log for {order_id}")
        
        menu_info = []
        if log.per_menu_payload:
            try:
                menu_data = json.loads(log.per_menu_payload)
                menu_info = menu_data if isinstance(menu_data, list) else []
            except:
                menu_info = []
        
        ingredients_detail = []
        total_ingredients_used = 0
        debug_info = {
            "per_ingredient_payload_exists": log.per_ingredient_payload is not None,
            "per_ingredient_payload_length": len(log.per_ingredient_payload) if log.per_ingredient_payload else 0,
            "per_ingredient_payload_preview": log.per_ingredient_payload[:100] + "..." if log.per_ingredient_payload and len(log.per_ingredient_payload) > 100 else log.per_ingredient_payload
        }
        
        if log.per_ingredient_payload:
            try:
                logging.info(f"🔍 DEBUG: Starting to parse per_ingredient_payload for {order_id}")
                logging.info(f"🔍 DEBUG: Raw per_ingredient_payload: {log.per_ingredient_payload}")
                
                ingredients_data = json.loads(log.per_ingredient_payload)
                logging.info(f"🔍 DEBUG: Raw ingredients_data type: {type(ingredients_data)}")
                logging.info(f"🔍 DEBUG: Raw ingredients_data: {ingredients_data}")
                
                if isinstance(ingredients_data, list):
                    for ingredient_info in ingredients_data:
                        ingredient = db.query(Inventory).filter(
                            Inventory.id == ingredient_info.get('ingredient_id')
                        ).first()
                        
                        if ingredient:
                            ingredients_detail.append({
                                "ingredient_id": ingredient_info.get('ingredient_id'),
                                "ingredient_name": ingredient_info.get('ingredient_name', ingredient.name),
                                "consumed_quantity": ingredient_info.get('deducted', 0),
                                "unit": ingredient_info.get('unit', ingredient.unit.value),
                                "category": ingredient.category.value,
                                "current_stock": ingredient.current_quantity,
                                "stock_before_consumption": ingredient_info.get('before', 0),
                                "stock_after_consumption": ingredient_info.get('after', 0)
                            })
                            total_ingredients_used += 1
                            
                ingredients_detail.sort(key=lambda x: x['ingredient_name'])
                
            except Exception as e:
                import traceback
                logging.warning(f"Failed to parse ingredient payload for {order_id}: {e}")
                logging.warning(f"Raw payload: {log.per_ingredient_payload}")
                logging.warning(f"Traceback: {traceback.format_exc()}")
        
        ingredients_detail = []
        total_ingredients_used = 0
        
        if log.per_ingredient_payload:
            try:
                ingredients_data = json.loads(log.per_ingredient_payload)
                
                if isinstance(ingredients_data, list):
                    for ingredient_info in ingredients_data:
                        ingredient = db.query(Inventory).filter(
                            Inventory.id == ingredient_info.get('ingredient_id')
                        ).first()
                        
                        if ingredient:
                            ingredients_detail.append({
                                "ingredient_id": ingredient_info.get('ingredient_id'),
                                "ingredient_name": ingredient_info.get('ingredient_name', ingredient.name),
                                "consumed_quantity": ingredient_info.get('deducted', 0),
                                "unit": ingredient_info.get('unit', ingredient.unit.value),
                                "category": ingredient.category.value,
                                "current_stock": ingredient.current_quantity,
                                "stock_before_consumption": ingredient_info.get('before', 0),
                                "stock_after_consumption": ingredient_info.get('after', 0)
                            })
                            total_ingredients_used += 1
                            
                ingredients_detail.sort(key=lambda x: x['ingredient_name'])
                
            except Exception as e:
                ingredients_detail = []
                total_ingredients_used = 0

        return JSONResponse(status_code=200, content={
            "status": "success",
            "message": f"Detail konsumsi bahan untuk order {order_id}",
            "data": {
                "order_id": order_id,
                "order_date": format_jakarta_time(log.created_at),
                "consumption_status": {
                    "consumed": log.consumed,
                    "rolled_back": log.rolled_back,
                    "status_text": "BERHASIL DIKONSUMSI" if log.consumed and not log.rolled_back else 
                                  "DIBATALKAN" if log.rolled_back else "PENDING"
                },
                "ingredients_breakdown": {
                    "total_ingredients_used": total_ingredients_used,
                    "details": ingredients_detail
                },
                "summary": {
                    "total_ingredients": total_ingredients_used,
                    "consumption_date": format_jakarta_time(log.created_at)
                }
            }
        })
        
    except Exception as e:
        logging.error(f"Error getting order ingredients detail for {order_id}: {e}")
        return JSONResponse(status_code=200, content={
            "status": "error",
            "message": f"Gagal mengambil detail konsumsi: {str(e)}",
            "data": None
        })

@app.get("/consumption/history/daily", 
         summary="History konsumsi stock harian", 
         tags=["Stock Management"],
         description="Menampilkan riwayat konsumsi stock per hari dengan breakdown per ingredient")
def get_daily_consumption_history(
    date: Optional[str] = Query(None, description="Tanggal tunggal dalam format YYYY-MM-DD. Untuk history hari tertentu saja"),
    start_date: Optional[str] = Query(None, description="Tanggal mulai dalam format YYYY-MM-DD (untuk date range)"),
    end_date: Optional[str] = Query(None, description="Tanggal akhir dalam format YYYY-MM-DD (untuk date range)"),
    db: Session = Depends(get_db)
):
    """History konsumsi harian dengan breakdown per ingredient."""
    try:
        from datetime import datetime, timedelta
        
        if date and (start_date or end_date):
            return JSONResponse(status_code=400, content={
                "status": "error",
                "message": "Tidak bisa menggunakan parameter 'date' bersamaan dengan 'start_date/end_date'. Pilih salah satu mode.",
                "data": None
            })
        
        if (start_date and not end_date) or (not start_date and end_date):
            return JSONResponse(status_code=400, content={
                "status": "error", 
                "message": "Untuk date range, harus menyertakan both 'start_date' dan 'end_date'",
                "data": None
            })
        
        if date:
            try:
                target_date = datetime.strptime(date, '%Y-%m-%d').date()
                query_start_date = target_date
                query_end_date = target_date
                query_mode = "single_date"
            except ValueError:
                return JSONResponse(status_code=400, content={
                    "status": "error",
                    "message": "Format tanggal tidak valid. Gunakan format YYYY-MM-DD",
                    "data": None
                })
        elif start_date and end_date:
            try:
                query_start_date = datetime.strptime(start_date, '%Y-%m-%d').date()
                query_end_date = datetime.strptime(end_date, '%Y-%m-%d').date()
                query_mode = "date_range"
                
                if query_start_date > query_end_date:
                    return JSONResponse(status_code=400, content={
                        "status": "error",
                        "message": "start_date tidak boleh lebih besar dari end_date",
                        "data": None
                    })
                    
            except ValueError:
                return JSONResponse(status_code=400, content={
                    "status": "error", 
                    "message": "Format tanggal tidak valid. Gunakan format YYYY-MM-DD",
                    "data": None
                })
        else:
            jakarta_now = datetime.now(jakarta_tz)
            query_start_date = jakarta_now.date()
            query_end_date = jakarta_now.date()
            query_mode = "today_default"
        
        consumption_logs = db.query(ConsumptionLog).filter(
            and_(
                ConsumptionLog.consumed == True,
                ConsumptionLog.rolled_back == False,
                func.date(ConsumptionLog.created_at) >= query_start_date,
                func.date(ConsumptionLog.created_at) <= query_end_date
            )
        ).order_by(ConsumptionLog.created_at.desc()).all()
        
        daily_consumption = {}
        
        for log in consumption_logs:
            if not log.per_ingredient_payload:
                continue
                
            try:
                ingredient_data = json.loads(log.per_ingredient_payload)
            except json.JSONDecodeError:
                continue
            
            log_date = log.created_at.astimezone(jakarta_tz).date()
            date_str = log_date.strftime('%Y-%m-%d')
            
            if date_str not in daily_consumption:
                daily_consumption[date_str] = {
                    "date": date_str,
                    "date_formatted": log_date.strftime('%d/%m/%Y'),
                    "day_name": log_date.strftime('%A'),
                    "total_orders": 0,
                    "ingredients_consumed": {},
                    "summary": {
                        "total_ingredients_types": 0,
                        "total_quantity_consumed": 0
                    }
                }
            
            daily_consumption[date_str]["total_orders"] += 1
            
            for item in ingredient_data:
                ingredient_id = item.get('ingredient_id')
                ingredient_name = item.get('ingredient_name', 'Unknown')
                quantity_consumed = item.get('deducted', 0) 
                unit = item.get('unit', '')
                
                if ingredient_id not in daily_consumption[date_str]["ingredients_consumed"]:
                    daily_consumption[date_str]["ingredients_consumed"][ingredient_id] = {
                        "ingredient_id": ingredient_id,
                        "ingredient_name": ingredient_name,
                        "unit": unit,
                        "total_consumed": 0,
                        "consumption_count": 0
                    }
                
                daily_consumption[date_str]["ingredients_consumed"][ingredient_id]["total_consumed"] += quantity_consumed
                daily_consumption[date_str]["ingredients_consumed"][ingredient_id]["consumption_count"] += 1
        
        for date_str in daily_consumption:
            ingredients = daily_consumption[date_str]["ingredients_consumed"]
            daily_consumption[date_str]["summary"]["total_ingredients_types"] = len(ingredients)
            daily_consumption[date_str]["summary"]["total_quantity_consumed"] = sum(
                ing["total_consumed"] for ing in ingredients.values()
            )
            
            daily_consumption[date_str]["ingredients_consumed"] = list(ingredients.values())
        
        sorted_daily_consumption = dict(sorted(daily_consumption.items(), reverse=True))
        
        total_days_with_consumption = len(sorted_daily_consumption)
        total_orders_all_days = sum(day_data["total_orders"] for day_data in sorted_daily_consumption.values())
        all_ingredients_used = set()
        for day_data in sorted_daily_consumption.values():
            for ing in day_data["ingredients_consumed"]:
                all_ingredients_used.add(ing["ingredient_id"])
        
        return JSONResponse(status_code=200, content={
            "status": "success",
            "message": f"History konsumsi berhasil diambil untuk {total_days_with_consumption} hari",
            "data": {
                "query_info": {
                    "mode": query_mode,
                    "date_range": {
                        "start_date": query_start_date.strftime('%Y-%m-%d'),
                        "end_date": query_end_date.strftime('%Y-%m-%d'),
                        "single_date": date if query_mode == "single_date" else None,
                        "start_date_param": start_date if query_mode == "date_range" else None,
                        "end_date_param": end_date if query_mode == "date_range" else None
                    },
                    "timezone": "Asia/Jakarta"
                },
                "summary": {
                    "total_days_with_consumption": total_days_with_consumption,
                    "total_orders_all_days": total_orders_all_days,
                    "unique_ingredients_used": len(all_ingredients_used),
                    "date_range_formatted": f"{query_start_date.strftime('%d/%m/%Y')} - {query_end_date.strftime('%d/%m/%Y')}"
                },
                "daily_consumption": list(sorted_daily_consumption.values())
            }
        })
        
    except Exception as e:
        logging.error(f"Error getting daily consumption history: {e}")
        return JSONResponse(status_code=500, content={
            "status": "error",
            "message": f"Gagal mengambil history konsumsi harian: {str(e)}",
            "data": None
        })

def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        logging.info("✅ inventory_service: migrasi selesai. Tables: %s", list(Base.metadata.tables.keys()))
    except Exception as e:
        logging.exception(f"❌ Gagal init_db inventory_service: {e}")

init_db()

Base.metadata.create_all(bind=engine)
hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ inventory_service running di http://{local_ip}:8006")
logging.info(f"Docs: http://{local_ip}:8006/docs")

mcp.setup_server()

@app.on_event("startup")
def start_outbox_worker():
    def worker():
        while True:
            db = SessionLocal()
            try:
                process_outbox_events(db)
            finally:
                db.close()
            time.sleep(5)
    threading.Thread(target=worker, daemon=True).start()