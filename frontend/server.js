const express = require("express");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 8080;

// Environment configuration
const ENV = process.env.NODE_ENV || 'development';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost';

// API configuration for different environments
const API_CONFIG = {
  development: {
    kitchen: 'http://localhost:8003',
    order: 'http://localhost:8002',
    menu: 'http://localhost:8001',
    report: 'http://localhost:8004',
    inventory: 'http://localhost:8005'
  },
  production: {
    kitchen: `${API_BASE_URL}:8003`,
    order: `${API_BASE_URL}:8002`,
    menu: `${API_BASE_URL}:8001`,
    report: `${API_BASE_URL}:8004`,
    inventory: `${API_BASE_URL}:8005`
  }
};

const currentConfig = API_CONFIG[ENV] || API_CONFIG.development;

app.use(express.static(path.join(__dirname, "public")));
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
    const resp = await fetch(`${currentConfig.kitchen}/kitchen/orders`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

app.get("/kitchen/status/now", async (req, res) => {
  try {
    const resp = await fetch(`${currentConfig.kitchen}/kitchen/status/now`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch kitchen status" });
  }
});

app.post("/kitchen/status", async (req, res) => {
  try {
    const isOpen = req.body;
    const resp = await fetch(`${currentConfig.kitchen}/kitchen/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isOpen)
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to update kitchen status" });
  }
});

app.post("/kitchen/update_status/:order_id", async (req, res) => {
  const { order_id } = req.params;
  const { status, reason = "" } = req.query;
  try {
    await fetch(`${currentConfig.kitchen}/kitchen/update_status/${order_id}?status=${status}&reason=${encodeURIComponent(reason)}`, { method: "POST" });
    await fetch(`${currentConfig.order}/order/update_status/${order_id}?status=${status}`, { method: "POST" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update status" });
  }
});

app.get("/stream/orders", (req, res) => {
  const streamReq = fetch(`${currentConfig.kitchen}/stream/orders`);
  streamReq.then(resp => {
    res.setHeader('Content-Type', 'text/event-stream');
    resp.body.pipe(res);
  }).catch(() => res.status(500).end());
});

app.get("/", async (req, res) => {
  try {
    const resp = await fetch(`${currentConfig.kitchen}/kitchen/orders`);
    const orders = await resp.json();
    res.render("index", { orders });
  } catch (err) {
    res.render("index", { orders: [] });
  }
});

app.get("/reportkitchen", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "report.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// API configuration endpoint for frontend
app.get("/api/config", (req, res) => {
  res.json({
    environment: ENV,
    apiUrls: currentConfig,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`✅ Frontend running at http://localhost:${PORT}`);
  console.log(`📘 Swagger docs available at http://localhost:${PORT}/docs`);
  console.log(`🌍 Environment: ${ENV}`);
  console.log(`🔗 API Base URL: ${API_BASE_URL}`);
});
