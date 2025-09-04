-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIME ZONE 'Asia/Jakarta';

CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS embeddings (
    id SERIAL PRIMARY KEY,
    embedding vector,
    text text,
    created_at timestamptz DEFAULT now()
);

-- Membersihkan data lama sebelum insert (jika tabel sudah ada)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'order_items') THEN
        TRUNCATE TABLE order_items CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
        TRUNCATE TABLE orders RESTART IDENTITY CASCADE;
    END IF;
END $$;

-- === Pesanan 1: Selesai (Done) ===
INSERT INTO orders (order_id, queue_number, customer_name, room_name, status, created_at, is_custom) VALUES
('ORD-001', 1, 'Fahri', 'VIP 1', 'done', NOW() - INTERVAL '3 hour', false);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes) VALUES
('ORD-001', '1414144124', 'Caffe Latte', 1, 'Caramel', NULL),
('ORD-001', '1414141412', 'Americano', 1, NULL, 'Less Ice');

-- === Pesanan 2: Sedang Dibuat (Making) ===
INSERT INTO orders (order_id, queue_number, customer_name, room_name, status, created_at, is_custom) VALUES
('ORD-002', 2, 'Rina', 'Outdoor', 'making', NOW() - INTERVAL '25 minutes', false);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes) VALUES
('ORD-002', '1414141413', 'Americano', 2, NULL, 'Satu pakai es, satu lagi panas');

-- === Pesanan 3: Baru Diterima (Receive) ===
INSERT INTO orders (order_id, queue_number, customer_name, room_name, status, created_at, is_custom) VALUES
('ORD-003', 3, 'Joko', 'Regular', 'receive', NOW() - INTERVAL '5 minutes', false);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes) VALUES
('ORD-003', '1414141414', 'Milkshake', 1, 'Banana', 'Less Sugar'),
('ORD-003', '1414141415', 'Squash', 1, 'Strawberry', NULL);

-- === Pesanan 4: Dibatalkan (Cancelled) ===
INSERT INTO orders (order_id, queue_number, customer_name, room_name, status, created_at, cancel_reason, is_custom) VALUES
('ORD-004', 4, 'Sari', 'Outdoor', 'cancelled', NOW() - INTERVAL '1 day', 'Stok bahan baku habis', false);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes) VALUES
('ORD-004', '1414141416', 'Espresso', 2, NULL, NULL);

-- === Pesanan 5: Pesanan Custom Baru (Receive) ===
INSERT INTO orders (order_id, queue_number, customer_name , room_name, status, created_at, is_custom) VALUES
('ORD-CUS-005', 5, 'Budi', 'Indoor', 'receive', NOW() - INTERVAL '2 minutes', true);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes) VALUES
('ORD-CUS-005', '1414141417', 'Indomie Goreng Carbonara', 1, 'Pedas', 'Telurnya setengah matang'),
('ORD-CUS-005', '1414141418', 'Es Teh Leci Yakult', 1, 'Normal', 'Es batunya sedikit saja');