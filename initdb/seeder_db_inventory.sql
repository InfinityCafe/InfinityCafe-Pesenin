-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIME ZONE 'Asia/Jakarta';

-- Membuat ekstensi vector jika belum ada
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
    -- Buat enum stockcategory jika belum ada
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stockcategory') THEN
        CREATE TYPE stockcategory AS ENUM ('packaging', 'ingredients', 'coffee_flavors', 'squash_flavors', 'milk_shake_flavors');
    ELSE
        -- Drop dan recreate enum dengan kategori baru
        DROP TYPE IF EXISTS stockcategory CASCADE;
        CREATE TYPE stockcategory AS ENUM ('packaging', 'ingredients', 'coffee_flavors', 'squash_flavors', 'milk_shake_flavors');
    END IF;
    
    -- Buat enum unittype jika belum ada
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unittype') THEN
        CREATE TYPE unittype AS ENUM ('gram', 'milliliter', 'piece');
    END IF;
END $$;

-- Tabel embeddings untuk AI/vector operations
CREATE TABLE IF NOT EXISTS embeddings (
    id SERIAL PRIMARY KEY,
    embedding vector,
    text text,
    created_at timestamptz DEFAULT now()
);

-- Drop dan recreate tabel inventories untuk memastikan schema terbaru
DROP TABLE IF EXISTS inventories CASCADE;
CREATE TABLE inventories (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    current_quantity FLOAT DEFAULT 0,
    minimum_quantity FLOAT DEFAULT 0,
    category stockcategory NOT NULL,
    unit unittype NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE
);

-- Buat index untuk performa query is_available
CREATE INDEX idx_inventories_is_available ON inventories(is_available);

-- Tabel inventory_outbox untuk event sourcing
CREATE TABLE IF NOT EXISTS inventory_outbox (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR NOT NULL,
    payload TEXT NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    error_message TEXT
);

-- 1. Tabel utama untuk consumption logs (dengan informasi menu)
CREATE TABLE IF NOT EXISTS consumption_logs (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR UNIQUE NOT NULL,
    menu_names TEXT NOT NULL, -- JSON array atau comma-separated menu names
    menu_summary TEXT, -- Summary info untuk display (e.g., "2x Cappuccino, 1x Latte")
    total_menu_items INTEGER DEFAULT 0,
    total_ingredients_affected INTEGER DEFAULT 0,
    status VARCHAR CHECK (status IN ('pending', 'consumed', 'rolled_back')) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT now(),
    consumed_at TIMESTAMP NULL,
    rolled_back_at TIMESTAMP NULL,
    notes TEXT NULL
);

-- 2. Tabel untuk detail konsumsi per ingredient
CREATE TABLE IF NOT EXISTS consumption_ingredient_details (
    id SERIAL PRIMARY KEY,
    consumption_log_id INTEGER NOT NULL REFERENCES consumption_logs(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES inventories(id),
    ingredient_name VARCHAR NOT NULL, -- denormalized untuk historical record
    quantity_consumed DECIMAL(10,3) NOT NULL,
    unit VARCHAR NOT NULL,
    stock_before DECIMAL(10,3) NOT NULL,
    stock_after DECIMAL(10,3) NOT NULL,
    created_at TIMESTAMP DEFAULT now()
);

-- Membuat index yang diperlukan untuk tabel yang sudah ada
CREATE INDEX IF NOT EXISTS idx_inventories_name ON inventories(name);
CREATE INDEX IF NOT EXISTS idx_inventories_category ON inventories(category);
CREATE INDEX IF NOT EXISTS idx_inventories_unit ON inventories(unit);
CREATE INDEX IF NOT EXISTS idx_inventory_outbox_event_type ON inventory_outbox(event_type);

-- Index untuk tabel simplified normalized consumption (2 tables only)
CREATE INDEX IF NOT EXISTS idx_consumption_logs_order_id ON consumption_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_consumption_logs_status ON consumption_logs(status);
CREATE INDEX IF NOT EXISTS idx_consumption_logs_created_at ON consumption_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_consumption_ingredient_details_log_id ON consumption_ingredient_details(consumption_log_id);
CREATE INDEX IF NOT EXISTS idx_consumption_ingredient_details_ingredient_id ON consumption_ingredient_details(ingredient_id);

-- Bersihkan tabel inventories bila diperlukan (hanya jika sudah ada data)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM inventories) THEN
        TRUNCATE TABLE inventories RESTART IDENTITY CASCADE;
        TRUNCATE TABLE inventory_outbox RESTART IDENTITY CASCADE;
        TRUNCATE TABLE consumption_logs RESTART IDENTITY CASCADE;
        TRUNCATE TABLE consumption_ingredient_details RESTART IDENTITY CASCADE;
    END IF;
END $$;

-- DATA INVENTORY BERDASARKAN KATEGORI DETAIL YANG DIMINTA
INSERT INTO inventories (id, name, current_quantity, minimum_quantity, category, unit) 
VALUES
-- 1. PACKAGING
(1,  'Cup',                   700,   100,  'packaging'::stockcategory, 'piece'::unittype),
(2,  'Cup Hot',               550,   100,  'packaging'::stockcategory, 'piece'::unittype),
(3,  'Sedotan',               173,    50,  'packaging'::stockcategory, 'piece'::unittype),

