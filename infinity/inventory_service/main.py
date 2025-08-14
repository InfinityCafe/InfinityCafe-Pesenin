# inventory_service.py (completed)
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

# Global variable for debugging
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

# ===================== MODELS =====================
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
    per_menu_payload = Column(Text)                 # ringkasan per menu
    per_ingredient_payload = Column(Text, nullable=True)  # DETAIL per ingredient
    consumed = Column(Boolean, default=False)
    rolled_back = Column(Boolean, default=False)    # penanda rollback
    created_at = Column(DateTime, default=datetime.utcnow)


# ===================== SCHEMAS =====================
class ValidateIngredientRequest(BaseModel):
    name: str
    current_quantity: float
    minimum_quantity: float
    category: StockCategory
    unit: UnitType

    # Normalisasi agar input 'Ingredient' / 'INGREDIENT' / 'ingredient' diterima (case-insensitive)
    @field_validator('category', 'unit', mode='before')
    @classmethod
    def normalize_enum(cls, v):
        if isinstance(v, str):
            return v.lower().strip()
        return v
    
    @field_validator('category', 'unit', mode='after')
    @classmethod
    def lowercase_enum(cls, v):
        # Kalau enum, ambil value-nya yang sudah lowercase
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
    debug_info: list = Field(default_factory=list)  # Temporary for debugging


# ===================== OUTBOX HELPERS =====================
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


# ===================== ADMIN OUTBOX =====================
@app.post("/admin/process_outbox", tags=["Admin"])
def manual_outbox(db: Session = Depends(get_db)):
    process_outbox_events(db)
    return {"message": "Outbox diproses"}


@app.get("/admin/outbox_status", tags=["Admin"])
def outbox_status(db: Session = Depends(get_db)):
    total = db.query(InventoryOutbox).count()
    processed = db.query(InventoryOutbox).filter(InventoryOutbox.processed.is_(True)).count()
    failed = db.query(InventoryOutbox).filter(
        InventoryOutbox.processed.is_(False),
        InventoryOutbox.retry_count >= InventoryOutbox.max_retries
    ).count()
    return {
        "total": total,
        "processed": processed,
        "failed": failed,
        "pending": total - processed - failed
    }


# ===================== CRUD INVENTORY =====================
@app.get("/list_ingredients", summary="Daftar bahan", tags=["Inventory"], operation_id="list ingredients")
def list_ingredients(db: Session = Depends(get_db)):
    rows = db.query(Inventory).all()
    return {
        "status": "success",
        "data": [
            {
                "id": r.id,
                "name": r.name,
                "current_quantity": r.current_quantity,
                "minimum_quantity": r.minimum_quantity,
                "category": r.category.value,
                "unit": r.unit.value
            } for r in rows
        ]
    }


@app.post("/add_ingredient", summary="Tambah bahan baru", tags=["Inventory"], operation_id="add ingredient")
def add_ingredient(req: ValidateIngredientRequest, db: Session = Depends(get_db)):
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
    return {"status": "success", "message": f"Bahan '{ing.name}' ditambahkan", "data": {"id": ing.id}}


@app.put("/update_ingredient", summary="Update bahan", tags=["Inventory"], operation_id="update ingredient")
def update_ingredient(req: UpdateIngredientRequest, db: Session = Depends(get_db)):
    ing = db.query(Inventory).filter(Inventory.id == req.id).first()
    if not ing:
        raise HTTPException(status_code=404, detail="Bahan tidak ditemukan")
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
    return {"status": "success", "message": f"Bahan '{ing.name}' diupdate"}


@app.delete("/delete_ingredient/{ingredient_id}", summary="Hapus bahan", tags=["Inventory"], operation_id="delete ingredient")
def delete_ingredient(ingredient_id: int, db: Session = Depends(get_db)):
    ing = db.query(Inventory).filter(Inventory.id == ingredient_id).first()
    if not ing:
        return {"status": "error", "message": "Bahan tidak ditemukan"}
    name = ing.name
    db.delete(ing)
    db.commit()
    create_outbox_event(db, "ingredient_deleted", {"id": ingredient_id})
    db.commit()
    process_outbox_events(db)
    return {"status": "success", "message": f"Bahan '{name}' dihapus"}


@app.get("/health", summary="Health check", tags=["Utility"])
def health():
    return {"status": "ok", "service": "inventory_service"}


# Debug endpoint to check flavor processing
@app.get("/debug/last_processing", tags=["Debug"])
async def get_last_debug_info():
    return {"debug_info": last_debug_info}

