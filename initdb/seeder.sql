-- Mengatur zona waktu sesi ke Asia/Jakarta
SET TIME ZONE 'Asia/Jakarta';

-- Membersihkan data lama (opsional)
TRUNCATE TABLE menus, orders, order_items, kitchen_orders, menu_suggestions RESTART IDENTITY CASCADE;

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

-- === Pesanan 1: Selesai (Done) ===
INSERT INTO orders (order_id, customer_name, table_no, room_name, status, created_at) VALUES
('ORD-001', 'Fahri', 'T5', 'VIP 1', 'done', NOW() - INTERVAL '3 hour');

INSERT INTO order_items (order_id, menu_name, quantity, preference) VALUES
('ORD-001', 'Cafe Latte', 1, 'Less sugar'),
('ORD-001', 'Nasi Goreng Infinity', 1, 'Pedas');

INSERT INTO kitchen_orders (order_id, status, detail, customer_name, table_no, room_name, time_receive, time_making, time_deliver, time_done) VALUES
('ORD-001', 'done', E'1x Cafe Latte (Less sugar)\n1x Nasi Goreng Infinity (Pedas)', 'Fahri', 'T5', 'VIP 1', NOW() - INTERVAL '3 hour', NOW() - INTERVAL '2 hour 50 minutes', NOW() - INTERVAL '2 hour 45 minutes', NOW() - INTERVAL '2 hour 40 minutes');

-- === Pesanan 2: Sedang Dibuat (Making) ===
INSERT INTO orders (order_id, customer_name, table_no, room_name, status, created_at) VALUES
('ORD-002', 'Rina', 'T2', 'Outdoor', 'making', NOW() - INTERVAL '25 minutes');

INSERT INTO order_items (order_id, menu_name, quantity, preference) VALUES
('ORD-002', 'Americano', 2, '');

INSERT INTO kitchen_orders (order_id, status, detail, customer_name, table_no, room_name, time_receive, time_making) VALUES
('ORD-002', 'making', E'2x Americano ()', 'Rina', 'T2', 'Outdoor', NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '20 minutes');

-- === Pesanan 3: Baru Diterima (Receive) ===
INSERT INTO orders (order_id, customer_name, table_no, room_name, status, created_at) VALUES
('ORD-003', 'Joko', 'T8', 'Regular', 'receive', NOW() - INTERVAL '5 minutes');

INSERT INTO order_items (order_id, menu_name, quantity, preference) VALUES
('ORD-003', 'Mie Goreng Spesial', 1, 'Tidak pakai sayur'),
('ORD-003', 'Kentang Goreng', 1, 'Extra saus');

INSERT INTO kitchen_orders (order_id, status, detail, customer_name, table_no, room_name, time_receive) VALUES
('ORD-003', 'receive', E'1x Mie Goreng Spesial (Tidak pakai sayur)\n1x Kentang Goreng (Extra saus)', 'Joko', 'T8', 'Regular', NOW() - INTERVAL '5 minutes');

-- === Pesanan 4: Dibatalkan (Cancelled) ===
INSERT INTO orders (order_id, customer_name, table_no, room_name, status, created_at, cancel_reason) VALUES
('ORD-004', 'Sari', 'T1', 'Outdoor', 'cancelled', NOW() - INTERVAL '1 day', 'Stok bahan baku habis');

INSERT INTO order_items (order_id, menu_name, quantity, preference) VALUES
('ORD-004', 'Teh Manis', 2, 'Hangat');

INSERT INTO kitchen_orders (order_id, status, detail, customer_name, table_no, room_name, time_receive, cancel_reason) VALUES
('ORD-004', 'cancel', E'2x Teh Manis (Hangat)', 'Sari', 'T1', 'Outdoor', NOW() - INTERVAL '1 day', 'Stok bahan baku habis');
