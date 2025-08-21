from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List
import requests
import socket
import logging
from dotenv import load_dotenv
from pytz import timezone as pytz_timezone

# Jakarta timezone untuk consistency dengan Menu Service
jakarta_tz = pytz_timezone('Asia/Jakarta')

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
    url = f"{MENU_SERVICE_URL}/menu_suggestion/raw"
    suggestions = make_request(url)
    
    # Parse dates sebagai Jakarta timezone untuk consistency
    start_dt = jakarta_tz.localize(datetime.strptime(start_date, "%Y-%m-%d"))
    end_dt = jakarta_tz.localize(datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59))
    
    menu_count = {}
    
    for suggestion in suggestions:
        # Parse timestamp dari database (format ISO dengan timezone)
        suggestion_date = datetime.fromisoformat(suggestion['timestamp'])
        
        # Ensure suggestion_date has timezone info
        if suggestion_date.tzinfo is None:
            suggestion_date = jakarta_tz.localize(suggestion_date)
        
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
    
    # Create menu price lookup - gunakan field yang benar dari menu service
    menu_prices = {menu['base_name']: menu['base_price'] for menu in menus}
    
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

def extract_date_from_datetime(datetime_str: str) -> str:
    """Extract date part dari datetime string database
    Format: 2025-08-20 03:37:20.365929+00 -> 2025-08-20
    """
    try:
        
        return datetime_str[:10]
    except:
        return datetime_str

def is_date_in_range(date_str: str, start_date: str, end_date: str) -> bool:
    """Check apakah date_str berada dalam range start_date dan end_date
    Menggunakan string comparison langsung
    """
    try:
        # Format: YYYY-MM-DD, bisa langsung compare sebagai string
        return start_date <= date_str <= end_date
    except:
        return False

@app.get("/report/best_seller", tags=["Report"])
def get_best_seller(
    start_date: str = Query(..., description="Format: YYYY-MM-DD"),
    end_date: str = Query(..., description="Format: YYYY-MM-DD"),
    limit: int = Query(10, description="Number of best selling menus to display")
):
    """Get best seller menus based on sold quantity from multiple services"""
    # Simple validation
    if len(start_date) != 10 or len(end_date) != 10:
        raise HTTPException(status_code=400, detail="Date format must be YYYY-MM-DD")
    
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Start date cannot be greater than end date")
    
    try:
        # Get data from services
        orders = make_request(f"{ORDER_SERVICE_URL}/order")
        menus = make_request(f"{MENU_SERVICE_URL}/menu")
        
        # Create price lookup dictionary
        menu_prices = {menu['base_name']: menu['base_price'] for menu in menus}
        
        # Process menu sales data
        menu_sales = {}
        processed_orders = 0
        total_orders_in_range = 0
        
        for order in orders:
            # Extract date from created_at timestamp
            order_date = extract_date_from_datetime(order['created_at'])
            
            # Filter orders by date range
            if is_date_in_range(order_date, start_date, end_date):
                total_orders_in_range += 1
                
                # Check order status directly from order data or get from detail endpoint
                order_status = order.get('status')  # Check if status field exists in order
                
                # If no status in order, get from order_status endpoint
                if not order_status:
                    try:
                        order_detail_response = requests.get(
                            f"{ORDER_SERVICE_URL}/order_status/{order['order_id']}", 
                            timeout=10
                        )
                        if order_detail_response.status_code == 200:
                            order_detail = order_detail_response.json()
                            if order_detail.get('status') == 'success':
                                order_info = order_detail.get('data', {})
                                order_status = order_info.get('status') 
                    except Exception as e:
                        logging.error(f"Error getting order status for {order['order_id']}: {e}")
                        continue
                
                # Process only orders with 'done' status
                if order_status == 'done':
                    processed_orders += 1
                    logging.info(f"Processing completed order {order['order_id']}: date={order_date}, status={order_status}")
                    
                    # Get order items detail using order_status endpoint
                    try:
                        order_detail_response = requests.get(
                            f"{ORDER_SERVICE_URL}/order_status/{order['order_id']}", 
                            timeout=10
                        )
                        if order_detail_response.status_code == 200:
                            order_detail = order_detail_response.json()
                            if order_detail.get('status') == 'success':
                                order_items = order_detail['data'].get('orders', [])
                                
                                for item in order_items:
                                    menu_name = item['menu_name']
                                    quantity = item['quantity']
                                    unit_price = menu_prices.get(menu_name, 0)
                                    total_revenue = quantity * unit_price
                                    
                                    if menu_name not in menu_sales:
                                        menu_sales[menu_name] = {
                                            "menu_name": menu_name,
                                            "total_quantity": 0,
                                            "total_orders": 0,
                                            "total_revenue": 0,
                                            "unit_price": unit_price
                                        }
                                    
                                    menu_sales[menu_name]["total_quantity"] += quantity
                                    menu_sales[menu_name]["total_orders"] += 1
                                    menu_sales[menu_name]["total_revenue"] += total_revenue
                                    
                    except requests.exceptions.RequestException as e:
                        logging.error(f"Error getting order details for {order['order_id']}: {e}")
                        continue
                else:
                    logging.info(f"Order {order['order_id']} in date range but status is: {order_status}")
        
        # Sort by total quantity (best seller) and take according to limit
        best_sellers = sorted(menu_sales.values(), key=lambda x: x["total_quantity"], reverse=True)[:limit]
        
        logging.info(f"Date range: {start_date} to {end_date}")
        logging.info(f"Processed {processed_orders} orders, found {len(best_sellers)} best sellers")
        
        return {
            "start_date": start_date,
            "end_date": end_date,
            "total_orders_in_range": total_orders_in_range,
            "processed_orders": processed_orders,
            "best_sellers": best_sellers
        }
        
    except Exception as e:
        logging.error(f"Error in best_seller endpoint: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

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
    
    # Create lookups - gunakan field yang benar
    menu_prices = {menu['base_name']: menu['base_price'] for menu in menus}
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

@app.get("/health", summary="Health Check", tags=["Utility"])
def health_check():
    """Cek apakah service menu sedang berjalan."""
    return {"status": "ok", "service": "report_service"}


# Log startup
hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ report_service sudah running di http://{local_ip}:8004")