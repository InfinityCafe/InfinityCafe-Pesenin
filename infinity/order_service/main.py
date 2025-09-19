from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, validator
from sqlalchemy import Boolean,create_engine, Column, String, Integer, ForeignKey, Text, DateTime, func, Index, and_
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from typing import List, Optional
import os
from dotenv import load_dotenv
import socket
import logging
import requests
from datetime import datetime, date
from pytz import timezone as pytz_timezone
import json
import uuid
from fastapi_mcp import FastApiMCP
import uvicorn
from fastapi import APIRouter
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL_ORDER")
MENU_SERVICE_URL = os.getenv("MENU_SERVICE_URL", "http://menu_service:8001")
INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://inventory_service:8006")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

app = FastAPI(
    title="Order Service API",
    description="Manajemen pemesanan untuk Infinity Cafe",
    version="1.0.0"
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Custom handler untuk menangani validasi error, merubah error status menjadi 200 untuk memastikan flow n8n tetap berjalan."""
    first_error = exc.errors()[0]
    field_location = " -> ".join(map(str, first_error['loc']))
    error_message = first_error['msg']
    
    full_message = f"Data tidak valid pada field '{field_location}': {error_message}"

    # Convert errors to string format to avoid JSON serialization issues
    error_details = []
    for error in exc.errors():
        error_dict = {
            "type": error.get("type", ""),
            "loc": [str(loc) for loc in error.get("loc", [])],
            "msg": str(error.get("msg", "")),
            "input": str(error.get("input", ""))[:200]  # Limit input length
        }
        error_details.append(error_dict)

    return JSONResponse(
        status_code=200,
        content={
            "status": "error",
            "message": full_message,
            "data": {"details": error_details}
        },
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://kitchen.gikstaging.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"]
)

mcp = FastApiMCP(app,name="Server MCP Infinity",
        description="Server MCP Infinity Descr",
        include_operations=["add order","list order","cancel order","cancel kitchen order","cancel order item","order status","list rooms"]
        )
mcp.mount(mount_path="/mcp",transport="sse")
jakarta_tz = pytz_timezone('Asia/Jakarta')

class OrderOutbox(Base):
    __tablename__ = "order_outbox"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id = Column(String, nullable=False)
    event_type = Column(String, nullable=False)
    payload = Column(Text, nullable=False)
    processed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(jakarta_tz))
    processed_at = Column(DateTime(timezone=True), nullable=True)
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    error_message = Column(Text, nullable=True)

class Room(Base):
    __tablename__ = "rooms"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(jakarta_tz))

class Order(Base):
    __tablename__ = "orders"
    order_id = Column(String, primary_key=True)
    queue_number = Column(Integer, nullable=False)
    customer_name = Column(String)
    room_name = Column(String)
    status = Column(String, default="receive")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(jakarta_tz))
    cancel_reason = Column(Text, nullable=True)
    is_custom = Column(Boolean, default=False)
    items = relationship("OrderItem", back_populates="order", cascade="all, delete")

    __table_args__ = (
        Index(
            'ix_order_queue_per_day',
            queue_number,
            func.date(func.timezone('Asia/Jakarta', created_at)),
            unique=True
        ),
    )

class OrderItem(Base):
    __tablename__ = "order_items"
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String, ForeignKey("orders.order_id"))
    telegram_id = Column(String, nullable=False)
    menu_name = Column(String)
    quantity = Column(Integer)
    preference = Column(Text)
    notes = Column(Text, nullable=True)
    status = Column(String, default="active")  # active, cancelled
    cancelled_reason = Column(Text, nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    order = relationship("Order", back_populates="items")

Base.metadata.create_all(bind=engine)

class OrderItemSchema(BaseModel):
    menu_name: str = Field(..., min_length=1, description="Nama menu tidak boleh kosong.")
    quantity: int = Field(..., gt=0, description="Jumlah pesanan harus lebih dari 0.")
    telegram_id: Optional[str] = Field(default="WEB_USER", description="ID Telegram (opsional, default: WEB_USER)")
    preference: Optional[str] = ""
    notes: Optional[str] = None

    class Config:
        from_attributes = True

class CreateOrderRequest(BaseModel):
    customer_name: str = Field(..., min_length=1, description="Nama pelanggan tidak boleh kosong.")
    room_name: str = Field(..., min_length=1, description="Nama ruangan tidak boleh kosong.")
    orders: List[OrderItemSchema] = Field(..., min_length=1, description="Daftar pesanan tidak boleh kosong.")
    order_id: Optional[str] = None

    class Config:
        from_attributes = True

class CancelOrderRequest(BaseModel):
    order_id: str
    reason: str

class CancelOrderItemRequest(BaseModel):
    order_id: str
    item_id: Optional[int] = None
    menu_name: Optional[str] = None
    reason: str
    
    @validator('reason')
    def validate_identification(cls, v, values):
        # Validasi dilakukan pada field terakhir untuk memastikan semua field sudah di-parse
        item_id = values.get('item_id')
        menu_name = values.get('menu_name')
        
        if not item_id and not menu_name:
            raise ValueError("Either item_id or menu_name must be provided")
        if item_id and menu_name:
            raise ValueError("Provide either item_id or menu_name, not both")
        return v

class StatusUpdateRequest(BaseModel):
    status: str

class RoomSchema(BaseModel):
    id: int
    name: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def generate_order_id():
    timestamp = datetime.now(jakarta_tz).strftime("%Y%m%d%H%M%S%f")
    unique_code = uuid.uuid4().hex[:6].upper()
    return f"ORD{timestamp}{unique_code}"

def get_next_queue_number(db: Session) -> int:
    today_jakarta = datetime.now(jakarta_tz).date()

    last_order_today = db.query(Order).filter(
        func.date(func.timezone('Asia/Jakarta', Order.created_at)) == today_jakarta
    ).order_by(Order.queue_number.desc()).first()

    if last_order_today:
        return last_order_today.queue_number + 1
    else:
        return 1
    
def validate_order_items(order_items: List[OrderItemSchema]) -> Optional[str]:
    """Menghubungi menu_service untuk memvalidasi item."""
    try:
        response = requests.get(f"{MENU_SERVICE_URL}/menu", timeout=5)
        response.raise_for_status()
        available_menus = response.json()
    except requests.RequestException as e:
        logging.error(f"Gagal menghubungi menu_service: {e}")
        return "Tidak dapat memvalidasi menu saat ini, layanan menu sedang OFF."

    # Menggunakan field dwi bahasa baru untuk validasi
    valid_menu_names = set()
    for menu in available_menus:
        # Tambahkan nama bahasa Inggris dan Indonesia
        if menu.get('base_name_en'):
            valid_menu_names.add(menu.get('base_name_en'))
        if menu.get('base_name_id'):
            valid_menu_names.add(menu.get('base_name_id'))
        # Fallback untuk compatibility dengan nama lama
        if menu.get('base_name'):
            valid_menu_names.add(menu.get('base_name'))
        if menu.get('menu_name'):
            valid_menu_names.add(menu.get('menu_name'))
    
    valid_menu_names.discard(None)

    invalid_items = [
        item.menu_name for item in order_items if item.menu_name not in valid_menu_names
    ]

    if invalid_items:
        return f"Menu berikut tidak ditemukan atau tidak tersedia: {', '.join(invalid_items)}"
    
    return None

def validate_room_name(room_name: str, db: Session) -> Optional[str]:
    """Memvalidasi nama ruangan berdasarkan data di database."""
    room = db.query(Room).filter(
        Room.name == room_name,
        Room.is_active == True
    ).first()
    
    if not room:
        # Ambil daftar ruangan yang tersedia untuk ditampilkan ke user
        available_rooms = db.query(Room).filter(Room.is_active == True).all()
        room_names = [room.name for room in available_rooms]
        
        if room_names:
            room_list = "\n".join([f"{i+1}. {name}" for i, name in enumerate(room_names)])
            return f"Nama ruangan '{room_name}' tidak valid. Ruangan yang tersedia:\n\n{room_list}\n\nSilakan pilih salah satu ruangan yang tersedia."
        else:
            return "Tidak ada ruangan yang tersedia saat ini."
    
    return None

def cancel_order_item_by_stock(order_id: str, menu_name: str, reason: str, db: Session) -> dict:
    """
    Membatalkan item order tertentu karena stok habis.
    Returns: {'cancelled_items': [...], 'remaining_items': [...], 'order_status': 'active/cancelled'}
    """
    # Ambil order
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        return {"error": f"Order {order_id} tidak ditemukan"}
    
    # Ambil item yang akan dibatalkan
    items_to_cancel = db.query(OrderItem).filter(
        OrderItem.order_id == order_id,
        OrderItem.menu_name == menu_name,
        OrderItem.status == "active"
    ).all()
    
    if not items_to_cancel:
        return {"error": f"Menu '{menu_name}' tidak ditemukan atau sudah dibatalkan dalam order {order_id}"}
    
    cancelled_items = []
    for item in items_to_cancel:
        item.status = "cancelled"
        item.cancelled_reason = reason
        item.cancelled_at = datetime.now(jakarta_tz)
        cancelled_items.append({
            "item_id": item.id,
            "menu_name": item.menu_name,
            "quantity": item.quantity,
            "preference": item.preference,
            "reason": reason
        })
    
    # Cek apakah masih ada item aktif
    remaining_items = db.query(OrderItem).filter(
        OrderItem.order_id == order_id,
        OrderItem.status == "active"
    ).all()
    
    # Update status order jika semua item dibatalkan
    if not remaining_items:
        order.status = "cancelled"
        order.cancel_reason = "Semua item dibatalkan karena stok habis"
        order_status = "cancelled"
    else:
        order_status = "partial_cancelled"
    
    # Buat outbox event untuk partial cancellation
    cancel_payload = {
        "order_id": order_id,
        "type": "partial_cancel",
        "cancelled_items": cancelled_items,
        "remaining_items": [
            {
                "item_id": item.id,
                "menu_name": item.menu_name,
                "quantity": item.quantity,
                "preference": item.preference
            } for item in remaining_items
        ],
        "reason": reason,
        "cancelled_at": datetime.now(jakarta_tz).isoformat(),
        "order_status": order_status
    }
    
    create_outbox_event(db, order_id, "item_cancelled", cancel_payload)
    db.commit()
    
    return {
        "cancelled_items": cancelled_items,
        "remaining_items": [
            {
                "item_id": item.id,
                "menu_name": item.menu_name,
                "quantity": item.quantity,
                "preference": item.preference
            } for item in remaining_items
        ],
        "order_status": order_status
    }

def check_stock_per_item(order_items: List[OrderItemSchema], order_id: str) -> tuple[bool, list, list]:
    """
    Cek stok per item dan pisahkan yang bisa dipenuhi vs yang tidak.
    Returns: (can_fulfill_all, available_items, unavailable_items)
    """
    available_items = []
    unavailable_items = []
    
    for item in order_items:
        try:
            # Cek stok per item individual
            inventory_payload = {
                "order_id": f"{order_id}_check_{item.menu_name}",
                "items": [{"menu_name": item.menu_name, "quantity": item.quantity, "preference": item.preference}]
            }
            
            stock_resp = requests.post(
                f"{INVENTORY_SERVICE_URL}/stock/check_availability",
                json=inventory_payload,
                timeout=7
            )
            stock_data = stock_resp.json()
            
            if stock_data.get("can_fulfill", False):
                available_items.append(item)
            else:
                unavailable_items.append({
                    "item": item,
                    "shortages": stock_data.get("shortages", []),
                    "reason": f"Stok tidak mencukupi untuk {item.menu_name}"
                })
        except Exception as e:
            logging.error(f"Error checking stock for {item.menu_name}: {e}")
            unavailable_items.append({
                "item": item,
                "shortages": [],
                "reason": f"Error saat cek stok: {e}"
            })
    
    can_fulfill_all = len(unavailable_items) == 0
    return can_fulfill_all, available_items, unavailable_items
    
def create_outbox_event(db: Session, order_id: str, event_type: str, payload: dict):
    outbox_event = OrderOutbox(
        order_id=order_id,
        event_type=event_type,
        payload=json.dumps(payload)
    )
    db.add(outbox_event)
    return outbox_event

def process_outbox_events(db: Session):
    """Memproses outbox events yang belum terkirim"""
    
    unprocessed_events = db.query(OrderOutbox).filter(
        OrderOutbox.processed == False,
        OrderOutbox.retry_count < OrderOutbox.max_retries
    ).all()
    
    for event in unprocessed_events:
        try:
            payload = json.loads(event.payload)
            
            if event.event_type == "order_created":
                response = requests.post(
                    "http://kitchen_service:8003/receive_order",
                    json=payload,
                    timeout=5
                )
                response.raise_for_status()
                
            elif event.event_type == "order_cancelled":
                reason = payload.get("reason", "").strip()
                if not reason:
                    reason = "Dibatalkan oleh sistem"  # Default reason
                    
                logging.info(f"Mengirim pembatalan order {event.order_id} dengan reason: '{reason}'")
                
                response = requests.post(
                    f"http://kitchen_service:8003/kitchen/update_status/{event.order_id}",
                    params={"status": "cancelled", "reason": reason},
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

@app.post("/admin/process_outbox", tags=["Admin"])
def manual_process_outbox(db: Session = Depends(get_db)):
    """Memproses outbox events secara manual"""
    process_outbox_events(db)
    return {"message": "Outbox events processed"}

@app.get("/admin/outbox_status", tags=["Admin"])
def get_outbox_status(db: Session = Depends(get_db)):
    """Melihat status outbox events"""
    total_events = db.query(OrderOutbox).count()
    processed_events = db.query(OrderOutbox).filter(OrderOutbox.processed == True).count()
    failed_events = db.query(OrderOutbox).filter(
        OrderOutbox.processed == False,
        OrderOutbox.retry_count >= OrderOutbox.max_retries
    ).count()
    
    return {
        "total_events": total_events,
        "processed_events": processed_events,
        "failed_events": failed_events,
        "pending_events": total_events - processed_events - failed_events
    }

@app.post("/create_order", summary="Buat pesanan baru", tags=["Order"], operation_id="add order")
def create_order(req: CreateOrderRequest, db: Session = Depends(get_db)):
    """Membuat pesanan baru dan mengirimkannya ke kitchen_service."""

    # Validasi nama ruangan
    room_validation_error = validate_room_name(req.room_name, db)
    if room_validation_error:
        return JSONResponse(status_code=200, content={"status": "error", "message": room_validation_error, "data": None})

    validation_error = validate_order_items(req.orders)
    if validation_error:
        return JSONResponse(status_code=200, content={"status": "error", "message": validation_error, "data": None})
    
    flavor_required_menus = ["Caffe Latte", "Cappuccino", "Milkshake", "Squash"]
    # Menu yang memerlukan flavor (menggunakan nama dwi bahasa)
    flavor_required_menus = [
        "Caffe Latte", "Kafe Latte",  # Bahasa Inggris dan Indonesia
        "Cappuccino", "Kapucino", 
        "Milkshake", "Milkshake",
        "Squash", "Skuas"
    ]
    temp_order_id = req.order_id if req.order_id else generate_order_id()

    for item in req.orders:
        # Jika item memiliki preference, validasi apakah menu tersebut boleh memiliki flavor
        if item.preference and item.preference.strip():
            try:
                flavor_url = f"{MENU_SERVICE_URL}/menu/by_name/{item.menu_name}/flavors"
                logging.info(f"🔍 DEBUG: Validating flavor for menu '{item.menu_name}', preference: '{item.preference}'")
                logging.info(f"🔍 DEBUG: Calling flavor endpoint: {flavor_url}")
                flavor_response = requests.get(flavor_url, timeout=3)
                logging.info(f"🔍 DEBUG: Flavor response status: {flavor_response.status_code}")
                
                if flavor_response.status_code != 200:
                    return JSONResponse(status_code=200, content={"status": "error", "message": f"Gagal mendapatkan data rasa untuk {item.menu_name}", "data": None})
                
                available_flavors = flavor_response.json()
                
                # Jika menu tidak memiliki pasangan flavor sama sekali
                if not available_flavors or len(available_flavors) == 0:
                    logging.info(f"🚫 DEBUG: Menu '{item.menu_name}' tidak memiliki pasangan flavor, tapi preference diberikan: '{item.preference}'")
                    return JSONResponse(
                        status_code=200,
                        content={
                            "status": "error",
                            "message": f"Menu '{item.menu_name}' tidak dapat diberikan pilihan rasa pada pesanan reguler. Silakan gunakan /custom_order jika ingin menambahkan rasa khusus.",
                            "data": {
                                "menu_item": item.menu_name,
                                "invalid_preference": item.preference,
                                "reason": "Menu tidak memiliki varian rasa standar"
                            }
                        }
                    )
                
                # Jika menu memiliki pasangan flavor, validasi apakah preference valid
                # Menggunakan field dwi bahasa baru untuk flavor
                available_flavor_names = []
                if available_flavors:
                    for f in available_flavors:
                        # Tambahkan nama bahasa Inggris dan Indonesia
                        if f.get('flavor_name_en'):
                            available_flavor_names.append(f.get('flavor_name_en'))
                        if f.get('flavor_name_id'):
                            available_flavor_names.append(f.get('flavor_name_id'))
                        # Fallback untuk compatibility dengan nama lama
                        if f.get('flavor_name'):
                            available_flavor_names.append(f.get('flavor_name'))
                # Remove duplicates
                available_flavor_names = list(set(available_flavor_names))
                logging.info(f"🔍 DEBUG: Available flavors for {item.menu_name}: {available_flavor_names}")
                
                # Validasi apakah preference yang diberikan valid
                if item.preference not in available_flavor_names:
                    logging.info(f"🚫 DEBUG: Invalid flavor '{item.preference}' for {item.menu_name}. Valid flavors: {available_flavor_names}")
                    # Format untuk menampilkan flavor dwi bahasa
                    flavor_names = []
                    for i, flavor in enumerate(available_flavors):
                        flavor_display = ""
                        if flavor.get('flavor_name_en') and flavor.get('flavor_name_id'):
                            flavor_display = f"{flavor['flavor_name_en']} / {flavor['flavor_name_id']}"
                        elif flavor.get('flavor_name_en'):
                            flavor_display = flavor['flavor_name_en']
                        elif flavor.get('flavor_name_id'):
                            flavor_display = flavor['flavor_name_id']
                        elif flavor.get('flavor_name'):
                            flavor_display = flavor['flavor_name']
                        
                        if flavor_display:
                            flavor_names.append(f"{i+1}. {flavor_display}")
                    
                    flavor_list_str = "\n".join(flavor_names)
                    message = (
                        f"Rasa '{item.preference}' tidak tersedia untuk {item.menu_name}. Varian yang tersedia:\n\n"
                        f"{flavor_list_str}\n\n"
                        "Silakan pilih salah satu rasa yang tersedia, atau gunakan /custom_order untuk rasa khusus."
                    )
                    
                    return JSONResponse(
                        status_code=200,
                        content={
                            "status": "error",
                            "message": message,
                            "data": {
                                "menu_item": item.menu_name,
                                "invalid_flavor": item.preference,
                                "available_flavors": available_flavor_names
                            }
                        }
                    )
                else:
                    logging.info(f"✅ DEBUG: Valid flavor '{item.preference}' for {item.menu_name}")
                    
            except requests.RequestException as e:
                logging.error(f"Gagal menghubungi menu_service untuk validasi flavor: {e}")
                return JSONResponse(status_code=200, content={"status": "error", "message": "Tidak dapat memvalidasi pilihan rasa saat ini.", "data": None})
        
        # Menu yang wajib memiliki flavor tapi tidak ada preference
        elif item.menu_name in flavor_required_menus and not item.preference:
            try:
                flavor_url = f"{MENU_SERVICE_URL}/menu/by_name/{item.menu_name}/flavors"
                flavor_response = requests.get(flavor_url, timeout=3)
                
                if flavor_response.status_code == 200:
                    available_flavors = flavor_response.json()
                    if available_flavors:
                        # Format untuk menampilkan flavor dwi bahasa
                        flavor_names = []
                        available_flavor_names = []
                        for i, flavor in enumerate(available_flavors):
                            flavor_display = ""
                            if flavor.get('flavor_name_en') and flavor.get('flavor_name_id'):
                                flavor_display = f"{flavor['flavor_name_en']} / {flavor['flavor_name_id']}"
                            elif flavor.get('flavor_name_en'):
                                flavor_display = flavor['flavor_name_en']
                            elif flavor.get('flavor_name_id'):
                                flavor_display = flavor['flavor_name_id']
                            elif flavor.get('flavor_name'):
                                flavor_display = flavor['flavor_name']
                            
                            if flavor_display:
                                flavor_names.append(f"{i+1}. {flavor_display}")
                                
                            # Build available names list for validation
                            if flavor.get('flavor_name_en'):
                                available_flavor_names.append(flavor.get('flavor_name_en'))
                            if flavor.get('flavor_name_id'):
                                available_flavor_names.append(flavor.get('flavor_name_id'))
                            if flavor.get('flavor_name'):
                                available_flavor_names.append(flavor.get('flavor_name'))
                        
                        available_flavor_names = list(set(available_flavor_names))
                        flavor_list_str = "\n".join(flavor_names)
                        message = (
                            f"Anda memesan {item.menu_name}, pilihan rasa wajib diisi. Varian yang tersedia:\n\n"
                            f"{flavor_list_str}\n\n"
                            "Silakan pilih satu rasa dan masukkan ke field 'preference', lalu kirim ulang pesanan Anda."
                        )
                        
                        return JSONResponse(
                            status_code=200,
                            content={
                                "status": "error",
                                "message": "Pilihan rasa diperlukan untuk menu ini.",
                                "data": {
                                    "guidance": message,
                                    "menu_item": item.menu_name,
                                    "available_flavors": available_flavor_names,
                                    "order_id_suggestion": temp_order_id 
                                }
                            }
                        )
                        
            except requests.RequestException as e:
                logging.error(f"Gagal menghubungi menu_service untuk validasi flavor: {e}")
                return JSONResponse(status_code=200, content={"status": "error", "message": "Tidak dapat memvalidasi pilihan rasa saat ini.", "data": None})

    try:
        status_response = requests.get("http://kitchen_service:8003/kitchen/status/now", timeout=5)
        status_response.raise_for_status()
        kitchen_status = status_response.json()
        if not kitchen_status.get("is_open", False):
            return JSONResponse(status_code=200, content={"status": "error", "message": "Dapur sedang OFF. Tidak dapat menerima pesanan.", "data": None})
    except Exception as e:
        logging.warning(f"⚠️ Gagal mengakses kitchen_service untuk cek status: {e}")
        return JSONResponse(status_code=200, content={"status": "error", "message": "Gagal menghubungi layanan dapur. Coba lagi nanti.", "data": None})
    
    order_id = temp_order_id
    if db.query(Order).filter(Order.order_id == order_id).first():
        return JSONResponse(status_code=200, content={"status": "error", "message": f"Pesanan dengan ID {order_id} sudah dalam proses.", "data": None})
    
    try:
        # Cek stok per item untuk partial cancellation
        can_fulfill_all, available_items, unavailable_items = check_stock_per_item(req.orders, temp_order_id)
        
        if not available_items:
            # Jika tidak ada item yang bisa dipenuhi sama sekali
            shortage_msgs = []
            for i, unavail_item in enumerate(unavailable_items[:5], 1):
                item = unavail_item["item"]
                reason = unavail_item["reason"]
                shortage_msgs.append(f"{i}. {item.menu_name} x{item.quantity} - {reason}")
            
            msg = "Semua menu yang dipesan tidak tersedia:\n" + "\n".join(shortage_msgs)
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": msg,
                "data": {"available_items": [], "unavailable_items": unavailable_items}
            })
        
        # Jika ada item yang tidak tersedia, buat partial order
        if unavailable_items:
            unavailable_names = [unavail_item["item"].menu_name for unavail_item in unavailable_items]
            shortage_msgs = []
            for i, unavail_item in enumerate(unavailable_items, 1):
                item = unavail_item["item"]
                reason = unavail_item["reason"]
                shortage_msgs.append(f"{i}. {item.menu_name} x{item.quantity} - {reason}")
            
            logging.info(f"⚠️ Partial order untuk {temp_order_id}: {len(available_items)} tersedia, {len(unavailable_items)} tidak tersedia")
            
            # Lanjutkan dengan item yang tersedia saja
            order_items_to_create = available_items
            partial_warning = f"\n\n⚠️ PERHATIAN: Menu berikut tidak tersedia dan akan otomatis dibatalkan:\n" + "\n".join(shortage_msgs)
        else:
            # Semua item tersedia
            order_items_to_create = req.orders
            partial_warning = ""
            
    except Exception as e:
        logging.error(f"Gagal cek stok per item: {e}")
        return JSONResponse(status_code=200, content={
            "status": "error",
            "message": "Tidak dapat memvalidasi stok saat ini.",
            "data": None
        })
        
    try:
        new_queue_number = get_next_queue_number(db)
        new_order = Order(
            order_id=order_id,
            queue_number=new_queue_number,
            customer_name=req.customer_name,
            room_name=req.room_name,
            is_custom=False
        )
        db.add(new_order)
        
        # Tambahkan semua items (termasuk yang akan dibatalkan)
        for item in req.orders:
            db.add(OrderItem(order_id=order_id, **item.model_dump()))
        
        # Jika ada partial cancellation, batalkan item yang tidak tersedia
        if unavailable_items:
            for unavail_item in unavailable_items:
                item = unavail_item["item"]
                reason = unavail_item["reason"]
                
                # Update status item yang tidak tersedia menjadi cancelled
                db_item = db.query(OrderItem).filter(
                    OrderItem.order_id == order_id,
                    OrderItem.menu_name == item.menu_name
                ).first()
                
                if db_item:
                    db_item.status = "cancelled"
                    db_item.cancelled_reason = reason
                    db_item.cancelled_at = datetime.now(jakarta_tz)
        
        outbox_payload = { 
            "order_id": order_id, 
            "queue_number": new_queue_number, 
            "orders": [item.model_dump() for item in order_items_to_create], 
            "customer_name": req.customer_name, 
            "room_name": req.room_name,
            "is_partial": len(unavailable_items) > 0,
            "cancelled_items": [unavail_item["item"].model_dump() for unavail_item in unavailable_items] if unavailable_items else []
        }
        create_outbox_event(db, order_id, "order_created", outbox_payload)
        db.commit()
    except Exception as e:
        db.rollback()
        logging.error(f"Database error saat create order: {e}")
        return JSONResponse(status_code=200, content={"status": "error", "message": f"Terjadi kesalahan pada database: {e}", "data": None})

    try:
        process_outbox_events(db)
    except Exception as e:
        logging.warning(f"⚠️ Gagal memproses outbox events: {e}")

    try:
        print(f"🔥 ORDER SERVICE: Mengkonsumsi stok untuk order {order_id}")
        # Hanya konsumsi stok untuk item yang tersedia
        consume_payload = {
            "order_id": order_id,
            "items": [
                {"menu_name": item.menu_name, "quantity": item.quantity, "preference": item.preference}
                for item in order_items_to_create
            ]
        }
        consume_resp = requests.post(
            f"{INVENTORY_SERVICE_URL}/stock/consume",
            json=consume_payload,
            timeout=7
        )
        consume_data = consume_resp.json()
        if not consume_data.get("success", False):
            logging.error(f"❌ Gagal konsumsi stok untuk order {order_id}: {consume_data.get('message')}")
        else:
            logging.info(f"✅ Berhasil konsumsi stok untuk order {order_id}")
    except Exception as e:
        logging.error(f"❌ Error saat konsumsi stok untuk order {order_id}: {e}")

    # Buat response message
    if unavailable_items:
        available_menu_names = [item.menu_name for item in order_items_to_create]
        unavailable_menu_names = [unavail_item["item"].menu_name for unavail_item in unavailable_items]
        
        if available_menu_names:
            available_str = ", ".join(available_menu_names)
            unavailable_str = ", ".join(unavailable_menu_names)
            success_message = f"Pesanan berhasil dibuat dengan nomor antrian {new_queue_number}.\n\n✅ Menu tersedia: {available_str}\n❌ Menu dibatalkan: {unavailable_str}{partial_warning}"
        else:
            success_message = f"Pesanan dibatalkan karena semua menu tidak tersedia.{partial_warning}"
    else:
        success_message = f"Pesanan berhasil dibuat dengan nomor antrian {new_queue_number}. Semua menu tersedia dan sedang diproses."

    order_details = {
        "queue_number": new_queue_number,
        "customer_name": req.customer_name,
        "room_name": req.room_name,
        "status": "receive",
        "created_at": new_order.created_at.isoformat(),
        "is_custom": False,
        "is_partial": len(unavailable_items) > 0,
        "total_items": len(req.orders),
        "available_items": len(order_items_to_create),
        "cancelled_items": len(unavailable_items),
        "orders": [
            {
                "menu_name": item.menu_name,
                "quantity": item.quantity,
                "preference": item.preference if item.preference else "",
                "notes": item.notes,
                "status": "active"
            } for item in order_items_to_create
        ],
        "cancelled_orders": [
            {
                "menu_name": unavail_item["item"].menu_name,
                "quantity": unavail_item["item"].quantity,
                "preference": unavail_item["item"].preference if unavail_item["item"].preference else "",
                "notes": unavail_item["item"].notes,
                "status": "cancelled",
                "cancel_reason": unavail_item["reason"]
            } for unavail_item in unavailable_items
        ] if unavailable_items else []
    }

    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": success_message,
        "data": order_details
    })

@app.post("/custom_order", summary="Buat pesanan custom (tanpa validasi menu)", tags=["Order"], operation_id="add custom order")
def create_custom_order(req: CreateOrderRequest, db: Session = Depends(get_db)):
    """Membuat pesanan custom baru dengan validasi menu tetapi flavor bebas."""

    # Validasi nama ruangan
    room_validation_error = validate_room_name(req.room_name, db)
    if room_validation_error:
        return JSONResponse(status_code=200, content={"status": "error", "message": room_validation_error, "data": None})

    validation_error = validate_order_items(req.orders)
    if validation_error:
        return JSONResponse(status_code=200, content={"status": "error", "message": validation_error, "data": None})

    flavor_required_menus = ["Caffe Latte", "Cappuccino", "Milkshake", "Squash"]
    # Menu yang memerlukan flavor (menggunakan nama dwi bahasa)  
    flavor_required_menus = [
        "Caffe Latte", "Kafe Latte",  # Bahasa Inggris dan Indonesia
        "Cappuccino", "Kapucino", 
        "Milkshake", "Milkshake",
        "Squash", "Skuas"
    ]
    temp_order_id = req.order_id if req.order_id else generate_order_id()

    for item in req.orders:
        if item.menu_name in flavor_required_menus and not item.preference:
            logging.info(f"🔍 DEBUG CUSTOM: Menu '{item.menu_name}' memerlukan flavor tapi tidak diisi")
            try:
                flavor_url = f"{MENU_SERVICE_URL}/menu/by_name/{item.menu_name}/flavors"
                flavor_response = requests.get(flavor_url, timeout=3)
                if flavor_response.status_code != 200:
                        return JSONResponse(status_code=200, content={"status": "error", "message": f"Gagal mendapatkan data rasa untuk {item.menu_name}", "data": None})
                
                available_flavors = flavor_response.json()
                if available_flavors:
                    # Format untuk menampilkan flavor dwi bahasa
                    flavor_names = []
                    for i, flavor in enumerate(available_flavors):
                        flavor_display = ""
                        if flavor.get('flavor_name_en') and flavor.get('flavor_name_id'):
                            flavor_display = f"{flavor['flavor_name_en']} / {flavor['flavor_name_id']}"
                        elif flavor.get('flavor_name_en'):
                            flavor_display = flavor['flavor_name_en']
                        elif flavor.get('flavor_name_id'):
                            flavor_display = flavor['flavor_name_id']
                        elif flavor.get('flavor_name'):
                            flavor_display = flavor['flavor_name']
                        
                        if flavor_display:
                            flavor_names.append(f"{i+1}. {flavor_display}")
                    
                    flavor_list_str = "\n".join(flavor_names)
                    message = (
                        f"Anda memesan {item.menu_name} via custom order, pilihan rasa tetap wajib diisi. Varian yang tersedia:\n\n"
                        f"{flavor_list_str}\n\n"
                        "Untuk custom order, Anda bisa menggunakan rasa apapun termasuk yang tidak ada dalam daftar di atas."
                    )
                    
                    return JSONResponse(
                        status_code=200,
                        content={
                            "status": "error",
                            "message": "Pilihan rasa diperlukan untuk menu ini.",
                            "data": {
                                "guidance": message,
                                "menu_item": item.menu_name,
                                "available_flavors": [f['flavor_name'] for f in available_flavors],
                                "order_id_suggestion": temp_order_id 
                            }
                        }
                    )
            except requests.RequestException as e:
                logging.error(f"Gagal menghubungi menu_service untuk validasi flavor: {e}")
                return JSONResponse(status_code=200, content={"status": "error", "message": "Tidak dapat memvalidasi pilihan rasa saat ini.", "data": None})
        elif item.menu_name in flavor_required_menus and item.preference:
            logging.info(f"🔍 DEBUG CUSTOM: Mulai validasi flavor '{item.preference}' untuk menu '{item.menu_name}'")
            try:
                flavor_check_url = f"{INVENTORY_SERVICE_URL}/flavors"
                logging.info(f"🔍 DEBUG CUSTOM: Calling {flavor_check_url}")
                flavor_response = requests.get(flavor_check_url, timeout=3)
                if flavor_response.status_code == 200:
                    available_flavors_data = flavor_response.json()
                    available_flavors = available_flavors_data.get("flavors", [])
                    logging.info(f"🔍 DEBUG CUSTOM: Got {len(available_flavors)} available flavors from inventory")
                    
                    # if item.preference not in available_flavors:
                    #     logging.info(f"❌ DEBUG CUSTOM: Flavor '{item.preference}' tidak ada dalam database untuk menu '{item.menu_name}'")
                    #     return JSONResponse(
                    #         status_code=200,
                    #         content={
                    #             "status": "error",
                    #             "message": f"Flavor '{item.preference}' tidak tersedia dalam database. Silakan pilih flavor yang tersedia.",
                    #             "data": {
                    #                 "available_flavors": available_flavors[:10], 
                    #                 "total_flavors": len(available_flavors),
                    #                 "invalid_flavor": item.preference,
                    #                 "menu_item": item.menu_name,
                    #                 "note": "Untuk custom order, Anda tetap harus memilih flavor yang ada dalam database."
                    #             }
                    #         }
                    #     )
                    # else:
                    #     logging.info(f"✅ DEBUG CUSTOM: Custom order dengan menu '{item.menu_name}' dan flavor valid '{item.preference}'")
                else:
                    logging.warning(f"⚠️ DEBUG CUSTOM: Gagal mengecek flavor dari inventory service, status: {flavor_response.status_code}")
                    return JSONResponse(status_code=200, content={"status": "error", "message": "Tidak dapat memvalidasi flavor saat ini.", "data": None})
                    
            except requests.RequestException as e:
                logging.error(f"Gagal menghubungi inventory_service untuk validasi flavor: {e}")
                return JSONResponse(status_code=200, content={"status": "error", "message": "Tidak dapat memvalidasi flavor saat ini.", "data": None})

    try:
        status_response = requests.get("http://kitchen_service:8003/kitchen/status/now", timeout=5)
        status_response.raise_for_status()
        kitchen_status = status_response.json()
        if not kitchen_status.get("is_open", False):
            return JSONResponse(status_code=200, content={"status": "error", "message": "Dapur sedang OFF. Tidak dapat menerima pesanan.", "data": None})
    except Exception as e:
        logging.warning(f"⚠️ Gagal mengakses kitchen_service untuk cek status: {e}")
        return JSONResponse(status_code=200, content={"status": "error", "message": "Gagal menghubungi layanan dapur. Coba lagi nanti.", "data": None})
    
    order_id = temp_order_id
    if db.query(Order).filter(Order.order_id == order_id).first():
        return JSONResponse(status_code=200, content={"status": "error", "message": f"Pesanan dengan ID {order_id} sudah dalam proses.", "data": None})
    
    
    try:
        # Cek stok per item untuk partial cancellation (sama seperti create_order)
        can_fulfill_all, available_items, unavailable_items = check_stock_per_item(req.orders, temp_order_id)
        
        if not available_items:
            # Jika tidak ada item yang bisa dipenuhi sama sekali
            shortage_msgs = []
            for i, unavail_item in enumerate(unavailable_items[:5], 1):
                item = unavail_item["item"]
                reason = unavail_item["reason"]
                shortage_msgs.append(f"{i}. {item.menu_name} x{item.quantity} - {reason}")
            
            msg = "Semua menu custom yang dipesan tidak tersedia:\n" + "\n".join(shortage_msgs)
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": msg,
                "data": {"available_items": [], "unavailable_items": unavailable_items}
            })
        
        # Jika ada item yang tidak tersedia, buat partial order
        if unavailable_items:
            unavailable_names = [unavail_item["item"].menu_name for unavail_item in unavailable_items]
            shortage_msgs = []
            for i, unavail_item in enumerate(unavailable_items, 1):
                item = unavail_item["item"]
                reason = unavail_item["reason"]
                shortage_msgs.append(f"{i}. {item.menu_name} x{item.quantity} - {reason}")
            
            logging.info(f"⚠️ Partial custom order untuk {temp_order_id}: {len(available_items)} tersedia, {len(unavailable_items)} tidak tersedia")
            
            # Lanjutkan dengan item yang tersedia saja
            order_items_to_create = available_items
            partial_warning = f"\n\n⚠️ PERHATIAN: Menu custom berikut tidak tersedia dan akan otomatis dibatalkan:\n" + "\n".join(shortage_msgs)
        else:
            # Semua item tersedia
            order_items_to_create = req.orders
            partial_warning = ""
            
    except Exception as e:
        logging.error(f"Gagal cek stok per item (custom): {e}")
        return JSONResponse(status_code=200, content={
            "status": "error",
            "message": "Tidak dapat memvalidasi stok saat ini.",
            "data": None
        })
        
    try:
        new_queue_number = get_next_queue_number(db)
        new_order = Order(
            order_id=order_id,
            queue_number=new_queue_number,
            customer_name=req.customer_name,
            room_name=req.room_name,
            is_custom=True
        )
        db.add(new_order)
        
        # Tambahkan semua items (termasuk yang akan dibatalkan)
        for item in req.orders:
            db.add(OrderItem(order_id=order_id, **item.model_dump()))
        
        # Jika ada partial cancellation, batalkan item yang tidak tersedia
        if unavailable_items:
            for unavail_item in unavailable_items:
                item = unavail_item["item"]
                reason = unavail_item["reason"]
                
                # Update status item yang tidak tersedia menjadi cancelled
                db_item = db.query(OrderItem).filter(
                    OrderItem.order_id == order_id,
                    OrderItem.menu_name == item.menu_name
                ).first()
                
                if db_item:
                    db_item.status = "cancelled"
                    db_item.cancelled_reason = reason
                    db_item.cancelled_at = datetime.now(jakarta_tz)
        
        outbox_payload = { 
            "order_id": order_id, 
            "queue_number": new_queue_number, 
            "orders": [item.model_dump() for item in order_items_to_create], 
            "customer_name": req.customer_name, 
            "room_name": req.room_name,
            "is_custom": True,
            "is_partial": len(unavailable_items) > 0,
            "cancelled_items": [unavail_item["item"].model_dump() for unavail_item in unavailable_items] if unavailable_items else []
        }
        create_outbox_event(db, order_id, "order_created", outbox_payload)
        db.commit()
    except Exception as e:
        db.rollback()
        logging.error(f"Database error saat create custom order: {e}")
        return JSONResponse(status_code=200, content={"status": "error", "message": f"Terjadi kesalahan pada database: {e}", "data": None})

    try:
        process_outbox_events(db)
    except Exception as e:
        logging.warning(f"⚠️ Gagal memproses outbox events: {e}")

    try:
        print(f"🔥 ORDER SERVICE: Mengkonsumsi stok untuk custom order {order_id}")
        # Hanya konsumsi stok untuk item yang tersedia
        consume_payload = {
            "order_id": order_id,
            "items": [
                {"menu_name": item.menu_name, "quantity": item.quantity, "preference": item.preference}
                for item in order_items_to_create
            ]
        }
        consume_resp = requests.post(
            f"{INVENTORY_SERVICE_URL}/stock/consume",
            json=consume_payload,
            timeout=7
        )
        consume_data = consume_resp.json()
        if not consume_data.get("success", False):
            logging.error(f"❌ Gagal konsumsi stok untuk custom order {order_id}: {consume_data.get('message')}")
        else:
            logging.info(f"✅ Berhasil konsumsi stok untuk custom order {order_id}")
    except Exception as e:
        logging.error(f"❌ Error saat konsumsi stok untuk custom order {order_id}: {e}")

    # Buat response message untuk custom order
    if unavailable_items:
        available_menu_names = [item.menu_name for item in order_items_to_create]
        unavailable_menu_names = [unavail_item["item"].menu_name for unavail_item in unavailable_items]
        
        if available_menu_names:
            available_str = ", ".join(available_menu_names)
            unavailable_str = ", ".join(unavailable_menu_names)
            success_message = f"Pesanan custom berhasil dibuat dengan nomor antrian {new_queue_number}.\n\n✅ Menu tersedia: {available_str}\n❌ Menu dibatalkan: {unavailable_str}{partial_warning}"
        else:
            success_message = f"Pesanan custom dibatalkan karena semua menu tidak tersedia.{partial_warning}"
    else:
        success_message = f"Pesanan custom berhasil dibuat dengan nomor antrian {new_queue_number}. Semua menu tersedia dan sedang diproses."

    order_details = {
        "queue_number": new_queue_number,
        "customer_name": req.customer_name,
        "room_name": req.room_name,
        "status": "receive",
        "created_at": new_order.created_at.isoformat(),
        "is_custom": True,
        "is_partial": len(unavailable_items) > 0,
        "total_items": len(req.orders),
        "available_items": len(order_items_to_create),
        "cancelled_items": len(unavailable_items),
        "orders": [
            {
                "menu_name": item.menu_name,
                "quantity": item.quantity,
                "preference": item.preference if item.preference else "",
                "notes": item.notes,
                "status": "active"
            } for item in order_items_to_create
        ],
        "cancelled_orders": [
            {
                "menu_name": unavail_item["item"].menu_name,
                "quantity": unavail_item["item"].quantity,
                "preference": unavail_item["item"].preference if unavail_item["item"].preference else "",
                "notes": unavail_item["item"].notes,
                "status": "cancelled",
                "cancel_reason": unavail_item["reason"]
            } for unavail_item in unavailable_items
        ] if unavailable_items else []
    }

    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": success_message,
        "data": order_details
    })

@app.post("/cancel_order", summary="Batalkan pesanan", tags=["Order"], operation_id="cancel order")
def cancel_order(req: CancelOrderRequest, db: Session = Depends(get_db)):
    """Membatalkan pesanan yang belum selesai dan mencatat alasannya."""
    order = db.query(Order).filter(Order.order_id == req.order_id).first()
    if not order:
        return JSONResponse(status_code=200, content={"status": "error", "message": f"Maaf, pesanan dengan ID: {req.order_id} tidak ditemukan.", "data": None})
    
    if order.status != "receive":
        return JSONResponse(status_code=200, content={"status": "error", "message": f"Maaf, pesanan dengan ID: {req.order_id} sudah dalam proses pembuatan dan tidak dapat dibatalkan.", "data": None})

    order_items = db.query(OrderItem).filter(OrderItem.order_id == req.order_id).all()
    
    # List nama menu untuk message
    menu_names = [item.menu_name for item in order_items]
    if len(menu_names) == 1:
        menu_list = menu_names[0]
    elif len(menu_names) == 2:
        menu_list = " dan ".join(menu_names)
    else:
        menu_list = ", ".join(menu_names[:-1]) + f", dan {menu_names[-1]}"
    
    order.status = "cancelled"
    order.cancel_reason = req.reason
    # Also mark all remaining active items as cancelled
    now_ts = datetime.now(jakarta_tz)
    for it in order_items:
        if getattr(it, 'status', 'active') != 'cancelled':
            it.status = 'cancelled'
            it.cancelled_reason = req.reason
            it.cancelled_at = now_ts
    
    cancel_payload = { "order_id": req.order_id, "reason": req.reason, "cancelled_at": datetime.now(jakarta_tz).isoformat() }
    create_outbox_event(db, req.order_id, "order_cancelled", cancel_payload)
    db.commit()
    
    try:
        rollback_response = requests.post(f"{INVENTORY_SERVICE_URL}/stock/rollback/{req.order_id}")
        if rollback_response.status_code == 200:
            rollback_data = rollback_response.json()
            logging.info(f"✅ Inventory rollback berhasil untuk order {req.order_id}: {rollback_data}")
        else:
            logging.warning(f"⚠️ Inventory rollback gagal untuk order {req.order_id}: {rollback_response.text}")
    except Exception as e:
        logging.error(f"❌ Error saat rollback inventory untuk order {req.order_id}: {e}")
    
    try:
        process_outbox_events(db)
    except Exception as e:
        logging.warning(f"⚠️ Gagal memproses cancel outbox event: {e}")

    # Best-effort sync to kitchen to reflect item-level cancellations
    try:
        requests.post(f"http://kitchen_service:8003/kitchen/sync_order_items/{req.order_id}", timeout=3)
    except Exception as e:
        logging.warning(f"⚠️ Gagal memanggil kitchen sync setelah cancel order {req.order_id}: {e}")
    
    cancelled_order_details = {
        "order_id": order.order_id,
        "queue_number": order.queue_number,
        "customer_name": order.customer_name,
        "room_name": order.room_name,
        "status": "cancelled",
        "cancel_reason": req.reason,
        "created_at": order.created_at.isoformat(),
        "cancelled_at": datetime.now(jakarta_tz).isoformat(),
        "is_custom": order.is_custom,
        "orders": [
            {
                "menu_name": item.menu_name,
                "quantity": item.quantity,
                "preference": item.preference if item.preference else "",
                "notes": item.notes
            } for item in order_items
        ]
    }
    
    return JSONResponse(status_code=200, content={
        "status": "success", 
        "message": f"Pesanan dengan menu {menu_list} telah berhasil dibatalkan.", 
        "data": cancelled_order_details
    })

@app.post("/cancel_kitchen", summary="Batalkan pesanan dari kitchen (tanpa batasan status)", tags=["Kitchen"], operation_id="cancel kitchen order")
def cancel_order_kitchen(req: CancelOrderRequest, db: Session = Depends(get_db)):
    """Membatalkan pesanan dari kitchen tanpa batasan status."""
    
    order = db.query(Order).filter(Order.order_id == req.order_id).first()
    if not order:
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Pesanan dengan ID: {req.order_id} tidak ditemukan.", 
            "data": None
        })
    
    if order.status == "cancelled":
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Pesanan dengan ID: {req.order_id} sudah dibatalkan sebelumnya.", 
            "data": None
        })
    
    if order.status == "done":
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Pesanan dengan ID: {req.order_id} sudah selesai dan tidak dapat dibatalkan.", 
            "data": None
        })

    previous_status = order.status
    
    order_items = db.query(OrderItem).filter(OrderItem.order_id == req.order_id).all()
    
    menu_names = [item.menu_name for item in order_items]
    if len(menu_names) == 1:
        menu_list = menu_names[0]
    elif len(menu_names) == 2:
        menu_list = " dan ".join(menu_names)
    else:
        menu_list = ", ".join(menu_names[:-1]) + f", dan {menu_names[-1]}"
    
    order.status = "cancelled"
    # Store clean reason without artificial prefix
    order.cancel_reason = req.reason
    # Also mark all remaining active items as cancelled
    now_ts = datetime.now(jakarta_tz)
    for it in order_items:
        if getattr(it, 'status', 'active') != 'cancelled':
            it.status = 'cancelled'
            it.cancelled_reason = req.reason
            it.cancelled_at = now_ts
    
    cancel_payload = { 
        "order_id": req.order_id, 
        "reason": req.reason, 
        "previous_status": previous_status,
        "cancelled_by": "kitchen",
        "cancelled_at": datetime.now(jakarta_tz).isoformat() 
    }
    create_outbox_event(db, req.order_id, "order_cancelled", cancel_payload)
    db.commit()
    
    try:
        rollback_response = requests.post(f"{INVENTORY_SERVICE_URL}/stock/rollback/{req.order_id}")
        if rollback_response.status_code == 200:
            rollback_data = rollback_response.json()
            logging.info(f"✅ Kitchen cancel - Inventory rollback berhasil untuk order {req.order_id}: {rollback_data}")
        else:
            logging.warning(f"⚠️ Kitchen cancel - Inventory rollback gagal untuk order {req.order_id}: {rollback_response.text}")
    except Exception as e:
        logging.error(f"❌ Kitchen cancel - Error saat rollback inventory untuk order {req.order_id}: {e}")
    
    try:
        process_outbox_events(db)
    except Exception as e:
        logging.warning(f"⚠️ Kitchen cancel - Gagal memproses cancel outbox event: {e}")

    # Best-effort sync to kitchen to reflect item-level cancellations
    try:
        requests.post(f"http://kitchen_service:8003/kitchen/sync_order_items/{req.order_id}", timeout=3)
    except Exception as e:
        logging.warning(f"⚠️ Kitchen cancel - Gagal memanggil kitchen sync setelah cancel order {req.order_id}: {e}")
    
    cancelled_order_details = {
        "order_id": order.order_id,
        "queue_number": order.queue_number,
        "customer_name": order.customer_name,
        "room_name": order.room_name,
        "status": "cancelled",
        "previous_status": previous_status,
        "cancel_reason": req.reason,
        "cancelled_by": "kitchen",
        "created_at": order.created_at.isoformat(),
        "cancelled_at": datetime.now(jakarta_tz).isoformat(),
        "is_custom": order.is_custom,
        "orders": [
            {
                "menu_name": item.menu_name,
                "quantity": item.quantity,
                "preference": item.preference if item.preference else "",
                "notes": item.notes
            } for item in order_items
        ]
    }
    
    logging.info(f"🍳 Kitchen membatalkan pesanan {req.order_id} (status sebelumnya: {previous_status}) - Reason: {req.reason}")
    
    return JSONResponse(status_code=200, content={
        "status": "success", 
        "message": f"Pesanan dengan menu {menu_list} telah berhasil dibatalkan oleh kitchen (status sebelumnya: {previous_status}).", 
        "data": cancelled_order_details
    })

@app.post("/cancel_order_item", summary="Batalkan item tertentu dalam pesanan", tags=["Order"], operation_id="cancel order item")
async def cancel_order_item_endpoint(request: Request, db: Session = Depends(get_db)):
    """Membatalkan item tertentu dalam pesanan, bukan seluruh pesanan."""
    
    # Parse request body manually to handle potential JSON parsing issues
    try:
        body = await request.body()
        if isinstance(body, bytes):
            body_str = body.decode('utf-8')
        else:
            body_str = str(body)
        
        import json
        request_data = json.loads(body_str)
        
        # Manual validation
        if not request_data.get('order_id'):
            return JSONResponse(status_code=200, content={
                "status": "error", 
                "message": "order_id is required", 
                "data": None
            })
        
        if not request_data.get('reason'):
            return JSONResponse(status_code=200, content={
                "status": "error", 
                "message": "reason is required", 
                "data": None
            })
        
        item_id = request_data.get('item_id')
        menu_name = request_data.get('menu_name')
        
        if not item_id and not menu_name:
            return JSONResponse(status_code=200, content={
                "status": "error", 
                "message": "Either item_id or menu_name must be provided", 
                "data": None
            })
        
        if item_id and menu_name:
            return JSONResponse(status_code=200, content={
                "status": "error", 
                "message": "Provide either item_id or menu_name, not both", 
                "data": None
            })
        
        # Create request object manually
        req = type('obj', (object,), {
            'order_id': request_data['order_id'],
            'item_id': item_id,
            'menu_name': menu_name,
            'reason': request_data['reason']
        })()
        
    except json.JSONDecodeError as e:
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Invalid JSON format: {str(e)}", 
            "data": None
        })
    except Exception as e:
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Error parsing request: {str(e)}", 
            "data": None
        })
    
    # Cek apakah order exists
    order = db.query(Order).filter(Order.order_id == req.order_id).first()
    if not order:
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Pesanan dengan ID: {req.order_id} tidak ditemukan.", 
            "data": None
        })
    
    # Cek apakah order sudah selesai atau dibatalkan
    if order.status in ["done", "cancelled"]:
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Pesanan dengan ID: {req.order_id} sudah {order.status} dan tidak dapat diubah.", 
            "data": None
        })
    
    # Cek apakah item exists dan masih aktif
    if req.item_id:
        # Pencarian berdasarkan item_id
        order_item = db.query(OrderItem).filter(
            OrderItem.id == req.item_id,
            OrderItem.order_id == req.order_id,
            OrderItem.status == "active"
        ).first()
        item_identifier = f"ID: {req.item_id}"
    else:
        # Pencarian berdasarkan menu_name
        order_item = db.query(OrderItem).filter(
            OrderItem.menu_name == req.menu_name,
            OrderItem.order_id == req.order_id,
            OrderItem.status == "active"
        ).first()
        item_identifier = f"menu: {req.menu_name}"
    
    if not order_item:
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Item dengan {item_identifier} tidak ditemukan atau sudah dibatalkan.", 
            "data": None
        })
    
    # Cancel the specific item
    order_item.status = "cancelled"
    order_item.cancelled_reason = req.reason
    order_item.cancelled_at = datetime.now(jakarta_tz)
    
    # Rollback inventory untuk item yang dibatalkan
    try:
        rollback_payload = {
            "order_id": req.order_id,
            "items": [
                {
                    "menu_name": order_item.menu_name,
                    "quantity": order_item.quantity,
                    "preference": order_item.preference
                }
            ]
        }
        rollback_response = requests.post(
            f"{INVENTORY_SERVICE_URL}/stock/rollback_partial",
            json=rollback_payload
        )
        if rollback_response.status_code == 200:
            rollback_data = rollback_response.json()
            logging.info(f"✅ Inventory rollback berhasil untuk item {req.item_id}: {rollback_data}")
        else:
            logging.warning(f"⚠️ Inventory rollback gagal untuk item {req.item_id}: {rollback_response.text}")
    except Exception as e:
        logging.error(f"❌ Error saat rollback inventory untuk item {req.item_id}: {e}")
    
    # Cek apakah masih ada item aktif (exclude item yang baru dibatalkan)
    remaining_items = db.query(OrderItem).filter(
        OrderItem.order_id == req.order_id,
        OrderItem.status == "active",
        OrderItem.id != order_item.id  # Exclude item yang baru dibatalkan
    ).all()
    
    # Update status order jika semua item dibatalkan
    if not remaining_items:
        order.status = "cancelled"
        order.cancel_reason = "Semua item telah dibatalkan"
    
    # Buat outbox event untuk item cancellation
    cancel_payload = {
        "order_id": req.order_id,
        "type": "item_cancelled",
        "cancelled_item": {
            "item_id": order_item.id,
            "menu_name": order_item.menu_name,
            "quantity": order_item.quantity,
            "preference": order_item.preference,
            "reason": req.reason
        },
        "remaining_items": [
            {
                "item_id": item.id,
                "menu_name": item.menu_name,
                "quantity": item.quantity,
                "preference": item.preference
            } for item in remaining_items
        ],
        "cancelled_at": datetime.now(jakarta_tz).isoformat(),
        "order_status": order.status
    }
    
    create_outbox_event(db, req.order_id, "order_item_cancelled", cancel_payload)
    db.commit()
    
    try:
        process_outbox_events(db)
    except Exception as e:
        logging.warning(f"⚠️ Gagal memproses cancel item outbox event: {e}")
    
    # Response data
    result_data = {
        "order_id": order.order_id,
        "queue_number": order.queue_number,
        "customer_name": order.customer_name,
        "room_name": order.room_name,
        "order_status": order.status,
        "cancelled_item": {
            "item_id": order_item.id,
            "menu_name": order_item.menu_name,
            "quantity": order_item.quantity,
            "preference": order_item.preference if order_item.preference else "",
            "cancel_reason": req.reason,
            "cancelled_at": order_item.cancelled_at.isoformat()
        },
        "remaining_items": [
            {
                "item_id": item.id,
                "menu_name": item.menu_name,
                "quantity": item.quantity,
                "preference": item.preference if item.preference else "",
                "notes": item.notes
            } for item in remaining_items
        ],
        "total_remaining": len(remaining_items)
    }
    
    if remaining_items:
        message = f"Item '{order_item.menu_name}' berhasil dibatalkan. Masih ada {len(remaining_items)} item tersisa dalam pesanan."
    else:
        message = f"Item '{order_item.menu_name}' berhasil dibatalkan. Seluruh pesanan telah dibatalkan karena tidak ada item yang tersisa."
    
    logging.info(f"🚫 Item {order_item.menu_name} dibatalkan dari order {req.order_id} - Reason: {req.reason}")
    
    return JSONResponse(status_code=200, content={
        "status": "success", 
        "message": message,
        "data": result_data
    })

@app.post("/internal/update_status/{order_id}", tags=["Internal"])
def update_order_status_from_kitchen(order_id: str, req: StatusUpdateRequest, db: Session = Depends(get_db)):
    """Endpoint internal untuk menerima update status dari kitchen_service."""
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        logging.error(f"Gagal menemukan order {order_id} untuk diupdate dari kitchen.")
        return {"status": "not_found"}

    order.status = req.status
    db.commit()
    logging.info(f"Status untuk order {order_id} diupdate menjadi '{req.status}' dari kitchen.")
    return {"status": "updated"}

@app.get("/order_status/{order_id}", summary="Status pesanan", tags=["Order"], operation_id="order status")
def get_order_status(order_id: str, db: Session = Depends(get_db)):
    """Mengambil status terkini dari pesanan tertentu."""
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        return JSONResponse(status_code=200, content={"status": "error", "message": "Order not found", "data": None})
    
    order_items = db.query(OrderItem).filter(OrderItem.order_id == order_id).all()

    # Separate active vs cancelled items and collect cancel timestamps
    active_items_list = []
    cancelled_items_list = []
    cancel_times = []
    for item in order_items:
        base = {
            "item_id": item.id,
            "menu_name": item.menu_name,
            "quantity": item.quantity,
            "preference": item.preference if item.preference else "",
            "notes": item.notes,
            "status": getattr(item, 'status', 'active')
        }
        if getattr(item, 'status', 'active') == 'cancelled':
            base["cancelled_reason"] = getattr(item, 'cancelled_reason', None)
            ca = getattr(item, 'cancelled_at', None)
            if ca:
                base["cancelled_at"] = ca.isoformat()
                cancel_times.append(ca)
            cancelled_items_list.append(base)
        else:
            active_items_list.append(base)

    # Derive time_cancelled for order if applicable
    time_cancelled_val = None
    if (order.status or "").lower() in ["cancelled", "habis"]:
        if cancel_times:
            time_cancelled_val = max(cancel_times).isoformat()
        else:
            # Fallback to outbox event timestamp
            try:
                evt = db.query(OrderOutbox).filter(
                    OrderOutbox.order_id == order_id,
                    OrderOutbox.event_type == "order_cancelled"
                ).order_by(OrderOutbox.created_at.desc()).first()
                if evt and evt.created_at:
                    time_cancelled_val = evt.created_at.isoformat()
            except Exception:
                time_cancelled_val = None

    order_status_details = {
        "order_id": order.order_id,
        "queue_number": order.queue_number,
        "customer_name": order.customer_name,
        "room_name": order.room_name,
        "status": order.status,
        "created_at": order.created_at.isoformat(),
        "cancel_reason": order.cancel_reason,
        "is_custom": order.is_custom,
        # items = active only for UI; also provide cancelled_orders and time_cancelled
        "orders": active_items_list,
        "cancelled_orders": cancelled_items_list,
        "time_cancelled": time_cancelled_val
    }
    
    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": "Status pesanan berhasil diambil.",
        "data": order_status_details
    })

@app.get("/order", summary="Semua pesanan", tags=["Order"], operation_id="list order")
def get_all_orders(db: Session = Depends(get_db)):
    """Mengembalikan semua data pesanan."""
    orders = db.query(Order).order_by(Order.created_at.asc()).all()
    return orders

@app.get("/order/estimate/{order_id}", summary="Perhitungan estimasi waktu order", tags=["Order"], operation_id="estimate order")
def estimate_order_time(order_id: str, db: Session = Depends(get_db)):
    """
    Estimasi untuk order ini = penjumlahan waktu semua order aktif hari ini
    dengan queue_number <= order ini:
      - making/receive: sum(quantity * making_time_minutes) + 1 menit
      - deliver: 1 menit
    """
    target = db.query(Order).filter(Order.order_id == order_id).first()
    if not target:
        return JSONResponse(status_code=200, content={"status": "error", "message": "Order not found", "data": None})

    # Ambil peta waktu pembuatan dari menu_service
    try:
        resp = requests.get(f"{MENU_SERVICE_URL}/menu", timeout=5)
        resp.raise_for_status()
        menus = resp.json() or []
        time_map = {}
        for m in menus:
            making_time = float(m.get("making_time_minutes", 0) or 0)
            # Menggunakan field dwi bahasa baru
            if m.get("base_name_en"):
                time_map[m.get("base_name_en")] = making_time
            if m.get("base_name_id"):
                time_map[m.get("base_name_id")] = making_time
            # Fallback untuk compatibility dengan nama lama
            if m.get("base_name"):
                time_map[m.get("base_name")] = making_time
            if m.get("menu_name"):
                time_map[m.get("menu_name").strip()] = making_time
    except Exception as e:
        logging.error(f"Error fetching menus for estimation: {e}")
        time_map = {}

    # Ambil semua order aktif (hari ini) sampai antrian target
    today = datetime.now(jakarta_tz).date()
    start_of_day = datetime.combine(today, datetime.min.time()).replace(tzinfo=jakarta_tz)
    end_of_day = datetime.combine(today, datetime.max.time()).replace(tzinfo=jakarta_tz)

    excluded_status = ["done", "cancelled", "habis"]
    orders_in_queue = db.query(Order).filter(
        Order.created_at >= start_of_day,
        Order.created_at <= end_of_day,
        Order.queue_number <= target.queue_number,
        ~Order.status.in_(excluded_status)
    ).order_by(Order.queue_number.asc()).all()

    order_ids = [o.order_id for o in orders_in_queue]
    items = db.query(OrderItem).filter(OrderItem.order_id.in_(order_ids)).all() if order_ids else []

    # Hitung total waktu per order
    per_order_production = {}  # order_id -> total produksi (menit)
    for it in items:
        per_order_production[it.order_id] = per_order_production.get(it.order_id, 0.0) + (
            (it.quantity or 0) * (time_map.get(it.menu_name, 0.0))
        )

    total_minutes = 0.0
    breakdown = []
    for o in orders_in_queue:
        status = (o.status or "").lower()
        if status == "deliver":
            order_minutes = 1.0
        else:
            prod = per_order_production.get(o.order_id, 0.0)
            order_minutes = prod + 1.0  # +1 menit deliver/buffer
        total_minutes += order_minutes
        if o.order_id == order_id:
            target_contrib = order_minutes

        breakdown.append({"order_id": o.order_id, "queue_number": o.queue_number, "status": status, "minutes": order_minutes})

    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "message": "Estimasi waktu berhasil dihitung.",
            "data": {
                "estimated_time_minutes": total_minutes,
                "target_order_minutes": target_contrib,
                "orders_count_in_queue": len(orders_in_queue),
                "queue_number": target.queue_number,
                "breakdown": breakdown
            }
        }
    )

@app.get("/today_orders", summary="Pesanan hari ini", tags=["Order"])
def get_today_orders(db: Session = Depends(get_db)):
    """Mengembalikan pesanan hari ini saja."""
    today_jakarta = datetime.now(jakarta_tz).date()

    start_of_day = datetime.combine(today_jakarta, datetime.min.time()).replace(tzinfo=jakarta_tz)
    end_of_day = datetime.combine(today_jakarta, datetime.max.time()).replace(tzinfo=jakarta_tz)

    today_orders = db.query(Order).filter(
        and_(
            Order.created_at >= start_of_day,
            Order.created_at <= end_of_day
        )
    ).order_by(Order.queue_number.asc()).all()

    return {
        "date": today_jakarta.isoformat(),
        "orders": today_orders,
        "total_orders": len(today_orders)
    }

@app.get("/order/status/{queue_number}", summary="Get order status by queue number", tags=["Order"])
def get_order_status(queue_number: int, db: Session = Depends(get_db)):
    """Mengambil status pesanan berdasarkan nomor antrian untuk HARI INI (Asia/Jakarta)."""
    # Batasi pencarian ke hari ini sesuai logika dashboard (queue reset per hari)
    today_jakarta = datetime.now(jakarta_tz).date()
    start_of_day = datetime.combine(today_jakarta, datetime.min.time()).replace(tzinfo=jakarta_tz)
    end_of_day = datetime.combine(today_jakarta, datetime.max.time()).replace(tzinfo=jakarta_tz)

    order = db.query(Order).filter(
        and_(
            Order.queue_number == queue_number,
            Order.created_at >= start_of_day,
            Order.created_at <= end_of_day
        )
    ).first()

    if not order:
        raise HTTPException(status_code=404, detail=f"Pesanan dengan nomor antrian {queue_number} tidak ditemukan untuk hari ini")

    # Get order items
    order_items = db.query(OrderItem).filter(OrderItem.order_id == order.order_id).all()

    # Pisahkan item aktif dan yang dibatalkan serta kumpulkan waktu batal
    active_items = []
    cancelled_items = []
    cancel_times = []
    for item in order_items:
        item_data = {
            "item_id": item.id,
            "menu_name": item.menu_name,
            "quantity": item.quantity,
            "preference": item.preference,
            "notes": item.notes,
            "status": getattr(item, 'status', 'active')
        }
        if getattr(item, 'status', 'active') == 'cancelled':
            item_data["cancelled_reason"] = getattr(item, 'cancelled_reason', None)
            ca = getattr(item, 'cancelled_at', None)
            if ca:
                item_data["cancelled_at"] = ca.isoformat()
                cancel_times.append(ca)
            cancelled_items.append(item_data)
        else:
            active_items.append(item_data)

    # Derive time_cancelled for the order
    time_cancelled_val = None
    if (order.status or "").lower() in ["cancelled", "habis"]:
        if cancel_times:
            time_cancelled_val = max(cancel_times).isoformat()
        else:
            try:
                evt = db.query(OrderOutbox).filter(
                    OrderOutbox.order_id == order.order_id,
                    OrderOutbox.event_type == "order_cancelled"
                ).order_by(OrderOutbox.created_at.desc()).first()
                if evt and evt.created_at:
                    time_cancelled_val = evt.created_at.isoformat()
            except Exception:
                time_cancelled_val = None

    return {
        "order_id": order.order_id,
        "queue_number": order.queue_number,
        "customer_name": order.customer_name,
        "room_name": order.room_name,
        "status": order.status,
        "created_at": order.created_at.isoformat(),
        "cancel_reason": order.cancel_reason,
        "is_custom": order.is_custom,
        "total_items": len(order_items),
        "active_items": len(active_items),
        "cancelled_items": len(cancelled_items),
        "items": active_items,
        "cancelled_orders": cancelled_items,
        "time_cancelled": time_cancelled_val
    }

@app.get("/health", summary="Health check", tags=["Utility"])
def health_check():
    """Cek status hidup service."""
    return {"status": "ok", "service": "order_service"}

@app.get("/rooms", summary="Daftar ruangan", tags=["Room"], operation_id="list rooms")
def get_rooms(db: Session = Depends(get_db)):
    """Mengambil daftar semua ruangan yang tersedia."""
    rooms = db.query(Room).filter(Room.is_active == True).order_by(Room.name).all()
    return {
        "status": "success",
        "message": "Daftar ruangan berhasil diambil.",
        "data": {
            "rooms": [{"id": room.id, "name": room.name} for room in rooms],
            "total": len(rooms)
        }
    }

@app.post("/rooms", summary="Tambah ruangan baru", tags=["Room"])
def add_room(room_name: str, db: Session = Depends(get_db)):
    """Menambahkan ruangan baru."""
    # Cek apakah ruangan sudah ada
    existing_room = db.query(Room).filter(Room.name == room_name).first()
    if existing_room:
        if existing_room.is_active:
            return JSONResponse(status_code=200, content={
                "status": "error", 
                "message": f"Ruangan '{room_name}' sudah ada.", 
                "data": None
            })
        else:
            # Aktifkan kembali ruangan yang sudah ada tapi nonaktif
            existing_room.is_active = True
            db.commit()
            return JSONResponse(status_code=200, content={
                "status": "success", 
                "message": f"Ruangan '{room_name}' berhasil diaktifkan kembali.", 
                "data": {"id": existing_room.id, "name": existing_room.name}
            })
    
    # Tambah ruangan baru
    new_room = Room(name=room_name)
    db.add(new_room)
    db.commit()
    db.refresh(new_room)
    
    return JSONResponse(status_code=200, content={
        "status": "success", 
        "message": f"Ruangan '{room_name}' berhasil ditambahkan.", 
        "data": {"id": new_room.id, "name": new_room.name}
    })

@app.delete("/rooms/{room_id}", summary="Nonaktifkan ruangan", tags=["Room"])
def deactivate_room(room_id: int, db: Session = Depends(get_db)):
    """Menonaktifkan ruangan (tidak menghapus dari database)."""
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": "Ruangan tidak ditemukan.", 
            "data": None
        })
    
    if not room.is_active:
        return JSONResponse(status_code=200, content={
            "status": "error", 
            "message": f"Ruangan '{room.name}' sudah nonaktif.", 
            "data": None
        })
    
    room.is_active = False
    db.commit()
    
    return JSONResponse(status_code=200, content={
        "status": "success", 
        "message": f"Ruangan '{room.name}' berhasil dinonaktifkan.", 
        "data": {"id": room.id, "name": room.name}
    })

hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ order_service sudah running di http://{local_ip}:8002")

mcp.setup_server()