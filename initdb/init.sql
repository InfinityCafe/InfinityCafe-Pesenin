CREATE EXTENSION IF NOT EXISTS vector;

-- Embeddings table for vector operations with EXPLICIT DIMENSIONS
CREATE TABLE IF NOT EXISTS embeddings (
  id SERIAL PRIMARY KEY,
  embedding vector(1536),  -- ✅ OpenAI ada-002 embedding dimension
  text text,
  created_at timestamptz DEFAULT now()
);

-- Menu table
CREATE TABLE IF NOT EXISTS menus (
    menu_id VARCHAR PRIMARY KEY,
    menu_name VARCHAR NOT NULL,
    menu_price INTEGER NOT NULL,
    menu_category VARCHAR DEFAULT 'Makanan',
    menu_description TEXT,
    "isAvail" BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Menu suggestions table
CREATE TABLE IF NOT EXISTS menu_suggestions (
    usulan_id VARCHAR PRIMARY KEY,
    menu_name VARCHAR NOT NULL,
    customer_name VARCHAR,
    description TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    order_id VARCHAR PRIMARY KEY,
    customer_name VARCHAR,
    table_no VARCHAR,
    room_name VARCHAR,
    status VARCHAR DEFAULT 'receive',
    total_amount INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    cancel_reason TEXT
);

-- Order items table
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR REFERENCES orders(order_id) ON DELETE CASCADE,
    menu_name VARCHAR NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price INTEGER,
    preference TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Kitchen orders table - CRITICAL for kitchen service
CREATE TABLE IF NOT EXISTS kitchen_orders (
    order_id VARCHAR PRIMARY KEY,
    status VARCHAR DEFAULT 'receive',
    detail TEXT,
    customer_name VARCHAR,
    table_no VARCHAR,
    room_name VARCHAR,
    time_receive TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    time_making TIMESTAMP WITH TIME ZONE,
    time_deliver TIMESTAMP WITH TIME ZONE,
    time_done TIMESTAMP WITH TIME ZONE,
    cancel_reason TEXT,
    notes TEXT
);

-- Chat memory for n8n conversations
CREATE TABLE IF NOT EXISTS chat_memory (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR NOT NULL,
    message_type VARCHAR NOT NULL, -- 'human' or 'ai'
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Documents table for vector store (with proper dimensions)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB,
    embedding vector(1536),  -- ✅ OpenAI embedding dimension
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Document metadata for RAG workflows
CREATE TABLE IF NOT EXISTS document_metadata (
    id TEXT PRIMARY KEY,
    title TEXT,
    url TEXT,
    file_type VARCHAR,
    schema TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Document rows for tabular data
CREATE TABLE IF NOT EXISTS document_rows (
    id SERIAL PRIMARY KEY,
    dataset_id TEXT REFERENCES document_metadata(id) ON DELETE CASCADE,
    row_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_menus_category ON menus(menu_category);
CREATE INDEX IF NOT EXISTS idx_menus_available ON menus("isAvail");
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_status ON kitchen_orders(status);
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_time_receive ON kitchen_orders(time_receive);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_chat_memory_session ON chat_memory(session_id);

-- Vector indexes (after table creation)
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_documents_vector ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Sample menu data
INSERT INTO menus (menu_id, menu_name, menu_price, menu_category, menu_description, "isAvail") VALUES
('MN001', 'Nasi Goreng Special', 25000, 'Makanan Utama', 'Nasi goreng dengan telur, ayam, dan kerupuk', true),
('MN002', 'Es Teh Manis', 8000, 'Minuman', 'Teh manis dingin segar', true),
('MN003', 'Mie Ayam Bakso', 20000, 'Makanan Utama', 'Mie ayam dengan bakso dan pangsit', true),
('MN004', 'Kopi Hitam', 12000, 'Minuman', 'Kopi hitam premium', true),
('MN005', 'Ayam Bakar', 30000, 'Makanan Utama', 'Ayam bakar bumbu kecap', true),
('MN006', 'Jus Jeruk', 15000, 'Minuman', 'Jus jeruk segar tanpa gula', true),
('MN007', 'Sate Ayam', 22000, 'Makanan Utama', '10 tusuk sate ayam dengan bumbu kacang', true),
('MN008', 'Pisang Goreng', 12000, 'Cemilan', 'Pisang goreng tepung krispy', true),
('MN009', 'Cappuccino', 18000, 'Minuman', 'Kopi cappuccino dengan foam susu', true),
('MN010', 'Gado-gado', 16000, 'Makanan Utama', 'Gado-gado sayuran segar', true)
ON CONFLICT (menu_id) DO NOTHING;

-- Sample orders
INSERT INTO orders (order_id, customer_name, table_no, room_name, status, total_amount) VALUES
('ORD001', 'John Doe', '5', 'Lantai 1', 'receive', 41000),
('ORD002', 'Jane Smith', '3', 'Lantai 1', 'making', 32000),
('ORD003', 'Bob Wilson', '8', 'Lantai 2', 'deliver', 45000),
('ORD004', 'Alice Brown', '2', 'Lantai 1', 'done', 28000),
('ORD005', 'Charlie Davis', '7', 'VIP Room', 'receive', 55000)
ON CONFLICT (order_id) DO NOTHING;

-- Sample order items
INSERT INTO order_items (order_id, menu_name, quantity, unit_price) VALUES
('ORD001', 'Nasi Goreng Special', 1, 25000),
('ORD001', 'Es Teh Manis', 2, 8000),
('ORD002', 'Mie Ayam Bakso', 1, 20000),
('ORD002', 'Kopi Hitam', 1, 12000),
('ORD003', 'Ayam Bakar', 1, 30000),
('ORD003', 'Jus Jeruk', 1, 15000),
('ORD004', 'Sate Ayam', 1, 22000),
('ORD004', 'Es Teh Manis', 1, 8000),
('ORD005', 'Cappuccino', 2, 18000),
('ORD005', 'Pisang Goreng', 1, 12000)
ON CONFLICT DO NOTHING;

-- Sample kitchen orders for testing
INSERT INTO kitchen_orders (order_id, detail, customer_name, table_no, room_name, status, time_receive) VALUES
('ORD001', '1x Nasi Goreng Special' || E'\n' || '2x Es Teh Manis', 'John Doe', '5', 'Lantai 1', 'receive', NOW()),
('ORD002', '1x Mie Ayam Bakso' || E'\n' || '1x Kopi Hitam', 'Jane Smith', '3', 'Lantai 1', 'making', NOW() - INTERVAL '10 minutes'),
('ORD003', '1x Ayam Bakar' || E'\n' || '1x Jus Jeruk', 'Bob Wilson', '8', 'Lantai 2', 'deliver', NOW() - INTERVAL '20 minutes'),
('ORD005', '2x Cappuccino' || E'\n' || '1x Pisang Goreng', 'Charlie Davis', '7', 'VIP Room', 'receive', NOW() - INTERVAL '5 minutes')
ON CONFLICT (order_id) DO NOTHING;

-- Sample menu suggestions
INSERT INTO menu_suggestions (usulan_id, menu_name, customer_name, description) VALUES
('SUG001', 'Rendang Padang', 'John Doe', 'Rendang daging sapi dengan bumbu rempah Padang'),
('SUG002', 'Ice Cream Durian', 'Jane Smith', 'Es krim durian lokal dengan topping keju'),
('SUG003', 'Pecel Lele', 'Bob Wilson', 'Ikan lele goreng dengan sambal pecel'),
('SUG004', 'Teh Tarik Malaysia', 'Alice Brown', 'Teh susu tarik ala Malaysia yang creamy'),
('SUG005', 'Martabak Manis', 'Charlie Davis', 'Martabak manis dengan topping coklat dan keju')
ON CONFLICT (usulan_id) DO NOTHING;

-- Sample knowledge base for AI (with proper vector dimensions)
-- Note: These are dummy vectors - in production, use actual embeddings from OpenAI
INSERT INTO embeddings (text, embedding) VALUES
('Menu Nasi Goreng Special adalah menu unggulan Infinity Cafe dengan harga Rp 25.000', array_fill(0.1, ARRAY[1536])::vector),
('Infinity Cafe buka setiap hari dari jam 08:00 - 22:00 WIB', array_fill(0.2, ARRAY[1536])::vector),
('Untuk reservasi meja VIP, silakan hubungi nomor WhatsApp 08123456789', array_fill(0.3, ARRAY[1536])::vector),
('Pembayaran bisa menggunakan cash, kartu debit/kredit, QRIS, GoPay, OVO, dan Dana', array_fill(0.4, ARRAY[1536])::vector),
('Infinity Cafe memiliki WiFi gratis dengan password: InfinityCafe2024', array_fill(0.5, ARRAY[1536])::vector)
ON CONFLICT DO NOTHING;

-- Vector similarity search function
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  WHERE 1 - (documents.embedding <=> query_embedding) > match_threshold
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Auto-update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Auto-update trigger for orders
CREATE TRIGGER update_orders_updated_at 
    BEFORE UPDATE ON orders 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Success notification
DO $$
BEGIN
    RAISE NOTICE 'Infinity Cafe database initialized successfully!';
    RAISE NOTICE 'Tables created with proper vector dimensions (1536)';
    RAISE NOTICE 'Sample data inserted for all services';
    RAISE NOTICE 'Vector search functions created';
END $$;


-- CREATE EXTENSION IF NOT EXISTS vector;

-- -- Embeddings table for vector operations
-- CREATE TABLE IF NOT EXISTS embeddings (
--   id SERIAL PRIMARY KEY,
--   embedding vector,
--   text text,
--   created_at timestamptz DEFAULT now()
-- );

-- -- Menu table
-- CREATE TABLE IF NOT EXISTS menus (
--     menu_id VARCHAR PRIMARY KEY,
--     menu_name VARCHAR NOT NULL,
--     menu_price INTEGER NOT NULL,
--     "isAvail" BOOLEAN DEFAULT TRUE
-- );

-- -- Menu suggestions table
-- CREATE TABLE IF NOT EXISTS menu_suggestions (
--     usulan_id VARCHAR PRIMARY KEY,
--     menu_name VARCHAR NOT NULL,
--     customer_name VARCHAR,
--     timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
-- );

-- -- Orders table
-- CREATE TABLE IF NOT EXISTS orders (
--     order_id VARCHAR PRIMARY KEY,
--     customer_name VARCHAR,
--     table_no VARCHAR,
--     room_name VARCHAR,
--     status VARCHAR DEFAULT 'receive',
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
--     cancel_reason TEXT
-- );

-- -- Order items table
-- CREATE TABLE IF NOT EXISTS order_items (
--     id SERIAL PRIMARY KEY,
--     order_id VARCHAR REFERENCES orders(order_id) ON DELETE CASCADE,
--     menu_name VARCHAR NOT NULL,
--     quantity INTEGER DEFAULT 1,
--     preference TEXT,
--     timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
-- );

-- -- Kitchen orders table - FIXED STRUCTURE
-- CREATE TABLE IF NOT EXISTS kitchen_orders (
--     order_id VARCHAR PRIMARY KEY,
--     status VARCHAR DEFAULT 'receive',
--     detail TEXT,
--     customer_name VARCHAR,
--     table_no VARCHAR,
--     room_name VARCHAR,
--     time_receive TIMESTAMP WITH TIME ZONE,
--     time_making TIMESTAMP WITH TIME ZONE,
--     time_deliver TIMESTAMP WITH TIME ZONE,
--     time_done TIMESTAMP WITH TIME ZONE,
--     cancel_reason TEXT
-- );

-- -- Sample data
-- INSERT INTO menus (menu_id, menu_name, menu_price, "isAvail") VALUES
-- ('MN001', 'Nasi Goreng Special', 25000, true),
-- ('MN002', 'Es Teh Manis', 8000, true),
-- ('MN003', 'Mie Ayam Bakso', 20000, true),
-- ('MN004', 'Kopi Hitam', 12000, true),
-- ('MN005', 'Ayam Bakar', 30000, true)
-- ON CONFLICT (menu_id) DO NOTHING;

-- -- Sample kitchen orders for testing
-- INSERT INTO kitchen_orders (order_id, detail, customer_name, table_no, room_name, status, time_receive) VALUES
-- ('ORD001', '2x Nasi Goreng Special\n1x Es Teh Manis', 'John Doe', '5', 'Lantai 1', 'receive', NOW()),
-- ('ORD002', '1x Mie Ayam Bakso\n1x Kopi Hitam', 'Jane Smith', '3', 'Lantai 1', 'making', NOW() - INTERVAL '10 minutes'),
-- ('ORD003', '1x Ayam Bakar\n1x Es Teh Manis', 'Bob Wilson', '8', 'Lantai 2', 'deliver', NOW() - INTERVAL '20 minutes')
-- ON CONFLICT (order_id) DO NOTHING;