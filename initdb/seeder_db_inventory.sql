-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIME ZONE 'Asia/Jakarta';

-- ===================================================================
-- NORMALISASI ENUM (menyamakan nilai enum ke lowercase yang dipakai di kode)
-- Jika sebelumnya enum berisi 'Ingredient' / 'Packaging' / 'Gram' / 'Milliliter' / 'Piece'
-- akan di-rename menjadi 'ingredient' / 'packaging' / 'gram' / 'milliliter' / 'piece'.
-- (Butuh PostgreSQL >= 10 untuk ALTER TYPE ... RENAME VALUE)
-- ===================================================================
DO $$
BEGIN
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

CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS embeddings (
    id SERIAL PRIMARY KEY,
    embedding vector,
    text text,
    created_at timestamptz DEFAULT now()
);

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

-- Bersihkan tabel inventories bila diperlukan
TRUNCATE TABLE inventories RESTART IDENTITY CASCADE;

-- Gunakan ID eksplisit agar sinkron dengan menu_service.synced_inventory
-- BAHAN DASAR MINUMAN (stok diperbanyak)
INSERT INTO inventories (id, name, current_quantity, minimum_quantity, category, unit) VALUES
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

-- PACKAGING & PERLENGKAPAN (stok diperbanyak)
INSERT INTO inventories (id, name, current_quantity, minimum_quantity, category, unit) VALUES
(16, 'Cup Plastik',           5000,   500, 'packaging', 'piece'),
(17, 'Cup Kertas',            7000,   700, 'packaging', 'piece'),
(18, 'Sedotan',               5000,   500, 'packaging', 'piece');

-- Pastikan sequence lanjut setelah ID max
SELECT setval(pg_get_serial_sequence('inventories','id'), (SELECT MAX(id) FROM inventories));

-- Verifikasi cepat
-- SELECT id,name,current_quantity,minimum_quantity,category,unit FROM inventories ORDER BY id;

-- Selesai
SELECT 'Seeder inventories selesai.' AS status;