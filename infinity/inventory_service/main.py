from dotenv import load_dotenv
from fastapi.responses import JSONResponse
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi_mcp import FastApiMCP
from pydantic import BaseModel, Field, model_validator, field_validator
from typing import Optional
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, Text, Enum as SQLEnum
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from sqlalchemy.exc import SQLAlchemyError
from pytz import timezone as pytz_timezone

last_debug_info = []
from datetime import datetime
import enum, os, json, logging, requests, math, socket, threading, time

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
    ingredient = "ingredient"
    packaging = "packaging"

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
    created_at = Column(DateTime, default=datetime.utcnow)

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
        rows = db.query(Inventory).all()
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
    try:
        ing = Inventory(
            name=req.name,
            current_quantity=req.current_quantity,
            minimum_quantity=req.minimum_quantity,
            category=req.category,
            unit=req.unit
        )
        db.add(ing)
        db.commit()
        db.refresh(ing)
        
        create_outbox_event(db, "ingredient_added", {
            "id": ing.id,
            "name": ing.name,
            "current_quantity": ing.current_quantity,
            "minimum_quantity": ing.minimum_quantity,
            "category": ing.category.value,
            "unit": ing.unit.value
        })
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


# ===================== SIMPLE STOCK OPERATIONS =====================
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
        "critical": [],  # Habis (qty <= 0)
        "low": [],       # Dibawah minimum
        "ok": []         # Stok aman
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
    """
    ⚠️ ENDPOINT INI DEPRECATED ⚠️
    
    Endpoint ini terlalu kompleks dan akan dihapus di versi mendatang.
    
    Gunakan yang lebih jelas:
    - POST /stock/check_availability - untuk cek ketersediaan tanpa konsumsi  
    - POST /stock/consume - untuk konsumsi stok setelah dikonfirmasi
    
    Alasan deprecated:
    - Parameter 'consume' membingungkan (dry-run vs actual consumption)
    - Response format terlalu kompleks
    - Gabungan 2 fungsi berbeda dalam 1 endpoint
    """
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
            flavor_mapping = {
                "Butterscotch": 12, "Butterscout": 12,
                "French Mocca": 13, "French Mocha": 13,
                "Roasted Almond": 14, "Rosted Almond": 14,
                "Creme Brulee": 15,
                "Irish": 16,
                "Havana": 17,
                "Salted Caramel": 18,
                "Mangga": 19, "Mango": 19,
                "Permenkaret": 20, "Bubble Gum": 20,
                "Tiramisu": 21,
                "Redvelvet": 22, "Red Velvet": 22,
                "Strawberry": 23, "Stroberi": 23,
                "Vanilla": 24,
                "Macadamia Nut": 12,  
                "Java Brown Sugar": 13, 
                "Chocolate": 15,
                "Taro": 21,
                "Choco Malt": 22,
                "Choco Hazelnut": 23,
                "Choco Biscuit": 24,
                "Milktea": 16,
                "Banana": 19,
                "Alpukat": 20,
                "Green Tea": 21,
                "Markisa": 22,
                "Melon": 23,
                "Nanas": 24
            }
            
            flavor_id = flavor_mapping.get(preference)
            if flavor_id:
                flavor_qty = 25 
                flavor_unit = "milliliter"
                
                if it.menu_name in ["Milkshake"] or "milkshake" in it.menu_name.lower():
                    powder_flavors = ["Mangga", "Mango", "Permenkaret", "Bubble Gum", "Tiramisu", "Redvelvet", "Red Velvet", "Strawberry", "Stroberi", "Vanilla", "Chocolate", "Taro", "Banana", "Alpukat"]
                    if preference in powder_flavors:
                        flavor_qty = 30
                        flavor_unit = "gram"
                elif "squash" in it.menu_name.lower():
                    flavor_qty = 20
                    flavor_unit = "milliliter"
                elif any(keyword in it.menu_name.lower() for keyword in ["custom", "special", "premium"]):
                    flavor_qty = 35
                    flavor_unit = "milliliter"
                
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

# ===================== UTILITY ENDPOINTS =====================

@app.get("/flavors", summary="Daftar flavor yang tersedia", tags=["Utility"])
def get_available_flavors():
    """Daftar flavor yang bisa digunakan untuk pesanan"""
    return {
        "success": True,
        "flavors": [
            "Butterscotch", "French Mocha", "Roasted Almond", "Creme Brulee",
            "Irish", "Havana", "Salted Caramel", "Mangga", "Permenkaret",
            "Tiramisu", "Redvelvet", "Strawberry", "Vanilla", "Chocolate",
            "Taro", "Milktea", "Banana", "Alpukat", "Green Tea", "Markisa",
            "Melon", "Nanas"
        ]
    }

@app.get("/history", summary="History penggunaan stok", tags=["Stock Management"])
def get_stock_history(
    order_id: str = Query(None, description="Filter by order ID"),
    limit: int = Query(20, description="Jumlah record maksimal"),
    db: Session = Depends(get_db)
):
    """History penggunaan stok dengan filter yang berfungsi"""
    
    query = db.query(ConsumptionLog)
    
    # Filter by order_id jika ada
    if order_id:
        query = query.filter(ConsumptionLog.order_id == order_id)
    
    logs = query.order_by(ConsumptionLog.created_at.desc()).limit(limit).all()
    
    result = []
    for log in logs:
        # Hitung ingredient count
        ingredient_count = 0
        if log.per_ingredient_payload:
            try:
                ingredient_count = len(json.loads(log.per_ingredient_payload))
            except:
                ingredient_count = 0
        
        result.append({
            "order_id": log.order_id,
            "date": log.created_at.strftime("%d/%m/%Y %H:%M") if log.created_at else "Unknown",
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