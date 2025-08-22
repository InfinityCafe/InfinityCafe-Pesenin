# menu_service.py

from fastapi import Body, FastAPI, HTTPException, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, validator, Field, ValidationError
from sqlalchemy import create_engine, Column, String, Integer, Boolean, DateTime, Table, ForeignKey, Float
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
    # Untuk endpoint flavors, jangan ubah status code agar frontend bisa mendeteksi error dengan benar
    if request.url.path.startswith("/flavors"):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "status": "error",
                "message": exc.detail,
                "data": {"error_type": "business_logic_error", "original_status": exc.status_code}
            }
        )
    
    # Jika error adalah validation related (400, 404), ubah ke 200 untuk kompatibilitas n8n
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
    making_time_minutes = Column(Float, default=0)

    # Relasi ke tabel flavors
    recipe_ingredients = relationship("RecipeIngredient", back_populates="menu_item")
    
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
    isAvail = Column(Boolean, default=True)
    
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

# (HAPUS create_all awal – dipindah ke bawah setelah SEMUA model terdefinisi)

class FlavorBase(BaseModel):
    flavor_name: str = Field(..., min_length=1, description="Nama flavor tidak boleh kosong")
    additional_price: Optional[int] = Field(default=0, ge=0, description="Harga tambahan tidak boleh negatif, default 0 jika tidak diisi")
    isAvail: bool = True

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
    making_time_minutes: float = Field(default=0, ge=0, description="Waktu pembuatan menu dalam menit")

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

# Tabel untuk menyimpan informasi bahan yang disinkronkan dari inventory service
class SyncedInventory(Base):
    __tablename__ = "synced_inventory"
    id = Column(Integer, primary_key=True, index=True)  # Tambah Column definisi
    name = Column(String, index=True)
    current_quantity = Column(Float, default=0)
    minimum_quantity = Column(Float, default=0)
    category = Column(String, index=True)
    unit = Column(String, index=True)
        
    # Tambah relationship ini
    recipe_ingredients = relationship("RecipeIngredient", back_populates="ingredient")

# Tabel untuk menyimpan bahan yang digunakan dalam resep
class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"
    id = Column(Integer, primary_key=True, index=True)
    menu_item_id = Column(String, ForeignKey('menu_items.id'))
    ingredient_id = Column(Integer, ForeignKey('synced_inventory.id'))
    quantity = Column(Float, nullable=False)
    unit = Column(String, nullable=False)  # disimpan sebagai string agar bebas dari enum mismatch

    # Relasi ke tabel menu_item dan synced_inventory
    menu_item = relationship("MenuItem", back_populates="recipe_ingredients")
    ingredient = relationship("SyncedInventory", back_populates="recipe_ingredients")

