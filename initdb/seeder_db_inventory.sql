-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIME ZONE 'Asia/Jakarta';

-- Membuat ekstensi vector jika belum ada
CREATE EXTENSION IF NOT EXISTS vector;

-- ===================================================================
-- MEMBUAT ENUM TYPES UNTUK INVENTORY
-- ===================================================================
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
    
    -- Normalisasi enum yang sudah ada (jika diperlukan)
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
-- ===================================================================
-- MEMBUAT TABEL YANG DIBUTUHKAN JIKA BELUM ADA
-- ===================================================================

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

-- ===================================================================
-- SEEDER INVENTORY (Bahan & Packaging) sesuai daftar kebutuhan resep
-- Catatan:
--   - category: 'ingredient' atau 'packaging'
--   - unit mengikuti enum di service: gram | milliliter | piece
--   - minimum_quantity diset konservatif (20% dari stok atau default)
--   - Beberapa variasi rasa disatukan dalam 'Flavor Syrup Generic' untuk baseline
--     karena sistem resep saat ini tidak membedakan per varian rasa di tabel resep.
--     Jika ingin tracking per rasa, pindahkan masing-masing flavor ke resep & order.
-- ===================================================================

-- Bersihkan tabel inventories bila diperlukan (hanya jika sudah ada data)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM inventories) THEN
        TRUNCATE TABLE inventories RESTART IDENTITY CASCADE;
        TRUNCATE TABLE inventory_outbox RESTART IDENTITY CASCADE;
        TRUNCATE TABLE consumption_log RESTART IDENTITY CASCADE;
    END IF;
END $$;

-- Gunakan ID eksplisit agar sinkron dengan menu_service.synced_inventory
-- BAHAN DASAR MINUMAN (stok diperbanyak)
INSERT INTO inventories (id, name, current_quantity, minimum_quantity, category, unit) 
VALUES
(1,  'Creamer',               500,   500,  'ingredient'::stockcategory, 'gram'::unittype),
(2,  'Kopi Robusta',         2000,  2000,  'ingredient'::stockcategory, 'gram'::unittype),
(3,  'Susu Cair',            5000,  5000,  'ingredient'::stockcategory, 'milliliter'::unittype),
(4,  'SKM',                  1000,  1000,  'ingredient'::stockcategory, 'milliliter'::unittype),
(5,  'Gula Aren Cair',       1000,  1000,  'ingredient'::stockcategory, 'milliliter'::unittype),
(6,  'Gula Pasir',           1500,  1500,  'ingredient'::stockcategory, 'gram'::unittype),
(7,  'Ice Batu',             5000,  5000,  'ingredient'::stockcategory, 'gram'::unittype),
(8,  'Biji Selasih',          100,   100,  'ingredient'::stockcategory, 'gram'::unittype),
(9,  'Soda',                 1000,  1000,  'ingredient'::stockcategory, 'milliliter'::unittype),
(10, 'Teh Celup',              50,    50,  'ingredient'::stockcategory, 'piece'::unittype),
(11, 'Kopi Nescafe',            10,     10,  'ingredient'::stockcategory, 'piece'::unittype),
(12, 'Butterscout',            356,   356,  'ingredient'::stockcategory, 'milliliter'::unittype),
(13, 'French Mocca',           560,   560,  'ingredient'::stockcategory, 'milliliter'::unittype),
(14, 'Rosted Almond',          231,   231,  'ingredient'::stockcategory, 'milliliter'::unittype),
(15, 'Creme Brulee',           358,   358,  'ingredient'::stockcategory, 'milliliter'::unittype),
(16, 'Irish',                  500,   500,  'ingredient'::stockcategory, 'milliliter'::unittype),
(17, 'Havana',                  82,    82,  'ingredient'::stockcategory, 'milliliter'::unittype),
(18, 'Salted Caramel',         600,   600,  'ingredient'::stockcategory, 'milliliter'::unittype),
(19, 'Mangga',                 183,   183,  'ingredient'::stockcategory, 'gram'::unittype),
(20, 'Permenkaret',            398,   398,  'ingredient'::stockcategory, 'gram'::unittype),
(21, 'Tiramisu',               484,   484,  'ingredient'::stockcategory, 'gram'::unittype),
(22, 'Redvelvet',              863,   863,  'ingredient'::stockcategory, 'gram'::unittype),
(23, 'Strawberry',             600,   600,  'ingredient'::stockcategory, 'gram'::unittype),
(24, 'Vanilla',                318,   318,  'ingredient'::stockcategory, 'gram'::unittype);

-- PACKAGING & PERLENGKAPAN (stok diperbanyak)
INSERT INTO inventories (id, name, current_quantity, minimum_quantity, category, unit) 
VALUES
(25, 'Cup Plastik',           500,   500, 'packaging'::stockcategory, 'piece'::unittype),
(26, 'Cup Kertas',            700,   700, 'packaging'::stockcategory, 'piece'::unittype),
(27, 'Sedotan',               500,   500, 'packaging'::stockcategory, 'piece'::unittype);

-- Pastikan sequence lanjut setelah ID max
SELECT setval(pg_get_serial_sequence('inventories','id'), (SELECT MAX(id) FROM inventories));

-- Verifikasi cepat
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
    -- Map existing inventory ingredients to flavors
    ('Irish', 16, 25, 'milliliter'),              -- Irish syrup
    ('Havana', 17, 25, 'milliliter'),             -- Havana syrup
    ('Salted Caramel', 18, 30, 'milliliter'),     -- Salted Caramel syrup
    ('Mangga', 19, 30, 'gram'),                   -- Mango powder
    ('Permenkaret', 20, 30, 'gram'),              -- Bubble gum powder
    ('Tiramisu', 21, 30, 'gram'),                 -- Tiramisu powder
    ('Redvelvet', 22, 30, 'gram'),                -- Red velvet powder
    ('Strawberry', 23, 30, 'gram'),               -- Strawberry powder
    ('Vanilla', 24, 30, 'gram'),                  -- Vanilla powder
    ('Butterscotch', 12, 25, 'milliliter'),       -- Butterscotch syrup
    ('French Mocca', 13, 25, 'milliliter'),       -- French Mocca syrup
    ('Roasted Almond', 14, 25, 'milliliter'),     -- Roasted Almond syrup
    ('Creme Brulee', 15, 25, 'milliliter')
ON CONFLICT (flavor_name) DO UPDATE SET
    ingredient_id = EXCLUDED.ingredient_id,
    quantity_per_serving = EXCLUDED.quantity_per_serving,
    unit = EXCLUDED.unit;

SELECT 'Seeder inventories dan flavor mapping selesai.' AS status;