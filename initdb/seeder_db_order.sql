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
INSERT INTO orders (order_id, queue_number, customer_name, table_no, room_name, status, created_at, is_custom) VALUES
('ORD-001', 1, 'Fahri', 'T5', 'VIP 1', 'done', NOW() - INTERVAL '3 hour', false);

INSERT INTO order_items (order_id, menu_name, quantity, preference, notes) VALUES
('ORD-001', 'Caffe Latte', 1, 'Iris', NULL),
('ORD-001', 'Americano', 1, NULL, 'Less Ice');

-- === Pesanan 2: Sedang Dibuat (Making) ===
INSERT INTO orders (order_id, queue_number, customer_name, table_no, room_name, status, created_at, is_custom) VALUES
('ORD-002', 2, 'Rina', 'T2', 'Outdoor', 'making', NOW() - INTERVAL '25 minutes', false);

INSERT INTO order_items (order_id, menu_name, quantity, preference, notes) VALUES
('ORD-002', 'Americano', 2, NULL, 'Satu pakai es, satu lagi panas');

-- === Pesanan 3: Baru Diterima (Receive) ===
INSERT INTO orders (order_id, queue_number, customer_name, table_no, room_name, status, created_at, is_custom) VALUES
('ORD-003', 3, 'Joko', 'T8', 'Regular', 'receive', NOW() - INTERVAL '5 minutes', false);

INSERT INTO order_items (order_id, menu_name, quantity, preference, notes) VALUES
('ORD-003', 'Milkshake', 1, 'Banana', 'Less Sugar'),
('ORD-003', 'Squash', 1, 'Stroberi', NULL);

-- === Pesanan 4: Dibatalkan (Cancelled) ===
INSERT INTO orders (order_id, queue_number, customer_name, table_no, room_name, status, created_at, cancel_reason, is_custom) VALUES
('ORD-004', 4, 'Sari', 'T1', 'Outdoor', 'cancelled', NOW() - INTERVAL '1 day', 'Stok bahan baku habis', false);

INSERT INTO order_items (order_id, menu_name, quantity, preference, notes) VALUES
('ORD-004', 'Espresso', 2, NULL, NULL);

-- === Pesanan 5: Pesanan Custom Baru (Receive) ===
INSERT INTO orders (order_id, queue_number, customer_name, table_no, room_name, status, created_at, is_custom) VALUES
('ORD-CUS-005', 5, 'Budi', 'T14', 'Indoor', 'receive', NOW() - INTERVAL '2 minutes', true);

INSERT INTO order_items (order_id, menu_name, quantity, preference, notes) VALUES
('ORD-CUS-005', 'Indomie Goreng Carbonara', 1, 'Pedas', 'Telurnya setengah matang'),
('ORD-CUS-005', 'Es Teh Leci Yakult', 1, 'Normal', 'Es batunya sedikit saja');