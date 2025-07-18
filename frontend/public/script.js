// Status flow and configuration
const statusFlow = { receive: "making", making: "deliver", deliver: "done" };
const statusColors = {
  receive: "bg-yellow-100", making: "bg-blue-100",
  deliver: "bg-green-100", done: "bg-gray-200",
  cancel: "bg-red-100", habis: "bg-orange-100"
};

// Global variables
let selectedOrderId = null;
let selectedOrder = null;
let currentTab = 'active';

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
  initializeKitchenToggle();
  fetchKitchenStatus();
  switchTab('active');
  initializeEventSource();
});

// Kitchen toggle functionality
function initializeKitchenToggle() {
  const toggle = document.getElementById('kitchen-toggle');
  const statusText = document.getElementById('kitchen-status-text');
  
  toggle.addEventListener('change', function() {
    const isOpen = this.checked;
    setKitchenStatus(isOpen);
    statusText.textContent = isOpen ? 'BUKA' : 'TUTUP';
  });
}

// Tab switching functionality
function switchTab(tab) {
  currentTab = tab;
  const activeBtn = document.getElementById('tab-active');
  const doneBtn = document.getElementById('tab-done');
  const orderColumns = document.querySelector('.order-columns');
  const doneOrders = document.getElementById('done-orders');
  
  if (tab === 'active') {
    activeBtn.classList.add('tab-active');
    doneBtn.classList.remove('tab-active');
    orderColumns.classList.remove('hidden');
    doneOrders.classList.add('hidden');
  } else {
    activeBtn.classList.remove('tab-active');
    doneBtn.classList.add('tab-active');
    orderColumns.classList.add('hidden');
    doneOrders.classList.remove('hidden');
  }
  
  fetchOrders();
}

// Modal functions
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

// API functions
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

function createOrderCard(order) {
  const card = document.createElement("div");
  card.className = "order-card";
  card.onclick = () => openDetailModal(order);
  
  const time = new Date(order.time_receive).toLocaleString("id-ID");
  const timeDone = order.time_done ? new Date(order.time_done).toLocaleString("id-ID") : null;
  
  // Parse items from detail
  const items = order.detail.split('\n').filter(item => item.trim());
  const itemsHtml = items.map(item => {
    const parts = item.split(' - ');
    const name = parts[0] || item;
    const quantity = parts[1] || '1x';
    return `
      <div class="order-item">
        <span class="item-name">${name}</span>
        <span class="item-quantity">${quantity}</span>
      </div>
    `;
  }).join('');
  
  // Status badge
  let statusBadge = '';
  let actionButton = '';
  
  if (order.status === 'receive') {
    statusBadge = '<span class="status-badge status-receive">RECEIVE</span>';
    actionButton = `<button class="action-btn action-btn-orange" onclick="event.stopPropagation(); syncUpdate('${order.order_id}', 'making')">MAKING →</button>`;
  } else if (order.status === 'making') {
    statusBadge = '<span class="status-badge status-making">MAKING</span>';
    actionButton = `<button class="action-btn action-btn-blue" onclick="event.stopPropagation(); syncUpdate('${order.order_id}', 'deliver')">DELIVER →</button>`;
  } else if (order.status === 'deliver') {
    statusBadge = '<span class="status-badge status-deliver">DELIVER</span>';
    actionButton = `<button class="action-btn action-btn-green" onclick="event.stopPropagation(); syncUpdate('${order.order_id}', 'done')">DONE →</button>`;
  }
  
  card.innerHTML = `
    <div class="order-header">
      <span class="order-number">#${order.order_id.toString().padStart(2, '0')}</span>
      <span class="customer-name">${order.customer_name ?? 'John Doe'}</span>
      ${["receive", "making", "deliver"].includes(order.status) ? `<button class="order-close" onclick="event.stopPropagation(); openConfirmModal('${order.order_id}')">&times;</button>` : ""}
    </div>
    <div class="order-location">
      <span class="location-icon">📍</span>
      <span class="location-text">Lantai ${order.table_no ?? '2'}</span>
      ${statusBadge}
    </div>
    <div class="order-timestamp">${time}</div>
    <div class="order-items">${itemsHtml}</div>
    <div class="order-footer">
      <span class="order-drink">Antrian ${order.queue_number ?? '1'}</span>
    </div>
    ${actionButton}
  `;
  
  return card;
}

function renderOrders(orders) {
  const newOrderColumn = document.getElementById("new-order-column");
  const makingColumn = document.getElementById("making-column");
  const deliverColumn = document.getElementById("deliver-column");
  const doneOrderGrid = document.getElementById("done-order-grid");
  
  // Clear all columns
  newOrderColumn.innerHTML = '';
  makingColumn.innerHTML = '';
  deliverColumn.innerHTML = '';
  doneOrderGrid.innerHTML = '';
  
  // Sort orders by time received (newest first)
  orders.sort((a, b) => new Date(b.time_receive) - new Date(a.time_receive));
  
  orders.forEach(order => {
    if (!order.order_id || !order.detail) return;
    
    const orderCard = createOrderCard(order);
    
    // Place order in appropriate column based on status
    if (order.status === 'receive') {
      newOrderColumn.appendChild(orderCard);
    } else if (order.status === 'making') {
      makingColumn.appendChild(orderCard);
    } else if (order.status === 'deliver') {
      deliverColumn.appendChild(orderCard);
    } else if (['done', 'cancel', 'habis'].includes(order.status)) {
      doneOrderGrid.appendChild(orderCard);
    }
  });
  
  // Update sidebar summary
  updateSummary(orders);
}

