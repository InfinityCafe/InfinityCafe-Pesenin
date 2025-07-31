# Perubahan Arsitektur Infinity Cafe

## Overview
Perubahan ini mengimplementasikan arsitektur gateway pattern dimana frontend tidak lagi langsung berkomunikasi dengan service-service, tetapi melalui backend gateway sebagai perantara.

## Arsitektur Sebelumnya
```
Frontend → Service (kitchen_service, order_service, menu_service, report_service)
```

## Arsitektur Baru
```
Frontend → Backend (gateway) → Service (kitchen_service, order_service, menu_service, report_service)
```

## Perubahan yang Dilakukan

### 1. Gateway Service (`gateway/gateway.py`)
- **Diperluas** untuk menangani semua endpoint yang diperlukan frontend
- **Ditambahkan** endpoint untuk:
  - Kitchen: `/kitchen/orders`, `/kitchen/update_status/{order_id}`, `/kitchen/status/now`, `/kitchen/status`, `/stream/orders`
  - Order: `/create_order`, `/custom_order`, `/cancel_order`, `/order_status/{order_id}`, `/order`, `/today_orders`
  - Report: `/report`, `/report/top_customers`, `/report/suggested_menu`
  - Menu: `/menu`, `/menu_suggestion`
  - MCP: `/mcp/menus`, `/mcp/orders`, `/mcp/kitchen` (untuk kompatibilitas)

### 2. Frontend Server (`frontend/server.js`)
- **Diubah** semua endpoint untuk menggunakan gateway sebagai perantara
- **Ditambahkan** middleware JSON parsing
- **Ditambahkan** endpoint baru untuk:
  - Kitchen status: `/kitchen/status/now`, `/kitchen/status`
  - Menu: `/menu`
  - Order: `/create_order`
  - Report: `/report`, `/report/top_customers`, `/report/suggested_menu`

### 3. Frontend JavaScript (`frontend/public/script.js`)
- **Diubah** semua URL dari `localhost:8001`, `localhost:8002`, `localhost:8003` menjadi relative path
- **Dihapus** direct call ke order service (sekarang ditangani gateway)

### 4. Report Page (`frontend/public/report.html`)
- **Diubah** semua URL dari `localhost:8004` menjadi relative path

### 5. Docker Compose (`docker-compose.yml`)
- **Diaktifkan** gateway service yang sebelumnya di-comment
- **Ditambahkan** dependency gateway ke frontend
- **Ditambahkan** dependency report_service ke gateway

## Keuntungan Arsitektur Baru

### 1. Centralized Control
- Semua request melalui satu titik (gateway)
- Lebih mudah untuk monitoring dan logging
- Centralized error handling

### 2. Security
- Frontend tidak lagi memiliki akses langsung ke service internal
- Gateway dapat menambahkan authentication/authorization
- Rate limiting dapat diterapkan di gateway

### 3. Scalability
- Load balancing dapat diterapkan di gateway
- Service discovery lebih mudah
- Circuit breaker pattern dapat diterapkan

### 4. Maintainability
- Perubahan endpoint service tidak mempengaruhi frontend
- Versioning API lebih mudah
- Documentation terpusat

## Endpoint Mapping

### Kitchen Endpoints
| Frontend | Gateway | Service |
|----------|---------|---------|
| `/kitchen/orders` | `/kitchen/orders` | `kitchen_service:8003/kitchen/orders` |
| `/kitchen/update_status/{id}` | `/kitchen/update_status/{id}` | `kitchen_service:8003/kitchen/update_status/{id}` |
| `/kitchen/status/now` | `/kitchen/status/now` | `kitchen_service:8003/kitchen/status/now` |
| `/kitchen/status` | `/kitchen/status` | `kitchen_service:8003/kitchen/status` |
| `/stream/orders` | `/stream/orders` | `kitchen_service:8003/stream/orders` |

### Order Endpoints
| Frontend | Gateway | Service |
|----------|---------|---------|
| `/create_order` | `/create_order` | `order_service:8002/create_order` |
| `/custom_order` | `/custom_order` | `order_service:8002/custom_order` |
| `/cancel_order` | `/cancel_order` | `order_service:8002/cancel_order` |
| `/order_status/{id}` | `/order_status/{id}` | `order_service:8002/order_status/{id}` |
| `/order` | `/order` | `order_service:8002/order` |
| `/today_orders` | `/today_orders` | `order_service:8002/today_orders` |

### Report Endpoints
| Frontend | Gateway | Service |
|----------|---------|---------|
| `/report` | `/report` | `report_service:8004/report` |
| `/report/top_customers` | `/report/top_customers` | `report_service:8004/report/top_customers` |
| `/report/suggested_menu` | `/report/suggested_menu` | `report_service:8004/report/suggested_menu` |

### Menu Endpoints
| Frontend | Gateway | Service |
|----------|---------|---------|
| `/menu` | `/menu` | `menu_service:8001/menu` |
| `/menu_suggestion` | `/menu_suggestion` | `report_service:8004/menu_suggestion` |

## Cara Menjalankan

1. **Build dan jalankan semua service:**
   ```bash
   docker-compose up --build
   ```

2. **Akses aplikasi:**
   - Frontend: http://localhost:7777
   - Gateway: http://localhost:2323
   - Kitchen Service: http://localhost:8003
   - Order Service: http://localhost:8002
   - Menu Service: http://localhost:8001
   - Report Service: http://localhost:8004

3. **Health Check:**
   - Frontend: http://localhost:7777/health
   - Gateway: http://localhost:2323/health

## Testing

Semua endpoint yang ada sebelumnya tetap berfungsi sama, hanya routing yang berubah:

- Frontend → Gateway → Service
- Error handling terpusat di gateway
- Response format tetap sama

## Catatan Penting

1. **Gateway berjalan di port 2323** dan menjadi perantara semua request
2. **Frontend tetap di port 7777** dan menggunakan relative path untuk semua request
3. **Service-service tetap berjalan di port aslinya** (8001, 8002, 8003, 8004)
4. **Semua fungsionalitas tetap sama**, hanya arsitektur yang berubah
5. **MCP endpoints tetap tersedia** untuk kompatibilitas dengan sistem yang ada 