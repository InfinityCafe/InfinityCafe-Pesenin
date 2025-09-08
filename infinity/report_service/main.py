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
INVENTORY_SERVICE_URL = "http://inventory_service:8006"

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

@app.get("/report/order/{order_id}/ingredients", tags=["Report"], summary="Detail konsumsi bahan per order (hanya DONE)")
def get_order_ingredients_via_report(order_id: str):
    """
    Mengambil detail konsumsi bahan untuk sebuah order melalui report service.
    - Hanya mengembalikan data untuk order dengan status 'done'.
    - Order yang dibatalkan atau belum selesai tidak akan ditampilkan (kembalikan details kosong).
    - Data diambil dari inventory service endpoint untuk konsistensi breakdown bahan.
    """
    try:
        # Cek status order dari order service
        try:
            status_resp = requests.get(f"{ORDER_SERVICE_URL}/order_status/{order_id}", timeout=10)
            status_resp.raise_for_status()
            status_json = status_resp.json()
        except requests.exceptions.RequestException as e:
            logging.error(f"Error getting order status for {order_id}: {e}")
            raise HTTPException(status_code=503, detail="Order service unavailable")

        order_status = None
        if isinstance(status_json, dict) and status_json.get("status") == "success":
            order_info = status_json.get("data", {})
            order_status = order_info.get("status")
        else:
            # Fallback kalau struktur berbeda
            order_status = (status_json or {}).get("data", {}).get("status")

        # Hanya proses jika status done
        if order_status != "done":
            return {
                "status": "success",
                "message": f"Order {order_id} tidak berstatus 'done' (status saat ini: {order_status})",
                "ingredients_breakdown": {"details": []}
            }

        # Ambil detail konsumsi bahan dari inventory service
        try:
            inv_resp = requests.get(f"{INVENTORY_SERVICE_URL}/order/{order_id}/ingredients", timeout=10)
            inv_resp.raise_for_status()
            inv_json = inv_resp.json()
        except requests.exceptions.RequestException as e:
            logging.error(f"Error calling inventory for order ingredients {order_id}: {e}")
            raise HTTPException(status_code=503, detail="Inventory service unavailable")

        # Pastikan ada struktur standar agar frontend mudah membaca
        if isinstance(inv_json, dict):
            details = (
                inv_json.get("data", {})
                      .get("ingredients_breakdown", {})
                      .get("details")
            )
            if details is None:
                details = (
                    inv_json.get("ingredients_breakdown", {})
                           .get("details")
                )
            if details is None:
                details = inv_json.get("details", [])

            return {
                "status": "success",
                "order_id": order_id,
                "ingredients_breakdown": {
                    "details": details if isinstance(details, list) else []
                }
            }

        # Fallback jika response bukan dict
        return {
            "status": "success",
            "order_id": order_id,
            "ingredients_breakdown": {"details": []}
        }

    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Unexpected error in get_order_ingredients_via_report: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

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
    
    # 2. Get menu data untuk price
    menu_url = f"{MENU_SERVICE_URL}/menu"
    menu_response = make_request(menu_url)
    
    # Handle different response structures from menu service
    if isinstance(menu_response, dict) and 'value' in menu_response:
        menus = menu_response['value']
    else:
        menus = menu_response
    
    # Debug logging
    logging.info(f"Retrieved {len(menus)} menus from menu service")
    if menus:
        logging.info(f"Sample menu structure: {menus[0]}")
    
    # Create menu price lookup - gunakan field yang benar dari menu service
    # Menu service menggunakan 'base_name_en' dan 'base_price'
    menu_prices = {}
    menu_name_mapping = {}  # Map Indonesian names to English names
    for menu in menus:
        if 'base_name_en' in menu and 'base_price' in menu:
            menu_prices[menu['base_name_en']] = menu['base_price']
            # Also map Indonesian name to English name for compatibility
            if 'base_name_id' in menu:
                menu_name_mapping[menu['base_name_id']] = menu['base_name_en']
        elif 'base_name' in menu and 'base_price' in menu:
            # Fallback untuk struktur data lama
            menu_prices[menu['base_name']] = menu['base_price']
        elif 'menu_name' in menu and 'menu_price' in menu:
            # Fallback untuk struktur data yang berbeda
            menu_prices[menu['menu_name']] = menu['menu_price']
        else:
            # Fallback untuk struktur data yang berbeda
            logging.warning(f"Menu item missing required fields: {menu}")
            continue
    
    if not menu_prices:
        logging.error("No valid menu prices found. Available fields in first menu:")
        if menus:
            logging.error(f"Available fields: {list(menus[0].keys())}")
        # Return empty report instead of error
        return {
            "start_date": start_date,
            "end_date": end_date,
            "total_order": 0,
            "total_income": 0,
            "details": []
        }
    
    # Process orders — align logic with best_seller: use order status/items from order service
    total_income = 0
    menu_summary = {}
    total_transactions = 0
    
    for order in orders:
        created_at = order.get('created_at') or order.get('time_receive')
        if not created_at:
            continue
        
        order_date = extract_date_from_datetime(str(created_at))
        # filter in range
        if not is_date_in_range(order_date, start_date, end_date):
            continue
        
        # Resolve order status
        order_status = order.get('status')
        if not order_status:
            try:
                detail_resp = requests.get(f"{ORDER_SERVICE_URL}/order_status/{order['order_id']}", timeout=10)
                if detail_resp.status_code == 200:
                    detail_json = detail_resp.json()
                    if detail_json.get('status') == 'success':
                        order_info = detail_json.get('data', {})
                        order_status = order_info.get('status')
            except Exception as e:
                logging.error(f"Error fetching order status {order.get('order_id')}: {e}")
                continue
        
        if order_status != 'done':
            continue
        
        # Fetch items reliably from order_status endpoint (same approach as best_seller)
        order_items = []
        try:
            detail_resp = requests.get(f"{ORDER_SERVICE_URL}/order_status/{order['order_id']}", timeout=10)
            if detail_resp.status_code == 200:
                detail_json = detail_resp.json()
                if detail_json.get('status') == 'success':
                    order_items = detail_json['data'].get('orders', [])
        except Exception as e:
            logging.error(f"Error fetching order items {order.get('order_id')}: {e}")
            continue
        
        # Optional filter by menu name
        if menu_name:
            order_items = [item for item in order_items if menu_name.lower() in item.get('menu_name', '').lower()]
        
        if not order_items:
            continue
        
        total_transactions += 1
        for item in order_items:
            menu_item_name = item.get('menu_name', '')
            quantity = item.get('quantity', 0)
            if not menu_item_name or not quantity:
                continue
            
            display_name = menu_name_mapping.get(menu_item_name, menu_item_name)
            unit_price = menu_prices.get(display_name, 0)
            item_total = quantity * unit_price
            total_income += item_total
            
            if display_name not in menu_summary:
                menu_summary[display_name] = {
                    "menu_name": display_name,
                    "quantity": 0,
                    "unit_price": unit_price,
                    "total": 0
                }
            menu_summary[display_name]["quantity"] += quantity
            menu_summary[display_name]["total"] += item_total
    
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
        # Simple string slicing untuk format YYYY-MM-DD
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

