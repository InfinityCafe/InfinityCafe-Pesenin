-- Seeder untuk tabel users
-- Catatan: file ini membuat tabel users jika belum ada, dan menambahkan admin + contoh user.
-- Password di-hash menggunakan extension pgcrypto (bcrypt).

-- Pastikan ekstensi pgcrypto dipasang di database sebelum menjalankan seeder ini
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR UNIQUE NOT NULL,
    hashed_password VARCHAR NOT NULL,
    role VARCHAR NOT NULL DEFAULT 'user',
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO users (username, hashed_password, role, is_active)
VALUES
    ('admin', crypt('admin123', gen_salt('bf')), 'admin', TRUE)
ON CONFLICT (username) DO UPDATE
    SET role = EXCLUDED.role,
        is_active = EXCLUDED.is_active;

SELECT 'seeder_users_done' AS status;