-- 2. INGREDIENTS (Bahan Dasar)
(4,  'Kopi Robusta',         1800,   500,  'ingredients'::stockcategory, 'gram'::unittype),
(5,  'Creamer',              1200,   500,  'ingredients'::stockcategory, 'gram'::unittype),
(6,  'Susu Kental Manis',    1605,   540,  'ingredients'::stockcategory, 'milliliter'::unittype),
(7,  'Susu Diamond',         6000,  3000,  'ingredients'::stockcategory, 'milliliter'::unittype),
(36, 'Sprite',               5000,  1250,  'ingredients'::stockcategory, 'milliliter'::unittype),
(35, 'Es Batu',             10000,  2500,  'ingredients'::stockcategory, 'gram'::unittype),
(37, 'Biji Selasih',          100,    20,  'ingredients'::stockcategory, 'gram'::unittype),
(34, 'Nescafe',                76,    20,  'ingredients'::stockcategory, 'gram'::unittype),
(33, 'Teh Celup',              22,    10,  'ingredients'::stockcategory, 'piece'::unittype),
(32, 'Sanquik Lemon',          50,   100,  'ingredients'::stockcategory, 'milliliter'::unittype),
(23, 'Gula Pasir Cair',       300,   200,  'ingredients'::stockcategory, 'milliliter'::unittype),
(24, 'Gula Aren Cair',        337,   200,  'ingredients'::stockcategory, 'milliliter'::unittype),

-- 3. COFFEE FLAVORS
(8,  'Caramel',               435,   150,  'coffee_flavors'::stockcategory, 'milliliter'::unittype),
(9,  'Peach',                 600,   150,  'coffee_flavors'::stockcategory, 'milliliter'::unittype),
(10, 'Macadamia Nut',         460,   150,  'coffee_flavors'::stockcategory, 'milliliter'::unittype),
(11, 'French Moca',           400,   150,  'coffee_flavors'::stockcategory, 'milliliter'::unittype),
(12, 'Java Brown Sugar',      400,   150,  'coffee_flavors'::stockcategory, 'milliliter'::unittype),
(13, 'Chocolate',             470,   150,  'coffee_flavors'::stockcategory, 'milliliter'::unittype),
(15, 'Roasted Almond',        585,   150,  'coffee_flavors'::stockcategory, 'milliliter'::unittype),
(16, 'Creme Brulee',          280,   150,  'coffee_flavors'::stockcategory, 'milliliter'::unittype),
(17, 'Butter Scotch',         500,   150,  'coffee_flavors'::stockcategory, 'milliliter'::unittype),

-- 4. SQUASH FLAVORS
(14, 'Passion Fruit',         530,   150,  'squash_flavors'::stockcategory, 'milliliter'::unittype),
(18, 'Marjan Vanilla',        230,   100,  'squash_flavors'::stockcategory, 'milliliter'::unittype),
(19, 'Marjan Grenadine',      367,   100,  'squash_flavors'::stockcategory, 'milliliter'::unittype),
(20, 'Marjan Markisa',        294,   100,  'squash_flavors'::stockcategory, 'milliliter'::unittype),
(21, 'Marjan Melon',          215,   100,  'squash_flavors'::stockcategory, 'milliliter'::unittype),
(22, 'Marjan Nanas',          460,   100,  'squash_flavors'::stockcategory, 'milliliter'::unittype),

-- 5. MILK SHAKE FLAVORS
(25, 'Powder Keju Vanilla',   197,   300,  'milk_shake_flavors'::stockcategory, 'gram'::unittype),
(26, 'Powder Taro',           187,   300,  'milk_shake_flavors'::stockcategory, 'gram'::unittype),
(27, 'Powder Banana',         377,   300,  'milk_shake_flavors'::stockcategory, 'gram'::unittype),
(28, 'Powder Dark Chocolate', 882,   300,  'milk_shake_flavors'::stockcategory, 'gram'::unittype),
(29, 'Powder Chocolate Hazelnut', 413, 300, 'milk_shake_flavors'::stockcategory, 'gram'::unittype),
(30, 'Powder Chocolate Malt', 668,   300,  'milk_shake_flavors'::stockcategory, 'gram'::unittype),
(31, 'Powder Blackcurrant',  1000,   300,  'milk_shake_flavors'::stockcategory, 'gram'::unittype);

-- Pastikan sequence lanjut setelah ID max
SELECT setval(pg_get_serial_sequence('inventories','id'), (SELECT MAX(id) FROM inventories));

-- SELECT id,name,current_quantity,minimum_quantity,category,unit FROM inventories ORDER BY id;
CREATE TABLE IF NOT EXISTS flavor_mapping (
    id SERIAL PRIMARY KEY,
    flavor_name VARCHAR UNIQUE NOT NULL,
    ingredient_id INTEGER NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
    quantity_per_serving FLOAT NOT NULL DEFAULT 25,
    unit unittype NOT NULL DEFAULT 'milliliter',
    created_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')
);

