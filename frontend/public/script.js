const statusFlow = { receive: "making", making: "deliver", deliver: "done" };
const statusColors = {
  receive: "bg-yellow-100", making: "bg-blue-100",
  deliver: "bg-green-100", done: "bg-gray-200",
  cancel: "bg-red-100", habis: "bg-orange-100"
};
let selectedOrderId = null;
let selectedOrder = null;

function switchTab(view) {
  document.getElementById("active-orders").classList.toggle("hidden", view !== "active");
  document.getElementById("inactive-orders").classList.toggle("hidden", view !== "inactive");
  document.getElementById("pending-orders").classList.toggle("hidden", view !== "pending");
  document.getElementById("tab-active").classList.toggle("tab-banner-active", view === "active");
  document.getElementById("tab-inactive").classList.toggle("tab-banner-active", view === "inactive");
  document.getElementById("tab-pending").classList.toggle("tab-banner-active", view === "pending");
  document.getElementById("tab-active").classList.toggle("tab-banner-inactive", view !== "active");
  document.getElementById("tab-inactive").classList.toggle("tab-banner-inactive", view !== "inactive");
  document.getElementById("tab-pending").classList.toggle("tab-banner-inactive", view !== "pending");
  fetchOrders();
}

function openConfirmModal(orderId) {
  selectedOrderId = orderId;
  document.getElementById("confirm-modal").classList.remove("hidden");
}

function closeConfirmModal() {
  selectedOrderId = null;
  document.getElementById("confirm-modal").classList.add("hidden");
}

function openDetailModal(order) {
  selectedOrder = order;
  const box = document.getElementById("detail-content");
  box.innerHTML = `
    <p><strong>Order ID:</strong> ${order.order_id}</p>
    <p><strong>Nama:</strong> ${order.customer_name}</p>
    <p><strong>Meja:</strong> ${order.table_no}</p>
    <p><strong>Ruangan:</strong> ${order.room_name}</p>
    <p><strong>Status:</strong> ${order.status}</p>
    <p><strong>Waktu:</strong> ${new Date(order.time_receive).toLocaleString("id-ID")}</p>
    ${order.time_done ? `<p><strong>Selesai:</strong> ${new Date(order.time_done).toLocaleString("id-ID")}</p>` : ""}
    <p><strong>Detail:</strong><br>${order.detail}</p>
  `;
  document.getElementById("detail-modal").classList.remove("hidden");
}

function closeDetailModal() {
  selectedOrder = null;
  document.getElementById("detail-modal").classList.add("hidden");
}

async function confirmCancel(status) {
  const reason = status === "cancel" ? prompt("Masukkan alasan pembatalan:", "Tidak jadi") : "Bahan habis";
  if (!reason) return closeConfirmModal();
  await syncUpdate(selectedOrderId, status, reason);
  closeConfirmModal();
}

async function syncUpdate(orderId, status, reason = "") {
  try {
    await fetch(`http://localhost:8003/kitchen/update_status/${orderId}?status=${status}&reason=${encodeURIComponent(reason)}`, { method: "POST" });
    await fetch(`http://localhost:8002/order/update_status/${orderId}?status=${status}`, { method: "POST" });
    document.getElementById("sound-status-update").play().catch(() => {});
    fetchOrders();
    logHistory(orderId, status, reason);
  } catch (err) {
    alert("Gagal update status ke kitchen/order service");
  }
}

function logHistory(orderId, status, reason = "") {
  console.log(`[LOG] Order ${orderId} → Status: ${status} ${reason ? "| Alasan: " + reason : ""}`);
}

