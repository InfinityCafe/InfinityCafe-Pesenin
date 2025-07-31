from sqlalchemy import or_, and_, func, Boolean

from fastapi import FastAPI, HTTPException, Depends, Request, Body
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from typing import List
from sqlalchemy import create_engine, Column, String, Text, DateTime, Integer
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
import re

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

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Custom handler untuk menangani validasi error, termasuk JSON parsing error"""
    first_error = exc.errors()[0]
    field_location = " -> ".join(map(str, first_error['loc']))
    error_message = first_error['msg']
    
    # Handle JSON parsing errors specifically
    if "JSON" in error_message or "parsing" in error_message.lower():
        full_message = f"Format JSON tidak valid. Pastikan mengirim objek JSON yang benar, contoh: {{'is_open': true}}"
    else:
        full_message = f"Data tidak valid pada field '{field_location}': {error_message}"

    return JSONResponse(
        status_code=422,
        content={
            "status": "error",
            "message": full_message,
            "data": {"details": exc.errors()}
        },
    )

# Enable CORS for frontend polling
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"]
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
    queue_number = Column(Integer, nullable=True)  # Menambahkan nomor antrian agar bisa konsisten
    status = Column(String, default="receive")
    detail = Column(Text)
    customer_name = Column(String)
    room_name = Column(String)
    time_receive = Column(DateTime(timezone=True), nullable=True)
    time_making = Column(DateTime(timezone=True), nullable=True)
    time_deliver = Column(DateTime(timezone=True), nullable=True)
    time_done = Column(DateTime(timezone=True), nullable=True)
    cancel_reason = Column(Text, nullable=True)
    orders_json = Column(Text, nullable=True)

Base.metadata.create_all(bind=engine)

class OrderItem(BaseModel):
    menu_name: str
    quantity: int
    preference: str = ""
    notes: str = ""

class KitchenStatusRequest(BaseModel):
    is_open: bool

class KitchenOrderRequest(BaseModel):
    order_id: str
    queue_number: int  # Menambahkan ini agar bisa konsisten
    orders: List[OrderItem]
    customer_name: str
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

class KitchenStatusRequest(BaseModel):
    is_open: bool

@app.post("/kitchen/status", summary="Atur status dapur ON/OFF", tags=["Kitchen"])
def set_kitchen_status(
    request: KitchenStatusRequest,
    db: Session = Depends(get_db)
):

    status = get_kitchen_status(db)
    status.is_open = request.is_open
    db.commit()
    return {
        "status": "success",
        "message": f"Kitchen status set to {'ON' if request.is_open else 'OFF'}",
        "data": {"is_open": request.is_open}
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
        raise HTTPException(status_code=400, detail="Kitchen is currently OFF")
        
    # Cek apakah order sudah ada
    existing_order = db.query(KitchenOrder).filter(KitchenOrder.order_id == order.order_id).first()
    if existing_order:
        raise HTTPException(status_code=400, detail="Order already exists")
        
    # Format detail dengan lebih baik
    detail_str = "\n".join([
        f"{item.quantity}x {item.menu_name}" +
        (f" ({item.preference})" if item.preference else "") +
        (f" - Notes: {item.notes}" if getattr(item, 'notes', None) else "")
        for item in order.orders
    ])
    import json
    now = datetime.now(jakarta_tz)
    new_order = KitchenOrder(
        order_id=order.order_id,
        queue_number=order.queue_number,
        detail=detail_str,
        customer_name=order.customer_name,
        room_name=order.room_name,
        time_receive=now,
        orders_json=json.dumps([item.model_dump() if hasattr(item, 'model_dump') else dict(item) for item in order.orders])
    )
    db.add(new_order)
    db.commit()
    # Broadcast ke semua client yang terhubung
    await broadcast_orders(db)
    return {
        "message": "Order received by kitchen",
        "order_id": order.order_id,
        "queue_number": order.queue_number,
        "time_receive": now.isoformat()
    }

@app.post("/kitchen/update_status/{order_id}", summary="Update status pesanan", tags=["Kitchen"], operation_id="change status")
async def update_status(order_id: str, status: str, reason: str = "", db: Session = Depends(get_db)):
    timestamp = datetime.now(jakarta_tz)
    order = db.query(KitchenOrder).filter(KitchenOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Validasi status dan reason
    if status in ["cancel", "habis"] and not reason:
        raise HTTPException(status_code=400, detail="Alasan wajib untuk status cancel, atau habis")

    # Update timestamp sesuai status
    if status == "making" and not order.time_making:
        order.time_making = timestamp
    elif status == "deliver" and not order.time_deliver:
        order.time_deliver = timestamp
    elif status == "done" and not order.time_done:
        order.time_done = timestamp

    if status in ["cancel", "habis"]:
        order.cancel_reason = reason

    # Update status
    order.status = status
    db.commit()

    # Notify order_service (jika bukan dari order_service)
    try:
        requests.post(
            f"http://order_service:8002/internal/update_status/{order_id}",
            json={"status": status},
            timeout=3
        )
        logging.info(f"✅ Berhasil mengirim update status '{status}' untuk order {order_id} ke order_service.")
    except Exception as e:
        logging.error(f"❌ Gagal mengirim update status ke order_service untuk order {order_id}: {e}")
        
    # Broadcast ke semua client
    await broadcast_orders(db)
    
    return {
        "message": f"Order {order_id} updated to status '{status}'",
        "order_id": order_id,
        "status": status,
        "timestamp": timestamp.isoformat()
    }
    
    
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
        KitchenOrder.status.in_(['receive', 'making', 'deliver'])
    ).order_by(KitchenOrder.time_receive.asc()).all()
    
    result = []
    for o in orders_today:
        ts = o.time_done or o.time_deliver or o.time_making or o.time_receive or datetime.now(jakarta_tz)
        result.append({
            "id": o.order_id,
            "queue_number": o.queue_number,
            "menu": o.detail,
            "status": o.status,
            "timestamp": ts.isoformat(),
            "timestamp_receive": o.time_receive.isoformat() if o.time_receive else None,
            "customer_name": o.customer_name,
            "room_name": o.room_name,
            "cancel_reason": o.cancel_reason or ""
        })
    
    data = f"data: {json.dumps({'orders': result})}\n\n"
    for queue in list(subscribers):
        try:
            await queue.put(data)
        except Exception as e:
            logging.error(f"Error broadcasting to subscriber: {e}")

@app.get("/health", summary="Health check", tags=["Utility"], operation_id="health kitchen")
def health_check():
    return {"status": "ok", "service": "kitchen_service"}

@app.options("/kitchen/status")
async def options_kitchen_status():
    """Handle preflight OPTIONS requests for /kitchen/status"""
    return {"message": "OK"}

@app.options("/kitchen/orders")
async def options_kitchen_orders():
    """Handle preflight OPTIONS requests for /kitchen/orders"""
    return {"message": "OK"}

@app.options("/receive_order")
async def options_receive_order():
    """Handle preflight OPTIONS requests for /receive_order"""
    return {"message": "OK"}

@app.options("/kitchen/orders")
async def options_kitchen_orders():
    """Handle preflight OPTIONS requests for /kitchen/orders"""
    return {"message": "OK"}

@app.options("/receive_order")
async def options_receive_order():
    """Handle preflight OPTIONS requests for /receive_order"""
    return {"message": "OK"}

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
    orders = db.query(KitchenOrder).filter(
        or_(
            KitchenOrder.status.in_(['receive', 'making', 'deliver']),
            and_(
                KitchenOrder.status.in_(['done', 'cancel', 'habis']),
                KitchenOrder.time_receive >= start_of_day,
                KitchenOrder.time_receive < end_of_day
            )
        )
    ).order_by(KitchenOrder.time_receive.asc()).all()
    import json
    result = []
    for o in orders:
        # Debug logging
        print(f"Processing order {o.order_id}")
        print(f"orders_json: {getattr(o, 'orders_json', None)}")
        
        # Ambil items dari orders_json jika ada, fallback ke parse_items jika tidak
        items = []
        if getattr(o, 'orders_json', None):
            try:
                items = json.loads(o.orders_json)
                print(f"Successfully parsed orders_json: {items}")
            except Exception as e:
                print(f"Error parsing orders_json: {e}")
                items = []
        if not items:
            print(f"No items from orders_json, parsing detail: {o.detail}")
            def parse_items(detail_str):
                items = []
                for item in (detail_str or '').split('\n'):
                    item = item.strip()
                    if not item:
                        continue
                    main, *notesPart = item.split(' - Notes:')
                    notes = notesPart[0].strip() if notesPart else ''
                    name = main
                    variant = ''
                    qty = ''
                    variantMatch = re.match(r'^(\d+)x ([^(]+) \(([^)]+)\)$', main)
                    if variantMatch:
                        qty = int(variantMatch.group(1))
                        name = variantMatch.group(2).strip()
                        variant = variantMatch.group(3).strip()
                    else:
                        noVarMatch = re.match(r'^(\d+)x ([^(]+)$', main)
                        if noVarMatch:
                            qty = int(noVarMatch.group(1))
                            name = noVarMatch.group(2).strip()
                    items.append({
                        'menu_name': name,
                        'quantity': qty,
                        'preference': variant,
                        'notes': notes
                    })
                return items
            items = parse_items(o.detail)
        
        print(f"Final items for order {o.order_id}: {items}")
        
        order_dict = {
            'order_id': o.order_id,
            'queue_number': o.queue_number,
            'detail': o.detail,
            'items': items,
            'status': o.status,
            'time_receive': o.time_receive.isoformat() if o.time_receive else None,
            'time_done': o.time_done.isoformat() if o.time_done else None,
            'customer_name': o.customer_name,
            'room_name': o.room_name,
            'cancel_reason': o.cancel_reason or ''
        }
        print(f"Order dict for {o.order_id}: {order_dict}")
        result.append(order_dict)
    
    print(f"Final result: {result}")
    return result

# @app.get("/kitchen/orders", summary="Lihat semua pesanan", tags=["Kitchen"], operation_id="kitchen order list")
# def get_kitchen_orders(db: Session = Depends(get_db)):
#     return db.query(KitchenOrder).all()

# @app.get("/kitchen/orders", summary="Lihat semua pesanan", tags=["Kitchen"], operation_id="kitchen order list")
# def get_kitchen_orders(db: Session = Depends(get_db)):
#     now = datetime.now(jakarta_tz)
#     start_of_day = datetime(now.year, now.month, now.day, tzinfo=jakarta_tz)
#     end_of_day = start_of_day + timedelta(days=1)

#     return db.query(KitchenOrder).filter(
#         or_(
#             KitchenOrder.status.in_(['receive', 'making', 'deliver', 'pending']),
#             and_(
#                 KitchenOrder.status.in_(['done', 'cancel', 'habis']),
#                 KitchenOrder.time_receive >= start_of_day,
#                 KitchenOrder.time_receive < end_of_day
#             )
#         )
#     ).all()