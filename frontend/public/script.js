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
  const sidebar = document.querySelector('.sidebar');
  document.body.classList.remove('tab-active', 'tab-done');
  document.body.classList.add(tab === 'active' ? 'tab-active' : 'tab-done');
  
  if (tab === 'active') {
    activeBtn.classList.add('tab-active');
    doneBtn.classList.remove('tab-active');
    orderColumns.classList.remove('hidden');
    doneOrders.classList.add('hidden');
    if (sidebar) sidebar.classList.remove('hidden');
  } else {
    activeBtn.classList.remove('tab-active');
    doneBtn.classList.add('tab-active');
    orderColumns.classList.add('hidden');
    doneOrders.classList.remove('hidden');
    if (sidebar) sidebar.classList.add('hidden');
  }
  
  fetchOrders();
}

// Highlight order card in active tab when order id in summary is clicked
function highlightOrderCard(orderId) {
  // Remove highlight from all order cards
  document.querySelectorAll('.order-card--highlight').forEach(card => {
    card.classList.remove('order-card--highlight');
  });
  // Find and highlight the card with matching order id
  const card = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
  if (card) {
    card.classList.add('order-card--highlight');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
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
  // Use order.items if available, else parse from detail
  const items = order.items && Array.isArray(order.items) && order.items.length > 0
    ? order.items
    : (order.detail || '').split('\n').filter(item => item.trim()).map(item => {
        // fallback parse
        const [main, notesPart] = item.split(' - Notes:');
        let name = main;
        let variant = '';
        let qty = '';
        const variantMatch = main.match(/^(\d+)x ([^(]+) \(([^)]+)\)$/);
        if (variantMatch) {
          qty = variantMatch[1] + 'x';
          name = variantMatch[2].trim();
          variant = variantMatch[3].trim();
        } else {
          const noVarMatch = main.match(/^(\d+)x ([^(]+)$/);
          if (noVarMatch) {
            qty = noVarMatch[1] + 'x';
            name = noVarMatch[2].trim();
          }
        }
        return { menu_name: name, quantity: qty, preference: variant, notes: notesPart ? notesPart.trim() : '' };
      });
  const itemsHtml = items.map(item => {
    return `<div style='margin-bottom:4px;'><b>${item.menu_name}</b>${item.preference ? ' <span style=\"color:#888;font-size:13px;\">(' + item.preference + ')</span>' : ''} - ${item.quantity}${item.notes ? `<div style='font-size:12px;color:#888;margin-top:2px;'><b>Notes:</b> ${item.notes}</div>` : ''}</div>`;
  }).join('');
  box.innerHTML = `
    <p><strong>Order ID:</strong> ${order.order_id}</p>
    <p><strong>Nama:</strong> ${order.customer_name}</p>
    <p><strong>Ruangan:</strong> ${order.room_name}</p>
    <p><strong>Status:</strong> ${order.status}</p>
    <p><strong>Waktu:</strong> ${new Date(order.time_receive).toLocaleString("id-ID")}</p>
    <div style='margin-top:10px;'><strong>Detail:</strong><br>${itemsHtml}</div>
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
    await fetch(`/kitchen/update_status/${orderId}?status=${status}&reason=${encodeURIComponent(reason)}`, { method: "POST" });
          // Removed direct call to order service - now handled by gateway
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
  card.setAttribute('data-order-id', order.order_id);
  card.onclick = () => openDetailModal(order);

  // Ambil nomor antrian dari mapping global
  const queueNumber = (window._orderIdToQueue && window._orderIdToQueue[order.order_id]) ? window._orderIdToQueue[order.order_id] : (order.queue_number || order.order_id);

  const time = new Date(order.time_receive).toLocaleString("id-ID");
  const timeDone = order.time_done ? new Date(order.time_done).toLocaleString("id-ID") : null;

  // Use order.items if available, else parse from detail
  const items = order.items && Array.isArray(order.items) && order.items.length > 0
    ? order.items
    : (order.detail || '').split('\n').filter(item => item.trim()).map(item => {
        const [main, notesPart] = item.split(' - Notes:');
        let name = main;
        let variant = '';
        let qty = '';
        const variantMatch = main.match(/^(\d+)x ([^(]+) \(([^)]+)\)$/);
        if (variantMatch) {
          qty = variantMatch[1] + 'x';
          name = variantMatch[2].trim();
          variant = variantMatch[3].trim();
        } else {
          const noVarMatch = main.match(/^(\d+)x ([^(]+)$/);
          if (noVarMatch) {
            qty = noVarMatch[1] + 'x';
            name = noVarMatch[2].trim();
          }
        }
        return { menu_name: name, quantity: qty, preference: variant, notes: notesPart ? notesPart.trim() : '' };
      });
  const itemsHtml = items.map(item => {
    return `
      <div class="order-item">
        <div class="item-content">
          <div class="item-main">
            <span class="item-name">${item.menu_name}${item.preference ? ' <span class="item-variant">(' + item.preference + ')</span>' : ''}</span>
            <span class="item-quantity">${item.quantity}</span>
          </div>
          ${item.notes ? `<div class="item-notes"><span class="notes-label">Notes:</span> ${item.notes}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Status badge
  let statusBadge = '';
  let actionButton = '';

  if (order.status === 'receive') {
    statusBadge = '<span class="status-badge status-receive"><i class="fa-solid fa-receipt"></i> RECEIVE</span>';
    actionButton = `<button class="action-btn action-btn-orange" onclick="event.stopPropagation(); syncUpdate('${order.order_id}', 'making')">MAKING <i class="fa-solid fa-arrow-right"></i></button>`;
  } else if (order.status === 'making') {
    statusBadge = '<span class="status-badge status-making"><i class="fa-solid fa-clock"></i> MAKING</span>';
    actionButton = `<button class="action-btn action-btn-blue" onclick="event.stopPropagation(); syncUpdate('${order.order_id}', 'deliver')">DELIVER <i class="fa-solid fa-arrow-right"></i></button>`;
  } else if (order.status === 'deliver') {
    statusBadge = '<span class="status-badge status-deliver"><i class="fa-solid fa-truck"></i> DELIVER</span>';
    actionButton = `<button class="action-btn action-btn-green" onclick="event.stopPropagation(); syncUpdate('${order.order_id}', 'done')">DONE <i class="fa-solid fa-arrow-right"></i></button>`;
  }
  else if (order.status === 'done') {
    statusBadge = '<span class="status-badge status-done"><i class="fa-solid fa-check"></i> DONE</span>';
    actionButton = `<button class="action-btn action-btn-green-disabled">DONE</button>`;
  }
  else if (order.status === 'cancel') {
    statusBadge = '<span class="status-badge status-cancel"><i class="fa-solid fa-xmark"></i> CANCEL</span>';
    actionButton = `<button class="action-btn action-btn-red-disabled">CANCEL</button>`;
  }
  else if (order.status === 'habis') {
    statusBadge = '<span class="status-badge status-cancel"><i class="fa-solid fa-xmark"></i> CANCEL</span>';
    actionButton = `<button class="action-btn action-btn-red-disabled">CANCEL</button>`;
  }

  card.innerHTML = `
    <div class="order-header">
      <span class="order-number">${queueNumber ? `#${queueNumber}` : ''}</span>
      <span class="customer-name">${order.customer_name ?? 'John Doe'}</span>
      ${["receive", "making", "deliver"].includes(order.status) ? `<button class="order-close" onclick="event.stopPropagation(); openConfirmModal('${order.order_id}')">&times;</button>` : ""}
    </div>
    <div class="order-contents">
        <div class="order-location">
            <span class="location-icon"><i class="fa-solid fa-location-dot"></i></span>
            <span class="location-text">Lantai ${order.table_no ?? '2'}</span>
            ${statusBadge}
        </div>
        <div class="order-timestamp">${time}</div>
        <div class="order-items">${itemsHtml}</div>
        <div class="order-footer">
            <span class="details-button">DETAILS <i class="fa-solid fa-chevron-right"></i></span>
        </div>
    ${actionButton}
    </div>
  `;

  return card;
}

function renderOrders(orders) {
  const newOrderColumn = document.getElementById("new-order-column");
  const makingColumn = document.getElementById("making-column");
  const deliverColumn = document.getElementById("deliver-column");
  const doneOrderColumn = document.getElementById("done-order-column");
  const cancelOrderColumn = document.getElementById("cancel-order-column");
  
  // Clear all columns completely
  newOrderColumn.innerHTML = '';
  makingColumn.innerHTML = '';
  deliverColumn.innerHTML = '';
  doneOrderColumn.innerHTML = '';
  cancelOrderColumn.innerHTML = '';
  
  // Validate and filter orders
  const validOrders = orders.filter(order => order && order.order_id && order.detail);
  
  // Sort orders by time received (FIFO)
  validOrders.sort((a, b) => new Date(a.time_receive) - new Date(b.time_receive));
  
  validOrders.forEach(order => {
    const orderCard = createOrderCard(order);
    
    // Place order in appropriate column based on status
    if (order.status === 'receive') {
      newOrderColumn.appendChild(orderCard);
    } else if (order.status === 'making') {
      makingColumn.appendChild(orderCard);
    } else if (order.status === 'deliver') {
      deliverColumn.appendChild(orderCard);
    } else if (order.status === 'done') {
      doneOrderColumn.appendChild(orderCard);
    } else if (order.status === 'cancel' || order.status === 'habis') {
      cancelOrderColumn.appendChild(orderCard);
    }
  });
  
  // Update sidebar summary with fresh data
  updateSummary(validOrders);
}

function updateSummary(orders) {
  // Reset global mapping to prevent stale data
  window._orderIdToQueue = {};
  
  // Ambil tanggal hari ini (YYYY-MM-DD)
  const todayStr = new Date().toISOString().slice(0, 10);
  // Filter orders yang time_receive-nya hari ini
  const todayOrders = orders.filter(order => {
    if (!order.time_receive) return false;
    const orderDate = new Date(order.time_receive).toISOString().slice(0, 10);
    return orderDate === todayStr;
  });
  // Urutkan orders hari ini berdasarkan waktu (FIFO)
  const sortedOrders = [...todayOrders]
    .sort((a, b) => new Date(a.time_receive) - new Date(b.time_receive));
  // Map order_id ke nomor antrian hari ini
  const orderIdToQueue = {};
  sortedOrders.forEach((order, idx) => {
    orderIdToQueue[order.order_id] = idx + 1;
  });

  const activeOrders = orders.filter(order => ['receive', 'making', 'deliver'].includes(order.status));
  const summary = {};
  activeOrders.forEach(order => {
    // Use order.items if available, else parse from detail
    let items = [];
    if (order.items && Array.isArray(order.items) && order.items.length > 0) {
      items = order.items;
    } else {
      // Fallback: parse from detail string
      const detailItems = order.detail.split('\n').filter(item => item.trim());
      items = detailItems.map(item => {
        const parts = item.split(' - ');
        const mainPart = parts[0] || item;
        const notes = parts[1] || '';
        
        // Parse quantity and name from main part
        const match = mainPart.match(/^(\d+)x\s+(.+?)(?:\s+\(([^)]+)\))?$/);
        if (match) {
          return {
            quantity: parseInt(match[1]),
            menu_name: match[2].trim(),
            preference: match[3] || '',
            notes: notes
          };
        } else {
          return {
            quantity: 1,
            menu_name: mainPart.trim(),
            preference: '',
            notes: notes
          };
        }
      });
    }
    
    items.forEach(item => {
      const name = item.menu_name;
      const variant = item.preference;
      const notes = item.notes;
      
      if (!summary[name]) {
        summary[name] = {
          count: 0,
          orders: [],
          variants: [],
          firstQueueNumber: Infinity // Untuk mengurutkan menu berdasarkan antrian terkecil
        };
      }
      summary[name].count += item.quantity || 1;
      const queueNumber = orderIdToQueue[order.order_id] || Infinity;
      summary[name].firstQueueNumber = Math.min(summary[name].firstQueueNumber, queueNumber);
      summary[name].orders.push({
        id: order.order_id,
        label: `#${order.order_id.toString().padStart(2, '0')}`,
        variant,
        notes,
        customer: order.customer_name ?? '',
        queue: queueNumber,
        time_receive: order.time_receive
      });
      if (variant) {
        summary[name].variants.push(variant);
      }
    });
  });

  const sidebarContent = document.querySelector('.sidebar-content');
  // Clear all content except the title
  const existingTitle = sidebarContent.querySelector('.sidebar-title');
  sidebarContent.innerHTML = '';
  if (existingTitle) {
    sidebarContent.appendChild(existingTitle);
  }

  // Urutkan menu berdasarkan nomor antrian terkecil
  const sortedSummary = Object.entries(summary)
    .sort((a, b) => a[1].firstQueueNumber - b[1].firstQueueNumber);

  sortedSummary.forEach(([itemName, data]) => {
    // Urutkan orders dalam setiap menu berdasarkan nomor antrian
    data.orders.sort((a, b) => (a.queue || Infinity) - (b.queue || Infinity));
    
    // Remove duplicates from orders array
    const uniqueOrders = data.orders.filter((order, index, self) => 
      index === self.findIndex(o => o.id === order.id)
    );
    
    const summaryItem = document.createElement('div');
    summaryItem.className = 'summary-item';
    summaryItem.innerHTML = `
      <div class="summary-header">
        <span class="summary-name">${itemName}</span>
        <span class="summary-count">${data.count} <span style='font-weight:400'>×</span></span>
      </div>
      <table class="summary-table">
        <thead>
          <tr><th>Varian</th><th>Antrian</th><th>Notes</th></tr>
        </thead>
        <tbody>
          ${uniqueOrders.map(order => `
            <tr>
              <td>${order.variant || '-'}</td>
              <td><span class="summary-detail--order" data-order-id="${order.id}" title="${order.label}">${order.queue}</span></td>
              <td class="${order.notes && order.notes !== '-' ? 'has-notes' : ''}">${order.notes || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    sidebarContent.appendChild(summaryItem);
  });

  // Add click event for order id highlight
  sidebarContent.querySelectorAll('.summary-detail--order').forEach(el => {
    el.addEventListener('click', function(e) {
      const orderId = this.getAttribute('data-order-id');
      highlightOrderCard(orderId);
    });
  });

  // Simpan mapping orderIdToQueue ke window agar bisa dipakai di createOrderCard
  window._orderIdToQueue = orderIdToQueue;
}