function renderOrders(orders) {
  const active = document.getElementById("active-orders");
  const inactive = document.getElementById("inactive-orders");
  const pending = document.getElementById("pending-orders");
  active.innerHTML = "";
  inactive.innerHTML = "";
  pending.innerHTML = "";
  
  orders.sort((a, b) => new Date(b.time_receive) - new Date(a.time_receive));
  
  orders.forEach(o => {
    if (!o.order_id || !o.detail) return;
    
    const card = document.createElement("div");
    card.className = `card ${statusColors[o.status] || "bg-white"}`;
    card.onclick = () => openDetailModal(o);
    
    const time = new Date(o.time_receive).toLocaleString("id-ID");
    const timeDone = o.time_done ? new Date(o.time_done).toLocaleString("id-ID") : null;
    
    card.innerHTML = `
      <div class="flex justify-between items-center border-b-2 border-black mb-2 px-2 py-1 bg-yellow-300">
        👤 ${o.customer_name ?? '-'}
        ${["receive", "making", "deliver"].includes(o.status) ? `<button class="btn-close" onclick="event.stopPropagation(); openConfirmModal('${o.order_id}')">&times;</button>` : ""}
      </div>
      <div class="text-sm">#${o.order_id} <span class="ml-2 font-bold text-blue-700">Antrian: ${typeof o.queue_number === 'number' ? o.queue_number : '-'}</span></div>
      <div class="text-xs text-gray-500">🕒 ${time}</div>
      <div class="text-xs">🏠 ${o.room_name ?? '-'} </div>
      <div class="text-xs">🪑 Meja ${o.table_no ?? '-'} </div>
      <div class="font-bold text-lg mt-1">${o.detail}</div>
      <div class="text-xs mt-1">Status: ${o.status}</div>
      ${timeDone ? `<div class="text-xs mt-1 text-gray-600">📅 Selesai: ${timeDone}</div>` : ""}
      ${o.status === 'pending' && o.pending_reason ? `<div class='text-xs mt-1 text-yellow-700'>⏳ Alasan: ${o.pending_reason}</div>` : ""}
    `;
    
    // Tombol update status (kecuali pending/done/cancel/habis)
    if (statusFlow[o.status]) {
      const btn = document.createElement("button");
      btn.textContent = `➡️ ${statusFlow[o.status]}`;
      btn.className = "btn-action";
      btn.onclick = async (e) => {
        e.stopPropagation();
        await syncUpdate(o.order_id, statusFlow[o.status]);
      };
      card.appendChild(btn);
    }
    
    // Tombol khusus update ke pending (hanya jika status 'receive')
    if (o.status === "receive") {
      const btnPending = document.createElement("button");
      btnPending.textContent = "⏳ Jadikan Pending";
      btnPending.className = "btn-action mt-2 bg-yellow-100 text-yellow-900 border-yellow-600";
      btnPending.onclick = async (e) => {
        e.stopPropagation();
        const reason = prompt("Masukkan alasan pending:", "");
        if (!reason) return;
        await syncUpdate(o.order_id, "pending", reason);
      };
      card.appendChild(btnPending);
    }
    
    // Tombol khusus update dari pending ke making
    if (o.status === "pending") {
      const btnMaking = document.createElement("button");
      btnMaking.textContent = "🔄 Jadikan Making";
      btnMaking.className = "btn-action mt-2 bg-blue-100 text-blue-900 border-blue-600";
      btnMaking.onclick = async (e) => {
        e.stopPropagation();
        await syncUpdate(o.order_id, "making");
      };
      card.appendChild(btnMaking);
    }
    
    if (["receive", "making", "deliver"].includes(o.status)) {
      active.appendChild(card);
    } else if (o.status === "pending") {
      pending.appendChild(card);
    } else {
      inactive.appendChild(card);
    }
  });
}

function fetchOrders() {
  fetch("http://localhost:8003/kitchen/orders")
    .then(res => res.json())
    .then(data => renderOrders(data))
    .catch(() => document.getElementById("offline-banner").classList.remove("hidden"));
}

async function fetchKitchenStatus() {
  try {
    const res = await fetch("http://localhost:8003/kitchen/status/now");
    const data = await res.json();
    updateKitchenStatusUI(data.is_open);
  } catch {
    updateKitchenStatusUI(false);
  }
}

async function setKitchenStatus(isOpen) {
  try {
    await fetch("http://localhost:8003/kitchen/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isOpen)
    });
    fetchKitchenStatus();
  } catch {
    alert("Gagal mengubah status dapur");
  }
}

function updateKitchenStatusUI(isOpen) {
  const label = document.getElementById("kitchen-status-label");
  const btn = document.getElementById("toggle-kitchen-btn");
  const offBanner = document.getElementById("kitchen-off-banner");
  
  label.textContent = isOpen ? "Dapur: ON" : "Dapur: OFF";
  btn.textContent = isOpen ? "Matikan Dapur" : "Nyalakan Dapur";
  btn.onclick = () => setKitchenStatus(!isOpen);
  btn.disabled = false; // pastikan tombol ON/OFF selalu aktif
  
  if (!isOpen) {
    offBanner.classList.remove("hidden");
    // Disable semua tombol order/action KECUALI tombol ON/OFF
    document.querySelectorAll(".btn-action").forEach(b => {
      if (b.id !== "toggle-kitchen-btn") b.disabled = true;
    });
  } else {
    offBanner.classList.add("hidden");
    document.querySelectorAll(".btn-action").forEach(b => {
      if (b.id !== "toggle-kitchen-btn") b.disabled = false;
    });
  }
}

// Panggil saat halaman load
fetchKitchenStatus();

const es = new EventSource("http://localhost:8003/stream/orders");
let updateTimeout = null;

es.onmessage = () => {
  if (updateTimeout) clearTimeout(updateTimeout);
  updateTimeout = setTimeout(async () => {
    const res = await fetch("http://localhost:8003/kitchen/orders");
    const data = await res.json();
    const activeIds = data.filter(o => ["receive", "making", "deliver"].includes(o.status)).map(o => o.order_id);
    const lastIds = JSON.parse(localStorage.getItem("lastActiveOrderIds") || "[]");
    const newOrder = activeIds.some(id => !lastIds.includes(id));
    const isInactiveTab = !document.getElementById("inactive-orders").classList.contains("hidden");
    
    if (newOrder) {
      document.getElementById("sound-new-order").play().catch(() => {});
      if (isInactiveTab) switchTab("active");
    }
    
    localStorage.setItem("lastActiveOrderIds", JSON.stringify(activeIds));
    renderOrders(data);
  }, 1000);
};

// Global functions untuk event handlers
window.openConfirmModal = openConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.confirmCancel = confirmCancel;
window.switchTab = switchTab;
window.openDetailModal = openDetailModal;
window.closeDetailModal = closeDetailModal;

// Initialize dengan tab active
switchTab("active");