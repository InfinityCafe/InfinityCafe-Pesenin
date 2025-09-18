from sqlalchemy import or_, and_, func, Boolean

from fastapi import FastAPI, HTTPException, Depends, Request, Body
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from typing import List, Optional
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
ORDER_SERVICE_URL = os.getenv("ORDER_SERVICE_URL", "http://order_service:8002")

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
    telegram_id: str = ""  # Menambahkan telegram_id untuk konsistensi
    preference: Optional[str] = ""
    notes: Optional[str] = ""

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

@app.get("/kitchen/status", summary="Cek status dapur saat ini", tags=["Kitchen"])
def get_kitchen_status_simple(db: Session = Depends(get_db)):
    status = get_kitchen_status(db)
    return {
        "status": "success",
        "data": {
            "is_open": status.is_open
        }
    }

@app.get("/kitchen/status/now", summary="Cek status dapur saat ini (format sederhana)", tags=["Kitchen"])
def get_kitchen_status_now(db: Session = Depends(get_db)):
    status = get_kitchen_status(db)
    return {
        "is_open": status.is_open
    }

@app.post("/kitchen/status", summary="Atur status dapur ON/OFF", tags=["Kitchen"])
async def set_kitchen_status(
    status_request: KitchenStatusRequest, 
    db: Session = Depends(get_db)
):

    status = get_kitchen_status(db)
    status.is_open = status_request.is_open
    db.commit()
    return {
        "status": "success",
        "message": f"Kitchen status set to {'ON' if status_request.is_open else 'OFF'}",
        "data": {"is_open": status_request.is_open}
    }

@app.post("/receive_order", summary="Terima pesanan", tags=["Kitchen"], operation_id="receive order")
async def receive_order(order: KitchenOrderRequest, db: Session = Depends(get_db)):
    status = get_kitchen_status(db)
    if not status.is_open:
        # Jika status dapur OFF, tolak pesanan baru
        raise HTTPException(status_code=400, detail="Kitchen is currently OFF. Tidak bisa menerima pesanan baru.")

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
    if status in ["cancelled", "habis"] and not reason:
        raise HTTPException(status_code=400, detail="Alasan wajib untuk status cancel, atau habis")

    # Update timestamp sesuai status
    if status == "making" and not order.time_making:
        order.time_making = timestamp
    elif status == "deliver" and not order.time_deliver:
        order.time_deliver = timestamp
    elif status == "done" and not order.time_done:
        order.time_done = timestamp

    if status in ["cancelled", "habis"]:
        if not reason:
            if status == "cancelled":
                reason = "Dibatalkan"
            else:
                reason = "Bahan habis"
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
                KitchenOrder.status.in_(['done', 'cancelled', 'habis']),
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
        
        # Ambil items yang masih aktif dari order_service untuk data terbaru
        items = []
        try:
            # Fetch active items from order service
            import requests
            order_response = requests.get(f"http://order_service:8002/order/status/{o.queue_number}", timeout=5)
            if order_response.status_code == 200:
                order_data = order_response.json()
                # Hanya ambil active items, exclude cancelled
                items = order_data.get('items', [])  # 'items' contains only active items
                print(f"Successfully fetched active items from order service: {items}")
            else:
                print(f"Failed to fetch order data from order service: {order_response.status_code}")
                raise Exception("Order service unavailable")
        except Exception as e:
            print(f"Error fetching from order service, using fallback: {e}")
            # Fallback ke data lokal jika order service tidak tersedia
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
                        qty = 1  # Default quantity
                        
                        # Pattern 1: "2x Menu Name (variant)"
                        variantMatch = re.match(r'^(\d+)x ([^(]+) \(([^)]+)\)$', main)
                        if variantMatch:
                            qty = int(variantMatch.group(1))
                            name = variantMatch.group(2).strip()
                            variant = variantMatch.group(3).strip()
                        else:
                            # Pattern 2: "2x Menu Name" (no variant)
                            noVarMatch = re.match(r'^(\d+)x ([^(]+)$', main)
                            if noVarMatch:
                                qty = int(noVarMatch.group(1))
                                name = noVarMatch.group(2).strip()
                            else:
                                # Pattern 3: "Menu Name (variant)" (no quantity, default to 1)
                                simpleVariantMatch = re.match(r'^([^(]+) \(([^)]+)\)$', main)
                                if simpleVariantMatch:
                                    name = simpleVariantMatch.group(1).strip()
                                    variant = simpleVariantMatch.group(2).strip()
                                else:
                                    # Pattern 4: Just "Menu Name" (no quantity, no variant)
                                    name = main.strip()
                        
                        # Clean up empty variant
                        if variant == '':
                            variant = None
                        
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

