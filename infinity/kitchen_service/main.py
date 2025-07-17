from sqlalchemy import or_, and_, func, Boolean

from fastapi import FastAPI, HTTPException, Depends, Request, Body
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from sqlalchemy import create_engine, Column, String, Text, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from dotenv import load_dotenv
from datetime import datetime, timezone, date, timedelta
from pytz import timezone as pytz_timezone
jakarta_tz = pytz_timezone('Asia/Jakarta')

import os
import socket
import logging
import asyncio
import json
import requests
from fastapi_mcp import FastApiMCP

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL_KITCHEN")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

app = FastAPI(
    title="Kitchen Service API",
    description="Service untuk mengelola pesanan masuk ke dapur Infinity Cafe.",
    version="1.0.0"
)

# Enable CORS for frontend polling
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mcp = FastApiMCP(app, name="Server MCP Infinity", description="Server MCP Infinity Descr",
    include_operations=["durasi","receive order","kitchen order list","change status","order status", "order stream"]
)
mcp.mount(mount_path="/mcp", transport="sse")

subscribers = set()

class KitchenStatus(Base):
    __tablename__ = "kitchen_status"
    id = Column(String, primary_key=True, default="kitchen")
    is_open = Column(Boolean, default=True)

    
class KitchenOrder(Base):
    __tablename__ = "kitchen_orders"
    order_id = Column(String, primary_key=True, index=True)
    status = Column(String, default="receive")
    detail = Column(Text)
    customer_name = Column(String)
    table_no = Column(String)
    room_name = Column(String)
    time_receive = Column(DateTime(timezone=True), nullable=True)
    time_making = Column(DateTime(timezone=True), nullable=True)
    time_deliver = Column(DateTime(timezone=True), nullable=True)
    time_done = Column(DateTime(timezone=True), nullable=True)
    cancel_reason = Column(Text, nullable=True)
    pending_reason = Column(Text, nullable=True)

Base.metadata.create_all(bind=engine)

class OrderItem(BaseModel):
    menu_name: str
    quantity: int
    preference: str = ""

class KitchenOrderRequest(BaseModel):
    order_id: str
    orders: List[OrderItem]
    customer_name: str
    table_no: str
    room_name: str

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_kitchen_status(db: Session):  # 
    status = db.query(KitchenStatus).filter(KitchenStatus.id == "kitchen").first()
    if not status:
        status = KitchenStatus(id="kitchen", is_open=True)
        db.add(status)
        db.commit()
    return status

@app.post("/kitchen/status", summary="Atur status dapur ON/OFF", tags=["Kitchen"])
def set_kitchen_status(
    is_open: bool = Body(...),
    db: Session = Depends(get_db)
):
    status = get_kitchen_status(db)
    status.is_open = is_open
    db.commit()
    return {
        "message": f"Kitchen status set to {'ON' if is_open else 'OFF'}"
    }

@app.get("/kitchen/status/now", summary="Cek status dapur saat ini", tags=["Kitchen"])
def get_kitchen_status_endpoint(db: Session = Depends(get_db)):
    status = get_kitchen_status(db)
    return {
        "is_open": status.is_open
    }


@app.post("/receive_order", summary="Terima pesanan", tags=["Kitchen"], operation_id="receive order")
async def receive_order(order: KitchenOrderRequest, db: Session = Depends(get_db)):
    status = get_kitchen_status(db)
    if not status.is_open:  
        return {  
            "message": "Kitchen is currently OFF",
        }
        
    if db.query(KitchenOrder).filter(KitchenOrder.order_id == order.order_id).first():
        raise HTTPException(status_code=400, detail="Order already exists")
    detail_str = "\n".join([f"{item.quantity}x {item.menu_name} ({item.preference})" for item in order.orders])
    now = datetime.now(jakarta_tz)
    new_order = KitchenOrder(
        order_id=order.order_id,
        detail=detail_str,
        customer_name=order.customer_name,
        table_no=order.table_no,
        room_name=order.room_name,
        time_receive=now
    )
    db.add(new_order)
    db.commit()
    await broadcast_orders(db)
    return {"message": "Order received by kitchen", "time_receive": now.isoformat()}

@app.get("/kitchen/orders", summary="Lihat semua pesanan", tags=["Kitchen"], operation_id="kitchen order list")
def get_kitchen_orders(db: Session = Depends(get_db)):
    return db.query(KitchenOrder).all()

