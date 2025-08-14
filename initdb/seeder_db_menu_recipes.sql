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
(1,  'Creamer',               5000,   500,  'ingredient', 'gram'),
(2,  'Kopi Robusta',         20000,  2000,  'ingredient', 'gram'),
(3,  'Susu Cair',            50000,  5000,  'ingredient', 'milliliter'),
(4,  'SKM',                  10000,  1000,  'ingredient', 'milliliter'),
(5,  'Gula Aren Cair',       10000,  1000,  'ingredient', 'milliliter'),
(6,  'Gula Pasir',           15000,  1500,  'ingredient', 'gram'),
(7,  'Ice Batu',             50000,  5000,  'ingredient', 'gram'),
(8,  'Air',                 100000, 10000,  'ingredient', 'milliliter'),
(9,  'Air Panas',            50000,  5000,  'ingredient', 'milliliter'),
(10, 'Biji Selasih',          1000,   100,  'ingredient', 'gram'),
(11, 'Soda',                 10000,  1000,  'ingredient', 'milliliter'),
(12, 'Teh Celup',              500,    50,  'ingredient', 'piece'),
(13, 'Kopi Nescafe',            10,     2,  'ingredient', 'piece'),
(14, 'Flavor Syrup Generic', 20000,  2000,  'ingredient', 'milliliter'),
(15, 'Milkshake Powder Generic', 5000, 500, 'ingredient', 'gram');

-- Pastikan menu id di tabel menu_items sudah ada (seed dari seeder_db_menu.sql)
-- Gunakan ID menu dari seeder_db_menu.sql: MENU001..MENU008

-- Resep berdasarkan data real:
-- 1) Caffe Latte (MENU001): Creamer 20g, Kopi Robusta 17g, Flavor 25ml (midpoint 20-30), Susu 120ml, Es 80g
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU001', 1, 20, 'gram'),
('MENU001', 2, 17, 'gram'),
('MENU001', 14, 25, 'milliliter'),
('MENU001', 3, 120, 'milliliter'),
('MENU001', 7, 80, 'gram');

-- 2) Es Kopi Susu (MENU002): Creamer 20g, Kopi 17g, SKM 30ml, Susu 120ml, Es 80g
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU002', 1, 20, 'gram'),
('MENU002', 2, 17, 'gram'),
('MENU002', 4, 30, 'milliliter'),
('MENU002', 3, 120, 'milliliter'),
('MENU002', 7, 80, 'gram');

-- 3) Es Kopi Susu Gula Aren (MENU003): Creamer 20g, Kopi 17g, Gula Aren 30ml, Susu 120ml, Es 80g
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU003', 1, 20, 'gram'),
('MENU003', 2, 17, 'gram'),
('MENU003', 5, 30, 'milliliter'),
('MENU003', 3, 120, 'milliliter'),
('MENU003', 7, 80, 'gram');

-- 4) Americano (MENU004): Kopi Robusta 40g, Air 100ml, (opsional gula 30g)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU004', 2, 40, 'gram'),
('MENU004', 8, 100, 'milliliter'),
('MENU004', 6, 30, 'gram');

-- 5) Cappuccino (MENU005) Hot: Creamer 20g, Kopi 17g, Flavor 25ml, Susu 200ml
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU005', 1, 20, 'gram'),
('MENU005', 2, 17, 'gram'),
('MENU005', 14, 25, 'milliliter'),
('MENU005', 3, 200, 'milliliter');

-- 6) Espresso (MENU006): single 12g (ambang 10-12), double 24g (opsional di sisi order)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU006', 2, 12, 'gram');

-- 7) Milkshake (MENU007): Flavor Powder/Syrup 30g, Susu 120ml, Air Panas 40ml, Es 80g
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU007', 15, 30, 'gram'),
('MENU007', 3, 120, 'milliliter'),
('MENU007', 9, 40, 'milliliter'),
('MENU007', 7, 80, 'gram');

-- 8) Squash (MENU008): Soda 100ml, Biji Selasih 5g, Flavor 25ml, Es 80g
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU008', 11, 100, 'milliliter'),
('MENU008', 10, 5,   'gram'),
('MENU008', 14, 25,  'milliliter'),
('MENU008', 7, 80,   'gram');

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
