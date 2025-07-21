import psycopg2

conn = psycopg2.connect(
    dbname="infinity_cafe",
    user="admin",
    password="password",
    host="127.0.0.1",
    port="5432"
)
cur = conn.cursor()

cur.execute("""
    SELECT ko.order_id, ko.customer_name, ko.table_no, ko.room_name, ko.status, ko.time_receive
    FROM kitchen_orders ko
    LEFT JOIN orders o ON ko.order_id = o.order_id
    WHERE o.order_id IS NULL
""")
rows = cur.fetchall()

for row in rows:
    cur.execute("SELECT COALESCE(MAX(queue_number), 0) + 1 FROM orders")
    queue_number = cur.fetchone()[0]
    cur.execute("""
        INSERT INTO orders (order_id, queue_number, customer_name, table_no, room_name, status, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, (row[0], queue_number, row[1], row[2], row[3], row[4], row[5]))

conn.commit()
cur.close()
conn.close()
print("Sinkronisasi selesai.") 