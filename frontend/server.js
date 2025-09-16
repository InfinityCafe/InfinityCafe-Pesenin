const express = require("express");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const fetch = require("node-fetch");
const { error } = require("console");

const app = express();
const PORT = 8080;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://oriented-terminally-sheepdog.ngrok-free.app/webhook/trigger-order-status";

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
    servers: [{ url: "http://frontend:8080" }],
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

// QR Order status endpoint
app.get("/order/status/:queueNumber", async (req, res) => {
  try {
    const { queueNumber } = req.params;
    const resp = await fetch(`http://order_service:8002/order/status/${queueNumber}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });
    const data = await resp.json();
    res.json(data);
  } catch (error) {
    console.error("Failed to get order status ", error);
    res.status(500).json({ error: "Failed to get order status" });
  }
});

// Order status by order_id (safer binding)
app.get("/order/status/by-id/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const encodedOrderId = encodeURIComponent(orderId);
    const resp = await fetch(`http://order_service:8002/order_status/${encodedOrderId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });
    const text = await resp.text();
    // Try parse JSON; if fail, passthrough text
    try {
      const data = JSON.parse(text);
      res.status(resp.status).json(data);
    } catch {
      res.status(resp.status).send(text);
    }
  } catch (error) {
    console.error("Failed to get order status by id ", error);
    res.status(500).json({ error: "Failed to get order status by id" });
  }
});

app.post("/custom_order", async (req, res) => {
  try {
    const body = req.body;
    console.log('Received custom order request:', body);
    const resp = await fetch("http://order_service:8002/custom_order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const errorData = await resp.text(); // Ambil response error dari service
      throw new Error(`Service error: ${resp.status} - ${errorData}`);
    }

    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to create custom order ", err);
    res.status(500).json({ error: "Failed to create custom order" });
  }
});

app.post("/cancel_order", async (req, res) => {
  try {
    const body = req.body;
    const { order_id = "" } = body || {};

    // Cek status pesanan terlebih dahulu: hanya boleh 'receive'
    try {
      const encodedOrderId = encodeURIComponent(String(order_id || ""));
      const statusResp = await fetch(`http://order_service:8002/order_status/${encodedOrderId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      const statusJson = await statusResp.json().catch(() => ({}));
      const currentStatus = (statusJson && (statusJson.data?.status || statusJson.status)) || "";
      if (String(currentStatus).toLowerCase() !== "receive") {
        return res.status(400).json({
          status: "failed",
          message: "Pesanan hanya bisa dibatalkan saat status 'receive'"
        });
      }
    } catch (checkErr) {
      console.error("Failed to verify order status before cancel ", checkErr);
      return res.status(500).json({ error: "Gagal memverifikasi status pesanan sebelum batal" });
    }

    // Panggil service untuk cancel order (allowed)
    const resp = await fetch("http://order_service:8002/cancel_kitchen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await resp.json();

    // Setelah cancel berhasil, trigger webhook ke n8n (GET) - non-blocking
    try {
      const { order_id = "", reason = "" } = body;
      const qs = new URLSearchParams({
        order_id: String(order_id),
        status: "cancelled", // status diset manual
        reason: String(reason || "Cancelled by user")
      });

      fetch(`${N8N_WEBHOOK_URL}?${qs.toString()}`, { method: "GET" })
        .catch(err => console.error("Failed to call n8n webhook ", err));
    } catch (whErr) {
      console.error("n8n webhook error ", whErr);
    }

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
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch menu ", err);
    res.status(500).json({ error: "Failed to fetch menu" });
  }
});

// Admin passthrough for all menus (same as list, explicit path)
app.get("/menu/all", async (req, res) => {
  try {
    const resp = await fetch("http://menu_service:8001/menu");
    const data = await resp.json();
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch all menus ", err);
    res.status(500).json({ error: "Failed to fetch all menus" });
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

// Proxy: flavors for a menu by base name
app.get("/menu/by_name/:base_name/flavors", async (req, res) => {
  try {
    const { base_name } = req.params;
    const resp = await fetch(`http://menu_service:8001/menu/by_name/${encodeURIComponent(base_name)}/flavors`);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to fetch flavors for menu by name ", err);
    res.status(500).json({ error: "Failed to fetch flavors for menu by name" });
  }
});

// Menu suggestion endpoints - MUST COME BEFORE /menu/:menu_id to avoid route conflict
app.get("/menu_suggestion", async (req, res) => {
  try {
    const resp = await fetch("http://menu_service:8001/menu_suggestion");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch menu suggestions ", err);
    res.status(500).json({ error: "Failed to fetch menu suggestions" });
  }
});

app.post("/menu_suggestion", async (req, res) => {
  try {
    const body = req.body;
    const resp = await fetch("http://menu_service:8001/menu_suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to create menu suggestion ", err);
    res.status(500).json({ error: "Failed to create menu suggestion" });
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

// Update menu recipe (menu service)
app.post("/menu/:menu_id/recipe", async (req, res) => {
  try {
    const { menu_id } = req.params;
    const body = req.body;
    const resp = await fetch(`http://menu_service:8001/menu/${menu_id}/recipe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to update menu recipe", err);
    res.status(500).json({ error: "Failed to update menu recipe" });
  }
});

app.get("/menu/:menu_id/recipe", async (req, res) => {
  try {
    const { menu_id } = req.params;
    const resp = await fetch(`http://menu_service:8001/menu/${menu_id}/recipe`, {
      method: "GET"
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to load menu recipe", err);
    res.status(500).json({ error: "Failed to load menu recipe" });
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
app.get("/flavors/all", async (req, res) => {
  try {
    const resp = await fetch("http://menu_service:8001/flavors/all");
    const data = await resp.json();
    res.set('Cache-Control', 'no-store');
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to fetch all flavors ", err);
    res.status(500).json({ error: "Failed to fetch all flavors" });
  }
});
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
    let data;
    try {
      data = await resp.json();
    } catch (_) {
      // Fallback when backend returns empty body
      data = {
        status: resp.ok ? "success" : "error",
        message: resp.ok ? "Flavor deleted" : `HTTP ${resp.status}: ${resp.statusText}`,
        data: { id: flavor_id }
      };
    }
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

// app.get("/report/best_seller", async (req, res) => {
//   const { start_date, end_date, menu_name } = req.query;
//   try {
//     const params = new URLSearchParams({ start_date, end_date });
//     if (menu_name) params.append('menu_name', menu_name);
    
//     const resp = await fetch(`http://report_service:8004/report/best_seller?${params.toString()}`);
//     const data = await resp.json();
//     res.json(data);
//   } catch (err) {
//     console.error("Failed to fetch report ", err);
//     res.status(500).json({ error: "Failed to fetch report" });
//   }
// });

app.get("/report/best_seller", async (req, res) => {
  const { start_date, end_date } = req.query;
  try {
    const params = new URLSearchParams({ start_date, end_date });
    const resp = await fetch(`http://report_service:8004/report/best_seller?${params.toString()}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch top customers ", err);
    res.status(500).json({ error: "Failed to fetch top customers" });
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

// Financial sales report endpoints
app.get("/report/financial_sales", async (req, res) => {
  const { start_date, end_date, today_only } = req.query;
  try {
    const params = new URLSearchParams();
    if (start_date) params.append('start_date', start_date);
    if (end_date) params.append('end_date', end_date);
    if (today_only) params.append('today_only', today_only);
    
    const resp = await fetch(`http://report_service:8004/report/financial_sales?${params.toString()}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch financial sales report ", err);
    res.status(500).json({ error: "Failed to fetch financial sales report" });
  }
});

app.get("/report/financial_sales/summary", async (req, res) => {
  const { start_date, end_date, today_only } = req.query;
  try {
    const params = new URLSearchParams();
    if (start_date) params.append('start_date', start_date);
    if (end_date) params.append('end_date', end_date);
    if (today_only) params.append('today_only', today_only);
    
    const resp = await fetch(`http://report_service:8004/report/financial_sales/summary?${params.toString()}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch financial sales summary ", err);
    res.status(500).json({ error: "Failed to fetch financial sales summary" });
  }
});

app.get("/report/financial_sales/export", async (req, res) => {
  const { start_date, end_date, today_only, format_type } = req.query;
  try {
    const params = new URLSearchParams();
    if (start_date) params.append('start_date', start_date);
    if (end_date) params.append('end_date', end_date);
    if (today_only) params.append('today_only', today_only);
    if (format_type) params.append('format_type', format_type);
    
    const resp = await fetch(`http://report_service:8004/report/financial_sales/export?${params.toString()}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to export financial sales report ", err);
    res.status(500).json({ error: "Failed to export financial sales report" });
  }
});

// Inventory endpoints
app.get("/inventory/list", async (req, res) => {
  try {
    const resp = await fetch("http://inventory_service:8006/list_ingredients?show_unavailable=true");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch inventory ", err);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

app.get("/report/order/:orderId/ingredients", async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Encode the orderId for the internal service call
    const encodedOrderId = encodeURIComponent(orderId);
    
    const resp = await fetch(`http://report_service:8004/report/order/${encodedOrderId}/ingredients`, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    if (resp.ok) {
      const data = await resp.json();
      return res.status(resp.status).json(data);
    }

    // Fallback: if report service doesn't have the endpoint or returns 404,
    // emulate the behavior here ensuring only 'done' orders are returned
    if (resp.status === 404) {
      try {
        const statusResp = await fetch(`http://order_service:8002/order_status/${encodedOrderId}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" }
        });
        const statusJson = await statusResp.json().catch(() => ({}));
        const orderStatus = (statusJson && statusJson.data && statusJson.data.status) || null;

        if (orderStatus !== "done") {
          return res.status(200).json({
            status: "success",
            order_id: orderId,
            message: `Order ${orderId} tidak berstatus 'done'`,
            ingredients_breakdown: { details: [] }
          });
        }

        // Fetch from inventory service for actual breakdown details
        const invResp = await fetch(`http://inventory_service:8006/order/${encodedOrderId}/ingredients`, {
          method: "GET",
          headers: { "Content-Type": "application/json" }
        });

        const invJson = await invResp.json().catch(() => ({}));
        const details = (invJson && invJson.data && invJson.data.ingredients_breakdown && invJson.data.ingredients_breakdown.details)
          || (invJson && invJson.ingredients_breakdown && invJson.ingredients_breakdown.details)
          || invJson.details
          || [];

        return res.status(200).json({
          status: "success",
          order_id: orderId,
          ingredients_breakdown: { details: Array.isArray(details) ? details : [] }
        });
      } catch (fallbackErr) {
        console.error("Fallback failed for order ingredients details", fallbackErr);
        return res.status(500).json({ error: "Failed to get order ingredients details via fallback" });
      }
    }

    // Any other error from report service
    const text = await resp.text().catch(() => "");
    return res.status(resp.status).send(text || { error: "Upstream error" });

  } catch (err) {
    console.error("Failed to get order ingredients details via report service", err);
    res.status(500).json({ error: "Failed to get order ingredients details via report service" });
  }
});

app.get("/inventory/summary", async (req, res) => {
  try {
    const resp = await fetch("http://inventory_service:8006/stock/summary");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch inventory summary ", err);
    res.status(500).json({ error: "Failed to fetch inventory summary" });
  }
});

app.get("/inventory/alerts", async (req, res) => {
  try {
    const resp = await fetch("http://inventory_service:8006/stock/alerts");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch inventory alerts ", err);
    res.status(500).json({ error: "Failed to fetch inventory alerts" });
  }
});

app.post("/inventory/add", async (req, res) => {
  try {
    const body = req.body;
    const auth = req.headers["authorization"] || "";
    const resp = await fetch("http://inventory_service:8006/add_ingredient", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to add ingredient ", err);
    res.status(500).json({ error: "Failed to add ingredient" });
  }
});

app.put("/inventory/update", async (req, res) => {
  try {
    const body = req.body;
    const auth = req.headers["authorization"] || "";
    const resp = await fetch("http://inventory_service:8006/update_ingredient_with_audit", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to update ingredient ", err);
    res.status(500).json({ error: "Failed to update ingredient" });
  }
});

app.delete("/inventory/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const resp = await fetch(`http://inventory_service:8006/delete_ingredient/${id}`, {
      method: "DELETE"
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to delete ingredient ", err);
    res.status(500).json({ error: "Failed to delete ingredient" });
  }
});

// Stock Management endpoints
app.post("/inventory/stock/add", async (req, res) => {
  try {
    const body = req.body;
    const auth = req.headers["authorization"] || "";
    const resp = await fetch("http://inventory_service:8006/stock/add", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to add stock ", err);
    res.status(500).json({ error: "Failed to add stock" });
  }
});

// app.post("/inventory/stock/bulk_add", async (req, res) => {
//   try {
//     const body = req.body;
//     const resp = await fetch("http://inventory_service:8006/stock/bulk_add", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(body)
//     });
//     const data = await resp.json();
//     res.status(resp.status).json(data);
//   } catch (err) {
//     console.error("Failed to bulk add stock ", err);
//     res.status(500).json({ error: "Failed to bulk add stock" });
//   }
// });

app.put("/inventory/stock/minimum", async (req, res) => {
  try {
    const body = req.body;
    const auth = req.headers["authorization"] || "";
    const resp = await fetch("http://inventory_service:8006/stock/minimum", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to update minimum stock ", err);
    res.status(500).json({ error: "Failed to update minimum stock" });
  }
});

// Stock history proxies
app.get("/inventory/stock/history/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const url = `http://inventory_service:8006/stock/history/${id}`;
    const resp = await fetch(url);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to fetch stock history by id ", err);
    res.status(500).json({ error: "Failed to fetch stock history" });
  }
});

app.get("/inventory/stock/history", async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.action_type) params.append('action_type', req.query.action_type);
    if (req.query.performed_by) params.append('performed_by', req.query.performed_by);
    if (req.query.limit) params.append('limit', req.query.limit);
    const resp = await fetch(`http://inventory_service:8006/stock/history?${params.toString()}`);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to fetch all stock history ", err);
    res.status(500).json({ error: "Failed to fetch all stock history" });
  }
});

app.get("/inventory/stock/out_of_stock", async (req, res) => {
  try {
    const resp = await fetch("http://inventory_service:8006/stock/out_of_stock");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch out of stock items ", err);
    res.status(500).json({ error: "Failed to fetch out of stock items" });
  }
});

app.get("/inventory/stock/critical_status", async (req, res) => {
  try {
    const resp = await fetch("http://inventory_service:8006/stock/critical_status");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch critical status ", err);
    res.status(500).json({ error: "Failed to fetch critical status" });
  }
});

app.post("/inventory/stock/check_and_consume", async (req, res) => {
  try {
    const body = req.body;
    const resp = await fetch("http://inventory_service:8006/stock/check_and_consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to check and consume stock ", err);
    res.status(500).json({ error: "Failed to check and consume stock" });
  }
});

app.post("/inventory/stock/rollback/:order_id", async (req, res) => {
  try {
    const { order_id } = req.params;
    const resp = await fetch(`http://inventory_service:8006/stock/rollback/${order_id}`, {
      method: "POST"
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to rollback stock consumption ", err);
    res.status(500).json({ error: "Failed to rollback stock consumption" });
  }
});

app.get("/inventory/consumption_log", async (req, res) => {
  try {
    const resp = await fetch("http://inventory_service:8006/consumption_log");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch consumption logs ", err);
    res.status(500).json({ error: "Failed to fetch consumption logs" });
  }
});

app.get("/inventory/consumption_log/:order_id", async (req, res) => {
  try {
    const { order_id } = req.params;
    const resp = await fetch(`http://inventory_service:8006/consumption_log/${order_id}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch consumption log for order ", err);
    res.status(500).json({ error: "Failed to fetch consumption log for order" });
  }
});

app.get("/inventory/flavor_mapping", async (req, res) => {
  try {
    const resp = await fetch("http://inventory_service:8006/flavor_mapping");
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch flavor mapping ", err);
    res.status(500).json({ error: "Failed to fetch flavor mapping" });
  }
});

// Proxy: inventory logs history
app.get("/inventory/history", async (req, res) => {
  try {
    const { order_id, limit } = req.query;
    const params = new URLSearchParams();
    if (order_id) params.set("order_id", order_id);
    if (limit) params.set("limit", limit);
    const url = params.toString()
      ? `http://inventory_service:8006/history?${params.toString()}`
      : `http://inventory_service:8006/history`;
    const resp = await fetch(url);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to fetch inventory history ", err);
    res.status(500).json({ error: "Failed to fetch inventory history" });
  }
});

// Audit History
// app.get("/inventory/stock/history", async (req,res) => {
//   try {
//     const { limit, action_type, performed_by } = req.query;

//     let queryParams = '';
//     if (limit || action_type || performed_by) {
//       queryParams = '?';
//       if (limit) queryParams += `limit=${encodeURIComponent(limit)}&`;
//       if (action_type) queryParams += `action_type=${encodeURIComponent(action_type)}&`;
//       if (performed_by) queryParams += `performed_by=${encodeURIComponent(performed_by)}&`;
//       queryParams = queryParams.slice(0, -1);
//     }

//     const resp = await fetch(`http://inventory_service:8006/stock/history${queryParams}`, {
//       method: "GET",
//       headers: { "Content-Type": "application/json" }
//     });

//     const data = await resp.json();
//     res.status(resp.status).json(data);

//   } catch (err) {
//     console.error("Failed to get stock history", err);
//     res.status(500).json({ error: "Failed to get stock history" });
//   }
// });

app.patch("/inventory/toggle/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const auth = req.headers["authorization"] || "";
    const resp = await fetch(`http://inventory_service:8006/toggle_ingredient_availability/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to toggle ingredient availability ", err);
    res.status(500).json({ error: "Failed to toggle ingredient availability" });
  }
});

// Recipe endpoints
app.post("/recipes/batch", async (req, res) => {
  try {
    const body = req.body;
    const resp = await fetch("http://menu_service:8001/recipes/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error("Failed to fetch batch recipes ", err);
    res.status(500).json({ error: "Failed to fetch batch recipes" });
  }
});

app.get("/order/:order_id/ingredients", async (req, res) => {
  try {
    const { order_id } = req.params;
    const resp = await fetch(`http://inventory_service:8006/order/${order_id}/ingredients`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch order ingredients ", err);
    res.status(500).json({ error: "Failed to fetch order ingredients" });
  }
});

// Menu endpoints
app.get("/menu/list", async (req, res) => {
  try {
    const resp = await fetch("http://menu_service:8001/menu");
    const data = await resp.json();
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) {
    console.error("Failed to fetch menu list ", err);
    res.status(500).json({ error: "Failed to fetch menu list" });
  }
});

// Order status endpoint
app.get('/order_status/:order_id', async (req, res) => {
  try {
    const { order_id } = req.params;
    const response = await fetch(`http://order_service:8002/order_status/${order_id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Failed to fetch order status:', err);
    res.status(500).json({ error: 'Failed to fetch order status' });
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

app.post('/register', async (req, res) => {
  try {
    const response = await fetch('http://user_service:8005/register', {
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

// JWT validation function
function validateJWT(token) {
  try {
    if (!token) return false;
    
    // Split JWT into parts
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    
    // Decode payload (middle part)
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    
    // Check if token is expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < currentTime) {
      console.log('Token expired');
      return false;
    }
    
    // Check if token has required fields
    if (!payload.sub) {
      console.log('Token missing subject');
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('JWT validation error:', error.message);
    return false;
  }
}

// Authentication middleware
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  const tempToken = req.query.temp;
  
  // If we have a temporary token, allow access (client-side will handle validation)
  if (tempToken) {
    console.log('Temporary token provided, allowing access');
    return next();
  }
  
  // If we have a regular token, validate it
  if (token) {
    if (!validateJWT(token)) {
      console.log('Invalid or expired token');
      return res.redirect('/login');
    }
    console.log('Token validated successfully');
    return next();
  }
  
  // No token provided - let client-side handle authentication
  // This allows page refreshes to work properly
  console.log('No token provided, allowing access for client-side auth check');
  return next();
}

// ========== PAGE ROUTES ==========
app.get("/", (req, res) => {
  res.redirect("/login");
});

app.get("/dashboard", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/menu-management", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "menu.html"));
});

app.get("/reportkitchen", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "report.html"));
});

app.get("/stock-management", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "kelola-stok.html"));
});

app.get("/menu-suggestion", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "menu-suggestion.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// QR Ordering routes (no auth required)
app.get("/qr-menu", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "qr-menu.html"));
});

app.get("/qr-cart", (req, res) => {
  setQrCspHeaders(res);
  res.sendFile(path.join(__dirname, "public", "qr-cart.html"));
});

// Apply relaxed CSP for QR routes to allow required connections/assets
function setQrCspHeaders(res) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
      "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
      "img-src 'self' data:",
      "connect-src 'self' http://localhost:*"
    ].join('; ')
  );
}

// Optional alias (not used by QR flow)
app.get("/checkout", (req, res) => {
  setQrCspHeaders(res);
  res.sendFile(path.join(__dirname, "public", "checkout.html"));
});

app.get("/qr-track", (req, res) => {
  setQrCspHeaders(res);
  res.sendFile(path.join(__dirname, "public", "qr-track.html"));
});

// ========== STATIC FILES (MUST COME LAST) ==========
app.use(express.static(path.join(__dirname, "public")));

// Start server
app.listen(PORT, () => {
  console.log(`✅ Frontend running at http://localhost:${PORT}`);
  console.log(`📘 Swagger docs available at http://localhost:${PORT}/docs`);
});