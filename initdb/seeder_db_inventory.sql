-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIME ZONE 'Asia/Jakarta';

-- Membuat ekstensi vector jika belum ada
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
    -- Buat enum stockcategory jika belum ada
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stockcategory') THEN
        CREATE TYPE stockcategory AS ENUM ('ingredient', 'packaging');
    END IF;
    
    -- Buat enum unittype jika belum ada
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unittype') THEN
        CREATE TYPE unittype AS ENUM ('gram', 'milliliter', 'piece');
    END IF;
    
    -- stockcategory: Ingredient -> ingredient
    IF EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
         WHERE t.typname='stockcategory' AND e.enumlabel='Ingredient'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
         WHERE t.typname='stockcategory' AND e.enumlabel='ingredient'
    ) THEN
        ALTER TYPE stockcategory RENAME VALUE 'Ingredient' TO 'ingredient';
    END IF;

    -- stockcategory: Packaging -> packaging
    IF EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
         WHERE t.typname='stockcategory' AND e.enumlabel='Packaging'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
         WHERE t.typname='stockcategory' AND e.enumlabel='packaging'
    ) THEN
        ALTER TYPE stockcategory RENAME VALUE 'Packaging' TO 'packaging';
    END IF;

    -- unittype: Gram -> gram
    IF EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
         WHERE t.typname='unittype' AND e.enumlabel='Gram'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
         WHERE t.typname='unittype' AND e.enumlabel='gram'
    ) THEN
        ALTER TYPE unittype RENAME VALUE 'Gram' TO 'gram';
    END IF;

    -- unittype: Milliliter -> milliliter
    IF EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
         WHERE t.typname='unittype' AND e.enumlabel='Milliliter'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
         WHERE t.typname='unittype' AND e.enumlabel='milliliter'
    ) THEN
        ALTER TYPE unittype RENAME VALUE 'Milliliter' TO 'milliliter';
    END IF;

    -- unittype: Piece -> piece
    IF EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
         WHERE t.typname='unittype' AND e.enumlabel='Piece'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
         WHERE t.typname='unittype' AND e.enumlabel='piece'
    ) THEN
        ALTER TYPE unittype RENAME VALUE 'Piece' TO 'piece';
    END IF;
END $$;

-- Tabel embeddings untuk AI/vector operations
CREATE TABLE IF NOT EXISTS embeddings (
    id SERIAL PRIMARY KEY,
    embedding vector,
    text text,
    created_at timestamptz DEFAULT now()
);

-- Tabel utama inventories
CREATE TABLE IF NOT EXISTS inventories (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    current_quantity FLOAT DEFAULT 0,
    minimum_quantity FLOAT DEFAULT 0,
    category stockcategory NOT NULL,
    unit unittype NOT NULL
);

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

-- Tabel consumption_log untuk tracking konsumsi stok
CREATE TABLE IF NOT EXISTS consumption_log (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR UNIQUE NOT NULL,
    per_menu_payload TEXT,
    per_ingredient_payload TEXT,
    consumed BOOLEAN DEFAULT FALSE,
    rolled_back BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT now()
);

-- Membuat index yang diperlukan
CREATE INDEX IF NOT EXISTS idx_inventories_name ON inventories(name);
CREATE INDEX IF NOT EXISTS idx_inventories_category ON inventories(category);
CREATE INDEX IF NOT EXISTS idx_inventories_unit ON inventories(unit);
CREATE INDEX IF NOT EXISTS idx_inventory_outbox_event_type ON inventory_outbox(event_type);
CREATE INDEX IF NOT EXISTS idx_consumption_log_order_id ON consumption_log(order_id);

-- Bersihkan tabel inventories bila diperlukan (hanya jika sudah ada data)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM inventories) THEN
        TRUNCATE TABLE inventories RESTART IDENTITY CASCADE;
        TRUNCATE TABLE inventory_outbox RESTART IDENTITY CASCADE;
        TRUNCATE TABLE consumption_log RESTART IDENTITY CASCADE;
    END IF;
END $$;

-- DATA INVENTORY BERDASARKAN SPREADSHEET TERBARU
INSERT INTO inventories (id, name, current_quantity, minimum_quantity, category, unit) 
VALUES
-- PACKAGING & PERLENGKAPAN
(1,  'Cup',                   700,   100,  'packaging'::stockcategory, 'piece'::unittype),
(2,  'Cup Hot',               550,   100,  'packaging'::stockcategory, 'piece'::unittype),
(3,  'Sedotan',               173,    50,  'packaging'::stockcategory, 'piece'::unittype),

-- BAHAN DASAR MINUMAN
(4,  'Kopi Robusta',         1800,   500,  'ingredient'::stockcategory, 'gram'::unittype),
(5,  'Creamer',              1200,   500,  'ingredient'::stockcategory, 'gram'::unittype),
(6,  'Susu Kental Manis',    1605,   540,  'ingredient'::stockcategory, 'milliliter'::unittype),
(7,  'Susu Diamond',         6000,  3000,  'ingredient'::stockcategory, 'milliliter'::unittype),

-- SYRUP & FLAVOR LIQUID
(8,  'Caramel',               435,   150,  'ingredient'::stockcategory, 'milliliter'::unittype),
(9,  'Peach',                 600,   150,  'ingredient'::stockcategory, 'milliliter'::unittype),
(10, 'Macadamia Nut',         460,   150,  'ingredient'::stockcategory, 'milliliter'::unittype),
(11, 'French Moca',           400,   150,  'ingredient'::stockcategory, 'milliliter'::unittype),
(12, 'Java Brown Sugar',      400,   150,  'ingredient'::stockcategory, 'milliliter'::unittype),
(13, 'Chocolate',             470,   150,  'ingredient'::stockcategory, 'milliliter'::unittype),
(14, 'Passion Fruit',         530,   150,  'ingredient'::stockcategory, 'milliliter'::unittype),
(15, 'Roasted Almond',        585,   150,  'ingredient'::stockcategory, 'milliliter'::unittype),
(16, 'Creme Brulee',          280,   150,  'ingredient'::stockcategory, 'milliliter'::unittype),
(17, 'Butter Scotch',         500,   150,  'ingredient'::stockcategory, 'milliliter'::unittype),

