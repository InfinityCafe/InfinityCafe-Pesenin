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

-- === Pesanan 1: Selesai (Done) ===
-- DIPERBAIKI: Menambahkan kolom `queue_number` dengan nilai 1
INSERT INTO orders (order_id, queue_number, customer_name, table_no, room_name, status, created_at) VALUES
('ORD-001', 1, 'Fahri', 'T5', 'VIP 1', 'done', NOW() - INTERVAL '3 hour');

INSERT INTO order_items (order_id, menu_name, quantity, preference) VALUES
('ORD-001', 'Cafe Latte', 1, 'Less sugar'),
('ORD-001', 'Nasi Goreng Infinity', 1, 'Pedas');

-- === Pesanan 2: Sedang Dibuat (Making) ===
-- DIPERBAIKI: Menambahkan kolom `queue_number` dengan nilai 2
INSERT INTO orders (order_id, queue_number, customer_name, table_no, room_name, status, created_at) VALUES
('ORD-002', 2, 'Rina', 'T2', 'Outdoor', 'making', NOW() - INTERVAL '25 minutes');

INSERT INTO order_items (order_id, menu_name, quantity, preference) VALUES
('ORD-002', 'Americano', 2, '');

-- === Pesanan 3: Baru Diterima (Receive) ===
-- DIPERBAIKI: Menambahkan kolom `queue_number` dengan nilai 3
INSERT INTO orders (order_id, queue_number, customer_name, table_no, room_name, status, created_at) VALUES
('ORD-003', 3, 'Joko', 'T8', 'Regular', 'receive', NOW() - INTERVAL '5 minutes');

INSERT INTO order_items (order_id, menu_name, quantity, preference) VALUES
('ORD-003', 'Mie Goreng Spesial', 1, 'Tidak pakai sayur'),
('ORD-003', 'Kentang Goreng', 1, 'Extra saus');

-- === Pesanan 4: Dibatalkan (Cancelled) ===
-- DIPERBAIKI: Menambahkan kolom `queue_number` dengan nilai 4
INSERT INTO orders (order_id, queue_number, customer_name, table_no, room_name, status, created_at, cancel_reason) VALUES
('ORD-004', 4, 'Sari', 'T1', 'Outdoor', 'cancelled', NOW() - INTERVAL '1 day', 'Stok bahan baku habis');

INSERT INTO order_items (order_id, menu_name, quantity, preference) VALUES
('ORD-004', 'Teh Manis', 2, 'Hangat');
