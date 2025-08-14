# inventory_service.py (completed)
from dotenv import load_dotenv
from fastapi.responses import JSONResponse
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi_mcp import FastApiMCP
from pydantic import BaseModel, Field, model_validator, field_validator
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, Text, Enum as SQLEnum
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from sqlalchemy.exc import SQLAlchemyError
from pytz import timezone as pytz_timezone
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


class BatchStockRequest(BaseModel):
    order_id: str
    items: list[BatchStockItem]


class BatchStockResponse(BaseModel):
    can_fulfill: bool
    shortages: list = Field(default_factory=list)
    partial_suggestions: list = Field(default_factory=list)
    details: list = Field(default_factory=list)


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
        return BatchStockResponse(can_fulfill=False, shortages=[{"error": f"Gagal ambil resep: {e}"}], partial_suggestions=[], details=[])

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
        for r in r_items:
            ing_id = r["ingredient_id"]
            need_map.setdefault(ing_id, {"needed": 0, "unit": r["unit"], "menus": set()})
            need_map[ing_id]["needed"] += r["quantity"] * it.quantity
            need_map[ing_id]["menus"].add(it.menu_name)

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
        return BatchStockResponse(can_fulfill=True, shortages=[], partial_suggestions=[], details=per_menu_detail)

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
        return BatchStockResponse(can_fulfill=True, shortages=[], partial_suggestions=[], details=per_menu_detail)
    except Exception as e:
        db.rollback()
        return BatchStockResponse(can_fulfill=False, shortages=[{"error": f"Gagal konsumsi stok: {e}"}], partial_suggestions=[], details=[])


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
            for d in per_ing:
                inv = inv_map.get(d["ingredient_id"])
                if inv:
                    inv.current_quantity += d["deducted"]
        log.rolled_back = True
        db.commit()
        return {"status": "success", "message": f"Rollback order {order_id} berhasil", "restored": len(per_ing)}
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": f"Gagal rollback: {e}"}

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