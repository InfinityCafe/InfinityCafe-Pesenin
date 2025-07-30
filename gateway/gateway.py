# gateway_service.py
from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx
import json
from typing import Optional

app = FastAPI(
    title="Infinity Gateway", 
    description="Gateway untuk routing requests ke menu, order, kitchen, dan report services", 
    version="1.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Base URLs for microservices
MENU_SERVICE_URL = "http://menu_service:8001"
ORDER_SERVICE_URL = "http://order_service:8002"
KITCHEN_SERVICE_URL = "http://kitchen_service:8003"
REPORT_SERVICE_URL = "http://report_service:8004"

@app.get("/health", tags=["Gateway"])
def health_check():
    return {"status": "ok", "gateway": "Infinity Gateway"}

# ========== KITCHEN ENDPOINTS ==========
@app.get("/kitchen/orders", tags=["Kitchen"])
async def get_kitchen_orders():
    """Ambil daftar semua pesanan dari dapur"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{KITCHEN_SERVICE_URL}/kitchen/orders")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch kitchen orders: {str(e)}")

@app.get("/kitchen/status/now", tags=["Kitchen"])
async def get_kitchen_status():
    """Cek status dapur saat ini"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{KITCHEN_SERVICE_URL}/kitchen/status/now")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch kitchen status: {str(e)}")

@app.post("/kitchen/status", tags=["Kitchen"])
async def set_kitchen_status(request: Request):
    """Atur status dapur ON/OFF"""
    try:
        body = await request.json()
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{KITCHEN_SERVICE_URL}/kitchen/status", json=body)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update kitchen status: {str(e)}")

@app.post("/kitchen/update_status/{order_id}", tags=["Kitchen"])
async def update_kitchen_status(order_id: str, status: str = Query(...), reason: str = Query("")):
    """Perbarui status pesanan tertentu"""
    try:
        async with httpx.AsyncClient() as client:
            # Update di kitchen service
            kitchen_response = await client.post(
                f"{KITCHEN_SERVICE_URL}/kitchen/update_status/{order_id}",
                params={"status": status, "reason": reason}
            )
            kitchen_response.raise_for_status()
            
            # Update di order service
            order_response = await client.post(
                f"{ORDER_SERVICE_URL}/internal/update_status/{order_id}",
                json={"status": status}
            )
            order_response.raise_for_status()
            
            return {"success": True, "message": f"Order {order_id} status updated to {status}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update status: {str(e)}")

@app.get("/stream/orders", tags=["Kitchen"])
async def stream_orders():
    """Streaming data pesanan aktif via SSE"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{KITCHEN_SERVICE_URL}/stream/orders")
            response.raise_for_status()
            
            async def event_generator():
                async for chunk in response.aiter_bytes():
                    yield chunk
                    
            return StreamingResponse(
                event_generator(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*"
                }
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stream orders: {str(e)}")

# ========== ORDER ENDPOINTS ==========
@app.post("/create_order", tags=["Order"])
async def create_order(request: Request):
    """Buat pesanan baru"""
    try:
        body = await request.json()
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{ORDER_SERVICE_URL}/create_order", json=body)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create order: {str(e)}")

@app.post("/custom_order", tags=["Order"])
async def create_custom_order(request: Request):
    """Buat pesanan custom"""
    try:
        body = await request.json()
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{ORDER_SERVICE_URL}/custom_order", json=body)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create custom order: {str(e)}")

@app.post("/cancel_order", tags=["Order"])
async def cancel_order(request: Request):
    """Batalkan pesanan"""
    try:
        body = await request.json()
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{ORDER_SERVICE_URL}/cancel_order", json=body)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to cancel order: {str(e)}")

@app.get("/order_status/{order_id}", tags=["Order"])
async def get_order_status(order_id: str):
    """Status pesanan"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{ORDER_SERVICE_URL}/order_status/{order_id}")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get order status: {str(e)}")

@app.get("/order", tags=["Order"])
async def get_all_orders():
    """Semua pesanan"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{ORDER_SERVICE_URL}/order")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get orders: {str(e)}")

@app.get("/today_orders", tags=["Order"])
async def get_today_orders():
    """Pesanan hari ini"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{ORDER_SERVICE_URL}/today_orders")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get today orders: {str(e)}")

# ========== REPORT ENDPOINTS ==========
@app.get("/report", tags=["Report"])
async def get_report(
    start_date: str = Query(...),
    end_date: str = Query(...),
    menu_name: Optional[str] = Query(None)
):
    """Ambil laporan penjualan berdasarkan rentang tanggal"""
    try:
        params = {"start_date": start_date, "end_date": end_date}
        if menu_name:
            params["menu_name"] = menu_name
            
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{REPORT_SERVICE_URL}/report", params=params)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get report: {str(e)}")

@app.get("/report/top_customers", tags=["Report"])
async def get_top_customers(
    start_date: str = Query(...),
    end_date: str = Query(...)
):
    """Ambil pelanggan loyal"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{REPORT_SERVICE_URL}/report/top_customers",
                params={"start_date": start_date, "end_date": end_date}
            )
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get top customers: {str(e)}")

@app.get("/report/suggested_menu", tags=["Report"])
async def get_suggested_menu(
    start_date: str = Query(...),
    end_date: str = Query(...)
):
    """Ambil daftar menu usulan pelanggan"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{REPORT_SERVICE_URL}/report/suggested_menu",
                params={"start_date": start_date, "end_date": end_date}
            )
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get suggested menu: {str(e)}")

# ========== MENU ENDPOINTS ==========
@app.get("/menu", tags=["Menu"])
async def get_menu():
    """Ambil daftar menu"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{MENU_SERVICE_URL}/menu")
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get menu: {str(e)}")

@app.post("/menu_suggestion", tags=["Menu"])
async def submit_menu_suggestion(request: Request):
    """Submit usulan menu"""
    try:
        body = await request.json()
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{REPORT_SERVICE_URL}/menu_suggestion", json=body)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to submit menu suggestion: {str(e)}")

# ========== MCP ENDPOINTS (untuk kompatibilitas) ==========
@app.api_route("/mcp/menus", methods=["POST"])
async def proxy_menus(request: Request):
    return await forward(request, f"{MENU_SERVICE_URL}/mcp")

@app.api_route("/mcp/orders", methods=["POST"])
async def proxy_orders(request: Request):
    return await forward(request, f"{ORDER_SERVICE_URL}/mcp")

@app.api_route("/mcp/kitchen", methods=["POST"])
async def proxy_kitchen(request: Request):
    return await forward(request, f"{KITCHEN_SERVICE_URL}/mcp")

# Util fungsi forwarding request
async def forward(request: Request, target_url: str):
    async with httpx.AsyncClient() as client:
        response = await client.request(
            method=request.method,
            url=target_url,
            headers=dict(request.headers),
            content=await request.body()
        )
        return response.json()