# Fix route: expose best_seller at /report/best_seller
@app.get("/report/best_seller", tags=["Report"])
def get_best_seller(
    start_date: str = Query(..., description="Format: YYYY-MM-DD"),
    end_date: str = Query(..., description="Format: YYYY-MM-DD")
):
    """Get best seller menus based on sold quantity from multiple services (unlimited)"""
    # Simple validation
    if len(start_date) != 10 or len(end_date) != 10:
        raise HTTPException(status_code=400, detail="Date format must be YYYY-MM-DD")
    
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Start date cannot be greater than end date")
    
    try:
        # Get data from services
        orders = make_request(f"{ORDER_SERVICE_URL}/order")
        menu_response = make_request(f"{MENU_SERVICE_URL}/menu")
        
        # Handle different response structures from menu service
        if isinstance(menu_response, dict) and 'value' in menu_response:
            menus = menu_response['value']
        else:
            menus = menu_response
        
        # Create price lookup dictionary - gunakan base_name_en untuk English name
        menu_prices = {}
        menu_name_mapping = {}  # Map Indonesian names to English names
        for menu in menus:
            if 'base_name_en' in menu and 'base_price' in menu:
                menu_prices[menu['base_name_en']] = menu['base_price']
                # Also map Indonesian name to English name for compatibility
                if 'base_name_id' in menu:
                    menu_name_mapping[menu['base_name_id']] = menu['base_name_en']
            elif 'base_name' in menu and 'base_price' in menu:
                menu_prices[menu['base_name']] = menu['base_price']
            elif 'menu_name' in menu and 'menu_price' in menu:
                # Fallback untuk struktur data lama
                menu_prices[menu['menu_name']] = menu['menu_price']
            else:
                logging.warning(f"Menu item missing required fields: {menu}")
                continue
        
        if not menu_prices:
            logging.error("No valid menu prices found in best_seller. Available fields in first menu:")
            if menus:
                logging.error(f"Available fields: {list(menus[0].keys())}")
            # Return empty report instead of error
            return {
                "start_date": start_date,
                "end_date": end_date,
                "total_orders_in_range": 0,
                "processed_orders": 0,
                "best_sellers": []
            }
        # Get flavor data dengan harga dari menu service
        try:
            flavors = make_request(f"{MENU_SERVICE_URL}/flavors")
        except:
            flavors = []  # Fallback jika endpoint flavor tidak ada
        
        # Create price lookup dictionaries
        menu_prices = {}
        menu_name_mapping = {}
        for menu in menus:
            if 'base_name_en' in menu and 'base_price' in menu:
                menu_prices[menu['base_name_en']] = menu['base_price']
                if 'base_name_id' in menu:
                    menu_name_mapping[menu['base_name_id']] = menu['base_name_en']
            elif 'base_name' in menu and 'base_price' in menu:
                menu_prices[menu['base_name']] = menu['base_price']
        
        # Create flavor lookup using both English and Indonesian names
        flavor_lookup = {}
        if flavors:
            for flavor in flavors:
                # Use English name as primary key
                if 'flavor_name_en' in flavor:
                    flavor_lookup[flavor['flavor_name_en']] = flavor
                # Also map Indonesian name to the same flavor
                if 'flavor_name_id' in flavor:
                    flavor_lookup[flavor['flavor_name_id']] = flavor
        
        # Process menu sales data
        menu_sales = {}
        processed_orders = 0
        total_orders_in_range = 0
        
        for order in orders:
            # Extract date from created_at timestamp
            created_at = order.get('created_at') or order.get('time_receive')
            if not created_at:
                continue
            
            order_date = extract_date_from_datetime(str(created_at))
            
            # Filter orders by date range
            if is_date_in_range(order_date, start_date, end_date):
                total_orders_in_range += 1
                
                # Check order status directly from order data
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
                                    preference = item.get('preference', '').strip() if item.get('preference') else ''
                                    
                                    # Map Indonesian menu name to English name if available
                                    display_name = menu_name_mapping.get(menu_name, menu_name)
                                    
                                    # Calculate base price
                                    unit_price = menu_prices.get(display_name, 0)
                                    
                                    # Calculate flavor additional cost
                                    flavor_additional_cost = 0
                                    if preference:
                                        # Try to find flavor by preference (could be Indonesian or English)
                                        flavor_info = flavor_lookup.get(preference)
                                        if flavor_info:
                                            flavor_additional_cost = flavor_info.get('additional_price', 0)
                                    
                                    # Calculate total revenue including flavor
                                    base_revenue = quantity * unit_price
                                    flavor_revenue = quantity * flavor_additional_cost
                                    total_revenue = base_revenue + flavor_revenue
                                    
                                    if display_name not in menu_sales:
                                        menu_sales[display_name] = {
                                            "menu_name": display_name,
                                            "total_quantity": 0,
                                            "total_orders": 0,
                                            "base_revenue": 0,
                                            "flavor_revenue": 0,
                                            "total_revenue": 0,
                                            "unit_price": unit_price
                                        }
                                    
                                    menu_sales[display_name]["total_quantity"] += quantity
                                    menu_sales[display_name]["total_orders"] += 1
                                    menu_sales[display_name]["base_revenue"] += base_revenue
                                    menu_sales[display_name]["flavor_revenue"] += flavor_revenue
                                    menu_sales[display_name]["total_revenue"] += total_revenue
                                    
                    except requests.exceptions.RequestException as e:
                        logging.error(f"Error getting order details for {order['order_id']}: {e}")
                        continue
                else:
                    logging.info(f"Order {order['order_id']} in date range but status is: {order_status}")
        
        # Sort by total quantity (best seller) - show all data without limit
        best_sellers = sorted(menu_sales.values(), key=lambda x: x["total_quantity"], reverse=True)
        
        # Calculate totals for summary (dari semua best sellers)
        total_base_revenue = sum(item["base_revenue"] for item in best_sellers)
        total_flavor_revenue = sum(item["flavor_revenue"] for item in best_sellers)
        total_combined_revenue = sum(item["total_revenue"] for item in best_sellers)
        
        logging.info(f"Date range: {start_date} to {end_date}")
        logging.info(f"Processed {processed_orders} orders, found {len(best_sellers)} best sellers (unlimited)")
        
        return {
            "start_date": start_date,
            "end_date": end_date,
            "total_orders_in_range": total_orders_in_range,
            "processed_orders": processed_orders,
            "unlimited_mode": True,
            "total_menus_found": len(best_sellers),
            "message": f"Menampilkan semua {len(best_sellers)} menu best seller (tanpa limit)",
            "summary": {
                "total_base_revenue": total_base_revenue,
                "total_flavor_revenue": total_flavor_revenue,
                "total_combined_revenue": total_combined_revenue
            },
            "best_sellers": best_sellers
        }
        
    except Exception as e:
        import traceback
        logging.error(f"Error in best_seller endpoint: {e}")
        logging.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/report/financial_sales", tags=["Report"], summary="Laporan Keuangan Penjualan Menu")
