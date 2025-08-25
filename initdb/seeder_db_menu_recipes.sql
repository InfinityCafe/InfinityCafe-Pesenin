-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIMEZONE = 'Asia/Jakarta';

-- Bersihkan data lama (opsional)
TRUNCATE TABLE recipe_ingredients RESTART IDENTITY CASCADE;
TRUNCATE TABLE synced_inventory RESTART IDENTITY CASCADE;

-- Sinkron bahan (copy dari inventory_service dengan ID yang benar + tambahan bahan baru)
INSERT INTO synced_inventory (id, name, current_quantity, minimum_quantity, category, unit) VALUES
-- PACKAGING & PERLENGKAPAN (dari inventory service)
(1,  'Cup',                   700,   100,  'packaging', 'piece'),
(2,  'Cup Hot',               550,   100,  'packaging', 'piece'), 
(3,  'Sedotan',               173,    50,  'packaging', 'piece'),

-- BAHAN DASAR MINUMAN
(4,  'Kopi Robusta',         1800,   500,  'ingredient', 'gram'),
(5,  'Creamer',              1200,   500,  'ingredient', 'gram'),
(6,  'Susu Kental Manis',    1605,   540,  'ingredient', 'milliliter'),
(7,  'Susu Diamond',         6000,  3000,  'ingredient', 'milliliter'),

-- SYRUP & FLAVOR LIQUID
(8,  'Caramel',               435,   150,  'ingredient', 'milliliter'),
(9,  'Peach',                 600,   150,  'ingredient', 'milliliter'),
(10, 'Macadamia Nut',         460,   150,  'ingredient', 'milliliter'),
(11, 'French Moca',           400,   150,  'ingredient', 'milliliter'),
(12, 'Java Brown Sugar',      400,   150,  'ingredient', 'milliliter'),
(13, 'Chocolate',             470,   150,  'ingredient', 'milliliter'),
(14, 'Passion Fruit',         530,   150,  'ingredient', 'milliliter'),
(15, 'Roasted Almond',        585,   150,  'ingredient', 'milliliter'),
(16, 'Creme Brulee',          280,   150,  'ingredient', 'milliliter'),
(17, 'Butter Scotch',         500,   150,  'ingredient', 'milliliter'),

-- MARJAN SERIES
(18, 'Marjan Vanilla',        230,   100,  'ingredient', 'milliliter'),
(19, 'Marjan Grenadine',      367,   100,  'ingredient', 'milliliter'),
(20, 'Marjan Markisa',        294,   100,  'ingredient', 'milliliter'),
(21, 'Marjan Melon',          215,   100,  'ingredient', 'milliliter'),
(22, 'Marjan Nanas',          460,   100,  'ingredient', 'milliliter'),

-- GULA & PEMANIS
(23, 'Gula Pasir Cair',       300,   200,  'ingredient', 'milliliter'),
(24, 'Gula Aren Cair',        337,   200,  'ingredient', 'milliliter'),

-- POWDER SERIES
(25, 'Powder Keju Vanilla',   197,   300,  'ingredient', 'gram'),
(26, 'Powder Taro',           187,   300,  'ingredient', 'gram'),
(27, 'Powder Banana',         377,   300,  'ingredient', 'gram'),
(28, 'Powder Dark Chocolate', 882,   300,  'ingredient', 'gram'),
(29, 'Powder Chocolate Hazelnut', 413, 300, 'ingredient', 'gram'),
(30, 'Powder Chocolate Malt', 668,   300,  'ingredient', 'gram'),
(31, 'Powder Blackcurrant',  1000,   300,  'ingredient', 'gram'),

-- MINUMAN & BAHAN LAIN
(32, 'Sanquik Lemon',          50,   100,  'ingredient', 'milliliter'),
(33, 'Teh Celup',              22,    10,  'ingredient', 'piece'),
(34, 'Nescafe',                76,    20,  'ingredient', 'gram'),

-- TAMBAHAN BAHAN YANG DIBUTUHKAN MENU
(35, 'Es Batu',             10000,  2500,  'ingredient', 'gram'),
(36, 'Sprite',               5000,  1250,  'ingredient', 'milliliter'),
(37, 'Biji Selasih',          100,    20,  'ingredient', 'gram');

