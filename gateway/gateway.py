# gateway_service.py
from fastapi import FastAPI, Request
import httpx

app = FastAPI(title="Infinity Gateway", description="Routes requests to menu, order, and kitchen services", version="1.0")

# Base URLs for microservices
MENU_SERVICE_URL = "http://menu_service:8001"
ORDER_SERVICE_URL = "http://order_service:8002"
KITCHEN_SERVICE_URL = "http://kitchen_service:8003"

@app.get("/health", tags=["Gateway"])
def health_check():
    return {"status": "ok", "gateway": "Infinity Gateway"}
# from fastapi import FastAPI, Request
# import httpx
# app = FastAPI()

# Routing proxy ke masing-masing MCP service
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
            headers=request.headers.raw,
            content=await request.body()
        )
        return response.json()