# --- Sync endpoint: reconcile kitchen_orders with order_service ---
@app.post("/kitchen/sync_order_items/{order_id}", summary="Sync kitchen order with order_service", tags=["Kitchen"])
async def sync_order_items(order_id: str, db: Session = Depends(get_db)):
    """Fetch current items and status from order_service by queue_number and update kitchen_orders.
    This keeps kitchen detail/items/status aligned after item or full cancellations.
    """
    order = db.query(KitchenOrder).filter(KitchenOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found in kitchen")

    # If queue_number known, prefer that to query order_service; otherwise try by order_id
    od = None
    try:
        if order.queue_number is not None:
            resp = requests.get(f"{ORDER_SERVICE_URL}/order/status/{order.queue_number}", timeout=5)
            if resp.status_code == 200:
                od = resp.json()
        if od is None:
            # Fallback to by-id status endpoint
            resp2 = requests.get(f"{ORDER_SERVICE_URL}/order_status/{order_id}", timeout=5)
            if resp2.status_code == 200:
                js = resp2.json()
                od = js.get("data") if isinstance(js, dict) else js
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to contact order_service: {e}")

    if not od:
        raise HTTPException(status_code=404, detail="Order not found in order_service")

    # Compute active items (exclude cancelled) from order_service payload
    items = od.get("items") or []
    cancelled = od.get("cancelled_orders") or []

    # Update detail string and orders_json to reflect current active items
    import json as _json
    detail_str = "\n".join([
        f"{it.get('quantity', 1)}x {it.get('menu_name','')}" +
        (f" ({it.get('preference')})" if it.get('preference') else "") +
        (f" - Notes: {it.get('notes')}" if it.get('notes') else "")
        for it in items
    ])

    order.detail = detail_str
    try:
        order.orders_json = _json.dumps(items)
    except Exception:
        order.orders_json = None

    # Sync status and cancel reason
    new_status = (od.get("status") or order.status) or "receive"
    order.status = new_status
    # Build a concise per-item cancelled reasons summary when partial cancellations exist
    reason_summary = None
    try:
        if cancelled:
            parts = []
            for ci in cancelled:
                name = (ci.get("menu_name") or ci.get("name") or ci.get("menu") or "Item").strip()
                pref = (ci.get("preference") or "").strip()
                r = (ci.get("cancel_reason") or ci.get("cancelled_reason") or ci.get("reason") or "Dibatalkan").strip()
                label = f"{name}"
                if pref:
                    label += f" ({pref})"
                parts.append(f"{label}: {r}")
            if parts:
                reason_summary = "; ".join(parts)
    except Exception:
        reason_summary = None

    if new_status in ["cancelled", "habis"]:
        # Prefer order-level reason from order_service; if missing, fall back to per-item summary
        order.cancel_reason = (od.get("cancel_reason") or reason_summary or order.cancel_reason or "Dibatalkan")
    else:
        # For partial cancels on active orders, store summary so kitchen UI can show notes
        if reason_summary:
            order.cancel_reason = reason_summary

    db.commit()

    # Broadcast updated orders to clients
    await broadcast_orders(db)

    return {
        "status": "success",
        "message": "Kitchen order synced with order_service",
        "data": {
            "order_id": order_id,
            "status": order.status,
            "active_items": len(items),
            "cancelled_items": len(cancelled)
        }
    }

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