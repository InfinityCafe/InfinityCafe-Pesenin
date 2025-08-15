const express = require("express");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const fetch = require("node-fetch");

const app = express();
const PORT = 8080;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://liberal-relative-panther.ngrok-free.app/webhook/trigger-order-status";

// Middleware
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Swagger configuration
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

// ========== API ROUTES (MUST COME BEFORE PAGE ROUTES) ==========

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Order endpoints
app.post("/create_order", async (req, res) => {
  try {
    const body = req.body;
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

app.post("/cancel_order", async (req, res) => {
  try {
    const body = req.body;
    const resp = await fetch("http://order_service:8002/cancel_order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to cancel order ", err);
    res.status(500).json({ error: "Failed to cancel order" });
  }
});

// Kitchen endpoints
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
    // Update status di kitchen_service
    await fetch(
      `http://kitchen_service:8003/kitchen/update_status/${order_id}?status=${status}&reason=${encodeURIComponent(reason)}`,
      { method: "POST" }
    );

    // Trigger n8n webhook (GET) - non-blocking agar tidak mengganggu response
    try {
      const qs = new URLSearchParams({
        order_id: String(order_id || ""),
        status: String(status || ""),
        reason: String(reason || "")
      });
      fetch(`${N8N_WEBHOOK_URL}?${qs.toString()}`, { method: "GET" })
        .catch(err => console.error("Failed to call n8n webhook ", err));
    } catch (whErr) {
      console.error("n8n webhook error ", whErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to update status ", err);
    res.status(500).json({ error: "Failed to update status" });
  }
});

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
    const body = req.body;
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

app.get("/stream/orders", (req, res) => {
  const streamReq = fetch("http://kitchen_service:8003/stream/orders");
  streamReq.then(resp => {
    res.setHeader('Content-Type', 'text/event-stream');
    resp.body.pipe(res);
  }).catch(() => res.status(500).end());
});

// Menu endpoints
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

app.post("/menu", async (req, res) => {
  try {
    const body = req.body;
    const resp = await fetch("http://menu_service:8001/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to create menu ", err);
    res.status(500).json({ error: "Failed to create menu" });
  }
});

app.get("/menu/:menu_id", async (req, res) => {
  try {
    const { menu_id } = req.params;
    const resp = await fetch(`http://menu_service:8001/menu/${menu_id}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch menu by ID ", err);
    res.status(500).json({ error: "Failed to fetch menu by ID" });
  }
});

app.put("/menu/:menu_id", async (req, res) => {
  try {
    const { menu_id } = req.params;
    const body = req.body;
    const resp = await fetch(`http://menu_service:8001/menu/${menu_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to update menu ", err);
    res.status(500).json({ error: "Failed to update menu" });
  }
});

app.delete("/menu/:menu_id", async (req, res) => {
  try {
    const { menu_id } = req.params;
    const resp = await fetch(`http://menu_service:8001/menu/${menu_id}`, {
      method: "DELETE"
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to delete menu ", err);
    res.status(500).json({ error: "Failed to delete menu" });
  }
});

// Flavor endpoints
app.get("/flavors", async (req, res) => {
  try {
    const resp = await fetch("http://menu_service:8001/flavors");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch flavors ", err);
    res.status(500).json({ error: "Failed to fetch flavors" });
  }
});

app.post("/flavors", async (req, res) => {
  try {
    const body = req.body;
    const resp = await fetch("http://menu_service:8001/flavors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to create flavor ", err);
    res.status(500).json({ error: "Failed to create flavor" });
  }
});

app.get("/flavors/:flavor_id", async (req, res) => {
  try {
    const { flavor_id } = req.params;
    const resp = await fetch(`http://menu_service:8001/flavors/${flavor_id}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch flavor by ID ", err);
    res.status(500).json({ error: "Failed to fetch flavor by ID" });
  }
});

app.put("/flavors/:flavor_id", async (req, res) => {
  try {
    const { flavor_id } = req.params;
    const body = req.body;
    const resp = await fetch(`http://menu_service:8001/flavors/${flavor_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to update flavor ", err);
    res.status(500).json({ error: "Failed to update flavor" });
  }
});

app.delete("/flavors/:flavor_id", async (req, res) => {
  try {
    const { flavor_id } = req.params;
    const resp = await fetch(`http://menu_service:8001/flavors/${flavor_id}`, {
      method: "DELETE"
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to delete flavor ", err);
    res.status(500).json({ error: "Failed to delete flavor" });
  }
});

// Report endpoints
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

// User endpoints
app.post('/login', async (req, res) => {
  try {
    const response = await fetch('http://user_service:8005/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== PAGE ROUTES ==========
app.get("/", (req, res) => {
  res.redirect("/dashboard");
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/menu-management", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "menu.html"));
});

app.get("/reportkitchen", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "report.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ========== STATIC FILES (MUST COME LAST) ==========
app.use(express.static(path.join(__dirname, "public")));

// Start server
app.listen(PORT, () => {
  console.log(`✅ Frontend running at http://localhost:${PORT}`);
  console.log(`📘 Swagger docs available at http://localhost:${PORT}/docs`);
});