-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIME ZONE 'Asia/Jakarta';

-- Membuat ekstensi 'vector' jika belum ada (berguna untuk AI/embedding)
CREATE EXTENSION IF NOT EXISTS vector;

-- Definisikan ulang tabel sesuai dengan model Python/SQLAlchemy yang baru
-- DROP TABLE IF EXISTS menu_item_flavor_association, flavors, menu_items, menu_suggestions CASCADE;
-- CREATE TABLE flavors (...);
-- CREATE TABLE menu_items (...);
-- CREATE TABLE menu_item_flavor_association (...);
-- CREATE TABLE menu_suggestions (...);


-- Membersihkan data lama dari tabel-tabel terkait agar tidak ada duplikasi
TRUNCATE TABLE menu_items, flavors, menu_item_flavor_association, menu_suggestions RESTART IDENTITY CASCADE;

-- LANGKAH 1: ISI TABEL MASTER 'flavors'
-- Diisi dengan SEMUA varian rasa yang unik dari semua produk.
INSERT INTO flavors (id, flavor_name, additional_price) VALUES
('FLAV01', 'Macadamia Nut', 0),
('FLAV02', 'Roasted Almond', 0),
('FLAV03', 'Creme Brulee', 0),
('FLAV04', 'Salted Caramel', 0),
('FLAV05', 'Java Brown Sugar', 0),
('FLAV06', 'French Mocca', 0),
('FLAV07', 'Havana', 0),
('FLAV08', 'Butterscotch', 0),
('FLAV09', 'Chocolate', 0),
('FLAV10', 'Irish', 0),
('FLAV11', 'Taro', 0),
('FLAV12', 'Red Velvet', 0),
('FLAV13', 'Bubble Gum', 0),
('FLAV14', 'Choco Malt', 0),
('FLAV15', 'Choco Hazelnut', 0),
('FLAV16', 'Choco Biscuit', 0),
('FLAV17', 'Milktea', 0),
('FLAV18', 'Stroberi', 0),
('FLAV19', 'Banana', 0),
('FLAV20', 'Alpukat', 0),
('FLAV21', 'Vanilla', 0),
('FLAV22', 'Tiramisu', 0),
('FLAV23', 'Green Tea', 0),
('FLAV24', 'Markisa', 0),
('FLAV25', 'Melon', 0),
('FLAV26', 'Nanas', 0);

-- LANGKAH 2: ISI TABEL MASTER 'menu_items'
-- Diisi dengan produk-produk dasar.
INSERT INTO menu_items (id, base_name, base_price, "isAvail") VALUES
('MENU001', 'Caffe Latte', 20000, TRUE),
('MENU002', 'Es Kopi Susu', 20000, TRUE),
('MENU003', 'Es Kopi Susu Gula Aren', 20000, TRUE),
('MENU004', 'Americano', 12000, TRUE),
('MENU005', 'Cappuccino', 20000, TRUE),
('MENU006', 'Espresso', 10000, TRUE),
('MENU007', 'Milkshake', 10000, TRUE),
('MENU008', 'Squash', 15000, TRUE);

-- LANGKAH 3: HUBUNGKAN MENU DENGAN RASA DI TABEL PENGHUBUNG
INSERT INTO menu_item_flavor_association (menu_item_id, flavor_id) VALUES
-- Rasa untuk Caffe Latte (MENU001)
('MENU001', 'FLAV01'), ('MENU001', 'FLAV02'), ('MENU001', 'FLAV03'), ('MENU001', 'FLAV04'), ('MENU001', 'FLAV05'),
('MENU001', 'FLAV06'), ('MENU001', 'FLAV07'), ('MENU001', 'FLAV08'), ('MENU001', 'FLAV09'), ('MENU001', 'FLAV10'),

-- Rasa untuk Cappuccino (MENU005)
('MENU005', 'FLAV01'), ('MENU005', 'FLAV02'), ('MENU005', 'FLAV03'), ('MENU005', 'FLAV04'), ('MENU005', 'FLAV05'),
('MENU005', 'FLAV06'), ('MENU005', 'FLAV07'), ('MENU005', 'FLAV08'), ('MENU005', 'FLAV09'), ('MENU005', 'FLAV10'),

-- Rasa untuk Milkshake (MENU007)
('MENU007', 'FLAV11'), ('MENU007', 'FLAV12'), ('MENU007', 'FLAV13'), ('MENU007', 'FLAV09'), ('MENU007', 'FLAV14'),
('MENU007', 'FLAV15'), ('MENU007', 'FLAV16'), ('MENU007', 'FLAV17'), ('MENU007', 'FLAV18'), ('MENU007', 'FLAV19'),
('MENU007', 'FLAV20'), ('MENU007', 'FLAV21'), ('MENU007', 'FLAV22'), ('MENU007', 'FLAV23'),

-- Rasa untuk Squash (MENU008)
('MENU008', 'FLAV18'), ('MENU008', 'FLAV24'), ('MENU008', 'FLAV25'), ('MENU008', 'FLAV26');

-- LANGKAH 4: ISI TABEL 'menu_suggestions'
INSERT INTO menu_suggestions (usulan_id, menu_name, customer_name, "timestamp") VALUES
('USL-001', 'Kopi Gula Aren', 'Budi', NOW() - INTERVAL '2 days'),
('USL-002', 'Croissant Coklat', 'Citra', NOW() - INTERVAL '1 day');

-- Notifikasi Selesai
SELECT 'Seeder SQL berhasil dijalankan dengan struktur data baru.' as "Status";