def get_financial_sales_report(
    start_date: Optional[str] = Query(None, description="Format: YYYY-MM-DD. Jika tidak diisi, akan menampilkan hari ini"),
    end_date: Optional[str] = Query(None, description="Format: YYYY-MM-DD. Jika tidak diisi, akan sama dengan start_date"),
    today_only: bool = Query(False, description="True untuk menampilkan transaksi hari ini saja")
):

    try:
        # Tentukan tanggal berdasarkan parameter
        jakarta_now = datetime.now(jakarta_tz)
        
        if today_only:
            # Hanya hari ini
            query_start_date = jakarta_now.date().strftime("%Y-%m-%d")
            query_end_date = query_start_date
            date_mode = "today_only"
        elif start_date:
            # Validate start_date format
            try:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d")
                query_start_date = start_date
            except ValueError:
                raise HTTPException(status_code=400, detail="Format start_date tidak valid (YYYY-MM-DD)")
            
            if end_date:
                # Validate end_date format
                try:
                    end_dt = datetime.strptime(end_date, "%Y-%m-%d")
                    query_end_date = end_date
                except ValueError:
                    raise HTTPException(status_code=400, detail="Format end_date tidak valid (YYYY-MM-DD)")
                
                if start_dt > end_dt:
                    raise HTTPException(status_code=400, detail="Start date tidak boleh lebih besar dari end date")
            else:
                query_end_date = start_date
            
            date_mode = "custom_range"
        else:
            # Default: hari ini
            query_start_date = jakarta_now.date().strftime("%Y-%m-%d")
            query_end_date = query_start_date
            date_mode = "default_today"

        logging.info(f"Financial report query: {query_start_date} to {query_end_date}")

        # Get data dari semua services yang diperlukan
        orders = make_request(f"{ORDER_SERVICE_URL}/order")
        menu_response = make_request(f"{MENU_SERVICE_URL}/menu")
        
        # Handle different response structures from menu service
        if isinstance(menu_response, dict) and 'value' in menu_response:
            menus = menu_response['value']
        else:
            menus = menu_response
        
        # Get flavor data dengan harga dari menu service
        try:
            flavors = make_request(f"{MENU_SERVICE_URL}/flavors")
        except:
            flavors = []  # Fallback jika endpoint flavor tidak ada
        
        # Create lookup dictionaries
        menu_lookup = {}
        menu_name_mapping = {}
        for menu in menus:
            if 'base_name_en' in menu:
                menu_lookup[menu['base_name_en']] = menu
                if 'base_name_id' in menu:
                    menu_name_mapping[menu['base_name_id']] = menu['base_name_en']
            elif 'base_name' in menu:
                menu_lookup[menu['base_name']] = menu
        
        # Create flavor lookup using both English and Indonesian names
        flavor_lookup = {}
        if flavors:
            for flavor in flavors:
                # Use English name as primary key
                if 'flavor_name_en' in flavor:
                    flavor_lookup[flavor['flavor_name_en']] = flavor
                # Also map Indonesian name to the same flavor
                if 'flavor_name_id' in flavor:
                    flavor_lookup[flavor['flavor_name_id']] = flavor
        
        logging.info(f"Loaded {len(orders)} orders, {len(menus)} menus, {len(flavors)} flavors")
        
        # Process sales data menggunakan pola yang sama seperti best_seller
        sales_transactions = []
        total_omzet = 0
        total_base_revenue = 0
        total_flavor_revenue = 0
        total_transactions = 0
        processed_orders = 0
        total_orders_in_range = 0
        
        for order in orders:
            # Extract date dari created_at timestamp - sama seperti best_seller
            order_date = extract_date_from_datetime(order['created_at'])
            
            # Filter orders by date range
            if is_date_in_range(order_date, query_start_date, query_end_date):
                total_orders_in_range += 1
                
                # Check order status directly from order data
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
                    
                    # Get order items detail using order_status endpoint - sama seperti best_seller
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
                                    preference = item.get('preference', '').strip() if item.get('preference') else ''
                                    notes = item.get('notes', '').strip() if item.get('notes') else ''
                                    
                                    # Map Indonesian menu name to English name if available
                                    display_name = menu_name_mapping.get(menu_name, menu_name)
                                    
                                    # Get menu data untuk base price
                                    menu_data = menu_lookup.get(display_name, {})
                                    base_price = menu_data.get('base_price', 0)
                                    
                                    # Determine flavor dan harga flavor
                                    flavor_name = preference if preference else "-"
                                    flavor_additional_cost = 0
                                    
                                    if preference:
                                        # Try to find flavor by preference (could be Indonesian or English)
                                        flavor_info = flavor_lookup.get(preference)
                                        if flavor_info:
                                            flavor_additional_cost = flavor_info.get('additional_price', 0)
                                    
                                    # Calculate total price for this item
                                    item_base_revenue = base_price * quantity
                                    item_flavor_revenue = flavor_additional_cost * quantity
                                    total_item_price = item_base_revenue + item_flavor_revenue
                                    
                                    total_omzet += total_item_price
                                    total_base_revenue += item_base_revenue
                                    total_flavor_revenue += item_flavor_revenue
                                    total_transactions += 1
                                    
                                    # Create transaction record
                                    transaction = {
                                        "order_id": order['order_id'],
                                        "order_date": order_date,
                                        "customer_name": order.get('customer_name', 'Unknown'),
                                        "menu_name": display_name,  # Use English name for display
                                        "flavor": flavor_name,
                                        "quantity": quantity,
                                        "base_price": base_price,
                                        "flavor_additional_cost": flavor_additional_cost,
                                        "base_revenue": item_base_revenue,
                                        "flavor_revenue": item_flavor_revenue,
                                        "total_price": total_item_price,
                                        "notes": notes if notes else "-",
                                        "order_status": order_status
                                    }
                                    
                                    sales_transactions.append(transaction)
                                    
                    except requests.exceptions.RequestException as e:
                        logging.error(f"Error getting order details for {order['order_id']}: {e}")
                        continue
                else:
                    logging.info(f"Order {order['order_id']} in date range but status is: {order_status}")
        
        # Sort by order_date ASC (ascending)
        sales_transactions.sort(key=lambda x: x["order_date"])
        
        # Generate summary statistics
        unique_menus = len(set(t["menu_name"] for t in sales_transactions))
        unique_customers = len(set(t["customer_name"] for t in sales_transactions))
        total_items_sold = sum(t["quantity"] for t in sales_transactions)
        transactions_with_flavor = len([t for t in sales_transactions if t["flavor"] != "-"])
        
        # Menu breakdown
        menu_breakdown = {}
        for transaction in sales_transactions:
            menu_key = transaction["menu_name"]
            if menu_key not in menu_breakdown:
                menu_breakdown[menu_key] = {
                    "menu_name": menu_key,
                    "total_quantity": 0,
                    "base_revenue": 0,
                    "flavor_revenue": 0,
                    "total_revenue": 0,
                    "transactions_count": 0,
                    "average_price_per_item": 0
                }
            menu_breakdown[menu_key]["total_quantity"] += transaction["quantity"]
            menu_breakdown[menu_key]["base_revenue"] += transaction["base_revenue"]
            menu_breakdown[menu_key]["flavor_revenue"] += transaction["flavor_revenue"]
            menu_breakdown[menu_key]["total_revenue"] += transaction["total_price"]
            menu_breakdown[menu_key]["transactions_count"] += 1
        
        # Calculate average price per item for each menu
        for menu_data in menu_breakdown.values():
            if menu_data["total_quantity"] > 0:
                menu_data["average_price_per_item"] = round(
                    menu_data["total_revenue"] / menu_data["total_quantity"], 2
                )
        
        # Sort menu breakdown by revenue (descending)
        sorted_menu_breakdown = sorted(
            menu_breakdown.values(), 
            key=lambda x: x["total_revenue"], 
            reverse=True
        )
        
        # Flavor breakdown (hanya untuk yang menggunakan flavor)
        flavor_breakdown = {}
        for transaction in sales_transactions:
            if transaction["flavor"] != "-":
                flavor_key = transaction["flavor"]
                if flavor_key not in flavor_breakdown:
                    flavor_breakdown[flavor_key] = {
                        "flavor_name": flavor_key,
                        "usage_count": 0,
                        "total_quantity": 0,
                        "total_flavor_revenue": 0,
                        "average_additional_cost": 0
                    }
                flavor_breakdown[flavor_key]["usage_count"] += 1
                flavor_breakdown[flavor_key]["total_quantity"] += transaction["quantity"]
                flavor_breakdown[flavor_key]["total_flavor_revenue"] += transaction["flavor_revenue"]
        
        # Calculate average additional cost per flavor
        for flavor_data in flavor_breakdown.values():
            if flavor_data["total_quantity"] > 0:
                flavor_data["average_additional_cost"] = round(
                    flavor_data["total_flavor_revenue"] / flavor_data["total_quantity"], 2
                )
        
        # Sort flavor breakdown by revenue
        sorted_flavor_breakdown = sorted(
            flavor_breakdown.values(),
            key=lambda x: x["total_flavor_revenue"],
            reverse=True
        )
        
        logging.info(f"Generated financial report: {total_transactions} transactions, total omzet: Rp {total_omzet:,}")
        
        return {
            "report_info": {
                "title": "Laporan Keuangan Penjualan Menu",
                "generated_at": jakarta_now.isoformat(),
                "date_range": {
                    "start_date": query_start_date,
                    "end_date": query_end_date,
                    "mode": date_mode
                }
            },
            "summary": {
                "total_transactions": total_transactions,
                "total_omzet": total_omzet,
                "total_base_revenue": total_base_revenue,
                "total_flavor_revenue": total_flavor_revenue,
                "total_items_sold": total_items_sold,
                "unique_menus_sold": unique_menus,
                "unique_customers": unique_customers,
                "transactions_with_flavor": transactions_with_flavor,
                "total_orders_in_range": total_orders_in_range,
                "processed_orders": processed_orders
            },
            "transactions": sales_transactions,
            "menu_breakdown": sorted_menu_breakdown,
            "flavor_breakdown": sorted_flavor_breakdown
        }
        
    except requests.exceptions.RequestException as e:
        logging.error(f"Error calling external service: {e}")
        raise HTTPException(status_code=503, detail=f"Service unavailable: {str(e)}")
    except Exception as e:
        logging.error(f"Error in financial_sales_report: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/report/financial_sales/summary", tags=["Report"], summary="Ringkasan Laporan Keuangan")
