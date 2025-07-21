from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List
import requests
import socket
import logging
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Report Service API",
    description="Service untuk laporan dan analytics Infinity Cafe",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== SCHEMAS ==========
class SuggestionIn(BaseModel):
    menu_name: str
    customer_name: Optional[str] = None

# ========== SERVICE ENDPOINTS ==========
ORDER_SERVICE_URL = "http://order_service:8002"
KITCHEN_SERVICE_URL = "http://kitchen_service:8003"
MENU_SERVICE_URL = "http://menu_service:8001"

def make_request(url: str, timeout: int = 10):
    """Helper function untuk HTTP requests dengan error handling"""
    try:
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Error calling {url}: {e}")
        raise HTTPException(status_code=503, detail=f"Service unavailable: {url}")

# ========== ENDPOINTS ==========
@app.get("/health", tags=["Utility"])
def health_check():
    return {"status": "ok", "service": "report_service"}

@app.post("/menu_suggestion", tags=["Menu Usulan"])
def submit_suggestion(suggestion: SuggestionIn):
    """Forward suggestion ke menu service"""
    try:
        response = requests.post(
            f"{MENU_SERVICE_URL}/menu_suggestion",
            json=suggestion.dict(),
            timeout=5
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Menu service unavailable: {e}")

@app.get("/report/suggested_menu", tags=["Report"])
def get_suggested_menu(
    start_date: str = Query(...),
    end_date: str = Query(...)
):
    """Ambil data usulan menu dari menu service"""
    try:
        # Validate date format
        datetime.strptime(start_date, "%Y-%m-%d")
        datetime.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid (YYYY-MM-DD)")
    
    # Get data dari menu service
    url = f"{MENU_SERVICE_URL}/menu_suggestion"
    suggestions = make_request(url)
    
    # Filter berdasarkan tanggal (karena menu service return semua data)
    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    
    filtered_suggestions = []
    menu_count = {}
    
    for suggestion in suggestions:
        suggestion_date = datetime.fromisoformat(suggestion['timestamp'].replace('Z', '+00:00'))
        if start_dt <= suggestion_date <= end_dt:
            menu_name = suggestion['menu_name']
            if menu_name not in menu_count:
                menu_count[menu_name] = {
                    "menu_name": menu_name,
                    "usulan_count": 0,
                    "last_suggested": suggestion_date
                }
            menu_count[menu_name]["usulan_count"] += 1
            if suggestion_date > menu_count[menu_name]["last_suggested"]:
                menu_count[menu_name]["last_suggested"] = suggestion_date
    
    # Convert to list and sort
    result = list(menu_count.values())
    result.sort(key=lambda x: x["usulan_count"], reverse=True)
    
    # Convert datetime to ISO string
    for item in result:
        item["last_suggested"] = item["last_suggested"].isoformat()
    
    return result

@app.get("/report", tags=["Report"])
def get_report(
    start_date: str = Query(...),
    end_date: str = Query(...),
    menu_name: Optional[str] = Query(None)
):
    """Generate laporan penjualan dengan mengambil data dari multiple services"""
    try:
        # Validate date format
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid (YYYY-MM-DD)")
    
    if start_dt > end_dt:
        raise HTTPException(status_code=400, detail="Start date tidak boleh lebih besar dari end date")
    
    # 1. Get orders dari order service
    orders_url = f"{ORDER_SERVICE_URL}/order"
    orders = make_request(orders_url)
    
    # 2. Get kitchen orders untuk status 'done'
    kitchen_url = f"{KITCHEN_SERVICE_URL}/kitchen/orders"
    kitchen_orders = make_request(kitchen_url)
    
    # 3. Get menu data untuk price
    menu_url = f"{MENU_SERVICE_URL}/menu"
    menus = make_request(menu_url)
    
    # Create menu price lookup
    menu_prices = {menu['menu_name']: menu['menu_price'] for menu in menus}
    
    # Filter completed orders dalam date range
    completed_order_ids = {
        order['order_id'] for order in kitchen_orders 
        if order['status'] == 'done'
    }
    
    # Process orders
    total_income = 0
    menu_summary = {}
    total_transactions = 0
    
    for order in orders:
        order_date = datetime.fromisoformat(order['created_at'].replace('Z', '+00:00')).date()
        
        # Filter by date range and completion status
        if (start_dt.date() <= order_date <= end_dt.date() and 
            order['order_id'] in completed_order_ids):
            
            # Filter by menu name if specified
            if menu_name:
                order_items = [item for item in order.get('items', []) 
                             if menu_name.lower() in item['menu_name'].lower()]
            else:
                order_items = order.get('items', [])
            
            if order_items:  # Only count if has relevant items
                total_transactions += 1
                
                for item in order_items:
                    menu_item_name = item['menu_name']
                    quantity = item['quantity']
                    unit_price = menu_prices.get(menu_item_name, 0)
                    item_total = quantity * unit_price
                    
                    total_income += item_total
                    
                    if menu_item_name not in menu_summary:
                        menu_summary[menu_item_name] = {
                            "menu_name": menu_item_name,
                            "quantity": 0,
                            "unit_price": unit_price,
                            "total": 0
                        }
                    
                    menu_summary[menu_item_name]["quantity"] += quantity
                    menu_summary[menu_item_name]["total"] += item_total
    
    # Sort by quantity descending
    details = sorted(menu_summary.values(), key=lambda x: x["quantity"], reverse=True)
    
    return {
        "start_date": start_date,
        "end_date": end_date,
        "total_order": total_transactions,
        "total_income": total_income,
        "details": details
    }

@app.get("/report/top_customers", tags=["Report"])
def get_top_customers(
    start_date: str = Query(...),
    end_date: str = Query(...)
):
    """Ambil top customers dari order data"""
    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid")
    
    # Get data dari services
    orders = make_request(f"{ORDER_SERVICE_URL}/order")
    kitchen_orders = make_request(f"{KITCHEN_SERVICE_URL}/kitchen/orders")
    menus = make_request(f"{MENU_SERVICE_URL}/menu")
    
    # Create lookups
    menu_prices = {menu['menu_name']: menu['menu_price'] for menu in menus}
    completed_order_ids = {order['order_id'] for order in kitchen_orders if order['status'] == 'done'}
    
    # Process customer data
    customer_stats = {}
    
    for order in orders:
        order_date = datetime.fromisoformat(order['created_at'].replace('Z', '+00:00')).date()
        
        if (start_dt.date() <= order_date <= end_dt.date() and 
            order['order_id'] in completed_order_ids):
            
            customer_name = order['customer_name']
            if not customer_name:
                continue
                
            if customer_name not in customer_stats:
                customer_stats[customer_name] = {
                    "customer_name": customer_name,
                    "total_orders": 0,
                    "total_spent": 0
                }
            
            customer_stats[customer_name]["total_orders"] += 1
            
            # Calculate spending
            for item in order.get('items', []):
                unit_price = menu_prices.get(item['menu_name'], 0)
                customer_stats[customer_name]["total_spent"] += item['quantity'] * unit_price
    
    # Sort by total spent and return top 5
    top_customers = sorted(customer_stats.values(), key=lambda x: x["total_spent"], reverse=True)[:5]
    
    return top_customers

# Log startup
hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ report_service sudah running di http://{local_ip}:8004")