-- Index untuk performa
CREATE INDEX IF NOT EXISTS idx_flavor_mapping_flavor_name ON flavor_mapping(flavor_name);
CREATE INDEX IF NOT EXISTS idx_flavor_mapping_ingredient_id ON flavor_mapping(ingredient_id);

INSERT INTO flavor_mapping (flavor_name, ingredient_id, quantity_per_serving, unit) VALUES 
    -- SYRUP & LIQUID FLAVORS (English + Indonesian names)
    ('Caramel', 8, 25, 'milliliter'),                    -- Caramel syrup
    ('Karamel', 8, 25, 'milliliter'),                    -- Caramel syrup
    ('Peach', 9, 25, 'milliliter'),                      -- Peach syrup  
    ('Persik', 9, 25, 'milliliter'),                     -- Peach syrup
    ('Macadamia Nut', 10, 25, 'milliliter'),             -- Macadamia Nut syrup
    ('Kacang Makadamia', 10, 25, 'milliliter'),          -- Macadamia Nut syrup
    ('French Moca', 11, 25, 'milliliter'),               -- French Moca syrup
    ('Moka Prancis', 11, 25, 'milliliter'),              -- French Moca syrup
    ('Java Brown Sugar', 12, 25, 'milliliter'),          -- Java Brown Sugar syrup
    ('Gula Merah Jawa', 12, 25, 'milliliter'),           -- Java Brown Sugar syrup
    ('Chocolate', 13, 25, 'milliliter'),                 -- Chocolate syrup
    ('Coklat', 13, 25, 'milliliter'),                    -- Chocolate syrup 
    ('Passion Fruit', 14, 25, 'milliliter'),             -- Passion Fruit syrup
    ('Markisa', 14, 25, 'milliliter'),                   -- Passion Fruit syrup
    ('Roasted Almond', 15, 25, 'milliliter'),            -- Roasted Almond syrup
    ('Almond Panggang', 15, 25, 'milliliter'),           -- Roasted Almond syrup
    ('Creme Brulee', 16, 25, 'milliliter'),              -- Creme Brulee syrup
    ('Krim Brulee', 16, 25, 'milliliter'),               -- Creme Brulee syrup
    ('Butterscotch', 17, 25, 'milliliter'),              -- Butterscotch syrup
    ('Butter Scotch', 17, 25, 'milliliter'),             -- Butterscotch syrup
    
    -- MARJAN SERIES
    ('Marjan Vanilla', 18, 25, 'milliliter'),            -- Marjan Vanilla
    ('Vanilla', 18, 25, 'milliliter'),                   -- Vanilla
    ('Vanila', 18, 25, 'milliliter'),                    -- Vanilla
    ('Marjan Grenadine', 19, 25, 'milliliter'),          -- Marjan Grenadine
    ('Grenadine', 19, 25, 'milliliter'),                 -- Grenadine
    ('Marjan Markisa', 20, 25, 'milliliter'),            -- Marjan Markisa
    ('Marjan Melon', 21, 25, 'milliliter'),              -- Marjan Melon
    ('Melon', 21, 25, 'milliliter'),                     -- Melon
    ('Marjan Nanas', 22, 25, 'milliliter'),              -- Marjan Nanas
    ('Pineapple', 22, 25, 'milliliter'),                 -- Pineapple
    ('Nanas', 22, 25, 'milliliter'),                     -- Nanas

    -- POWDER SERIES
    ('Keju Vanilla', 25, 30, 'gram'),                    -- Powder Keju Vanilla
    ('Vanilla Cheese', 25, 30, 'gram'),                  -- Vanilla Cheese
    ('Taro', 26, 30, 'gram'),                            -- Powder Taro
    ('Talas', 26, 30, 'gram'),                           -- Taro
    ('Banana', 27, 30, 'gram'),                          -- Powder Banana
    ('Pisang', 27, 30, 'gram'),                          -- Banana
    ('Dark Chocolate', 28, 30, 'gram'),                  -- Powder Dark Chocolate
    ('Coklat Hitam', 28, 30, 'gram'),                    -- Dark Chocolate
    ('Chocolate Hazelnut', 29, 30, 'gram'),              -- Powder Chocolate Hazelnut
    ('Coklat Hazelnut', 29, 30, 'gram'),                 -- Chocolate Hazelnut
    ('Chocolate Malt', 30, 30, 'gram'),                  -- Powder Chocolate Malt
    ('Coklat Malt', 30, 30, 'gram'),                     -- Chocolate Malt
    ('Blackcurrant', 31, 30, 'gram'),                    -- Powder Blackcurrant
    
    -- SPECIAL FLAVORS
    ('Sanquik Lemon', 32, 25, 'milliliter')              -- Sanquik Lemon
ON CONFLICT (flavor_name) DO UPDATE SET
    ingredient_id = EXCLUDED.ingredient_id,
    quantity_per_serving = EXCLUDED.quantity_per_serving,
    unit = EXCLUDED.unit;

SELECT 'Seeder inventories dan flavor mapping selesai.' AS status;