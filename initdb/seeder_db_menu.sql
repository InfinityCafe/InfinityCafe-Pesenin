-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIME ZONE 'Asia/Jakarta';

-- Membuat ekstensi 'vector' jika belum ada (berguna untuk AI/embedding)
CREATE EXTENSION IF NOT EXISTS vector;

-- DDL (Data Definition Language) - Definisi Tabel (Opsional, untuk referensi)
-- DROP TABLE IF EXISTS menu_item_flavor_association, flavors, menu_items, menu_suggestions CASCADE;
/*
CREATE TABLE flavors (
    id VARCHAR PRIMARY KEY,
    flavor_name VARCHAR UNIQUE,
    additional_price INTEGER,
    "isAvail" BOOLEAN DEFAULT TRUE -- Kolom status ketersediaan
);

CREATE TABLE menu_items (
    id VARCHAR PRIMARY KEY,
    base_name VARCHAR UNIQUE,
    base_price INTEGER,
    "isAvail" BOOLEAN DEFAULT TRUE
);

CREATE TABLE menu_item_flavor_association (
    menu_item_id VARCHAR REFERENCES menu_items(id) ON DELETE CASCADE,
    flavor_id VARCHAR REFERENCES flavors(id) ON DELETE CASCADE,
    PRIMARY KEY (menu_item_id, flavor_id)
);

CREATE TABLE menu_suggestions (
    usulan_id VARCHAR PRIMARY KEY,
    menu_name VARCHAR,
    customer_name VARCHAR,
    "timestamp" TIMESTAMPTZ DEFAULT NOW()
);
*/

-- Membersihkan data lama dari tabel-tabel terkait agar tidak ada duplikasi
TRUNCATE TABLE menu_items, flavors, menu_item_flavor_association, menu_suggestions RESTART IDENTITY CASCADE;

-- LANGKAH 1: ISI TABEL MASTER 'flavors'
INSERT INTO flavors (id, flavor_name, additional_price, "isAvail") VALUES
('FLAV01', 'Macadamia Nut', 0, TRUE),
('FLAV02', 'Roasted Almond', 0, TRUE),
('FLAV03', 'Creme Brulee', 0, TRUE),
('FLAV04', 'Salted Caramel', 0, TRUE),
('FLAV05', 'Java Brown Sugar', 0, TRUE),
('FLAV06', 'French Mocca', 0, TRUE),
('FLAV07', 'Havana', 0, TRUE),
('FLAV08', 'Butterscotch', 0, TRUE),
('FLAV09', 'Chocolate', 0, TRUE),
('FLAV10', 'Irish', 0, TRUE),
('FLAV11', 'Taro', 0, TRUE),
('FLAV12', 'Red Velvet', 0, TRUE),
('FLAV13', 'Bubble Gum', 0, TRUE),
('FLAV14', 'Choco Malt', 0, TRUE),
('FLAV15', 'Choco Hazelnut', 0, TRUE),
('FLAV16', 'Choco Biscuit', 0, TRUE),
('FLAV17', 'Milktea', 0, TRUE),
('FLAV18', 'Stroberi', 0, TRUE),
('FLAV19', 'Banana', 0, TRUE),
('FLAV20', 'Alpukat', 0, TRUE),
('FLAV21', 'Vanilla', 0, TRUE),
('FLAV22', 'Tiramisu', 0, TRUE),
('FLAV23', 'Green Tea', 0, TRUE),
('FLAV24', 'Markisa', 0, TRUE),
('FLAV25', 'Melon', 0, FALSE),    
('FLAV26', 'Nanas', 0, FALSE);   

-- LANGKAH 2: ISI TABEL MASTER 'menu_items'
INSERT INTO menu_items (id, base_name, base_price, "isAvail") VALUES
('MENU001', 'Caffe Latte', 20000, TRUE),
('MENU002', 'Es Kopi Susu', 20000, TRUE),
('MENU003', 'Es Kopi Susu Gula Aren', 20000, TRUE),
('MENU004', 'Americano', 12000, TRUE),
('MENU005', 'Cappuccino', 20000, TRUE),
('MENU006', 'Espresso', 10000, FALSE),
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