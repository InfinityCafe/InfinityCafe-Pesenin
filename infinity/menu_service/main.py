from fastapi import Body, FastAPI, HTTPException, Depends, Request, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, validator, Field, ValidationError
from sqlalchemy import create_engine, Column, String, Integer, Boolean, DateTime, Table, ForeignKey, Float, Text, text
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
    if request.url.path.startswith("/flavors"):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "status": "error",
                "message": exc.detail,
                "data": {"error_type": "business_logic_error", "original_status": exc.status_code}
            }
        )
    
    if exc.status_code in [400, 404]:
        return JSONResponse(
            status_code=200,
            content={
                "status": "error",
                "message": exc.detail,
                "data": {"error_type": "business_logic_error", "original_status": exc.status_code}
            }
        )
    
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "status": "error",
            "message": exc.detail,
            "data": {"error_type": "http_error", "original_status": exc.status_code}
        }
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


mcp = FastApiMCP(app,name="Server MCP Infinity",
        description="Server MCP Infinity Descr",
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
    base_name_en = Column(String, index=True)  
    base_name_id = Column(String, index=True)  
    base_price = Column(Integer)
    isAvail = Column(Boolean, default=True)
    making_time_minutes = Column(Float, default=0)

    recipe_ingredients = relationship("RecipeIngredient", back_populates="menu_item")
    
    flavors = relationship(
        "Flavor",
        secondary=menu_item_flavor_association,
        back_populates="menu_items"
    )

class Flavor(Base):
    __tablename__ = "flavors"
    id = Column(String, primary_key=True, index=True)
    flavor_name_en = Column(String, index=True)  
    flavor_name_id = Column(String, index=True)  
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
    description = Column(Text, nullable=True)


class FlavorBase(BaseModel):
    flavor_name_en: str = Field(..., min_length=1, description="English flavor name tidak boleh kosong")
    flavor_name_id: str = Field(..., min_length=1, description="Indonesian flavor name tidak boleh kosong")
    additional_price: Optional[int] = Field(default=0, ge=0, description="Harga tambahan tidak boleh negatif, default 0 jika tidak diisi")
    isAvail: bool = True

class FlavorCreate(FlavorBase):
    @validator('flavor_name_en')
    def validate_flavor_name_en(cls, v):
        if not v or v.strip() == "":
            raise ValueError('English flavor name tidak boleh kosong atau hanya spasi')
        return v.strip()
    
    @validator('flavor_name_id')
    def validate_flavor_name_id(cls, v):
        if not v or v.strip() == "":
            raise ValueError('Indonesian flavor name tidak boleh kosong atau hanya spasi')
        return v.strip()
    
    @validator('additional_price')
    def validate_additional_price(cls, v):
        if v is None:
            return 0  
        if v < 0:
            raise ValueError('Harga tambahan tidak boleh negatif')
        return v

class FlavorOut(FlavorBase):
    id: str
    model_config = { "from_attributes": True }

class MenuItemBase(BaseModel):
    base_name_en: str = Field(..., min_length=1, description="Nama menu tidak boleh kosong")
    base_name_id: str = Field(..., min_length=1, description="Nama menu tidak boleh kosong")
    base_price: int = Field(..., gt=0, description="Harga harus lebih dari 0")
    isAvail: bool = True
    making_time_minutes: float = Field(default=0, ge=0, description="Waktu pembuatan menu dalam menit")

class RecipeIngredientCreate(BaseModel):
    ingredient_id: int = Field(..., description="ID ingredient dari inventory service")
    quantity: float = Field(..., gt=0, description="Jumlah ingredient yang dibutuhkan")
    unit: str = Field(..., min_length=1, description="Unit (milliliter, gram, piece)")
    
    @validator('unit')
    def validate_unit(cls, v):
        allowed_units = ['milliliter', 'gram', 'piece']
        if v.lower() not in allowed_units:
            raise ValueError(f'Unit harus salah satu dari: {", ".join(allowed_units)}')
        return v.lower()

class MenuItemCreate(MenuItemBase):
    flavor_ids: List[str] = Field(default=[], description="ID flavor untuk menu (opsional)")
    recipe_ingredients: List[RecipeIngredientCreate] = Field(default=[], description="Resep ingredients untuk menu ini (WAJIB untuk menu baru)")
    
    @validator('base_name_en')
    def validate_base_name_en(cls, v):
        if not v or v.strip() == "":
            raise ValueError('Nama menu tidak boleh kosong atau hanya spasi')
        return v.strip()
    
    @validator('base_name_id')
    def validate_base_name_id(cls, v):
        if not v or v.strip() == "":
            raise ValueError('Nama menu tidak boleh kosong atau hanya spasi')
        return v.strip()
    
    @validator('recipe_ingredients')
    def validate_recipe_ingredients(cls, v):
        if not v or len(v) == 0:
            raise ValueError('Recipe ingredients tidak boleh kosong! Menu harus memiliki setidaknya 1 ingredient.')
        return v
    
    @validator('base_price')
    def validate_base_price(cls, v):
        if v is None or v <= 0:
            raise ValueError('Harga harus lebih dari 0')
        return v
    
    @validator('flavor_ids')
    def validate_flavor_ids(cls, v):
        if v is None:
            return []
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
    description: Optional[str] = None
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
    description: Optional[str] = None
    model_config = { "from_attributes": True }

class SyncedInventory(Base):
    __tablename__ = "synced_inventory"
    id = Column(Integer, primary_key=True, index=True)  
    name = Column(String, index=True)
    current_quantity = Column(Float, default=0)
    minimum_quantity = Column(Float, default=0)
    category = Column(String, index=True)
    unit = Column(String, index=True)
        
    recipe_ingredients = relationship("RecipeIngredient", back_populates="ingredient")

class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"
    id = Column(Integer, primary_key=True, index=True)
    menu_item_id = Column(String, ForeignKey('menu_items.id'))
    ingredient_id = Column(Integer, ForeignKey('synced_inventory.id'))
    quantity = Column(Float, nullable=False)
    unit = Column(String, nullable=False) 

    menu_item = relationship("MenuItem", back_populates="recipe_ingredients")
    ingredient = relationship("SyncedInventory", back_populates="recipe_ingredients")

Base.metadata.create_all(bind=engine)

# Safe migration: add description column if it does not exist
try:
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE menu_suggestions ADD COLUMN IF NOT EXISTS description TEXT"))
        conn.commit()
except Exception:
    pass
    
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
    
    if not flavor.flavor_name_en or flavor.flavor_name_en.strip() == "":
        raise HTTPException(status_code=400, detail="Nama flavor tidak boleh kosong")
    
    if not flavor.flavor_name_id or flavor.flavor_name_id.strip() == "":
        raise HTTPException(status_code=400, detail="Nama flavor tidak boleh kosong")
    
    price = flavor.additional_price if flavor.additional_price is not None else 0
    
    if price < 0:
        raise HTTPException(status_code=400, detail="Harga tambahan tidak boleh negatif")
    
    db_flavor_en = db.query(Flavor).filter(Flavor.flavor_name_en == flavor.flavor_name_en.strip()).first()
    if db_flavor_en:
        raise HTTPException(status_code=400, detail="Rasa dengan nama ini sudah ada")
    
    db_flavor_id = db.query(Flavor).filter(Flavor.flavor_name_id == flavor.flavor_name_id.strip()).first()
    if db_flavor_id:
        raise HTTPException(status_code=400, detail="Rasa dengan nama ini sudah ada")
    
    new_flavor = Flavor(
        id=generate_id("FLAV", 6), 
        flavor_name_en=flavor.flavor_name_en.strip(),
        flavor_name_id=flavor.flavor_name_id.strip(),
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
            "flavor_name_en": new_flavor.flavor_name_en,
            "flavor_name_id": new_flavor.flavor_name_id,
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

@app.options("/flavors/{flavor_id}")
async def options_flavor_item(flavor_id: str):
    return {"message": "OK"}

@app.put("/flavors/{flavor_id}", summary="Update Varian Rasa", tags=["Flavor"], operation_id="update flavor")
def update_flavor_item(flavor_id: str, flavor: FlavorCreate, db: Session = Depends(get_db)):
    """Memperbarui informasi dari varian rasa berdasarkan ID."""
    db_flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not db_flavor:
        raise HTTPException(status_code=404, detail="Varian rasa tidak ditemukan")
    
    if not flavor.flavor_name_en or flavor.flavor_name_en.strip() == "":
        raise HTTPException(status_code=400, detail="Nama varian rasa tidak boleh kosong")
    
    if not flavor.flavor_name_id or flavor.flavor_name_id.strip() == "":
        raise HTTPException(status_code=400, detail="Nama varian rasa tidak boleh kosong")
    
    if flavor.additional_price is None or flavor.additional_price < 0:
        raise HTTPException(status_code=400, detail="Harga tambahan tidak boleh negatif")
    
    existing_en = db.query(Flavor).filter(
        Flavor.flavor_name_en == flavor.flavor_name_en.strip(),
        Flavor.id != flavor_id
    ).first()
    if existing_en:
        raise HTTPException(status_code=400, detail=f"Varian rasa dengan nama '{flavor.flavor_name_en}' sudah ada.")
    
    existing_id = db.query(Flavor).filter(
        Flavor.flavor_name_id == flavor.flavor_name_id.strip(),
        Flavor.id != flavor_id
    ).first()
    if existing_id:
        raise HTTPException(status_code=400, detail=f"Varian rasa dengan nama '{flavor.flavor_name_id}' sudah ada.")
    
    db_flavor.flavor_name_en = flavor.flavor_name_en.strip()
    db_flavor.flavor_name_id = flavor.flavor_name_id.strip()
    db_flavor.additional_price = flavor.additional_price
    db_flavor.isAvail = flavor.isAvail
    
    db.commit()
    db.refresh(db_flavor)
    
    return {
        "status": "success",
        "message": "Varian rasa berhasil diperbarui",
        "data": {
            "id": db_flavor.id,
            "flavor_name_en": db_flavor.flavor_name_en,
            "flavor_name_id": db_flavor.flavor_name_id,
            "additional_price": db_flavor.additional_price
        }
    }

@app.delete("/flavors/{flavor_id}", summary="Hapus Varian Rasa", tags=["Flavor"], operation_id="delete flavor")
def delete_flavor_item(flavor_id: str, db: Session = Depends(get_db)):
    """Menghapus varian rasa berdasarkan ID."""
    db_flavor = db.query(Flavor).filter(Flavor.id == flavor_id).first()
    if not db_flavor:
        raise HTTPException(status_code=404, detail="Varian rasa tidak ditemukan")
    
    menu_items_using_flavor = db.query(MenuItem).filter(
        MenuItem.flavors.any(id=flavor_id)
    ).all()
    
    if menu_items_using_flavor:
        menu_names = [f"{item.base_name_en} / {item.base_name_id}" for item in menu_items_using_flavor]
        raise HTTPException(
            status_code=400, 
            detail=f"Varian rasa tidak dapat dihapus karena masih digunakan oleh menu: {', '.join(menu_names)}"
        )
    
    db.execute(
        menu_item_flavor_association.delete().where(
            menu_item_flavor_association.c.flavor_id == flavor_id
        )
    )
    
    db.delete(db_flavor)
    db.commit()
    
    # Return explicit non-null JSON response
    return {
        "status": "success",
        "message": "Varian rasa berhasil dihapus",
        "data": {
            "id": flavor_id,
            "flavor_name_en": db_flavor.flavor_name_en,
            "flavor_name_id": db_flavor.flavor_name_id
        }
    }

@app.post("/menu", summary="Tambah Menu Baru", tags=["Menu"], operation_id="add menu")
def create_menu_item(item: MenuItemCreate, db: Session = Depends(get_db)):
    """Menambahkan menu dasar baru beserta recipe ingredients dan menautkannya dengan varian rasa."""
    
    if not item.base_name_en or item.base_name_en.strip() == "":
        raise HTTPException(status_code=400, detail="Nama menu tidak boleh kosong")
    
    if not item.base_name_id or item.base_name_id.strip() == "":
        raise HTTPException(status_code=400, detail="Nama menu tidak boleh kosong")

    if item.base_price is None or item.base_price <= 0:
        raise HTTPException(status_code=400, detail="Harga menu harus diisi dan lebih dari 0")
    
    if not item.recipe_ingredients or len(item.recipe_ingredients) == 0:
        raise HTTPException(status_code=400, detail="Recipe ingredients tidak boleh kosong! Menu harus memiliki setidaknya 1 ingredient.")
    
    ingredient_ids = [ri.ingredient_id for ri in item.recipe_ingredients]
    existing_ingredients = db.query(SyncedInventory).filter(SyncedInventory.id.in_(ingredient_ids)).all()
    existing_ingredient_ids = {ing.id for ing in existing_ingredients}
    
    missing_ingredients = set(ingredient_ids) - existing_ingredient_ids
    if missing_ingredients:
        raise HTTPException(
            status_code=400, 
            detail=f"Ingredient ID tidak ditemukan di inventory service: {', '.join(map(str, missing_ingredients))}"
        )
    
    if item.flavor_ids:
        for flavor_id in item.flavor_ids:
            if not flavor_id or flavor_id.strip() == "":
                raise HTTPException(status_code=400, detail="Flavor ID tidak boleh kosong")
    
    existing_en = db.query(MenuItem).filter(MenuItem.base_name_en == item.base_name_en.strip()).first()
    if existing_en:
        raise HTTPException(status_code=400, detail=f"Menu dengan nama '{item.base_name_en}' sudah ada.")
    
    existing_id = db.query(MenuItem).filter(MenuItem.base_name_id == item.base_name_id.strip()).first()
    if existing_id:
        raise HTTPException(status_code=400, detail=f"Menu dengan nama '{item.base_name_id}' sudah ada.")
    
    if item.flavor_ids:
        flavors = db.query(Flavor).filter(Flavor.id.in_(item.flavor_ids)).all()
        if len(flavors) != len(item.flavor_ids):
            missing_ids = set(item.flavor_ids) - {f.id for f in flavors}
            raise HTTPException(status_code=404, detail=f"Flavor ID tidak ditemukan: {', '.join(missing_ids)}")
    else:
        flavors = []

    db_item = MenuItem(
        id=generate_id("MENU"), 
        base_name_en=item.base_name_en.strip(), 
        base_name_id=item.base_name_id.strip(),
        base_price=item.base_price, 
        isAvail=item.isAvail,
        making_time_minutes=item.making_time_minutes
    )
    
    if flavors:
        db_item.flavors.extend(flavors)
    
    db.add(db_item)
    db.flush()  
    
    recipe_ingredients_created = []
    for recipe_ingredient in item.recipe_ingredients:
        db_recipe = RecipeIngredient(
            menu_item_id=db_item.id,
            ingredient_id=recipe_ingredient.ingredient_id,
            quantity=recipe_ingredient.quantity,
            unit=recipe_ingredient.unit
        )
        db.add(db_recipe)
        
        ingredient = next((ing for ing in existing_ingredients if ing.id == recipe_ingredient.ingredient_id), None)
        recipe_ingredients_created.append({
            "ingredient_id": recipe_ingredient.ingredient_id,
            "ingredient_name": ingredient.name if ingredient else f"ID:{recipe_ingredient.ingredient_id}",
            "quantity": recipe_ingredient.quantity,
            "unit": recipe_ingredient.unit
        })
    
    db.commit()
    db.refresh(db_item)
    
    return {
        "status": "success",
        "message": "Menu beserta recipe berhasil ditambahkan",
        "data": {
            "id": db_item.id,
            "base_name_en": db_item.base_name_en,
            "base_name_id": db_item.base_name_id,
            "base_price": db_item.base_price,
            "isAvail": db_item.isAvail,
            "flavors": [{"id": f.id, "flavor_name_en": f.flavor_name_en, "flavor_name_id": f.flavor_name_id, "additional_price": f.additional_price} for f in db_item.flavors],
            "recipe_ingredients": recipe_ingredients_created
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
    """Mengembalikan daftar rasa yang tersedia untuk menu tertentu berdasarkan namanya (English atau Indonesian)."""
    menu_item = db.query(MenuItem).options(joinedload(MenuItem.flavors)).filter(
        (MenuItem.base_name_en == base_name) | (MenuItem.base_name_id == base_name)
    ).first()
    
    if not menu_item:
        raise HTTPException(status_code=404, detail=f"Menu dengan nama '{base_name}' tidak ditemukan.")
    
    return menu_item.flavors

@app.put("/menu/{menu_id}", summary="Update Menu", tags=["Menu"], response_model=MenuItemOut, operation_id="update menu")
def update_menu_item(menu_id: str, item: MenuItemCreate, db: Session = Depends(get_db)):
    """Memperbarui informasi dari menu berdasarkan ID, termasuk varian rasanya."""
    db_item = db.query(MenuItem).options(joinedload(MenuItem.flavors)).filter(MenuItem.id == menu_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Menu item tidak ditemukan")
    
    db_item.base_name_en = item.base_name_en
    db_item.base_name_id = item.base_name_id
    db_item.base_price = item.base_price
    db_item.isAvail = item.isAvail
    db_item.making_time_minutes = item.making_time_minutes
    
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
        
        exist_main = db.query(MenuItem).filter(
            (MenuItem.base_name_en == item.menu_name.strip()) | (MenuItem.base_name_id == item.menu_name.strip())
        ).first()
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
            customer_name=item.customer_name.strip(),
            description=(item.description.strip() if isinstance(item.description, str) and item.description.strip() != "" else None)
        )
        db.add(suggestion)
        db.commit()
        
        return {
            "status": "success",
            "message": "Langit cerah, hati lega — usulan kamu bisa jadi tren menu selanjutnya 🌟",
            "data": {
                "usulan_id": suggestion.usulan_id,
                "menu_name": suggestion.menu_name,
                "customer_name": suggestion.customer_name,
                "description": suggestion.description
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
    
    suggestion_data = []
    for suggestion in suggestions:
        suggestion_data.append({
            "usulan_id": suggestion.usulan_id,
            "menu_name": suggestion.menu_name,
            "customer_name": suggestion.customer_name,
            "timestamp": suggestion.timestamp.isoformat(),
            "description": suggestion.description
        })
    
    return {
        "status": "success", 
        "message": f" Hallo! Kami punya beberapa usulan menu yang baru nih dari pelanggan lain, coba cek siapa tahu ada yang cocok dengan anda:",
        "data": suggestion_data
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

@app.post("/receive_ingredient_event", summary="Terima Event Bahan", tags=["Inventory"], operation_id="receive ingredient event")
async def receive_ingredient_event(request: Request, db: Session = Depends(get_db)):
    """Sinkron add ingredient dari inventory_service (event_type=ingredient_added)."""
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Payload tidak valid (bukan JSON)")

    required = ["id", "name", "current_quantity", "minimum_quantity", "category", "unit"]
    if not all(k in data for k in required):
        raise HTTPException(status_code=400, detail="Field ingredient tidak lengkap")

    existing = db.query(SyncedInventory).filter(SyncedInventory.id == data["id"]).first()
    if existing:
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

    for field in ["name", "current_quantity", "minimum_quantity", "category", "unit"]:
        if field in data:
            setattr(ingredient, field, data[field])
    db.commit()
    logging.info(f"🔄 Sinkron update ingredient {ingredient_id}")
    return {"message": "Ingredient diperbarui", "data": {"id": ingredient_id}}

@app.get("/ingredients/available", summary="Daftar Ingredients Tersedia", tags=["Recipe"], operation_id="list available ingredients")
def get_available_ingredients(db: Session = Depends(get_db)):
    """Mengambil daftar ingredients yang tersedia dari synced inventory untuk pembuatan recipe."""
    
    ingredients = db.query(SyncedInventory).order_by(SyncedInventory.id.asc()).all()
    
    ingredients_data = []
    for ing in ingredients:
        ingredients_data.append({
            "ingredient_id": ing.id,
            "ingredient_name": ing.name,
            "current_quantity": ing.current_quantity,
            "minimum_quantity": ing.minimum_quantity,
            "category": ing.category,
            "unit": ing.unit,
            "is_low_stock": ing.current_quantity <= ing.minimum_quantity
        })
    
    categories = {}
    for ing in ingredients_data:
        cat = ing["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(ing)
    
    return {
        "status": "success",
        "message": f"Berhasil mengambil {len(ingredients_data)} ingredients tersedia",
        "data": {
            "total_ingredients": len(ingredients_data),
            "low_stock_count": sum(1 for ing in ingredients_data if ing["is_low_stock"]),
            "categories": categories,
            "all_ingredients": ingredients_data
        }
    }

@app.get("/recipes/validation", summary="Validasi Recipe Ingredients", tags=["Recipe"], operation_id="validate recipe ingredients")
def validate_recipe_ingredients(
    ingredient_ids: str = Query(..., description="Comma-separated ingredient IDs (e.g., '1,2,3')"),
    db: Session = Depends(get_db)
):
    """Memvalidasi apakah ingredient IDs tersedia di inventory service."""
    
    try:
        ids = [int(id.strip()) for id in ingredient_ids.split(',') if id.strip().isdigit()]
        if not ids:
            raise HTTPException(status_code=400, detail="Tidak ada ingredient ID yang valid")
        
        available_ingredients = db.query(SyncedInventory).filter(SyncedInventory.id.in_(ids)).all()
        available_ids = {ing.id for ing in available_ingredients}
        missing_ids = set(ids) - available_ids
        
        validation_results = []
        for ing in available_ingredients:
            validation_results.append({
                "ingredient_id": ing.id,
                "ingredient_name": ing.name,
                "is_available": True,
                "current_stock": ing.current_quantity,
                "unit": ing.unit,
                "category": ing.category
            })
        
        for missing_id in missing_ids:
            validation_results.append({
                "ingredient_id": missing_id,
                "ingredient_name": f"Unknown ID:{missing_id}",
                "is_available": False,
                "current_stock": 0,
                "unit": "unknown",
                "category": "unknown"
            })
        
        return {
            "status": "success" if len(missing_ids) == 0 else "warning",
            "message": f"Validasi selesai: {len(available_ids)} tersedia, {len(missing_ids)} tidak ditemukan",
            "data": {
                "total_checked": len(ids),
                "available_count": len(available_ids),
                "missing_count": len(missing_ids),
                "missing_ids": list(missing_ids),
                "validation_results": validation_results
            }
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Format ingredient_ids tidak valid: {str(e)}")

@app.delete("/delete_ingredient_event/{ingredient_id}", summary="Hapus Bahan Event", tags=["Inventory"], operation_id="delete ingredient event")
def delete_ingredient_event(ingredient_id: int, db: Session = Depends(get_db)):
    """Sinkron delete ingredient (event_type=ingredient_deleted)."""
    ing = db.query(SyncedInventory).filter(SyncedInventory.id == ingredient_id).first()
    if not ing:
        return {"message": "Ingredient tidak ditemukan, dianggap sudah terhapus"}
    db.delete(ing)
    db.commit()
    logging.info(f"🗑️ Sinkron delete ingredient {ingredient_id}")
    return {"message": "Ingredient dihapus", "data": {"id": ingredient_id}}

@app.post("/menu/{menu_id}/recipe", summary="Tambah/Update Recipe untuk Menu", tags=["Recipe"], operation_id="update menu recipe")
def update_menu_recipe(
    menu_id: str, 
    recipe_ingredients: List[RecipeIngredientCreate], 
    db: Session = Depends(get_db)
):
    """Menambah atau mengupdate recipe ingredients untuk menu yang sudah ada."""
    
    menu = db.query(MenuItem).filter(MenuItem.id == menu_id).first()
    if not menu:
        raise HTTPException(status_code=404, detail=f"Menu dengan ID '{menu_id}' tidak ditemukan")
    
    if not recipe_ingredients or len(recipe_ingredients) == 0:
        raise HTTPException(status_code=400, detail="Recipe ingredients tidak boleh kosong")
    
    ingredient_ids = [ri.ingredient_id for ri in recipe_ingredients]
    existing_ingredients = db.query(SyncedInventory).filter(SyncedInventory.id.in_(ingredient_ids)).all()
    existing_ingredient_ids = {ing.id for ing in existing_ingredients}
    
    missing_ingredients = set(ingredient_ids) - existing_ingredient_ids
    if missing_ingredients:
        raise HTTPException(
            status_code=400, 
            detail=f"Ingredient ID tidak ditemukan di inventory service: {', '.join(map(str, missing_ingredients))}"
        )
    
    db.query(RecipeIngredient).filter(RecipeIngredient.menu_item_id == menu_id).delete()
    
    recipe_ingredients_created = []
    for recipe_ingredient in recipe_ingredients:
        db_recipe = RecipeIngredient(
            menu_item_id=menu_id,
            ingredient_id=recipe_ingredient.ingredient_id,
            quantity=recipe_ingredient.quantity,
            unit=recipe_ingredient.unit
        )
        db.add(db_recipe)
        
        ingredient = next((ing for ing in existing_ingredients if ing.id == recipe_ingredient.ingredient_id), None)
        recipe_ingredients_created.append({
            "ingredient_id": recipe_ingredient.ingredient_id,
            "ingredient_name": ingredient.name if ingredient else f"ID:{recipe_ingredient.ingredient_id}",
            "quantity": recipe_ingredient.quantity,
            "unit": recipe_ingredient.unit
        })
    
    db.commit()
    
    return {
        "status": "success",
        "message": f"Recipe untuk menu '{menu.base_name_en} / {menu.base_name_id}' berhasil diperbarui",
        "data": {
            "menu_id": menu_id,
            "menu_name_en": menu.base_name_en,
            "menu_name_id": menu.base_name_id,
            "total_ingredients": len(recipe_ingredients_created),
            "recipe_ingredients": recipe_ingredients_created
        }
    }

@app.get("/menu/{menu_id}/recipe", summary="Lihat Recipe Menu", tags=["Recipe"], operation_id="get menu recipe")
def get_menu_recipe(menu_id: str, db: Session = Depends(get_db)):
    """Mengambil recipe ingredients untuk menu tertentu dengan detail ingredient."""
    
    menu = db.query(MenuItem).options(joinedload(MenuItem.recipe_ingredients)).filter(MenuItem.id == menu_id).first()
    if not menu:
        raise HTTPException(status_code=404, detail=f"Menu dengan ID '{menu_id}' tidak ditemukan")
    
    recipe_with_details = []
    for recipe in menu.recipe_ingredients:
        ingredient = db.query(SyncedInventory).filter(SyncedInventory.id == recipe.ingredient_id).first()
        recipe_with_details.append({
            "ingredient_id": recipe.ingredient_id,
            "ingredient_name": ingredient.name if ingredient else f"Unknown ID:{recipe.ingredient_id}",
            "quantity": recipe.quantity,
            "unit": recipe.unit,
            "ingredient_category": ingredient.category if ingredient else "unknown",
            "current_stock": ingredient.current_quantity if ingredient else 0
        })
    
    return {
        "status": "success",
        "message": f"Recipe untuk menu '{menu.base_name_en} / {menu.base_name_id}' berhasil diambil",
        "data": {
            "menu_id": menu_id,
            "menu_name_en": menu.base_name_en,
            "menu_name_id": menu.base_name_id,
            "menu_price": menu.base_price,
            "is_available": menu.isAvail,
            "total_ingredients": len(recipe_with_details),
            "recipe_ingredients": recipe_with_details
        }
    }

@app.delete("/menu/{menu_id}/recipe", summary="Hapus Recipe Menu", tags=["Recipe"], operation_id="delete menu recipe")
def delete_menu_recipe(menu_id: str, db: Session = Depends(get_db)):
    """Menghapus semua recipe ingredients untuk menu tertentu."""
    
    menu = db.query(MenuItem).filter(MenuItem.id == menu_id).first()
    if not menu:
        raise HTTPException(status_code=404, detail=f"Menu dengan ID '{menu_id}' tidak ditemukan")
    
    deleted_count = db.query(RecipeIngredient).filter(RecipeIngredient.menu_item_id == menu_id).delete()
    db.commit()
    
    return {
        "status": "success",
        "message": f"Recipe untuk menu '{menu.base_name_en} / {menu.base_name_id}' berhasil dihapus",
        "data": {
            "menu_id": menu_id,
            "menu_name_en": menu.base_name_en,
            "menu_name_id": menu.base_name_id,
            "deleted_ingredients_count": deleted_count
        }
    }

@app.post("/recipes/batch", summary="Ambil resep banyak menu", tags=["Recipe"], operation_id="batch recipes")
def get_recipes_batch(payload: dict = Body(...), db: Session = Depends(get_db)):
    """
    Body: { "menu_names": ["Caffe Latte","Cappuccino","Kafe Latte"] }
    Return: { "recipes": { "Caffe Latte": [ {ingredient_id, quantity, unit}, ...], ... } }
    Mendukung pencarian dengan nama English atau Indonesian
    """
    menu_names = payload.get("menu_names", [])
    if not isinstance(menu_names, list) or not menu_names:
        raise HTTPException(status_code=400, detail="menu_names harus list dan tidak kosong")
    
    menu_rows = db.query(MenuItem).options(joinedload(MenuItem.recipe_ingredients)).filter(
        (MenuItem.base_name_en.in_(menu_names)) | (MenuItem.base_name_id.in_(menu_names))
    ).all()
    
    mapping = {}
    for m in menu_rows:
        for name in menu_names:
            if name == m.base_name_en or name == m.base_name_id:
                if name not in mapping:
                    mapping[name] = []
                    for r in m.recipe_ingredients:
                        mapping[name].append({
                            "ingredient_id": r.ingredient_id,
                            "quantity": r.quantity,
                            "unit": r.unit
                        })
    
    for name in menu_names:
        mapping.setdefault(name, [])
    
    return {"recipes": mapping}

hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ menu_service sudah running di http://{local_ip}:8001 Operation Added ")
logging.info("Dokumentasi API tersedia di http://{local_ip}:8001/docs")

mcp.setup_server()