@app.post("/kitchen/update_status/{order_id}")
async def update_status(order_id: str, status: str, reason: str = "", db: Session = Depends(get_db)):
    timestamp = datetime.now(jakarta_tz)
    order = db.query(KitchenOrder).filter(KitchenOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if status in ["cancel", "habis", "pending"] and not reason:
        raise HTTPException(status_code=400, detail="Alasan wajib untuk status cancel atau habis")

    if status == "making" and not order.time_making:
        order.time_making = timestamp
    elif status == "deliver" and not order.time_deliver:
        order.time_deliver = timestamp
    elif status == "done" and not order.time_done:
        order.time_done = timestamp

    if status == "pending":
        order.pending_reason = reason
    if status in ["cancel", "habis"]:
        order.cancel_reason = reason

    order.status = status

    db.commit()

    try:
        requests.post(
            f"http://order_service:8002/internal/update_status/{order_id}",
            json={"status": status},
            timeout=3
        )
        logging.info(f"Berhasil mengirim update status '{status}' untuk order {order_id} ke order_service.")
    except Exception as e:
        logging.error(f"Gagal mengirim update status ke order_service untuk order {order_id}: {e}")
        
    await broadcast_orders(db)
    return {"message": f"Order {order_id} updated to status '{status}'", "timestamp": timestamp.isoformat()}

@app.get("/kitchen/duration/{order_id}", summary="Lihat durasi pesanan", tags=["Kitchen"], operation_id="durasi")
def get_order_durations(order_id: str, db: Session = Depends(get_db)):
    order = db.query(KitchenOrder).filter(KitchenOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    durations = {}
    if order.time_making and order.time_deliver:
        durations["making_to_deliver"] = (order.time_deliver - order.time_making).total_seconds()
    if order.time_making and order.time_done:
        durations["making_to_done"] = (order.time_done - order.time_making).total_seconds()
    return durations

@app.get("/stream/orders", summary="SSE stream pesanan hari ini", tags=["Kitchen"], operation_id="order stream")
async def stream_orders(request: Request, db: Session = Depends(get_db)):
    queue = asyncio.Queue()
    subscribers.add(queue)
    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                data = await queue.get()
                yield data
        finally:
            subscribers.remove(queue)
    return StreamingResponse(event_generator(), media_type="text/event-stream")

async def broadcast_orders(db: Session):
    today = datetime.now(jakarta_tz).date()
    orders_today = db.query(KitchenOrder).filter(
    KitchenOrder.status.in_(['receive', 'making', 'deliver', 'pending'])
).all()
    result = []
    for o in orders_today:
        ts = o.time_done or o.time_deliver or o.time_making or o.time_receive or datetime.now(jakarta_tz)
        result.append({
            "id": o.order_id,
            "menu": o.detail,
            "status": o.status,
            "timestamp": ts.isoformat(),
            "timestamp_receive": o.time_receive.isoformat() if o.time_receive else None,
            "customer_name": o.customer_name,
            "table_no": o.table_no,
            "room_name": o.room_name,
            "pending_reason": o.pending_reason or "",
            "cancel_reason": o.cancel_reason or ""
        })
    data = f"data: {json.dumps({'orders': result})}\n\n"
    for queue in list(subscribers):
        await queue.put(data)

@app.get("/health", summary="Health check", tags=["Utility"], operation_id="health kitchen")
def health_check():
    return {"status": "ok", "service": "kitchen_service"}

hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ kitchen_service sudah running di http://{local_ip}:8003 add cors")

mcp.setup_server()

@app.get("/kitchen/orders", summary="Lihat semua pesanan", tags=["Kitchen"], operation_id="kitchen order list")
def get_kitchen_orders(db: Session = Depends(get_db)):
    now = datetime.now(jakarta_tz)
    start_of_day = datetime(now.year, now.month, now.day, tzinfo=jakarta_tz)
    end_of_day = start_of_day + timedelta(days=1)

    return db.query(KitchenOrder).filter(
        or_(
            KitchenOrder.status.in_(['receive', 'making', 'deliver', 'pending']),
            and_(
                KitchenOrder.status.in_(['done', 'cancel', 'habis']),
                KitchenOrder.time_receive >= start_of_day,
                KitchenOrder.time_receive < end_of_day
            )
        )
    ).all()