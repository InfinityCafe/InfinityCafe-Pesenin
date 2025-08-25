-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIMEZONE = 'Asia/Jakarta';

-- Membersihkan data lama dari tabel-tabel terkait agar tidak ada duplikasi (jika tabel sudah ada)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'menu_items') THEN
        TRUNCATE TABLE menu_items RESTART IDENTITY CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'flavors') THEN
        TRUNCATE TABLE flavors RESTART IDENTITY CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'menu_item_flavor_association') THEN
        TRUNCATE TABLE menu_item_flavor_association RESTART IDENTITY CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'menu_suggestions') THEN
        TRUNCATE TABLE menu_suggestions RESTART IDENTITY CASCADE;
    END IF;
END $$;

-- LANGKAH 1: ISI TABEL MASTER 'flavors' - disesuaikan dengan inventory yang tersedia
INSERT INTO flavors (id, flavor_name, additional_price, "isAvail") VALUES
-- Flavors untuk Caffe Latte
('FLAV01', 'Caramel', 0, TRUE),           -- ID 8 di inventory
('FLAV02', 'Macadamia Nut', 0, TRUE),     -- ID 10 di inventory
('FLAV03', 'French Moca', 0, TRUE),       -- ID 11 di inventory  
('FLAV04', 'Java Brown Sugar', 0, TRUE),  -- ID 12 di inventory
('FLAV05', 'Chocolate', 0, TRUE),         -- ID 13 di inventory
('FLAV06', 'Roasted Almond', 0, TRUE),    -- ID 15 di inventory
('FLAV07', 'Creme Brulee', 0, TRUE),      -- ID 16 di inventory
('FLAV08', 'Butter Scotch', 0, TRUE),     -- ID 17 di inventory

-- Flavors untuk Squash
('FLAV09', 'Peach', 0, TRUE),             -- ID 9 di inventory
('FLAV10', 'Passion Fruit', 0, TRUE),     -- ID 14 di inventory
('FLAV11', 'Marjan Vanilla', 0, TRUE),    -- ID 18 di inventory
('FLAV12', 'Marjan Grenadine', 0, TRUE),  -- ID 19 di inventory
('FLAV13', 'Marjan Markisa', 0, TRUE),    -- ID 20 di inventory
('FLAV14', 'Marjan Melon', 0, TRUE),      -- ID 21 di inventory
('FLAV15', 'Marjan Nanas', 0, TRUE),      -- ID 22 di inventory

-- Flavors untuk MilkShake (powder series)
('FLAV16', 'Keju Vanilla', 0, TRUE),      -- ID 25 di inventory
('FLAV17', 'Taro', 0, TRUE),              -- ID 26 di inventory
('FLAV18', 'Banana', 0, TRUE),            -- ID 27 di inventory
('FLAV19', 'Dark Chocolate', 0, TRUE),    -- ID 28 di inventory
('FLAV20', 'Chocolate Hazelnut', 0, TRUE), -- ID 29 di inventory
('FLAV21', 'Chocolate Malt', 0, TRUE),    -- ID 30 di inventory
('FLAV22', 'Blackcurrant', 0, TRUE);      -- ID 31 di inventory   

-- LANGKAH 2: ISI TABEL MASTER 'menu_items'
INSERT INTO menu_items (id, base_name, base_price, making_time_minutes, "isAvail") VALUES
('MENU001', 'Caffe Latte', 20000, 5.0, TRUE),
('MENU002', 'Es Kopi Susu', 20000, 5.0, TRUE),
('MENU003', 'Kopi Late Gula Aren', 20000, 5.0, TRUE),
('MENU004', 'Hot Cappucino', 20000, 5.0, TRUE),
('MENU005', 'Vietnam Drive', 18000, 9.0, TRUE),
('MENU006', 'Squash', 15000, 3.0, TRUE),
('MENU007', 'Milk Shake', 18000, 6.0, TRUE),
('MENU008', 'Esteh', 8000, 2.0, TRUE),
('MENU009', 'Americano', 12000, 2.0, TRUE),
('MENU010', 'Expreso Single', 10000, 2.0, TRUE),
('MENU011', 'Expreso Double', 15000, 2.0, TRUE);

-- LANGKAH 3: HUBUNGKAN MENU DENGAN RASA DI TABEL PENGHUBUNG
INSERT INTO menu_item_flavor_association (menu_item_id, flavor_id) VALUES
-- Rasa untuk Caffe Latte (MENU001)
('MENU001', 'FLAV01'), -- Caramel
('MENU001', 'FLAV02'), -- Macadamia Nut
('MENU001', 'FLAV03'), -- French Moca
('MENU001', 'FLAV04'), -- Java Brown Sugar
('MENU001', 'FLAV05'), -- Chocolate
('MENU001', 'FLAV06'), -- Roasted Almond
('MENU001', 'FLAV07'), -- Creme Brulee
('MENU001', 'FLAV08'), -- Butter Scotch

-- Rasa untuk Squash (MENU006)
('MENU006', 'FLAV09'), -- Peach
('MENU006', 'FLAV10'), -- Passion Fruit
('MENU006', 'FLAV11'), -- Marjan Vanilla
('MENU006', 'FLAV12'), -- Marjan Grenadine
('MENU006', 'FLAV13'), -- Marjan Markisa
('MENU006', 'FLAV14'), -- Marjan Melon
('MENU006', 'FLAV15'), -- Marjan Nanas

-- Rasa untuk MilkShake (MENU007) - Powder series
('MENU007', 'FLAV16'), -- Keju Vanilla
('MENU007', 'FLAV17'), -- Taro
('MENU007', 'FLAV18'), -- Banana
('MENU007', 'FLAV19'), -- Dark Chocolate
('MENU007', 'FLAV20'), -- Chocolate Hazelnut
('MENU007', 'FLAV21'), -- Chocolate Malt
('MENU007', 'FLAV22'); -- Blackcurrant

-- LANGKAH 4: ISI TABEL 'menu_suggestions'
INSERT INTO menu_suggestions (usulan_id, menu_name, customer_name, "timestamp") VALUES
('USL-001', 'Kopi Gula Aren', 'Budi', NOW() - INTERVAL '2 day'),
('USL-002', 'Croissant Coklat', 'Citra', NOW() - INTERVAL '1 day');

-- Notifikasi Selesai
SELECT 'Seeder SQL berhasil dijalankan dengan struktur data baru.' as "Status";