-- MARJAN SERIES
(18, 'Marjan Vanilla',        230,   100,  'ingredient'::stockcategory, 'milliliter'::unittype),
(19, 'Marjan Grenadine',      367,   100,  'ingredient'::stockcategory, 'milliliter'::unittype),
(20, 'Marjan Markisa',        294,   100,  'ingredient'::stockcategory, 'milliliter'::unittype),
(21, 'Marjan Melon',          215,   100,  'ingredient'::stockcategory, 'milliliter'::unittype),
(22, 'Marjan Nanas',          460,   100,  'ingredient'::stockcategory, 'milliliter'::unittype),

-- GULA & PEMANIS
(23, 'Gula Pasir Cair',       300,   200,  'ingredient'::stockcategory, 'milliliter'::unittype),
(24, 'Gula Aren Cair',        337,   200,  'ingredient'::stockcategory, 'milliliter'::unittype),

-- POWDER SERIES
(25, 'Powder Keju Vanilla',   197,   300,  'ingredient'::stockcategory, 'gram'::unittype),
(26, 'Powder Taro',           187,   300,  'ingredient'::stockcategory, 'gram'::unittype),
(27, 'Powder Banana',         377,   300,  'ingredient'::stockcategory, 'gram'::unittype),
(28, 'Powder Dark Chocolate', 882,   300,  'ingredient'::stockcategory, 'gram'::unittype),
(29, 'Powder Chocolate Hazelnut', 413, 300, 'ingredient'::stockcategory, 'gram'::unittype),
(30, 'Powder Chocolate Malt', 668,   300,  'ingredient'::stockcategory, 'gram'::unittype),
(31, 'Powder Blackcurrant',  1000,   300,  'ingredient'::stockcategory, 'gram'::unittype),

-- MINUMAN & BAHAN LAIN
(32, 'Sanquik Lemon',          50,   100,  'ingredient'::stockcategory, 'milliliter'::unittype),
(33, 'Teh Celup',              22,    10,  'ingredient'::stockcategory, 'piece'::unittype),
(34, 'Nescafe',                76,    20,  'ingredient'::stockcategory, 'gram'::unittype),

-- TAMBAHAN BAHAN YANG DIBUTUHKAN MENU
(35, 'Es Batu',             10000,  2500,  'ingredient'::stockcategory, 'gram'::unittype),
(36, 'Sprite',               5000,  1250,  'ingredient'::stockcategory, 'milliliter'::unittype),
(37, 'Biji Selasih',          100,    20,  'ingredient'::stockcategory, 'gram'::unittype);

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
    -- SYRUP & LIQUID FLAVORS
    ('Caramel', 8, 25, 'milliliter'),                    -- Caramel syrup
    ('Peach', 9, 25, 'milliliter'),                      -- Peach syrup  
    ('Macadamia Nut', 10, 25, 'milliliter'),             -- Macadamia Nut syrup
    ('French Moca', 11, 25, 'milliliter'),               -- French Moca syrup
    ('Java Brown Sugar', 12, 25, 'milliliter'),          -- Java Brown Sugar syrup
    ('Chocolate', 13, 25, 'milliliter'),                 -- Chocolate syrup
    ('Passion Fruit', 14, 25, 'milliliter'),             -- Passion Fruit syrup
    ('Roasted Almond', 15, 25, 'milliliter'),            -- Roasted Almond syrup
    ('Creme Brulee', 16, 25, 'milliliter'),              -- Creme Brulee syrup
    ('Butter Scotch', 17, 25, 'milliliter'),             -- Butter Scotch syrup
    
    -- MARJAN SERIES
    ('Marjan Vanilla', 18, 25, 'milliliter'),            -- Marjan Vanilla
    ('Marjan Grenadine', 19, 25, 'milliliter'),          -- Marjan Grenadine
    ('Marjan Markisa', 20, 25, 'milliliter'),            -- Marjan Markisa
    ('Marjan Melon', 21, 25, 'milliliter'),              -- Marjan Melon
    ('Marjan Nanas', 22, 25, 'milliliter'),              -- Marjan Nanas
    
    -- POWDER SERIES
    ('Keju Vanilla', 25, 30, 'gram'),                    -- Powder Keju Vanilla
    ('Taro', 26, 30, 'gram'),                            -- Powder Taro
    ('Banana', 27, 30, 'gram'),                          -- Powder Banana
    ('Dark Chocolate', 28, 30, 'gram'),                  -- Powder Dark Chocolate
    ('Chocolate Hazelnut', 29, 30, 'gram'),              -- Powder Chocolate Hazelnut
    ('Chocolate Malt', 30, 30, 'gram'),                  -- Powder Chocolate Malt
    ('Blackcurrant', 31, 30, 'gram'),                    -- Powder Blackcurrant
    
    -- SPECIAL FLAVORS
    ('Sanquik Lemon', 32, 25, 'milliliter')              -- Sanquik Lemon
ON CONFLICT (flavor_name) DO UPDATE SET
    ingredient_id = EXCLUDED.ingredient_id,
    quantity_per_serving = EXCLUDED.quantity_per_serving,
    unit = EXCLUDED.unit;

SELECT 'Seeder inventories dan flavor mapping selesai.' AS status;