# order_service.py

from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, Integer, ForeignKey, Text, DateTime, func, Index, and_
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

jakarta_tz = pytz_timezone('Asia/Jakarta')

import uuid
from fastapi_mcp import FastApiMCP
import uvicorn
from fastapi import APIRouter
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

app = FastAPI(
    title="Order Service API",
    description="Manajemen pemesanan untuk Infinity Cafe",
    version="1.0.0"
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
        include_operations=["add order","list order","cancel order","order status"]
        )
mcp.mount(mount_path="/mcp",transport="sse")

class Order(Base):
    __tablename__ = "orders"
    order_id = Column(String, primary_key=True)
    queue_number = Column(Integer, nullable=False)
    customer_name = Column(String)
    table_no = Column(String)
    room_name = Column(String)
    status = Column(String, default="receive")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(jakarta_tz))
    cancel_reason = Column(Text, nullable=True)
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
    menu_name = Column(String)
    quantity = Column(Integer)
    preference = Column(Text)
    order = relationship("Order", back_populates="items")

Base.metadata.create_all(bind=engine)

class OrderItemSchema(BaseModel):
    menu_name: str
    quantity: int
    preference: Optional[str] = ""
    class Config:
        from_attributes = True

class CreateOrderRequest(BaseModel):
    customer_name: str
    table_no: str
    room_name: str
    orders: List[OrderItemSchema]

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

@app.post("/create_order", summary="Buat pesanan baru", tags=["Order"], operation_id="add order")
def create_order(req: CreateOrderRequest, db: Session = Depends(get_db)):
    """Membuat pesanan baru dan mengirimkannya ke kitchen_service."""

    try:
        status_response = requests.get("http://kitchen_service:8003/kitchen/status/now", timeout=5)
        status_response.raise_for_status()
        kitchen_status = status_response.json()

        if not kitchen_status.get("is_open", False):
            return JSONResponse(
                status_code=400,
                content={
                    "message": "Dapur sedang OFF. Tidak dapat menerima pesanan.",
                }
            )
    except Exception as e:
        logging.warning(f"⚠️ Gagal mengakses kitchen_service untuk cek status: {e}")
        raise HTTPException(status_code=503, detail="Gagal menghubungi layanan dapur. Coba lagi nanti.")

    try:
        new_queue_number = get_next_queue_number(db)
    except Exception as e:
        logging.warning(f"Error getting queue number, retrying once: {e}")
        new_queue_number = get_next_queue_number(db)

    order_id = generate_order_id()
    new_order = Order(
        order_id=order_id,
        queue_number=new_queue_number,
        customer_name=req.customer_name,
        table_no=req.table_no,
        room_name=req.room_name
    )

    try:
        db.add(new_order)
        for item in req.orders:
            db.add(OrderItem(order_id=order_id, **item.model_dump()))
        db.commit()
    except Exception as e:
        db.rollback()
        if "ix_order_queue_per_day" in str(e) or "unique constraint" in str(e).lower():
            logging.warning(f"Queue number conflict, retrying with next available number")
            new_queue_number_retry = get_next_queue_number(db)
            new_order.queue_number = new_queue_number_retry
            db.add(new_order)
            for item in req.orders:
                db.add(OrderItem(order_id=order_id, **item.model_dump()))
            db.commit()
            new_queue_number = new_queue_number_retry
        else:
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    try:
        response = requests.post(
            "http://kitchen_service:8003/receive_order",
            json={
                "order_id": order_id,
                "queue_number": new_queue_number,
                "orders": [item.model_dump() for item in req.orders],
                "customer_name": req.customer_name,
                "table_no": req.table_no,
                "room_name": req.room_name
            },
            timeout=5
        )
        response.raise_for_status()
    except Exception as e:
        logging.warning(f"⚠️ Order dibuat tapi gagal diteruskan ke kitchen: {e}")

    return {
        "message": f"Pesanan kamu telah berhasil diproses dengan id order : {order_id}, mohon ditunggu ya !",
        "order_id": order_id,
        "queue_number": new_queue_number
    }

@app.post("/cancel_order", summary="Batalkan pesanan", tags=["Order"], operation_id="cancel order")
def cancel_order(req: CancelOrderRequest, db: Session = Depends(get_db)):
    """Membatalkan pesanan yang belum selesai dan mencatat alasannya."""
    order = db.query(Order).filter(Order.order_id == req.order_id).first()
    if not order:
        raise HTTPException(
            status_code=404, 
            detail=f"Maaf, pesanan dengan ID: {req.order_id} tidak ditemukan. Mohon periksa kembali ID pesanan Anda."
        )
    if order.status != "receive":
        raise HTTPException(
            status_code=400,
            detail=f"Maaf, pesanan dengan ID: {req.order_id} sudah dalam proses pembuatan oleh dapur dan tidak dapat dibatalkan."
        )

    # Update status dan simpan ke outbox dalam satu transaksi
    order.status = "cancelled"
    order.cancel_reason = req.reason
    
    # Buat outbox event untuk cancel
    cancel_payload = {
        "order_id": req.order_id,
        "reason": req.reason,
        "cancelled_at": datetime.now(jakarta_tz).isoformat()
    }
    
    create_outbox_event(db, req.order_id, "order_cancelled", cancel_payload)
    db.commit()
    
    # Proses outbox event
    try:
        process_outbox_events(db)
    except Exception as e:
        logging.warning(f"⚠️ Gagal memproses cancel outbox event: {e}")
    
    return {"message": f"Pesanan kamu dengan ID: {req.order_id} telah berhasil dibatalkan."}

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
        raise HTTPException(status_code=404, detail="Order not found")
    return {
        "order_id": order.order_id,
        "status": order.status,
        "queue_number": order.queue_number,
        "created_at": order.created_at
    }

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