# Test endpoint untuk debug preference
@app.post("/debug/test_preference", tags=["Debug"])
async def test_preference(request: BatchStockRequest):
    result = []
    for item in request.items:
        result.append({
            "menu_name": item.menu_name,
            "quantity": item.quantity,
            "preference": item.preference,
            "preference_received": bool(item.preference),
            "preference_length": len(item.preference or "")
        })
    return {"received_items": result, "order_id": request.order_id}


# ===================== STOCK CHECK & CONSUME =====================
class StockRequestPayload(BaseModel):
    order_id: str
    items: list[BatchStockItem]


@app.post("/stock/check_and_consume", response_model=BatchStockResponse, tags=["Inventory"], operation_id="check and consume stock")
def check_and_consume(
    req: BatchStockRequest,
    db: Session = Depends(get_db),
    consume: bool = Query(True, description="False = hanya cek (dry-run)")
):
    global last_debug_info  # Declare global at the start
    debug_info = []  # Initialize debug_info early
    
    # Idempotensi adalah kemampuan untuk mengulangi operasi yang sama tanpa efek samping
    # contohnya adalah permintaan yang sama dapat dikirim berulang kali tanpa mengubah hasil
    existing = db.query(ConsumptionLog).filter(ConsumptionLog.order_id == req.order_id).first()
    if existing and existing.consumed and not existing.rolled_back:
        return BatchStockResponse(
            can_fulfill=True,
            shortages=[],
            partial_suggestions=[],
            details=json.loads(existing.per_menu_payload)
        )

    # Ambil resep batch dari menu_service
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

    # Process each menu item for stock calculation
    need_map = {}  # ing_id -> {needed, unit, menus:set()}
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
        
        # Proses resep dasar
        for r in r_items:
            ing_id = r["ingredient_id"]
            need_map.setdefault(ing_id, {"needed": 0, "unit": r["unit"], "menus": set()})
            need_map[ing_id]["needed"] += r["quantity"] * it.quantity
            need_map[ing_id]["menus"].add(it.menu_name)
        
        # Tambahkan flavor jika diperlukan
        # PENTING: Flavor tidak terikat ke menu tertentu, bisa digunakan untuk semua menu atau custom order
        preference = it.preference or ""  # Get preference directly from request item
        print(f"🔍 DEBUG: Checking preference for {it.menu_name}: '{preference}'")
        debug_info.append(f"Checking preference for {it.menu_name}: '{preference}'")
        if preference:
            # Map flavor name ke ingredient_id (universal untuk semua menu)
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
                # Tambah flavor lain sesuai inventory
                "Macadamia Nut": 12,  # Bisa mapping ke existing atau ID baru
                "Java Brown Sugar": 13,  # Flexible mapping
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
                # Tentukan quantity flavor berdasarkan jenis menu
                # Default: semua menu bisa pakai flavor dengan quantity standar
                flavor_qty = 25  # default milliliter untuk liquid
                flavor_unit = "milliliter"
                
                # Khusus untuk menu tertentu, sesuaikan quantity dan unit
                if it.menu_name in ["Milkshake"] or "milkshake" in it.menu_name.lower():
                    # Untuk milkshake, beberapa flavor bisa dalam bentuk powder (gram)
                    powder_flavors = ["Mangga", "Mango", "Permenkaret", "Bubble Gum", "Tiramisu", "Redvelvet", "Red Velvet", "Strawberry", "Stroberi", "Vanilla", "Chocolate", "Taro", "Banana", "Alpukat"]
                    if preference in powder_flavors:
                        flavor_qty = 30
                        flavor_unit = "gram"
                elif "squash" in it.menu_name.lower():
                    # Squash biasanya pakai lebih sedikit flavor
                    flavor_qty = 20
                    flavor_unit = "milliliter"
                elif any(keyword in it.menu_name.lower() for keyword in ["custom", "special", "premium"]):
                    # Custom order bisa pakai lebih banyak flavor
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
        
    # Hitung kekurangan
    for ing_id, data in need_map.items():
        inv = inv_map.get(ing_id)
        available = inv.current_quantity if inv else 0
        if available < data["needed"]:
            shortages.append({
                "ingredient_id": ing_id,
                "ingredient_name": inv.name if inv else f"ID-{ing_id}",
                "required": data["needed"],
                "available": available,
                "unit": data["unit"],
                "menus": list(data["menus"])
            })

    if shortages:
        # Partial suggestion
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
        return BatchStockResponse(
            can_fulfill=False,
            shortages=shortages,
            partial_suggestions=partial,
            details=per_menu_detail
        )

    # Dry-run (tidak konsumsi)
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

    # Konsumsi stok
    per_ing_detail = []
    try:
        for ing_id, data in need_map.items():
            inv = inv_map[ing_id]
            before = inv.current_quantity
            inv.current_quantity -= data["needed"]
            if inv.current_quantity < 0:
                raise ValueError(f"Stok negatif ingredient {ing_id}")
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


