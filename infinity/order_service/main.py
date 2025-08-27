from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field
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

    return JSONResponse(
        status_code=200,
        content={
            "status": "error",
            "message": full_message,
            "data": {"details": exc.errors()}
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
        include_operations=["add order","list order","cancel order","order status"]
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
    order = relationship("Order", back_populates="items")

Base.metadata.create_all(bind=engine)

class OrderItemSchema(BaseModel):
    menu_name: str = Field(..., min_length=1, description="Nama menu tidak boleh kosong.")
    quantity: int = Field(..., gt=0, description="Jumlah pesanan harus lebih dari 0.")
    telegram_id : str = Field(..., min_length=1, description="ID Telegram tidak boleh kosong.")
    preference: Optional[str] = ""
    notes: Optional[str] = None

    class Config:
        from_attributes = True

class CreateOrderRequest(BaseModel):
    customer_name: str = Field(..., min_length=1, description="Nama pelanggan tidak boleh kosong.")
    room_name: str = Field(..., min_length=1, description="Nama ruangan tidak boleh kosong.")
    orders: List[OrderItemSchema] = Field(..., min_length=1, description="Daftar pesanan tidak boleh kosong.")

    order_id: Optional[str] = None

class CancelOrderRequest(BaseModel):
    order_id: str
    reason: str

class StatusUpdateRequest(BaseModel):
    status: str

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

    validation_error = validate_order_items(req.orders)
    if validation_error:
        return JSONResponse(status_code=200, content={"status": "error", "message": validation_error, "data": None})
    
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
        inventory_payload = {
            "order_id": temp_order_id,
            "items": [
                {"menu_name": item.menu_name, "quantity": item.quantity, "preference": item.preference}
                for item in req.orders
            ]
        }
        print(f"🔍 DEBUG ORDER SERVICE: Checking stock availability: {inventory_payload}")
        
        stock_resp = requests.post(
            f"{INVENTORY_SERVICE_URL}/stock/check_availability",
            json=inventory_payload,
            timeout=7
        )
        stock_data = stock_resp.json()
        if not stock_data.get("can_fulfill", False):
            msg = "Stok belum mencukupi."
            shortages = stock_data.get("shortages") or []
            if shortages:
                detail_parts = []
                for s in shortages[:5]:
                    detail_parts.append(f"ID {s.get('ingredient_id')} perlu {s.get('required')} (ada {s.get('available')})")
                msg += " Kekurangan: " + "; ".join(detail_parts)
            partial = stock_data.get("partial_suggestions")
            if partial:
                sug_parts = [f"{p['menu_name']} bisa {p['can_make']}/{p['requested']}" for p in partial]
                msg += " | Saran partial: " + ", ".join(sug_parts)
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": msg,
                "data": stock_data
            })
    except Exception as e:
        logging.error(f"Gagal cek stok batch: {e}")
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
        for item in req.orders:
            db.add(OrderItem(order_id=order_id, **item.model_dump()))
        
        outbox_payload = { "order_id": order_id, "queue_number": new_queue_number, "orders": [item.model_dump() for item in req.orders], "customer_name": req.customer_name, "room_name": req.room_name }
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
        consume_resp = requests.post(
            f"{INVENTORY_SERVICE_URL}/stock/consume",
            json=inventory_payload,
            timeout=7
        )
        consume_data = consume_resp.json()
        if not consume_data.get("success", False):
            logging.error(f"❌ Gagal konsumsi stok untuk order {order_id}: {consume_data.get('message')}")
        else:
            logging.info(f"✅ Berhasil konsumsi stok untuk order {order_id}")
    except Exception as e:
        logging.error(f"❌ Error saat konsumsi stok untuk order {order_id}: {e}")

    order_details = {
        "queue_number": new_queue_number,
        "customer_name": req.customer_name,
        "room_name": req.room_name,
        "status": "receive",
        "created_at": new_order.created_at.isoformat(),
        "is_custom": False,
        "total_items": len(req.orders),
        "orders": [
            {
                "menu_name": item.menu_name,
                "quantity": item.quantity,
                "preference": item.preference if item.preference else "",
                "notes": item.notes
            } for item in req.orders
        ]
    }

    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": f"Pesanan kamu telah berhasil diproses dengan no antrian : {new_queue_number} mohon ditunggu ya !",
        "data": order_details
    })