function fetchOrders() {
  // Show loading state
  document.getElementById('offline-banner').classList.add('hidden');
  
      fetch("/kitchen/orders")
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
    const res = await fetch("/kitchen/status/now");
    const data = await res.json();
    updateKitchenStatusUI(data.is_open);
  } catch {
    updateKitchenStatusUI(false);
  }
}

async function setKitchenStatus(isOpen) {
  try {
    await fetch("/kitchen/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_open: isOpen })
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
//   statusText.textContent = isOpen ? 'BUKA' : 'TUTUP';
  
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

//
function initializeEventSource() {
  const eventSource = new EventSource("/stream/orders");
  let updateTimeout = null;
  
  eventSource.onmessage = () => {
    if (updateTimeout) clearTimeout(updateTimeout);
    updateTimeout = setTimeout(async () => {
      try {
        const res = await fetch("/kitchen/orders");
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
        
        // Force re-render with fresh data
        renderOrders(data);
      } catch (error) {
        console.error('Error fetching orders:', error);
      }
    }, 300); // Reduced from 1000ms to 300ms for faster updates
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

// Tambah Modal Add Order
function openAddOrderModal() {
  document.getElementById('add-order-modal').classList.remove('hidden');
  renderOrderItemsList();
  fetchMenuOptions();
}
function closeAddOrderModal() {
  document.getElementById('add-order-modal').classList.add('hidden');
  document.getElementById('add-order-form').reset();
  orderItems = [{ menu_name: '', quantity: 1, preference: '', notes: '' }];
  renderOrderItemsList();
}
// State untuk order items
let menuOptions = [];
let orderItems = [{ menu_name: '', quantity: 1, preference: '', notes: '' }];
async function fetchMenuOptions() {
  try {
    const res = await fetch('/menu');
    menuOptions = await res.json();
    renderOrderItemsList();
  } catch (e) {
    menuOptions = [];
    renderOrderItemsList();
  }
}
function renderOrderItemsList() {
  const list = document.getElementById('order-items-list');
  list.innerHTML = '';
  orderItems.forEach((item, idx) => {
    const block = document.createElement('div');
    block.className = 'order-item-block';
    // Remove button
    if (orderItems.length > 1) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-item-btn';
      removeBtn.innerHTML = '&times;';
      removeBtn.onclick = function() {
        orderItems.splice(idx, 1);
        if (orderItems.length === 0) orderItems.push({ menu_name: '', quantity: 1, preference: '', notes: '' });
        renderOrderItemsList();
      };
      block.appendChild(removeBtn);
    }
    // Item Order
    const menuLabel = document.createElement('label');
    menuLabel.textContent = 'Item Order';
    menuLabel.setAttribute('for', `menu_name_${idx}`);
    block.appendChild(menuLabel);
    const menuSelect = document.createElement('select');
    menuSelect.required = true;
    menuSelect.name = `menu_name_${idx}`;
    menuSelect.id = `menu_name_${idx}`;
    menuSelect.style = 'margin-bottom:0;';
    menuSelect.onchange = async function() {
      orderItems[idx].menu_name = this.value;
      orderItems[idx].preference = '';
      await renderOrderItemsList();
    };
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Select One';
    menuSelect.appendChild(defaultOpt);
    menuOptions.forEach(menu => {
      const opt = document.createElement('option');
      opt.value = menu.base_name;
      opt.textContent = menu.base_name;
      if (item.menu_name === menu.base_name) opt.selected = true;
      menuSelect.appendChild(opt);
    });
    block.appendChild(menuSelect);
    // Flavour
    const selectedMenu = menuOptions.find(m => m.base_name === item.menu_name);
    if (selectedMenu && selectedMenu.flavors && selectedMenu.flavors.length > 0) {
      const flavorLabel = document.createElement('label');
      flavorLabel.textContent = 'Flavour';
      flavorLabel.setAttribute('for', `preference_${idx}`);
      block.appendChild(flavorLabel);
      const flavorSelect = document.createElement('select');
      flavorSelect.name = `preference_${idx}`;
      flavorSelect.id = `preference_${idx}`;
      flavorSelect.required = false;
      const defaultFlavor = document.createElement('option');
      defaultFlavor.value = '';
      defaultFlavor.textContent = 'Select One';
      flavorSelect.appendChild(defaultFlavor);
      selectedMenu.flavors.forEach(f => {
        const opt = document.createElement('option');
        // Fallback ke flavor_name jika tidak ada f.name
        opt.value = f.name || f.flavor_name || '';
        opt.textContent = f.name || f.flavor_name || '';
        if ((item.preference || '') === (f.name || f.flavor_name || '')) opt.selected = true;
        flavorSelect.appendChild(opt);
      });
      flavorSelect.onchange = function() { orderItems[idx].preference = this.value; };
      block.appendChild(flavorSelect);
    }
    // Notes
    const notesLabel = document.createElement('label');
    notesLabel.textContent = 'Notes';
    notesLabel.setAttribute('for', `notes_${idx}`);
    block.appendChild(notesLabel);
    const notesInput = document.createElement('textarea');
    notesInput.id = `notes_${idx}`;
    notesInput.placeholder = 'e.g. Less ice';
    notesInput.value = item.notes || '';
    notesInput.oninput = function() { orderItems[idx].notes = this.value; };
    block.appendChild(notesInput);
    // Quantity
    const qtyLabel = document.createElement('label');
    qtyLabel.textContent = 'Quantity';
    qtyLabel.setAttribute('for', `quantity_${idx}`);
    block.appendChild(qtyLabel);
    const qtyRow = document.createElement('div');
    qtyRow.className = 'quantity-row';
    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'quantity-btn';
    minusBtn.textContent = '−';
    minusBtn.onclick = function() {
      if (orderItems[idx].quantity > 1) {
        orderItems[idx].quantity--;
        renderOrderItemsList();
      }
    };
    const qtyVal = document.createElement('span');
    qtyVal.className = 'quantity-value';
    qtyVal.textContent = item.quantity;
    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'quantity-btn';
    plusBtn.textContent = '+';
    plusBtn.onclick = function() {
      orderItems[idx].quantity++;
      renderOrderItemsList();
    };
    qtyRow.appendChild(minusBtn);
    qtyRow.appendChild(qtyVal);
    qtyRow.appendChild(plusBtn);
    block.appendChild(qtyRow);
    list.appendChild(block);
  });
}
document.getElementById('add-order-item-btn').onclick = function() {
  orderItems.push({ menu_name: '', quantity: 1, preference: '', notes: '' });
  renderOrderItemsList();
};
// Handle open modal
const addOrderBtn = document.querySelector('.add-order-btn');
if (addOrderBtn) addOrderBtn.onclick = openAddOrderModal;
// Handle submit
const addOrderForm = document.getElementById('add-order-form');
function showSuccessModal(message) {
  const modal = document.getElementById('success-modal');
  const msgBox = document.getElementById('success-message');
  msgBox.textContent = message;
  modal.classList.remove('hidden');
}
function closeSuccessModal() {
  document.getElementById('success-modal').classList.add('hidden');
}
addOrderForm.onsubmit = async function(e) {
  e.preventDefault();
  const customer_name = document.getElementById('customer_name').value.trim();
  // Only Room field exists, so use it for both room_name and table_no
  const room_name = document.getElementById('room_name').value.trim();
  const table_no = room_name; // Use room_name as table_no for now
  const orders = orderItems.filter(i => i.menu_name && i.quantity > 0).map(i => ({
    menu_name: i.menu_name,
    quantity: i.quantity,
    preference: i.preference,
    notes: i.notes
  }));
  if (!customer_name || !room_name || orders.length === 0) {
    alert('Mohon lengkapi semua data dan minimal 1 item pesanan.');
    return;
  }
  const submitBtn = addOrderForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';
  try {
    const res = await fetch('/create_order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name, table_no, room_name, orders })
    });
    const data = await res.json();
    if (data.status === 'success') {
      closeAddOrderModal();
      fetchOrders();
      showSuccessModal(data.message || 'Pesanan berhasil ditambahkan!');
    } else {
      alert(data.message || 'Gagal membuat pesanan.');
    }
  } catch (err) {
    alert('Gagal terhubung ke server order.');
  }
  submitBtn.disabled = false;
  submitBtn.textContent = 'Save Order';
};

function setupNavigation() {
    const currentPage = document.body.dataset.page;

    // Highlight tombol nav sesuai halaman
    document.querySelectorAll('.nav-btn').forEach(btn => {
        const btnPage = btn.id.replace('nav-', '');
        if (btnPage === currentPage) {
            btn.classList.add('active');
        }
    });

    // Add click event listeners for navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const targetUrl = this.getAttribute('data-url');
            if (targetUrl) {
                // Determine the correct route based on the button
                let route = '/dashboard';
                if (this.id === 'nav-menu') {
                    route = '/management-menu';
                } else if (this.id === 'nav-dashboard') {
                    route = '/dashboard';
                }
                window.location.href = route;
            }
        });
    });

    // Judul dinamis berdasarkan halaman
    const pageTitles = {
        dashboard: "Infinity Cafe",
        menu: "Management Menu",
        pesanan: "Daftar Pesanan",
        // tambahkan judul page lain disini
    };

    const navbarTitle = document.getElementById('navbar-title');
    if (navbarTitle && pageTitles[currentPage]) {
        navbarTitle.textContent = pageTitles[currentPage];
    }
}

