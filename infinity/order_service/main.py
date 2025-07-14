# order_service.py

from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, Integer, ForeignKey, Text, DateTime, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from typing import List, Optional
import os
from dotenv import load_dotenv
import socket
import logging
import requests
from datetime import datetime
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
        # include_tags=["Order","Utility"],
        include_operations=["add order","list order","cancel order","order status"]
        )

mcp.mount(mount_path="/mcp",transport="sse")


class Order(Base):
    __tablename__ = "orders"
    order_id = Column(String, primary_key=True)
    queue_number = Column(Integer, unique=True, nullable=False)
    customer_name = Column(String)
    table_no = Column(String)
    room_name = Column(String)
    status = Column(String, default="receive")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(jakarta_tz))
    cancel_reason = Column(Text, nullable=True)
    items = relationship("OrderItem", back_populates="order", cascade="all, delete")

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

@app.post("/create_order", summary="Buat pesanan baru", tags=["Order"], operation_id="add order")
def create_order(req: CreateOrderRequest, db: Session = Depends(get_db)):
    """Membuat pesanan baru dan mengirimkannya ke kitchen_service."""

    today = datetime.now(jakarta_tz).date()

    last_order_today = db.query(Order).filter(func.date(Order.created_at) == today).order_by(Order.queue_number.desc()).first()
    if last_order_today:
        new_queue_number = last_order_today.queue_number + 1
    else:
        new_queue_number = 1

    order_id = generate_order_id()
    new_order = Order(
        order_id=order_id,
        queue_number=new_queue_number,
        customer_name=req.customer_name,
        table_no=req.table_no,
        room_name=req.room_name
    )
    db.add(new_order)
    for item in req.orders:
        db.add(OrderItem(order_id=order_id, **item.model_dump()))
    db.commit()

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

    return {"message": "Order created and forwarded to kitchen", "order_id": order_id, "queue_number": new_queue_number}

@app.post("/cancel_order", summary="Batalkan pesanan", tags=["Order"], operation_id="cancel order")
def cancel_order(req: CancelOrderRequest, db: Session = Depends(get_db)):
    """Membatalkan pesanan yang belum selesai dan mencatat alasannya."""
    order = db.query(Order).filter(Order.order_id == req.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "receive":
        raise HTTPException(
            status_code=400, 
            detail=f"Tidak bisa membatalkan pesanan. Status saat ini: '{order.status}'."
        )
    if order.status == "order done":
        raise HTTPException(status_code=400, detail="Order already completed")
    
    order.status = "cancelled"
    try:
        requests.post(
            f"http://kitchen_service:8003/kitchen/update_status/{order.order_id}?status=cancel&reason={req.reason}", 
            timeout=5
        )
    except Exception as e:
        logging.warning(f"⚠️ Gagal broadcast cancel ke dapur: {e}")
        
    order.cancel_reason = req.reason
    db.commit()
    return {"message": "Order cancelled"}

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
    return {"order_id": order.order_id, "status": order.status, "queue_number": order.queue_number}

@app.get("/order", summary="Semua pesanan", tags=["Order"], operation_id="list order")
def get_all_orders(db: Session = Depends(get_db)):
    """Mengembalikan semua data pesanan."""
    orders = db.query(Order).all()
    return orders

@app.get("/health", summary="Health check", tags=["Utility"])
def health_check():
    """Cek status hidup service."""
    return {"status": "ok", "service": "order_service"}

hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ order_service sudah running di http://{local_ip}:8002")

mcp.setup_server()