function updateSummary(orders) {
  const activeOrders = orders.filter(order => ['receive', 'making', 'deliver'].includes(order.status));
  const summary = {};
  
  activeOrders.forEach(order => {
    const items = order.detail.split('\n').filter(item => item.trim());
    items.forEach(item => {
      const parts = item.split(' - ');
      const name = parts[0] || item;
      const variant = parts[1] || '';
      
      if (!summary[name]) {
        summary[name] = {
          count: 0,
          orders: [],
          variants: []
        };
      }
      
      summary[name].count++;
      summary[name].orders.push(`#${order.order_id.toString().padStart(2, '0')}`);
      if (variant) {
        summary[name].variants.push(variant);
      }
    });
  });
  
  const sidebarContent = document.querySelector('.sidebar-content');
  const existingTitle = sidebarContent.querySelector('.sidebar-title');
  
  // Clear existing summary items
  while (sidebarContent.children.length > 1) {
    sidebarContent.removeChild(sidebarContent.lastChild);
  }
  
  // Add new summary items
  Object.entries(summary).forEach(([itemName, data]) => {
    const summaryItem = document.createElement('div');
    summaryItem.className = 'summary-item';
    
    summaryItem.innerHTML = `
      <div class="summary-header">
        <span class="summary-name">${itemName}</span>
        <span class="summary-count">${data.count}</span>
      </div>
      <div class="summary-details">
        ${data.orders.map(order => `<span class="summary-detail">${order}</span>`).join('')}
      </div>
      <div class="summary-variants">
        <div class="variant-item">
          ${data.variants.map(variant => `<span>${variant}</span>`).join('')}
        </div>
      </div>
    `;
    
    sidebarContent.appendChild(summaryItem);
  });
}

function fetchOrders() {
  // Show loading state
  document.getElementById('offline-banner').classList.add('hidden');
  
  fetch("http://localhost:8003/kitchen/orders")
    .then(res => {
      if (!res.ok) {
        throw new Error('Network response was not ok');
      }
      return res.json();
    })
    .then(data => {
      renderOrders(data);
    })
    .catch(() => {
      document.getElementById("offline-banner").classList.remove("hidden");
    });
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
  const toggle = document.getElementById('kitchen-toggle');
  const statusText = document.getElementById('kitchen-status-text');
  const offBanner = document.getElementById('kitchen-off-banner');
  
  toggle.checked = isOpen;
  statusText.textContent = isOpen ? 'BUKA' : 'TUTUP';
  
  if (!isOpen) {
    offBanner.classList.remove('hidden');
    // Disable all action buttons when kitchen is closed
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.disabled = true;
    });
  } else {
    offBanner.classList.add('hidden');
    // Enable all action buttons when kitchen is open
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.disabled = false;
    });
  }
}

function initializeEventSource() {
  const eventSource = new EventSource("http://localhost:8003/stream/orders");
  let updateTimeout = null;
  
  eventSource.onmessage = () => {
    if (updateTimeout) clearTimeout(updateTimeout);
    updateTimeout = setTimeout(async () => {
      try {
        const res = await fetch("http://localhost:8003/kitchen/orders");
        const data = await res.json();
        
        // Check for new orders
        const activeIds = data.filter(o => ["receive", "making", "deliver"].includes(o.status)).map(o => o.order_id);
        const lastIds = JSON.parse(localStorage.getItem("lastActiveOrderIds") || "[]");
        const newOrder = activeIds.some(id => !lastIds.includes(id));
        
        if (newOrder) {
          document.getElementById("sound-new-order").play().catch(() => {});
          // Switch to active tab if new order comes in while viewing done orders
          if (currentTab === 'done') {
            switchTab('active');
          }
        }
        
        localStorage.setItem("lastActiveOrderIds", JSON.stringify(activeIds));
        renderOrders(data);
      } catch (error) {
        console.error('Error fetching orders:', error);
      }
    }, 1000);
  };
  
  eventSource.onerror = (error) => {
    console.error('EventSource error:', error);
    document.getElementById("offline-banner").classList.remove("hidden");
  };
  
  eventSource.onopen = () => {
    console.log('EventSource connected');
    document.getElementById("offline-banner").classList.add("hidden");
  };
}

// Search functionality
function initializeSearch() {
  const searchInput = document.querySelector('.search-input');
  searchInput.addEventListener('input', function(e) {
    const searchTerm = e.target.value.toLowerCase();
    const orderCards = document.querySelectorAll('.order-card');
    
    orderCards.forEach(card => {
      const orderNumber = card.querySelector('.order-number').textContent.toLowerCase();
      const customerName = card.querySelector('.customer-name').textContent.toLowerCase();
      const orderItems = card.querySelector('.order-items').textContent.toLowerCase();
      
      if (orderNumber.includes(searchTerm) || 
          customerName.includes(searchTerm) || 
          orderItems.includes(searchTerm)) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  });
}

// Add new order functionality
function addNewOrder() {
  alert('Fungsi tambah pesanan baru akan diimplementasikan');
}

// Initialize all functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  initializeKitchenToggle();
  initializeSearch();
  fetchKitchenStatus();
  switchTab('active');
  initializeEventSource();
  
  // Add click event to "ADD PESANAN BARU" button
  document.querySelector('.add-order-btn').addEventListener('click', addNewOrder);
});

// Global functions for event handlers
window.switchTab = switchTab;
window.openConfirmModal = openConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.confirmCancel = confirmCancel;
window.openDetailModal = openDetailModal;
window.closeDetailModal = closeDetailModal;
window.syncUpdate = syncUpdate;