@app.post("/custom_order", summary="Buat pesanan custom (tanpa validasi menu)", tags=["Order"], operation_id="add custom order")
def create_custom_order(req: CreateOrderRequest, db: Session = Depends(get_db)):
    """Membuat pesanan custom baru dengan validasi menu tetapi flavor bebas."""

    validation_error = validate_order_items(req.orders)
    if validation_error:
        return JSONResponse(status_code=200, content={"status": "error", "message": validation_error, "data": None})

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
                    
                    if item.preference not in available_flavors:
                        logging.info(f"❌ DEBUG CUSTOM: Flavor '{item.preference}' tidak ada dalam database untuk menu '{item.menu_name}'")
                        return JSONResponse(
                            status_code=200,
                            content={
                                "status": "error",
                                "message": f"Flavor '{item.preference}' tidak tersedia dalam database. Silakan pilih flavor yang tersedia.",
                                "data": {
                                    "available_flavors": available_flavors[:10], 
                                    "total_flavors": len(available_flavors),
                                    "invalid_flavor": item.preference,
                                    "menu_item": item.menu_name,
                                    "note": "Untuk custom order, Anda tetap harus memilih flavor yang ada dalam database."
                                }
                            }
                        )
                    else:
                        logging.info(f"✅ DEBUG CUSTOM: Custom order dengan menu '{item.menu_name}' dan flavor valid '{item.preference}'")
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
        inventory_payload = {
            "order_id": temp_order_id,
            "items": [
                {"menu_name": item.menu_name, "quantity": item.quantity, "preference": item.preference}
                for item in req.orders
            ]
        }
        print(f"🔍 DEBUG ORDER SERVICE: Checking stock availability: {inventory_payload}")
        
        stock_resp = requests.post(
            f"{INVENTORY_SERVICE_URL}/stock/check_availability",
            json=inventory_payload,
            timeout=7
        )
        stock_data = stock_resp.json()
        if not stock_data.get("can_fulfill", False):
            msg = "Stok belum mencukupi."
            shortages = stock_data.get("shortages") or []
            if shortages:
                detail_parts = []
                for s in shortages[:5]:
                    detail_parts.append(f"ID {s.get('ingredient_id')} perlu {s.get('required')} (ada {s.get('available')})")
                msg += " Kekurangan: " + "; ".join(detail_parts)
            return JSONResponse(status_code=200, content={
                "status": "error",
                "message": msg,
                "data": stock_data
            })
    except Exception as e:
        logging.error(f"Gagal cek stok batch (custom): {e}")
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
        for item in req.orders:
            db.add(OrderItem(order_id=order_id, **item.model_dump()))
        
        outbox_payload = { "order_id": order_id, "queue_number": new_queue_number, "orders": [item.model_dump() for item in req.orders], "customer_name": req.customer_name, "room_name": req.room_name }
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
        print(f"🔥 ORDER SERVICE: Mengkonsumsi stok untuk custom order {order_id}")
        consume_resp = requests.post(
            f"{INVENTORY_SERVICE_URL}/stock/consume",
            json=inventory_payload,
            timeout=7
        )
        consume_data = consume_resp.json()
        if not consume_data.get("success", False):
            logging.error(f"❌ Gagal konsumsi stok untuk custom order {order_id}: {consume_data.get('message')}")
        else:
            logging.info(f"✅ Berhasil konsumsi stok untuk custom order {order_id}")
    except Exception as e:
        logging.error(f"❌ Error saat konsumsi stok untuk custom order {order_id}: {e}")

    order_details = {
        "queue_number": new_queue_number,
        "customer_name": req.customer_name,
        "room_name": req.room_name,
        "status": "receive",
        "created_at": new_order.created_at.isoformat(),
        "is_custom": True,

        "orders": [
            {
                "menu_name": item.menu_name,
                "quantity": item.quantity,
                "preference": item.preference if item.preference else "",
                "notes": item.notes
            } for item in req.orders
        ]
    }

    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": f"Pesanan custom kamu telah berhasil diproses dengan no antrian : {new_queue_number}, mohon ditunggu ya !",
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
    
    order_status_details = {
        "order_id": order.order_id,
        "queue_number": order.queue_number,
        "customer_name": order.customer_name,
        "room_name": order.room_name,
        "status": order.status,
        "created_at": order.created_at.isoformat(),
        "cancel_reason": order.cancel_reason,
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

@app.get("/health", summary="Health check", tags=["Utility"])
def health_check():
    """Cek status hidup service."""
    return {"status": "ok", "service": "order_service"}

hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ order_service sudah running di http://{local_ip}:8002")

mcp.setup_server()