-- 1) Caffe Latte (MENU001) - Menggunakan perasa apa saja (20-30ml akan ditambah dinamis)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU001', 1, 1, 'piece'),     -- Cup (default untuk semua menu)
('MENU001', 3, 1, 'piece'),     -- Sedotan
('MENU001', 5, 20, 'gram'),     -- Creamer 20gr
('MENU001', 4, 17, 'gram'),     -- Kopi robusta 17gr
('MENU001', 7, 120, 'milliliter'), -- Susu cair (Susu Diamond) 120ml
('MENU001', 35, 80, 'gram');    -- Es batu 80gr

-- 2) Es Kopi Susu (MENU002)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU002', 1, 1, 'piece'),     -- Cup
('MENU002', 3, 1, 'piece'),     -- Sedotan
('MENU002', 5, 20, 'gram'),     -- Creamer 20gr
('MENU002', 4, 17, 'gram'),     -- Kopi robusta 17gr
('MENU002', 6, 30, 'milliliter'), -- SKM (Susu Kental Manis) 30ml
('MENU002', 7, 120, 'milliliter'), -- Susu cair 120ml
('MENU002', 35, 80, 'gram');    -- Es batu 80gr

-- 3) Kopi late gula aren (MENU003)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU003', 1, 1, 'piece'),     -- Cup
('MENU003', 3, 1, 'piece'),     -- Sedotan
('MENU003', 5, 20, 'gram'),     -- Creamer 20gr
('MENU003', 4, 17, 'gram'),     -- Kopi robusta 17gr
('MENU003', 24, 30, 'milliliter'), -- Gula aren cair 30ml
('MENU003', 7, 120, 'milliliter'), -- Susu cair 120ml
('MENU003', 35, 80, 'gram');    -- Es batu 80gr

-- 4) Hot Cappucino (MENU004)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU004', 1, 1, 'piece'),     -- Cup (default untuk semua menu)
('MENU004', 5, 20, 'gram'),     -- Creamer 20gr
('MENU004', 4, 17, 'gram'),     -- Kopi robusta 17gr
('MENU004', 7, 200, 'milliliter'); -- Susu cair 200ml

-- 5) vietnam drive (MENU005)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU005', 1, 1, 'piece'),     -- Cup
('MENU005', 3, 1, 'piece'),     -- Sedotan
('MENU005', 4, 18, 'gram'),     -- Kopi robusta 18gr
('MENU005', 7, 120, 'milliliter'); -- Susu cair 120ml

-- 6) squash/soda gembira (MENU006) - Rasa 20-30ml akan ditambah dinamis
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU006', 1, 1, 'piece'),     -- Cup
('MENU006', 3, 1, 'piece'),     -- Sedotan
('MENU006', 36, 100, 'milliliter'), -- Sprite 100ml
('MENU006', 37, 5, 'gram'),     -- Biji selasih 5gr
('MENU006', 35, 80, 'gram');    -- Ice 80gr

-- 7) milk shake (MENU007) - Rasa all varian 30gr akan ditambah dinamis
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU007', 1, 1, 'piece'),     -- Cup
('MENU007', 3, 1, 'piece'),     -- Sedotan
('MENU007', 7, 120, 'milliliter'); -- Susu 120ml

-- 8) esteh (MENU008)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU008', 1, 1, 'piece'),     -- Cup
('MENU008', 3, 1, 'piece'),     -- Sedotan
('MENU008', 33, 1, 'piece'),    -- Kantung teh 1 pc
('MENU008', 23, 30, 'milliliter'), -- Gula Pasir Cair 30ml
('MENU008', 35, 80, 'gram');    -- Ice 80gr

-- 9) americano (MENU009)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU009', 1, 1, 'piece'),     -- Cup (default untuk semua menu)
('MENU009', 4, 40, 'gram'),     -- Kopi robusta 40gr
('MENU009', 23, 30, 'milliliter'); -- Gula Pasir Cair 30ml

-- 10) expreso single (MENU010)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU010', 1, 1, 'piece'),     -- Cup (default untuk semua menu)
('MENU010', 4, 11, 'gram');     -- Kopi robusta 10-12gr (rata2: 11gr)

-- 11) expreso double (MENU011)
INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity, unit) VALUES
('MENU011', 1, 1, 'piece'),     -- Cup (default untuk semua menu)
('MENU011', 4, 22, 'gram');     -- Kopi robusta 20-24gr (rata2: 22gr)

-- Set sequence recipe_ingredients ke max id
SELECT setval(pg_get_serial_sequence('recipe_ingredients','id'), (SELECT MAX(id) FROM recipe_ingredients));

SELECT 'Seeder menu recipes & synced_inventory selesai.' AS status;
