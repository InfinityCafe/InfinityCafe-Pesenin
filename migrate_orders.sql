-- Migrate orders with notes to kitchen_orders.orders_json
-- This script updates kitchen_orders table with JSON data from order_items

-- First, let's see what orders have notes
SELECT DISTINCT order_id 
FROM order_items 
WHERE notes IS NOT NULL AND notes != '';

-- Update kitchen_orders with orders_json for ORD20250725153115593321B4F4E6
UPDATE kitchen_orders 
SET orders_json = '[{"menu_name":"Caffe Latte","quantity":1,"preference":"Roasted Almond","notes":"Less Ice"}]'
WHERE order_id = 'ORD20250725153115593321B4F4E6';

-- Update kitchen_orders with orders_json for ORD2025072515313941185737F07F
UPDATE kitchen_orders 
SET orders_json = '[{"menu_name":"Cappuccino","quantity":1,"preference":"Salted Caramel","notes":"Less Ice"}]'
WHERE order_id = 'ORD2025072515313941185737F07F';

-- Update kitchen_orders with orders_json for ORD20250725153320268976615C8F (has 2 items)
UPDATE kitchen_orders 
SET orders_json = '[{"menu_name":"Caffe Latte","quantity":1,"preference":"Roasted Almond","notes":"sdf"},{"menu_name":"Cappuccino","quantity":1,"preference":"Roasted Almond","notes":"sdfsffd"}]'
WHERE order_id = 'ORD20250725153320268976615C8F';

-- Update kitchen_orders with orders_json for ORD2025072515383968754146ECBB
UPDATE kitchen_orders 
SET orders_json = '[{"menu_name":"Caffe Latte","quantity":2,"preference":"Macadamia Nut","notes":"Less Ice"}]'
WHERE order_id = 'ORD2025072515383968754146ECBB';

-- Verify the updates
SELECT order_id, detail, orders_json 
FROM kitchen_orders 
WHERE orders_json IS NOT NULL; 