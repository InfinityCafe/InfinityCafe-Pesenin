# order_service.py

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
    allow_origins=["https://kitchen.gikstaging.com"],  # Dalam production, ganti dengan domain spesifik
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

    valid_menu_names = {
        menu.get('base_name', menu.get('menu_name')) for menu in available_menus
    }
    valid_menu_names.discard(None)

    invalid_items = [
        item.menu_name for item in order_items if item.menu_name not in valid_menu_names
    ]

    if invalid_items:
        return f"Menu berikut tidak ditemukan atau tidak tersedia: {', '.join(invalid_items)}"
    
    return None
    
# Fungsi helper untuk outbox
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
    
    # Ambil events yang belum diproses dan masih bisa di-retry
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
                response = requests.post(
                    f"http://kitchen_service:8003/kitchen/update_status/{event.order_id}",
                    params={"status": "cancel", "reason": payload.get("reason", "")},
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
    
    flavor_required_menus = ["Caffe Latte", "Cappuccino", "Milkshake", "Squash"]
    temp_order_id = req.order_id if req.order_id else generate_order_id()

    for item in req.orders:
        if item.menu_name in flavor_required_menus and not item.preference:
            try:
                flavor_url = f"{MENU_SERVICE_URL}/menu/by_name/{item.menu_name}/flavors"
                flavor_response = requests.get(flavor_url, timeout=3)
                if flavor_response.status_code != 200:
                     return JSONResponse(status_code=200, content={"status": "error", "message": f"Gagal mendapatkan data rasa untuk {item.menu_name}", "data": None})
                
                available_flavors = flavor_response.json()
                if available_flavors:
                    flavor_names = [f"{i+1}. {flavor['flavor_name']}" for i, flavor in enumerate(available_flavors)]
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
                                "available_flavors": [f['flavor_name'] for f in available_flavors],
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
    
    # Cek stok 
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
            # Bentuk pesan informatif
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

    # Konsumsi stok setelah order berhasil disimpan
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
        "order_id": order_id,
        "queue_number": new_queue_number,
        "customer_name": req.customer_name,
        "room_name": req.room_name,
        "status": "receive",
        "created_at": new_order.created_at.isoformat(),
        "is_custom": False,
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
        "message": f"Pesanan kamu telah berhasil diproses dengan id order : {order_id} dan dengan no antrian : {new_queue_number} mohon ditunggu ya !",
        "data": order_details
    })

@app.post("/custom_order", summary="Buat pesanan custom (tanpa validasi menu)", tags=["Order"], operation_id="add custom order")
def create_custom_order(req: CreateOrderRequest, db: Session = Depends(get_db)):
    """Membuat pesanan custom baru tanpa validasi ke menu_service."""

    flavor_required_menus = ["Caffe Latte", "Cappuccino", "Milkshake", "Squash"]
    temp_order_id = req.order_id if req.order_id else generate_order_id()

    for item in req.orders:
        if item.menu_name in flavor_required_menus and not item.preference:
            try:
                flavor_url = f"{MENU_SERVICE_URL}/menu/by_name/{item.menu_name}/flavors"
                flavor_response = requests.get(flavor_url, timeout=3)
                if flavor_response.status_code != 200:
                        return JSONResponse(status_code=200, content={"status": "error", "message": f"Gagal mendapatkan data rasa untuk {item.menu_name}", "data": None})
                
                available_flavors = flavor_response.json()
                if available_flavors:
                    flavor_names = [f"{i+1}. {flavor['flavor_name']}" for i, flavor in enumerate(available_flavors)]
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
                                "available_flavors": [f['flavor_name'] for f in available_flavors],
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
    
    # Pengecekan stock
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

    # Konsumsi stok setelah custom order berhasil disimpan
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
        "order_id": order_id,
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
        "message": f"Pesanan custom kamu telah berhasil diproses dengan id order : {order_id}, mohon ditunggu ya !",
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
    
    order.status = "cancelled"
    order.cancel_reason = req.reason
    
    cancel_payload = { "order_id": req.order_id, "reason": req.reason, "cancelled_at": datetime.now(jakarta_tz).isoformat() }
    create_outbox_event(db, req.order_id, "order_cancelled", cancel_payload)
    db.commit()
    
    # Rollback inventory untuk pesanan yang dibatalkan
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
        "message": f"Pesanan kamu dengan ID: {req.order_id} telah berhasil dibatalkan.", 
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