@app.get("/flavor_mapping", summary="Mapping flavor ke ingredient ID", tags=["Inventory"])
def get_flavor_mapping():
    """Mengembalikan mapping nama flavor ke ingredient ID untuk debugging."""
    return {
        "flavor_mapping": {
            # Mapping berdasarkan inventory yang ada
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
            # Mapping tambahan untuk flavor dari menu service
            "Macadamia Nut": 12,  # Mapping ke Butterscotch sebagai substitute
            "Java Brown Sugar": 13,  # Mapping ke French Mocca sebagai substitute
            "Chocolate": 15,  # Mapping ke Creme Brulee
            "Taro": 21,  # Mapping ke Tiramisu
            "Choco Malt": 22,  # Mapping ke Redvelvet
            "Choco Hazelnut": 23,  # Mapping ke Strawberry
            "Choco Biscuit": 24,  # Mapping ke Vanilla
            "Milktea": 16,  # Mapping ke Irish
            "Banana": 19,  # Mapping ke Mangga
            "Alpukat": 20,  # Mapping ke Permenkaret
            "Green Tea": 21,  # Mapping ke Tiramisu
            "Markisa": 22,  # Mapping ke Redvelvet
            "Melon": 23,  # Mapping ke Strawberry
            "Nanas": 24   # Mapping ke Vanilla
        },
        "powder_flavors": [
            "Mangga", "Mango", "Permenkaret", "Bubble Gum", "Tiramisu", 
            "Redvelvet", "Red Velvet", "Strawberry", "Stroberi", "Vanilla", 
            "Chocolate", "Taro", "Banana", "Alpukat"
        ],
        "flavor_quantities": {
            "default_liquid": 25,     # milliliter untuk kopi/cappuccino
            "milkshake_powder": 30,   # gram untuk milkshake powder
            "milkshake_liquid": 25,   # milliliter untuk milkshake liquid
            "squash": 20,             # milliliter untuk squash (lebih sedikit)
            "custom_premium": 35      # milliliter untuk custom order premium
        },
        "menu_compatibility": {
            "note": "Semua flavor bisa digunakan untuk semua menu dan custom order",
            "flexible": "Tidak ada batasan menu_item_flavor_association di inventory level",
            "custom_order_support": "Penuh mendukung custom order dengan flavor apapun"
        }
    }


@app.post("/stock/rollback/{order_id}", summary="Rollback konsumsi stok", tags=["Inventory"])
def rollback(order_id: str, db: Session = Depends(get_db)):
    log = db.query(ConsumptionLog).filter(ConsumptionLog.order_id == order_id).first()
    if not log or not log.consumed:
        return {"status": "ignore", "message": "Tidak ada konsumsi untuk order ini"}
    if log.rolled_back:
        return {"status": "ok", "message": "Sudah rollback"}
    try:
        per_ing = json.loads(log.per_ingredient_payload or "[]")
        ids = [d["ingredient_id"] for d in per_ing]
        if ids:
            invs = db.query(Inventory).filter(Inventory.id.in_(ids)).with_for_update().all()
            inv_map = {i.id: i for i in invs}
            restored_items = []
            for d in per_ing:
                inv = inv_map.get(d["ingredient_id"])
                if inv:
                    inv.current_quantity += d["deducted"]
                    restored_items.append({
                        "ingredient_id": d["ingredient_id"],
                        "ingredient_name": d.get("ingredient_name", inv.name),
                        "restored_quantity": d["deducted"],
                        "unit": d["unit"]
                    })
        log.rolled_back = True
        db.commit()
        logging.info(f"✅ Rollback berhasil untuk order {order_id}: {len(restored_items)} ingredients")
        return {
            "status": "success", 
            "message": f"Rollback order {order_id} berhasil", 
            "restored": len(restored_items),
            "restored_items": restored_items
        }
    except Exception as e:
        db.rollback()
        logging.error(f"❌ Gagal rollback order {order_id}: {e}")
        return {"status": "error", "message": f"Gagal rollback: {e}"}

