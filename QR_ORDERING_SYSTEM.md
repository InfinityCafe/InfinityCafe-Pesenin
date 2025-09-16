# QR Ordering System - Infinity Cafe

## Overview
Sistem pemesanan melalui QR code yang memungkinkan pelanggan untuk memesan langsung dari meja mereka menggunakan smartphone. QR code akan ditempelkan di setiap meja dengan parameter ruangan yang sudah diset.

## Fitur Utama

### 1. Input Nama Pelanggan
- Pelanggan diminta memasukkan nama lengkap sebelum memulai pemesanan
- Validasi nama minimal 2 karakter
- Nama akan digunakan untuk identifikasi pesanan

### 2. Menu Management
- Menampilkan menu berdasarkan kategori
- Filter dan pencarian menu
- Informasi lengkap: nama, harga, estimasi waktu pembuatan
- Pilihan rasa untuk menu tertentu (Caffe Latte, Cappuccino, Milkshake, Squash)

### 3. Keranjang & Checkout
- Manajemen keranjang dengan quantity control
- Catatan khusus untuk setiap item
- Ringkasan pesanan dengan total harga dan estimasi waktu
- Konfirmasi pesanan sebelum submit

### 4. Tracking Order
- Real-time status update setiap 10 detik
- Progress bar visual untuk status pesanan
- Informasi lengkap: nomor antrian, estimasi selesai, detail item
- Auto-refresh dan notifikasi ketika pesanan selesai

## URL Structure

### QR Code URLs
```
http://localhost:7777/qr-menu?room=ROOM_NAME
```

Contoh:
- `http://localhost:7777/qr-menu?room=A1` (Meja A1)
- `http://localhost:7777/qr-menu?room=B5` (Meja B5)
- `http://localhost:7777/qr-menu?room=VIP1` (Meja VIP1)

### Halaman Sistem
1. **Menu Selection**: `/qr-menu?room=ROOM_NAME`
2. **Cart/Checkout**: `/qr-cart?room=ROOM_NAME`
3. **Order Tracking**: `/qr-track?room=ROOM_NAME`

## Flow Penggunaan

### 1. Pelanggan Memindai QR Code
- QR code di meja mengarah ke `/qr-menu?room=ROOM_NAME`
- Parameter `room` otomatis ter-set dan tidak bisa diubah user

### 2. Input Nama
- Pelanggan memasukkan nama lengkap
- Tombol "Mulai Pemesanan" aktif setelah nama valid

### 3. Pilih Menu
- Menu ditampilkan per kategori
- Filter dan search tersedia
- Klik "Pilih Menu" untuk detail dan customisasi

### 4. Customisasi Item
- Pilih rasa (jika tersedia)
- Set quantity (1-10)
- Tambah catatan khusus
- "Tambah ke Keranjang"

### 5. Review & Checkout
- Review semua item di keranjang
- Edit quantity atau hapus item
- Konfirmasi pesanan

### 6. Tracking
- Dapatkan nomor antrian
- Monitor status real-time
- Notifikasi ketika selesai

## Technical Implementation

### Backend Integration
- **Menu Service**: `/menu` - Get available menus
- **Flavor Service**: `/flavors/all` - Get available flavors
- **Order Service**: `/create_order` - Create new order
- **Order Service**: `/order/status/{queue_number}` - Get order status

### Session Management
- Menggunakan `sessionStorage` untuk data sementara
- Data otomatis terhapus setelah pesanan selesai atau refresh
- Tidak memerlukan login/authentication

### Data Flow
1. **Menu Loading**: Fetch dari menu_service dengan cache busting
2. **Order Creation**: POST ke order_service dengan validasi
3. **Status Tracking**: Polling order_service setiap 10 detik
4. **Session Cleanup**: Auto-clear setelah order complete

## Styling & UX

### Design Consistency
- Menggunakan color palette yang sama dengan aplikasi utama
- Font: Inter (Google Fonts)
- Color scheme: #685454, #DCD0A8, #F5EFE6, #207156
- Responsive design untuk mobile dan desktop

### User Experience
- Loading states untuk semua async operations
- Error handling dengan pesan yang jelas
- Success feedback untuk setiap action
- Auto-refresh untuk status tracking
- Mobile-first design

## File Structure

```
frontend/public/
├── qr-menu.html          # Halaman menu selection
├── qr-menu.js           # Logic menu selection
├── qr-cart.html         # Halaman keranjang/checkout
├── qr-cart.js          # Logic keranjang
├── qr-track.html       # Halaman tracking order
├── qr-track.js         # Logic tracking
└── style.css           # Styling (updated with QR styles)
```

## API Endpoints

### Frontend Routes
- `GET /qr-menu` - Menu selection page
- `GET /qr-cart` - Cart/checkout page  
- `GET /qr-track` - Order tracking page

### Backend Proxies
- `POST /create_order` - Create order
- `GET /order/status/:queueNumber` - Get order status
- `GET /menu` - Get available menus
- `GET /flavors/all` - Get available flavors

## Deployment Notes

### QR Code Generation
QR codes harus di-generate dengan URL format:
```
http://YOUR_DOMAIN/qr-menu?room=ROOM_IDENTIFIER
```

### Room Management
- Setiap meja/ruangan memiliki identifier unik
- Identifier bisa berupa: A1, B5, VIP1, OUTDOOR1, dll
- Identifier akan muncul di header dan tracking

### Security Considerations
- Tidak ada authentication required
- Session data temporary (sessionStorage)
- Room parameter tidak bisa diubah user
- Auto-cleanup setelah order complete

## Testing

### Manual Testing Flow
1. Buka `/qr-menu?room=TEST1`
2. Input nama: "Test User"
3. Pilih menu dan tambah ke keranjang
4. Review di cart dan confirm order
5. Monitor di tracking page
6. Verify status updates real-time

### Error Scenarios
- Network errors during menu loading
- Invalid room parameter
- Empty cart submission
- Order service unavailable
- Status polling failures

## Future Enhancements

### Potential Features
- Multiple language support
- Order history for returning customers
- Payment integration
- Table service notifications
- Menu recommendations
- Loyalty points system

### Performance Optimizations
- Menu caching strategies
- Image optimization for menu items
- Progressive web app features
- Offline capability
- Push notifications for order status

