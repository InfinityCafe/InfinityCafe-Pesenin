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
INSERT INTO flavors (id, flavor_name_en, flavor_name_id, additional_price, "isAvail") VALUES
('FLAV00', 'Original', 'Original', 0, TRUE), 
('FLAV01', 'Caramel', 'Karamel', 0, TRUE),
('FLAV02', 'Macadamia Nut', 'Kacang Makadamia', 0, TRUE),
('FLAV03', 'French Moca', 'Moka Prancis', 0, TRUE),  
('FLAV04', 'Java Brown Sugar', 'Gula Merah Jawa', 0, TRUE),
('FLAV05', 'Chocolate', 'Coklat', 0, TRUE),
('FLAV06', 'Roasted Almond', 'Almond Panggang', 0, TRUE),
('FLAV07', 'Creme Brulee', 'Krim Brulee', 0, TRUE),
('FLAV08', 'Butterscotch', 'Butterscotch', 0, TRUE),

-- Flavors untuk Squash
('FLAV09', 'Peach', 'Persik', 0, TRUE),
('FLAV10', 'Passion Fruit', 'Markisa', 0, TRUE),
('FLAV11', 'Vanilla', 'Vanila', 0, TRUE),
('FLAV12', 'Grenadine', 'Grenadine', 0, TRUE),
('FLAV13', 'Passion Fruit', 'Markisa', 0, TRUE),
('FLAV14', 'Melon', 'Melon', 0, TRUE),
('FLAV15', 'Pineapple', 'Nanas', 0, TRUE),

-- Flavors untuk MilkShake
('FLAV16', 'Vanilla Cheese', 'Keju Vanila', 0, TRUE),
('FLAV17', 'Taro', 'Talas', 0, TRUE),
('FLAV18', 'Banana', 'Pisang', 0, TRUE),
('FLAV19', 'Dark Chocolate', 'Coklat Hitam', 0, TRUE),
('FLAV20', 'Chocolate Hazelnut', 'Coklat Hazelnut', 0, TRUE),
('FLAV21', 'Chocolate Malt', 'Coklat Malt', 0, TRUE),
('FLAV22', 'Blackcurrant', 'Blackcurrant', 0, TRUE);   

-- LANGKAH 2: ISI TABEL MASTER 'menu_items'
INSERT INTO menu_items (id, base_name_en, base_name_id, base_price, making_time_minutes, "isAvail") VALUES
('MENU001', 'Caffe Latte', 'Kafe Latte', 20000, 5.0, TRUE),
('MENU002', 'Squash', 'Squash', 15000, 3.0, TRUE),
('MENU003', 'Milkshake', 'Milkshake', 18000, 6.0, TRUE),
('MENU004', 'Espresso Single', 'Espresso Tunggal', 10000, 2.0, TRUE),
('MENU005', 'Vietnamese Drip Coffee', 'Kopi Vietnam', 18000, 9.0, TRUE),
('MENU006', 'Palm Sugar Milk Coffee', 'Kopi Susu Gula Aren', 20000, 5.0, TRUE),
('MENU007', 'Tea', 'Teh', 8000, 2.0, TRUE),
('MENU008', 'Espresso Double', 'Espresso Ganda', 15000, 2.0, TRUE),
('MENU009', 'Milk Coffee', 'Kopi Susu', 20000, 5.0, TRUE),
('MENU010', 'Americano', 'Amerikano', 12000, 2.0, TRUE),
('MENU011', 'Cappuccino', 'Kapucino', 20000, 5.0, TRUE);

-- LANGKAH 3: HUBUNGKAN MENU DENGAN RASA DI TABEL PENGHUBUNG
INSERT INTO menu_item_flavor_association (menu_item_id, flavor_id) VALUES

-- Rasa untuk Caffe Latte (MENU001)
('MENU001', 'FLAV00'), -- Original / Original
('MENU001', 'FLAV01'), -- Caramel / Karamel
('MENU001', 'FLAV02'), -- Macadamia Nut / Kacang Makadamia
('MENU001', 'FLAV03'), -- French Moca / Moka Prancis
('MENU001', 'FLAV04'), -- Java Brown Sugar / Gula Merah Jawa
('MENU001', 'FLAV05'), -- Chocolate / Coklat
('MENU001', 'FLAV06'), -- Roasted Almond / Almond Panggang
('MENU001', 'FLAV07'), -- Creme Brulee / Krim Brulee
('MENU001', 'FLAV08'), -- Butterscotch / Butterscotch

-- Rasa untuk Squash (MENU002)
('MENU002', 'FLAV09'), -- Peach / Persik
('MENU002', 'FLAV10'), -- Passion Fruit / Markisa
('MENU002', 'FLAV11'), -- Vanilla / Vanila
('MENU002', 'FLAV12'), -- Grenadine / Grenadine
('MENU002', 'FLAV13'), -- Passion Fruit / Markisa
('MENU002', 'FLAV14'), -- Melon / Melon
('MENU002', 'FLAV15'), -- Pineapple / Nanas

-- Rasa untuk MilkShake (MENU003)
('MENU003', 'FLAV16'), -- Vanilla Cheese / Keju Vanila
('MENU003', 'FLAV17'), -- Taro / Talas
('MENU003', 'FLAV18'), -- Banana / Pisang
('MENU003', 'FLAV19'), -- Dark Chocolate / Coklat Hitam
('MENU003', 'FLAV20'), -- Chocolate Hazelnut / Coklat Hazelnut
('MENU003', 'FLAV21'), -- Chocolate Malt / Coklat Malt
('MENU003', 'FLAV22'), -- Blackcurrant / Blackcurrant

-- Rasa untuk Cappuccino (MENU011) - SAMA seperti Caffe Latte
('MENU011', 'FLAV00'), -- Original / Original
('MENU011', 'FLAV01'), -- Caramel / Karamel
('MENU011', 'FLAV02'), -- Macadamia Nut / Kacang Makadamia
('MENU011', 'FLAV03'), -- French Moca / Moka Prancis
('MENU011', 'FLAV04'), -- Java Brown Sugar / Gula Merah Jawa
('MENU011', 'FLAV05'), -- Chocolate / Coklat
('MENU011', 'FLAV06'), -- Roasted Almond / Almond Panggang
('MENU011', 'FLAV07'), -- Creme Brulee / Krim Brulee
('MENU011', 'FLAV08'); -- Butterscotch / Butterscotch

-- LANGKAH 4: ISI TABEL 'menu_suggestions'
INSERT INTO menu_suggestions (usulan_id, menu_name, customer_name, "timestamp") VALUES
('USL-001', 'Kopi Gula Aren', 'Budi', NOW() - INTERVAL '2 day'),
('USL-002', 'Croissant Coklat', 'Citra', NOW() - INTERVAL '1 day');

-- Notifikasi Selesai
SELECT 'Seeder SQL berhasil dijalankan dengan struktur data baru.' as "Status";