# PANGGIL create_all SETELAH SEMUA MODEL DI ATAS TERDEFINISI
Base.metadata.create_all(bind=engine)
    
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
    
    if not flavor.flavor_name or flavor.flavor_name.strip() == "":
        raise HTTPException(status_code=400, detail="Nama flavor tidak boleh kosong")
    
    price = flavor.additional_price if flavor.additional_price is not None else 0
    
    if price < 0:
        raise HTTPException(status_code=400, detail="Harga tambahan tidak boleh negatif")
    
    db_flavor = db.query(Flavor).filter(Flavor.flavor_name == flavor.flavor_name.strip()).first()
    if db_flavor:
        raise HTTPException(status_code=400, detail="Rasa dengan nama ini sudah ada")
    
    new_flavor = Flavor(
        id=generate_id("FLAV", 6), 
        flavor_name=flavor.flavor_name.strip(),
        additional_price=price,
        isAvail=flavor.isAvail
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

@app.get("/flavors", summary="Lihat Varian Rasa Tersedia", tags=["Flavor"], response_model=List[FlavorOut], operation_id="list available flavors")
def get_available_flavors(db: Session = Depends(get_db)):
    """Mengambil semua varian rasa yang statusnya tersedia."""
    return db.query(Flavor).filter(Flavor.isAvail == True).all()

@app.get("/flavors/all", summary="Lihat Semua Varian Rasa (Admin)", tags=["Flavor"], response_model=List[FlavorOut], operation_id="list all flavors")
def get_all_flavors_admin(db: Session = Depends(get_db)):
    """Mengambil semua varian rasa dari database"""
    return db.query(Flavor).all()

@app.get("/flavors/{flavor_id}", summary="Lihat Detail Varian Rasa", tags=["Flavor"], response_model=FlavorOut, operation_id="get flavor by id")
def get_flavor_item(flavor_id: str, db: Session = Depends(get_db)):
    """Mengambil informasi detail dari sebuah varian rasa berdasarkan ID."""
    flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not flavor:
        raise HTTPException(status_code=404, detail="Varian rasa tidak ditemukan")
    return flavor

@app.put("/flavors/{flavor_id}", summary="Update Varian Rasa", tags=["Flavor"], operation_id="update flavor")
def update_flavor_item(flavor_id: str, flavor: FlavorCreate, db: Session = Depends(get_db)):
    """Memperbarui informasi dari varian rasa berdasarkan ID."""
    db_flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not db_flavor:
        raise HTTPException(status_code=404, detail="Varian rasa tidak ditemukan")
    
    if not flavor.flavor_name or flavor.flavor_name.strip() == "":
        raise HTTPException(status_code=400, detail="Nama varian rasa tidak boleh kosong")
    
    if flavor.additional_price is None or flavor.additional_price < 0:
        raise HTTPException(status_code=400, detail="Harga tambahan tidak boleh negatif")
    
    existing = db.query(Flavor).filter(
        Flavor.flavor_name == flavor.flavor_name.strip(),
        Flavor.id != flavor_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Varian rasa dengan nama '{flavor.flavor_name}' sudah ada.")
    
    db_flavor.flavor_name = flavor.flavor_name.strip()
    db_flavor.additional_price = flavor.additional_price
    db_flavor.isAvail = flavor.isAvail
    
    db.commit()
    db.refresh(db_flavor)
    
    return {
        "status": "success",
        "message": "Varian rasa berhasil diperbarui",
        "data": {
            "id": db_flavor.id,
            "flavor_name": db_flavor.flavor_name,
            "additional_price": db_flavor.additional_price
        }
    }

@app.delete("/flavors/{flavor_id}", summary="Hapus Varian Rasa", tags=["Flavor"], operation_id="delete flavor")
def delete_flavor_item(flavor_id: str, db: Session = Depends(get_db)):
    """Menghapus varian rasa berdasarkan ID."""
    db_flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not db_flavor:
        raise HTTPException(status_code=404, detail="Varian rasa tidak ditemukan")
    
    # Cek apakah flavor sedang digunakan oleh menu
    menu_items_using_flavor = db.query(MenuItem).filter(
        MenuItem.flavors.any(id=flavor_id)
    ).all()
    
    if menu_items_using_flavor:
        menu_names = [item.base_name for item in menu_items_using_flavor]
        raise HTTPException(
            status_code=400, 
            detail=f"Varian rasa tidak dapat dihapus karena masih digunakan oleh menu: {', '.join(menu_names)}"
        )
    
    # Hapus relasi dari tabel association terlebih dahulu
    db.execute(
        menu_item_flavor_association.delete().where(
            menu_item_flavor_association.c.flavor_id == flavor_id
        )
    )
    
    # Hapus flavor
    db.delete(db_flavor)
    db.commit()
    
    return {
        "status": "success",
        "message": "Varian rasa berhasil dihapus",
        "data": {
            "id": flavor_id,
            "flavor_name": db_flavor.flavor_name
        }
    }

@app.post("/menu", summary="Tambah Menu Baru", tags=["Menu"], operation_id="add menu")
def create_menu_item(item: MenuItemCreate, db: Session = Depends(get_db)):
    """Menambahkan menu dasar baru dan menautkannya dengan varian rasa."""
    
    if not item.base_name or item.base_name.strip() == "":
        raise HTTPException(status_code=400, detail="Nama menu tidak boleh kosong")
    
    if item.base_price is None or item.base_price <= 0:
        raise HTTPException(status_code=400, detail="Harga menu harus diisi dan lebih dari 0")
    
    if item.flavor_ids:
        for flavor_id in item.flavor_ids:
            if not flavor_id or flavor_id.strip() == "":
                raise HTTPException(status_code=400, detail="Flavor ID tidak boleh kosong")
    
    existing = db.query(MenuItem).filter(MenuItem.base_name == item.base_name.strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Menu dengan nama '{item.base_name}' sudah ada.")
    
    if item.flavor_ids:
        flavors = db.query(Flavor).filter(Flavor.id.in_(item.flavor_ids)).all()
        if len(flavors) != len(item.flavor_ids):
            missing_ids = set(item.flavor_ids) - {f.id for f in flavors}
            raise HTTPException(status_code=404, detail=f"Flavor ID tidak ditemukan: {', '.join(missing_ids)}")
    else:
        flavors = []

    db_item = MenuItem(
        id=generate_id("MENU"), 
        base_name=item.base_name.strip(), 
        base_price=item.base_price, 
        isAvail=item.isAvail
    )
    
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

@app.get("/menu/all", summary="Daftar Semua Menu (Untuk Admin)", tags=["Menu"], response_model=List[MenuItemOut])
def get_all_menus_admin(db: Session = Depends(get_db)):
    """Mengambil semua data menu dari database"""
    all_menus = db.query(MenuItem).options(joinedload(MenuItem.flavors)).all()
    return all_menus    

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

@app.get("/menu_suggestion", summary="Lihat Semua Usulan", tags=["Usulan Menu"], operation_id="list usulan menu")
def get_suggestions(db: Session = Depends(get_db)):
    """Menampilkan seluruh usulan menu terbaru dari pelanggan."""
    suggestions = db.query(MenuSuggestion).order_by(MenuSuggestion.timestamp.desc()).all()
    
    if not suggestions:
        return {
            "status": "success",
            "message": "Saat ini belum ada usulan menu dari pelanggan lain. Yuk, jadi yang pertama! Kami sangat menantikan ide-ide seru dari Anda" ,
            "data": []
        }
    
    # Format data hanya nama menu saja
    menu_names = []
    for suggestion in suggestions:
        menu_names.append(suggestion.menu_name)
    
    return {
        "status": "success", 
        "message": f" Hallo! Kami punya beberapa usulan menu yang baru nih dari pelanggan lain, coba cek siapa tahu ada yang cocok dengan anda:",
        "data": menu_names
    }

@app.get("/menu_suggestion/raw", summary="Raw Usulan untuk Report", tags=["Usulan Menu"], operation_id="list raw usulan menu")
def get_suggestions_raw(db: Session = Depends(get_db)):
    """Mengambil data usulan dalam format raw untuk report service."""
    suggestions = db.query(MenuSuggestion).order_by(MenuSuggestion.timestamp.desc()).all()
    
    return [
        {
            "usulan_id": suggestion.usulan_id,
            "menu_name": suggestion.menu_name,
            "customer_name": suggestion.customer_name,
            "timestamp": suggestion.timestamp.isoformat()
        }
        for suggestion in suggestions
    ]

@app.get("/health", summary="Health Check", tags=["Utility"])
def health_check():
    """Cek apakah service menu sedang berjalan."""
    return {"status": "ok", "service": "menu_service"}

# Endpoint untuk menerima event bahan dari inventory service jika terjadi penambahan agar data dari inventory service dapat disinkronkan dengan menu service
@app.post("/receive_ingredient_event", summary="Terima Event Bahan", tags=["Inventory"], operation_id="receive ingredient event")
async def receive_ingredient_event(request: Request, db: Session = Depends(get_db)):
    """Sinkron add ingredient dari inventory_service (event_type=ingredient_added)."""
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Payload tidak valid (bukan JSON)")

    # Payload langsung berisi field ingredient (inventory_service sudah kirim flat)
    required = ["id", "name", "current_quantity", "minimum_quantity", "category", "unit"]
    if not all(k in data for k in required):
        raise HTTPException(status_code=400, detail="Field ingredient tidak lengkap")

    existing = db.query(SyncedInventory).filter(SyncedInventory.id == data["id"]).first()
    if existing:
        # Jika sudah ada, update saja (idempotent)
        existing.name = data["name"]
        existing.current_quantity = data["current_quantity"]
        existing.minimum_quantity = data["minimum_quantity"]
        existing.category = data["category"]
        existing.unit = data["unit"]
        db.commit()
        return {"message": "Ingredient sudah ada, data diperbarui", "data": {"id": existing.id}}

    new_ing = SyncedInventory(
        id=data["id"],
        name=data["name"],
        current_quantity=data["current_quantity"],
        minimum_quantity=data["minimum_quantity"],
        category=data["category"],
        unit=data["unit"]
    )
    db.add(new_ing)
    db.commit()
    logging.info(f"🔄 Sinkron add ingredient {new_ing.id} : {new_ing.name}")
    return {"message": "Ingredient ditambahkan", "data": {"id": new_ing.id}}

# Endpoint untuk menerima event bahan jika terjadi update dari inventory service agar data dari inventory service dapat disinkronkan dengan menu service
@app.put("/update_ingredient_event", summary="Update Bahan Event", tags=["Inventory"], operation_id="update ingredient event")
async def update_ingredient_event(request: Request, db: Session = Depends(get_db)):
    """Sinkron update ingredient dari inventory_service (event_type=ingredient_updated)."""
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Payload tidak valid")

    ingredient_id = data.get("id")
    if ingredient_id is None:
        raise HTTPException(status_code=400, detail="Field id wajib ada")

    ingredient = db.query(SyncedInventory).filter(SyncedInventory.id == ingredient_id).first()
    if not ingredient:
        raise HTTPException(status_code=404, detail="Bahan tidak ditemukan untuk diupdate")

    # Update
    for field in ["name", "current_quantity", "minimum_quantity", "category", "unit"]:
        if field in data:
            setattr(ingredient, field, data[field])
    db.commit()
    logging.info(f"🔄 Sinkron update ingredient {ingredient_id}")
    return {"message": "Ingredient diperbarui", "data": {"id": ingredient_id}}

# Endpoint untuk menghapus bahan berdasarkan ID dari inventory service agar data dari inventory service dapat disinkronkan dengan menu service
@app.delete("/delete_ingredient_event/{ingredient_id}", summary="Hapus Bahan Event", tags=["Inventory"], operation_id="delete ingredient event")
def delete_ingredient_event(ingredient_id: int, db: Session = Depends(get_db)):
    """Sinkron delete ingredient (event_type=ingredient_deleted)."""
    ing = db.query(SyncedInventory).filter(SyncedInventory.id == ingredient_id).first()
    if not ing:
        # Idempotent delete
        return {"message": "Ingredient tidak ditemukan, dianggap sudah terhapus"}
    db.delete(ing)
    db.commit()
    logging.info(f"🗑️ Sinkron delete ingredient {ingredient_id}")
    return {"message": "Ingredient dihapus", "data": {"id": ingredient_id}}

# Endpoint untuk mendapatkan semua bahan resep yang tersedia sesuai dengan data yang ada di inventory service
@app.post("/recipes/batch", summary="Ambil resep banyak menu", tags=["Recipe"], operation_id="batch recipes")
def get_recipes_batch(payload: dict = Body(...), db: Session = Depends(get_db)):
    """
    Body: { "menu_names": ["Caffe Latte","Cappuccino"] }
    Return: { "recipes": { "Caffe Latte": [ {ingredient_id, quantity, unit}, ...], ... } }
    """
    menu_names = payload.get("menu_names", [])
    if not isinstance(menu_names, list) or not menu_names:
        raise HTTPException(status_code=400, detail="menu_names harus list dan tidak kosong")
    menu_rows = db.query(MenuItem).options(joinedload(MenuItem.recipe_ingredients)).filter(
        MenuItem.base_name.in_(menu_names)
    ).all()
    mapping = {m.base_name: [] for m in menu_rows}
    for m in menu_rows:
        for r in m.recipe_ingredients:
            mapping[m.base_name].append({
                "ingredient_id": r.ingredient_id,
                "quantity": r.quantity,
                "unit": r.unit
            })
    # Pastikan menu yang tidak ditemukan tetap muncul kosong untuk feedback
    for name in menu_names:
        mapping.setdefault(name, [])
    return {"recipes": mapping}

hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ menu_service sudah running di http://{local_ip}:8001 Operation Added ")
logging.info("Dokumentasi API tersedia di http://{local_ip}:8001/docs")

mcp.setup_server()