def get_financial_sales_summary(
    start_date: Optional[str] = Query(None, description="Format: YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="Format: YYYY-MM-DD"),
    today_only: bool = Query(False, description="True untuk hari ini saja")
):
    """
    Ringkasan singkat laporan keuangan tanpa detail transaksi
    """
    try:
        # Get full report
        full_report_response = get_financial_sales_report(start_date, end_date, today_only)
        
        # Extract hanya summary dan breakdown
        return {
            "report_info": full_report_response["report_info"],
            "summary": full_report_response["summary"],
            "menu_breakdown": full_report_response["menu_breakdown"],
            "flavor_breakdown": full_report_response["flavor_breakdown"]
        }
        
    except Exception as e:
        logging.error(f"Error in financial_sales_summary: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/report/financial_sales/export", tags=["Report"], summary="Export Laporan ke Format Tabel")
def export_financial_sales_table(
    start_date: Optional[str] = Query(None, description="Format: YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="Format: YYYY-MM-DD"),
    today_only: bool = Query(False, description="True untuk hari ini saja"),
    format_type: str = Query("json", description="Format export: json, csv_data")
):
    """
    Export laporan dalam format tabel yang siap untuk ditampilkan atau diunduh
    """
    try:
        # Get full report
        report_data = get_financial_sales_report(start_date, end_date, today_only)
        
        if format_type == "csv_data":
            # Generate CSV-like data structure
            headers = [
                "No", "Tanggal Order", "Order ID", "Customer", "Menu", 
                "Flavor", "Qty", "Harga Satuan", "Harga Flavor", "Revenue Base", "Revenue Flavor", "Total Harga"
            ]
            
            rows = []
            for i, transaction in enumerate(report_data["transactions"], 1):
                row = [
                    i,
                    transaction["order_date"],
                    transaction["order_id"],
                    transaction["customer_name"],
                    transaction["menu_name"],
                    transaction["flavor"],
                    transaction["quantity"],
                    f"Rp {transaction['base_price']:,}",
                    f"Rp {transaction['flavor_additional_cost']:,}",
                    f"Rp {transaction['base_revenue']:,}",
                    f"Rp {transaction['flavor_revenue']:,}",
                    f"Rp {transaction['total_price']:,}"
                ]
                rows.append(row)
            
            return {
                "export_info": {
                    "format": "csv_data",
                    "generated_at": datetime.now(jakarta_tz).isoformat(),
                    "total_rows": len(rows)
                },
                "headers": headers,
                "rows": rows,
                "summary": {
                    "total_omzet": f"Rp {report_data['summary']['total_omzet']:,}",
                    "total_base_revenue": f"Rp {report_data['summary']['total_base_revenue']:,}",
                    "total_flavor_revenue": f"Rp {report_data['summary']['total_flavor_revenue']:,}",
                    "total_transactions": report_data['summary']['total_transactions'],
                    "date_range": f"{report_data['report_info']['date_range']['start_date']} s/d {report_data['report_info']['date_range']['end_date']}"
                }
            }
        
        else:  # json format (default)
            return {
                "export_info": {
                    "format": "json",
                    "generated_at": datetime.now(jakarta_tz).isoformat()
                },
                "data": report_data
            }
        
    except Exception as e:
        logging.error(f"Error in export_financial_sales_table: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/health", summary="Health Check", tags=["Utility"])
def health_check():
    """Cek apakah service menu sedang berjalan."""
    return {"status": "ok", "service": "report_service"}


# Log startup
hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
logging.basicConfig(level=logging.INFO)
logging.info(f"✅ report_service sudah running di http://{local_ip}:8004")