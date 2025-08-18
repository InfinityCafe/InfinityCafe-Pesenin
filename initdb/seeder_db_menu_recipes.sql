-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIME ZONE 'Asia/Jakarta';

-- Seeder untuk menu_service: sinkronisasi bahan dari inventory & resep menu
-- Asumsi: ID inventories pada inventory_service diset eksplisit 1..15 seperti di seeder_db_inventory.sql terbaru
-- Tabel target: synced_inventory, recipe_ingredients

-- Bersihkan data lama (opsional)
TRUNCATE TABLE recipe_ingredients RESTART IDENTITY CASCADE;
TRUNCATE TABLE synced_inventory RESTART IDENTITY CASCADE;

-- Sinkron bahan (copy of inventories minimal fields; kategori & unit sudah lowercase)
INSERT INTO synced_inventory (id, name, current_quantity, minimum_quantity, category, unit) VALUES
(1,  'Creamer',               500,   500,  'ingredient', 'gram'),
(2,  'Kopi Robusta',         2000,  2000,  'ingredient', 'gram'),
(3,  'Susu Cair',            5000,  5000,  'ingredient', 'milliliter'),
(4,  'SKM',                  1000,  1000,  'ingredient', 'milliliter'),
(5,  'Gula Aren Cair',       1000,  1000,  'ingredient', 'milliliter'),
(6,  'Gula Pasir',           1500,  1500,  'ingredient', 'gram'),
(7,  'Ice Batu',             5000,  5000,  'ingredient', 'gram'),
(8,  'Biji Selasih',          100,   100,  'ingredient', 'gram'),
(9,  'Soda',                 1000,  1000,  'ingredient', 'milliliter'),
(10, 'Teh Celup',              50,    50,  'ingredient', 'piece'),
(11, 'Kopi Nescafe',            10,     10,  'ingredient', 'piece'),
(12, 'Butterscout',            356,   356,  'ingredient', 'milliliter'),
(13, 'French Mocca',           560,   560,  'ingredient', 'milliliter'),
(14, 'Rosted Almond',          231,   231,  'ingredient', 'milliliter'),
(15, 'Creme Brulee',           358,   358,  'ingredient', 'milliliter'),
(16, 'Irish',                  500,   500,  'ingredient', 'milliliter'),
(17, 'Havana',                  82,    82,  'ingredient', 'milliliter'),
(18, 'Salted Caramel',         600,   600,  'ingredient', 'milliliter'),
(19, 'Mangga',                 183,   183,  'ingredient', 'gram'),
(20, 'Permenkaret',            398,   398,  'ingredient', 'gram'),
(21, 'Tiramisu',               484,   484,  'ingredient', 'gram'),
(22, 'Redvelvet',              863,   863,  'ingredient', 'gram'),
(23, 'Strawberry',             600,   600,  'ingredient', 'gram'),
(24, 'Vanilla',                318,   318,  'ingredient', 'gram'),
(25, 'Cup Plastik',           500,   500, 'packaging', 'piece'),
(26, 'Cup Kertas',            700,   700, 'packaging', 'piece'),
(27, 'Sedotan',               500,   500, 'packaging', 'piece');

-- Pastikan menu id di tabel menu_items sudah ada (seed dari seeder_db_menu.sql)
-- Gunakan ID menu dari seeder_db_menu.sql: MENU001..MENU008

-- Resep berdasarkan data real dengan komponen lengkap (flavor + packaging):
-- 1) Caffe Latte (MENU001): Creamer 20g, Kopi Robusta 17g, Susu 120ml, Es 80g + Cup + Sedotan
-- Note: Flavor akan ditambahkan secara dinamis berdasarkan pilihan customer
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU001', 1, 20, 'gram'),    -- Creamer
('MENU001', 2, 17, 'gram'),    -- Kopi Robusta
('MENU001', 3, 120, 'milliliter'), -- Susu Cair
('MENU001', 7, 80, 'gram'),    -- Ice Batu
('MENU001', 25, 1, 'piece'),   -- Cup Plastik
('MENU001', 27, 1, 'piece');   -- Sedotan

-- 2) Es Kopi Susu (MENU002): Creamer 20g, Kopi 17g, SKM 30ml, Susu 120ml, Es 80g + Cup + Sedotan
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU002', 1, 20, 'gram'),
('MENU002', 2, 17, 'gram'),
('MENU002', 4, 30, 'milliliter'),
('MENU002', 3, 120, 'milliliter'),
('MENU002', 7, 80, 'gram'),
('MENU002', 25, 1, 'piece'),
('MENU002', 27, 1, 'piece');

-- 3) Es Kopi Susu Gula Aren (MENU003): Creamer 20g, Kopi 17g, Gula Aren 30ml, Susu 120ml, Es 80g + Cup + Sedotan
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU003', 1, 20, 'gram'),
('MENU003', 2, 17, 'gram'),
('MENU003', 5, 30, 'milliliter'),
('MENU003', 3, 120, 'milliliter'),
('MENU003', 7, 80, 'gram'),
('MENU003', 25, 1, 'piece'),
('MENU003', 27, 1, 'piece');

-- 4) Americano (MENU004): Kopi Robusta 40g, Gula 30g + Cup + Sedotan
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU004', 2, 40, 'gram'),
('MENU004', 6, 30, 'gram'),
('MENU004', 25, 1, 'piece'),
('MENU004', 27, 1, 'piece');

-- 5) Cappuccino (MENU005) Hot: Creamer 20g, Kopi 17g, Susu 200ml + Cup
-- Note: Flavor akan ditambahkan secara dinamis berdasarkan pilihan customer
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU005', 1, 20, 'gram'),
('MENU005', 2, 17, 'gram'),
('MENU005', 3, 200, 'milliliter'),
('MENU005', 26, 1, 'piece');   -- Cup Kertas untuk minuman panas

-- 6) Espresso (MENU006): Kopi Robusta 12g + Cup
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU006', 2, 12, 'gram'),
('MENU006', 26, 1, 'piece');

-- 7) Milkshake (MENU007): Susu 120ml, Es 80g + Cup + Sedotan
-- Note: Flavor akan ditambahkan secara dinamis berdasarkan pilihan customer
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU007', 3, 120, 'milliliter'),
('MENU007', 7, 80, 'gram'),
('MENU007', 25, 1, 'piece'),
('MENU007', 27, 1, 'piece');

-- 8) Squash (MENU008): Soda 100ml, Biji Selasih 5g, Es 80g + Cup + Sedotan
-- Note: Flavor akan ditambahkan secara dinamis berdasarkan pilihan customer
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU008', 9, 100, 'milliliter'),
('MENU008', 8, 5, 'gram'),
('MENU008', 7, 80, 'gram'),
('MENU008', 25, 1, 'piece'),
('MENU008', 27, 1, 'piece');

-- 9) Es Teh (tidak ada ID menu di seeder default, tambahkan manual jika perlu)
-- Contoh jika ada MENU009: Teh Celup 1pc, Air 120ml, Gula 30g, Es 80g
-- INSERT INTO menu_items (id, base_name, base_price, "isAvail") VALUES ('MENU009','Es Teh',8000, TRUE);
-- INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
-- ('MENU009', 12, 1, 'piece'),
-- ('MENU009', 8, 120, 'milliliter'),
-- ('MENU009', 6, 30, 'gram'),
-- ('MENU009', 7, 80, 'gram');

-- Set sequence recipe_ingredients ke max id
SELECT setval(pg_get_serial_sequence('recipe_ingredients','id'), (SELECT MAX(id) FROM recipe_ingredients));

SELECT 'Seeder menu recipes & synced_inventory selesai.' AS status;