@app.post("/stock/check_custom_with_flavor", summary="Cek stok untuk custom order dengan flavor", tags=["Inventory"])
def check_custom_with_flavor(
    req: dict,  # {"menu_name": "Kopi Custom", "quantity": 1, "flavor": "Irish", "order_id": "test"}
    db: Session = Depends(get_db)
):
    """
    Endpoint khusus untuk testing custom order dengan flavor.
    Tidak memerlukan resep dari menu_service, langsung hitung flavor yang diperlukan.
    """
    menu_name = req.get("menu_name", "Custom Menu")
    quantity = req.get("quantity", 1)
    flavor = req.get("flavor", "")
    order_id = req.get("order_id", f"TEST_{datetime.now().strftime('%H%M%S')}")
    
    if not flavor:
        return {"can_fulfill": False, "message": "Flavor harus diisi untuk custom order"}
    
    # Map flavor ke ingredient
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
        # Extended mapping
        "Macadamia Nut": 12, "Java Brown Sugar": 13, "Chocolate": 15,
        "Taro": 21, "Choco Malt": 22, "Choco Hazelnut": 23,
        "Choco Biscuit": 24, "Milktea": 16, "Banana": 19,
        "Alpukat": 20, "Green Tea": 21, "Markisa": 22,
        "Melon": 23, "Nanas": 24
    }
    
    flavor_id = flavor_mapping.get(flavor)
    if not flavor_id:
        return {
            "can_fulfill": False, 
            "message": f"Flavor '{flavor}' tidak tersedia",
            "available_flavors": list(flavor_mapping.keys())
        }
    
    # Cek stok flavor
    inv = db.query(Inventory).filter(Inventory.id == flavor_id).first()
    if not inv:
        return {"can_fulfill": False, "message": f"Ingredient untuk flavor '{flavor}' tidak ditemukan"}
    
    # Hitung kebutuhan (custom order pakai quantity premium)
    needed_qty = 35 * quantity  # 35ml/gram untuk custom order
    
    if inv.current_quantity < needed_qty:
        return {
            "can_fulfill": False,
            "message": f"Stok {flavor} tidak cukup",
            "details": {
                "flavor": flavor,
                "ingredient_id": flavor_id,
                "ingredient_name": inv.name,
                "needed": needed_qty,
                "available": inv.current_quantity,
                "unit": inv.unit.value,
                "shortage": needed_qty - inv.current_quantity
            }
        }
    
    return {
        "can_fulfill": True,
        "message": f"Custom order '{menu_name}' dengan flavor '{flavor}' dapat dipenuhi",
        "details": {
            "menu_name": menu_name,
            "quantity": quantity,
            "flavor": flavor,
            "ingredient_id": flavor_id,
            "ingredient_name": inv.name,
            "needed": needed_qty,
            "available": inv.current_quantity,
            "unit": inv.unit.value,
            "remaining_after": inv.current_quantity - needed_qty
        },
        "order_id": order_id
    }


@app.get("/consumption_log/{order_id}", summary="Lihat log konsumsi order", tags=["Inventory"])
def get_consumption_log(order_id: str, db: Session = Depends(get_db)):
    """Melihat detail konsumsi stok untuk order tertentu."""
    log = db.query(ConsumptionLog).filter(ConsumptionLog.order_id == order_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log konsumsi tidak ditemukan")
    
    result = {
        "order_id": log.order_id,
        "consumed": log.consumed,
        "rolled_back": log.rolled_back,
        "created_at": log.created_at.isoformat() if log.created_at else None,
        "per_menu_summary": json.loads(log.per_menu_payload) if log.per_menu_payload else [],
        "ingredient_details": json.loads(log.per_ingredient_payload) if log.per_ingredient_payload else []
    }
    return result


@app.get("/consumption_log", summary="Lihat semua log konsumsi", tags=["Inventory"])
def get_all_consumption_logs(
    db: Session = Depends(get_db),
    limit: int = Query(50, le=100),
    consumed_only: bool = Query(False)
):
    """Melihat semua log konsumsi dengan filter."""
    query = db.query(ConsumptionLog)
    if consumed_only:
        query = query.filter(ConsumptionLog.consumed.is_(True))
    
    logs = query.order_by(ConsumptionLog.created_at.desc()).limit(limit).all()
    
    result = []
    for log in logs:
        result.append({
            "order_id": log.order_id,
            "consumed": log.consumed,
            "rolled_back": log.rolled_back,
            "created_at": log.created_at.isoformat() if log.created_at else None,
            "ingredient_count": len(json.loads(log.per_ingredient_payload)) if log.per_ingredient_payload else 0
        })
    
    return {"logs": result, "total": len(result)}


# === PASTIKAN create_all SETELAH SEMUA MODEL TERDEFINISI ===
def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        # Uji koneksi cepat
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        logging.info("✅ inventory_service: migrasi selesai. Tables: %s", list(Base.metadata.tables.keys()))
    except Exception as e:
        logging.exception(f"❌ Gagal init_db inventory_service: {e}")

init_db()

# ===================== STARTUP =====================
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