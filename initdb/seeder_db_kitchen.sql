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

INSERT INTO kitchen_orders (order_id, status, detail, customer_name, table_no, room_name, time_receive, time_making, time_deliver, time_done) VALUES
('ORD-001', 'done', E'1x Cafe Latte (Less sugar)\n1x Nasi Goreng Infinity (Pedas)', 'Fahri', 'T5', 'VIP 1', NOW() - INTERVAL '3 hour', NOW() - INTERVAL '2 hour 50 minutes', NOW() - INTERVAL '2 hour 45 minutes', NOW() - INTERVAL '2 hour 40 minutes');

-- === Pesanan 2: Sedang Dibuat (Making) ===
INSERT INTO kitchen_orders (order_id, status, detail, customer_name, table_no, room_name, time_receive, time_making) VALUES
('ORD-002', 'making', E'2x Americano ()', 'Rina', 'T2', 'Outdoor', NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '20 minutes');

-- === Pesanan 3: Baru Diterima (Receive) ===
-- DIPERBAIKI: Menambahkan kolom `queue_number` dengan nilai 3

INSERT INTO kitchen_orders (order_id, status, detail, customer_name, table_no, room_name, time_receive) VALUES
('ORD-003', 'receive', E'1x Mie Goreng Spesial (Tidak pakai sayur)\n1x Kentang Goreng (Extra saus)', 'Joko', 'T8', 'Regular', NOW() - INTERVAL '5 minutes');

-- === Pesanan 4: Dibatalkan (Cancelled) ===
-- DIPERBAIKI: Menambahkan kolom `queue_number` dengan nilai 4

INSERT INTO kitchen_orders (order_id, status, detail, customer_name, table_no, room_name, time_receive, cancel_reason) VALUES
('ORD-004', 'cancel', E'2x Teh Manis (Hangat)', 'Sari', 'T1', 'Outdoor', NOW() - INTERVAL '1 day', 'Stok bahan baku habis');