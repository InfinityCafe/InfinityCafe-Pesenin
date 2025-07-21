-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIME ZONE 'Asia/Jakarta';

CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS embeddings (
    id SERIAL PRIMARY KEY,
    embedding vector,
    text text,
    created_at timestamptz DEFAULT now()
);

-- Membersihkan data lama (opsional)
-- TRUNCATE TABLE menus, orders, order_items, kitchen_orders, menu_suggestions RESTART IDENTITY CASCADE;

-- === Tabel 'menus' ===
INSERT INTO menus (menu_id, menu_name, menu_price, "isAvail") VALUES
('MENU-001', 'Espresso', 18000, TRUE),
('MENU-002', 'Americano', 20000, TRUE),
('MENU-003', 'Cafe Latte', 25000, TRUE),
('MENU-004', 'Cappuccino', 25000, TRUE),
('MENU-005', 'Nasi Goreng Infinity', 35000, TRUE),
('MENU-006', 'Mie Goreng Spesial', 32000, TRUE),
('MENU-007', 'Kentang Goreng', 22000, TRUE),
('MENU-008', 'Teh Manis', 10000, FALSE);

-- === Tabel 'menu_suggestions' ===
INSERT INTO menu_suggestions (usulan_id, menu_name, customer_name, "timestamp") VALUES
('USL-001', 'Kopi Gula Aren', 'Budi', NOW() - INTERVAL '2 days'),
('USL-002', 'Croissant Coklat', 'Citra', NOW() - INTERVAL '1 day');
