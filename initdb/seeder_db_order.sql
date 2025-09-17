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
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rooms') THEN
        TRUNCATE TABLE rooms RESTART IDENTITY CASCADE;
    END IF;
END $$;

-- === SEEDER DATA RUANGAN ===
-- Membuat tabel rooms jika belum ada
CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Insert data ruangan
INSERT INTO rooms (name, is_active, created_at) VALUES
('Gazebo', true, NOW()),
('Ruang Tamu', true, NOW()),
('Ruang Meeting', true, NOW()),
('Ruang Tengah', true, NOW()),
('Ruang Server', true, NOW()),
('Game Room', true, NOW()),
('Ruang Manajemen', true, NOW()),
('Teras', true, NOW()),
('Balkon', true, NOW()),
('Dapur', true, NOW());

-- === Pesanan 1: Selesai (Done) ===
INSERT INTO orders (order_id, queue_number, customer_name, room_name, status, created_at, is_custom) VALUES
('ORD-001', 1, 'Fahri', 'Ruang Meeting', 'done', NOW() - INTERVAL '3 hour', false);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes, status) VALUES
('ORD-001', '1414144124', 'Caffe Latte', 1, 'Caramel', NULL, 'active'),
('ORD-001', '1414141412', 'Americano', 1, NULL, 'Less Ice', 'active');

-- === Pesanan 2: Sedang Dibuat (Making) ===
INSERT INTO orders (order_id, queue_number, customer_name, room_name, status, created_at, is_custom) VALUES
('ORD-002', 2, 'Rina', 'Teras', 'making', NOW() - INTERVAL '25 minutes', false);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes, status) VALUES
('ORD-002', '1414141413', 'Americano', 2, NULL, 'Satu pakai es, satu lagi panas', 'active');

-- === Pesanan 3: Baru Diterima (Receive) ===
INSERT INTO orders (order_id, queue_number, customer_name, room_name, status, created_at, is_custom) VALUES
('ORD-003', 3, 'Joko', 'Gazebo', 'receive', NOW() - INTERVAL '5 minutes', false);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes, status) VALUES
('ORD-003', '1414141414', 'Milkshake', 1, 'Banana', 'Less Sugar', 'active'),
('ORD-003', '1414141415', 'Squash', 1, 'Strawberry', NULL, 'active');

-- === Pesanan 4: Dibatalkan (Cancelled) ===
INSERT INTO orders (order_id, queue_number, customer_name, room_name, status, created_at, cancel_reason, is_custom) VALUES
('ORD-004', 4, 'Sari', 'Balkon', 'cancelled', NOW() - INTERVAL '1 day', 'Stok bahan baku habis', false);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes, status, cancelled_reason, cancelled_at) VALUES
('ORD-004', '1414141416', 'Espresso', 2, NULL, NULL, 'cancelled', 'Stok bahan baku habis', NOW() - INTERVAL '1 day');

-- === Pesanan 5: Pesanan Custom Baru (Receive) ===
INSERT INTO orders (order_id, queue_number, customer_name , room_name, status, created_at, is_custom) VALUES
('ORD-CUS-005', 5, 'Budi', 'Game Room', 'receive', NOW() - INTERVAL '2 minutes', true);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes, status) VALUES
('ORD-CUS-005', '1414141417', 'Indomie Goreng Carbonara', 1, 'Pedas', 'Telurnya setengah matang', 'active'),
('ORD-CUS-005', '1414141418', 'Es Teh Leci Yakult', 1, 'Normal', 'Es batunya sedikit saja', 'active');

-- === Pesanan 6: Pesanan dengan Partial Cancellation ===
INSERT INTO orders (order_id, queue_number, customer_name, room_name, status, created_at, is_custom) VALUES
('ORD-006', 6, 'Lisa', 'Ruang Tamu', 'receive', NOW() - INTERVAL '1 minute', false);

INSERT INTO order_items (order_id, telegram_id, menu_name, quantity, preference, notes, status) VALUES
('ORD-006', '1414141419', 'Americano', 1, NULL, NULL, 'active'),
('ORD-006', '1414141420', 'Milkshake', 1, 'Chocolate', NULL, 'cancelled'),
('ORD-006', '1414141421', 'Cappuccino', 1, 'Vanilla', NULL, 'active');

-- Update item yang dibatalkan dengan alasan dan waktu
UPDATE order_items 
SET cancelled_reason = 'Stok chocolate habis', cancelled_at = NOW() - INTERVAL '30 seconds'
WHERE order_id = 'ORD-006' AND menu_name = 'Milkshake';