// Initialize all functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  initializeKitchenToggle();
  initializeSearch();
  fetchKitchenStatus();
  switchTab('active');
  initializeEventSource();
  updateGreetingDate();
  setupNavigation();
  
  // Set greeting date to today in Indonesian format
  const greetingDate = document.querySelector('.greeting-date');
  if (greetingDate) {
    const today = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    greetingDate.textContent = today.toLocaleDateString('id-ID', options);
  }
});

// Global functions for event handlers
window.switchTab = switchTab;
window.openConfirmModal = openConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.confirmCancel = confirmCancel;
window.openDetailModal = openDetailModal;
window.closeDetailModal = closeDetailModal;
window.syncUpdate = syncUpdate;
window.openAddOrderModal = openAddOrderModal;
window.closeAddOrderModal = closeAddOrderModal;
window.showSuccessModal = showSuccessModal;
window.closeSuccessModal = closeSuccessModal;

// fungsi untuk menampilkan tanggal
function updateGreetingDate() {
    const dateElement = document.getElementById('greeting-date');
    const today = new Date();
    const day = today.getDate();
    const weekday = today.toLocaleDateString('en-US', { weekday: 'long' });
    const month = today.toLocaleDateString('en-US', { month: 'long' });
    const year = today.getFullYear();
    const ordinalSuffix = day > 3 && day < 21 ? 'th' : ['th', 'st', 'nd', 'rd', 'th'][day % 10] || 'th';
    const formattedDate = `${weekday}, ${day}${ordinalSuffix} ${month} ${year}`;
    dateElement.textContent = formattedDate;
}