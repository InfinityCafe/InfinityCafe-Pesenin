const express = require("express");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const fetch = require("node-fetch");

const app = express();
const PORT = 8080;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json()); // Add JSON parsing middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Infinity Cafe Frontend API",
      version: "1.0.0",
      description: "Dokumentasi untuk frontend Infinity Cafe",
    },
    servers: [{ url: "http://localhost:8080" }],
  },
  apis: ["./server.js"],
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /:
 *   get:
 *     summary: Halaman dashboard dapur
 *     responses:
 *       200:
 *         description: Mengembalikan file index.html
 * /report_page:
 *   get:
 *     summary: Halaman laporan penjualan
 *     responses:
 *       200:
 *         description: Mengembalikan file report.html
 * /health:
 *   get:
 *     summary: Health check API
 *     responses:
 *       200:
 *         description: Status OK
 * /kitchen/orders:
 *   get:
 *     summary: Ambil daftar semua pesanan dari dapur
 *     responses:
 *       200:
 *         description: Daftar pesanan
 * /kitchen/update_status/{order_id}:
 *   post:
 *     summary: Perbarui status pesanan tertentu
 *     parameters:
 *       - in: path
 *         name: order_id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID pesanan
 *       - in: query
 *         name: status
 *         required: true
 *         schema:
 *           type: string
 *         description: Status baru
 *       - in: query
 *         name: reason
 *         schema:
 *           type: string
 *         description: Alasan pembatalan
 *     responses:
 *       200:
 *         description: Status pesanan berhasil diperbarui
 * /stream/orders:
 *   get:
 *     summary: Streaming data pesanan aktif via SSE
 *     responses:
 *       200:
 *         description: Event stream (SSE)
 * /report:
 *   get:
 *     summary: Ambil laporan penjualan berdasarkan rentang tanggal
 *     parameters:
 *       - in: query
 *         name: start_date
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: end_date
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Data laporan penjualan
 * /report/top_customers:
 *   get:
 *     summary: Ambil pelanggan loyal
 *     parameters:
 *       - in: query
 *         name: start_date
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: end_date
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daftar pelanggan loyal
 * /report/suggested_menu:
 *   get:
 *     summary: Ambil daftar menu usulan pelanggan
 *     parameters:
 *       - in: query
 *         name: start_date
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: end_date
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Daftar menu usulan
 */

app.get("/kitchen/orders", async (req, res) => {
  try {
    const resp = await fetch("http://kitchen_service:8003/kitchen/orders");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed on fetching orders ", err);
    res.status(500).json({ error: "Failed to fetch kitchen orders" });
  }
});

app.post("/kitchen/update_status/:order_id", async (req, res) => {
  const { order_id } = req.params;
  const { status, reason = "" } = req.query;
  try {
    await fetch(`http://kitchen_service:8003/kitchen/update_status/${order_id}?status=${status}&reason=${encodeURIComponent(reason)}`, { method: "POST" });
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to update status ", err);
    res.status(500).json({ error: "Failed to update status" });
  }
});

app.get("/stream/orders", (req, res) => {
  const streamReq = fetch("http://kitchen_service:8003/stream/orders");
  streamReq.then(resp => {
    res.setHeader('Content-Type', 'text/event-stream');
    resp.body.pipe(res);
  }).catch(() => res.status(500).end());
});

app.get("/", async (req, res) => {
  try {
    const resp = await fetch("http://kitchen_service:8003/kitchen/orders");
    const orders = await resp.json();
    res.render("index", { orders });
  } catch (err) {
    console.error("Error on fetching orders ", err);
    res.render("index", { orders: [] });
  }
});

app.get("/reportkitchen", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "report.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ========== KITCHEN STATUS ENDPOINTS ==========
app.get("/kitchen/status/now", async (req, res) => {
  try {
    const resp = await fetch("http://kitchen_service:8003/kitchen/status/now");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch kitchen status ", err);
    res.status(500).json({ error: "Failed to fetch kitchen status" });
  }
});

app.post("/kitchen/status", async (req, res) => {
  try {
    const body = await req.json();
    const resp = await fetch("http://kitchen_service:8003/kitchen/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to update kitchen status ", err);
    res.status(500).json({ error: "Failed to update kitchen status" });
  }
});

// ========== MENU ENDPOINTS ==========
app.get("/menu", async (req, res) => {
  try {
    const resp = await fetch("http://menu_service:8001/menu");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch menu ", err);
    res.status(500).json({ error: "Failed to fetch menu" });
  }
});

// ========== ORDER ENDPOINTS ==========
app.post("/create_order", async (req, res) => {
  try {
    const body = await req.json();
    const resp = await fetch("http://order_service:8002/create_order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to create order ", err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// ========== REPORT ENDPOINTS ==========
app.get("/report", async (req, res) => {
  const { start_date, end_date, menu_name } = req.query;
  try {
    const params = new URLSearchParams({ start_date, end_date });
    if (menu_name) params.append('menu_name', menu_name);
    
    const resp = await fetch(`http://report_service:8004/report?${params.toString()}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch report ", err);
    res.status(500).json({ error: "Failed to fetch report" });
  }
});

app.get("/report/top_customers", async (req, res) => {
  const { start_date, end_date } = req.query;
  try {
    const params = new URLSearchParams({ start_date, end_date });
    const resp = await fetch(`http://report_service:8004/report/top_customers?${params.toString()}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch top customers ", err);
    res.status(500).json({ error: "Failed to fetch top customers" });
  }
});

app.get("/report/suggested_menu", async (req, res) => {
  const { start_date, end_date } = req.query;
  try {
    const params = new URLSearchParams({ start_date, end_date });
    const resp = await fetch(`http://report_service:8004/report/suggested_menu?${params.toString()}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch suggested menu ", err);
    res.status(500).json({ error: "Failed to fetch suggested menu" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Frontend running at http://localhost:${PORT}`);
  console.log(`📘 Swagger docs available at http://localhost:${PORT}/docs`);
});
