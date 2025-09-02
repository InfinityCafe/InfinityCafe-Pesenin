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
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'kitchen_orders') THEN
        TRUNCATE TABLE kitchen_orders RESTART IDENTITY CASCADE;
    END IF;
END $$;

-- INSERT INTO kitchen_orders (order_id, queue_number, status, detail, customer_name, room_name, time_receive, time_making, time_deliver, time_done) VALUES
-- ('ORD-001', 1, 'done', E'1x Cafe Latte (Less sugar)\n1x Nasi Goreng Infinity (Pedas)', 'Fahri', 'VIP 1', NOW() - INTERVAL '3 hour', NOW() - INTERVAL '2 hour 50 minutes', NOW() - INTERVAL '2 hour 45 minutes', NOW() - INTERVAL '2 hour 40 minutes');

-- === Pesanan 2: Sedang Dibuat (Making) ===
INSERT INTO kitchen_orders (order_id, queue_number, status, detail, customer_name, room_name, time_receive, time_making) VALUES
('ORD-002', 2, 'making', E'2x Americano ()', 'Rina', 'Outdoor', NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '20 minutes');

-- === Pesanan 3: Baru Diterima (Receive) ===
-- DIPERBAIKI: Menambahkan kolom `queue_number` dengan nilai 3

INSERT INTO kitchen_orders (order_id, queue_number, status, detail, customer_name, room_name, time_receive) VALUES
('ORD-003', 3, 'receive', E'1x Mie Goreng Spesial (Tidak pakai sayur)\n1x Kentang Goreng (Extra saus)', 'Joko', 'Regular', NOW() - INTERVAL '5 minutes');

-- === Pesanan 4: Dibatalkan (Cancelled) ===
-- DIPERBAIKI: Menambahkan kolom `queue_number` dengan nilai 4

INSERT INTO kitchen_orders (order_id, queue_number, status, detail, customer_name, room_name, time_receive, cancel_reason) VALUES
('ORD-004', 4, 'cancelled', E'2x Teh Manis (Hangat)', 'Sari', 'Outdoor', NOW() - INTERVAL '1 day', 'Stok bahan baku habis');