
# Infinity Cafe Microservices ☕️

Infinity Cafe adalah sistem pemesanan restoran berbasis microservices menggunakan Python + FastAPI + PgVector17 + FastAPI-MCP.

## 📦 Struktur Folder

```
infinity/
├── requirements.txt
├── menu_service/
│   ├── Dockerfile
│   └── main.py
├── order_service/
│   ├── Dockerfile
│   └── main.py
├── kitchen_service/
│   ├── Dockerfile
│   └── main.py
```

## 🚀 Cara Menjalankan

1. **Persiapan:**
   - Install Docker dan Docker Compose

2. **Jalankan layanan:**
   ```bash
   docker-compose -f docker-compose.infinitycafe.yml up --build
   ```

3. **Akses:**
   - Menu Service → [http://localhost:8001](http://localhost:8001)
   - Order Service → [http://localhost:8002](http://localhost:8002)
   - Kitchen Service → [http://localhost:8003](http://localhost:8003)
   - QwenAgent Service → [http://localhost:9000](http://localhost:9000)

## 📝 Endpoint
- **QwenAgent Service:**
  - POST `http://localhost:9000/api/chat` untuk chat dengan QwenAgent. dengan body:
    ```json
    {
      "messages": "Tambahkan menu baru dengan nama 'Nasi Goreng' dan harga '20000'.",
    }



## 🔗 Koneksi Antar Layanan

- `order_service` akan otomatis meneruskan order ke `kitchen_service` jika order valid.
- Semua service menggunakan database bersama: `infinitycafe_db`.

## 🔍 Testing

Gunakan Postman collection `InfinityCafe_PostmanCollection.json` untuk menguji seluruh endpoint layanan.

## 🙌 Kontribusi & Lisensi

Proyek ini dibuat untuk pembelajaran dan simulasi produksi ringan.  
Silakan kembangkan lebih lanjut sesuai kebutuhan.


How to install
0. ubah file .env 

1. running docker desktop
2. docker compose --profile gpu-amd up
3. add Database n8n
4. docker compose --profile gpu-amd up lagi