// Remove highlight from order cards when clicking outside summary/order
document.addEventListener('click', function(e) {
  if (!e.target.closest('.summary-detail--order') && !e.target.closest('.order-card')) {
    document.querySelectorAll('.order-card--highlight').forEach(card => {
      card.classList.remove('order-card--highlight');
    });
  }
});
// Login guard
if (!localStorage.getItem('access_token')) {
  window.location.href = '/login';
}

// Fungsi untuk mendekode token JWT
function parseJwt(token) {
  try {
    // Memisahkan header, payload, dan signature
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    // Decode base64 dan parse JSON
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('Error parsing JWT token:', e);
    return {};
  }
}

// Status flow and configuration
const statusFlow = { receive: "making", making: "deliver", deliver: "done" };
const statusColors = {
  receive: "bg-yellow-100", making: "bg-blue-100",
  deliver: "bg-green-100", done: "bg-gray-200",
  cancel: "bg-red-100", habis: "bg-orange-100"
};

// Helper function to format status display consistently
function formatStatusDisplay(status) {
  if (status === 'cancel' || status === 'cancelled') {
    return 'CANCELLED';
  }
  return status.toUpperCase();
}

// Global variables
let selectedOrder = null;
let selectedStatus = null;
let currentTab = 'active';

// Store for cancelled items grouped by order_id
let cancelledItemsStore = {};
let _isLoadingCancelled = false;

// Helper function to check if an item has been cancelled (robust matching)
function isItemCancelled(orderId, menuName, preference, itemId) {
  const norm = (s) => (s ?? '').toString().trim().toLowerCase();
  if (!cancelledItemsStore[orderId]) return false;
  const targetName = norm(menuName);
  const targetPref = norm(preference);
  const targetId = (itemId ?? '').toString();
  return cancelledItemsStore[orderId].cancelled_items.some(item => {
    const name = norm(item.menu_name || item.name || item.menu);
    const pref = norm(item.preference || item.variant || '');
    const cid = (item.item_id || item.id || '').toString();
    const nameMatch = name === targetName;
    const prefMatch = (!targetPref && !pref) || (pref === targetPref);
    const idMatch = targetId && cid && targetId === cid;
    // Prefer id match when present, else fallback to name+pref
    return (idMatch) || (nameMatch && prefMatch);
  });
}

// Fetch cancelled items from database on page load
async function fetchCancelledItems() {
  try {
    _isLoadingCancelled = true;
    const response = await fetch('/get_cancelled_items', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.status === 'success' && data.data) {
        // Reconstruct cancelledItemsStore from database data
        cancelledItemsStore = {};
        data.data.forEach(order => {
          if (order.cancelled_items && order.cancelled_items.length > 0) {
            // Prefer queue_number from backend to avoid client-side flicker
            const queueNumber = order.queue_number || (window._orderIdToQueue && window._orderIdToQueue[order.order_id]) || order.order_id;
              
            cancelledItemsStore[order.order_id] = {
              order_id: order.order_id,
              queue_number: queueNumber,
              customer_name: order.customer_name,
              room_name: order.room_name,
              time_cancelled: order.time_cancelled || null,
              cancelled_items: order.cancelled_items
            };
          }
        });
        console.log('✅ Loaded cancelled items from database:', cancelledItemsStore);
        renderCancelledItems();
        // Re-render orders so active columns exclude cancelled items just loaded
        try { fetchOrders(); } catch (e) { console.warn('fetchOrders after cancelled-items load failed:', e); }
      }
    }
  } catch (error) {
    console.error('Error fetching cancelled items:', error);
  }
  finally {
    _isLoadingCancelled = false;
  }
}

// Kitchen toggle functionality
function initializeKitchenToggle() {
  const toggle = document.getElementById('kitchen-toggle');
  
  toggle.addEventListener('change', function() {
    const isOpen = this.checked;
    setKitchenStatus(isOpen);
  });
  
  // Fetch initial kitchen status when page loads
  fetchKitchenStatus();
}

// Tab switching functionality
function switchTab(tab) {
  console.log('switchTab called with:', tab);
  currentTab = tab;
  const activeBtn = document.getElementById('tab-active');
  const doneBtn = document.getElementById('tab-done');
  const orderColumns = document.querySelector('.order-columns');
  const doneOrders = document.getElementById('done-orders');
  const sidebar = document.getElementById('sidebar');
  
  console.log('Elements found:', { activeBtn, doneBtn, orderColumns, doneOrders, sidebar });
  
  document.body.classList.remove('tab-active', 'tab-done');
  document.body.classList.add(tab === 'active' ? 'tab-active' : 'tab-done');
  
  if (tab === 'active') {
    if (activeBtn) activeBtn.classList.add('tab-active');
    if (doneBtn) doneBtn.classList.remove('tab-active');
    if (orderColumns) orderColumns.classList.remove('hidden');
    if (doneOrders) doneOrders.classList.add('hidden');
    if (sidebar) sidebar.classList.remove('hidden');
  } else {
    if (activeBtn) activeBtn.classList.remove('tab-active');
    if (doneBtn) doneBtn.classList.add('tab-active');
    if (orderColumns) orderColumns.classList.add('hidden');
    if (doneOrders) doneOrders.classList.remove('hidden');
    if (sidebar) sidebar.classList.add('hidden');
  }
  
  // Debounce a little to allow any preceding cancelled-items updates to settle
  setTimeout(() => fetchOrders(), 50);
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
    card.classList.remove('order-card--highlight');
    void card.offsetWidth;
    card.classList.add('order-card--highlight');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Modal functions


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
  // Add cancel reason if order is cancelled
  const cancelReasonHtml = order.cancel_reason ? `<p><strong>Alasan Pembatalan:</strong> <span style="color: #dc3545; font-style: italic;">${order.cancel_reason}</span></p>` : '';
  
  box.innerHTML = `
    <p><strong>Order ID:</strong> ${order.order_id}</p>
    <p><strong>Nama:</strong> ${order.customer_name}</p>
    <p><strong>Ruangan:</strong> ${order.room_name}</p>
    <p><strong>Status:</strong> ${formatStatusDisplay(order.status)}</p>
    <p><strong>Waktu:</strong> ${new Date(order.time_receive).toLocaleString("id-ID")}</p>
    ${cancelReasonHtml}
    <div style='margin-top:10px;'><strong>Detail:</strong><br>${itemsHtml}</div>
  `;
  document.getElementById("detail-modal").classList.remove("hidden");
}

function closeDetailModal() {
  selectedOrder = null;
  document.getElementById("detail-modal").classList.add("hidden");
}

// Item Detail Modal Functions
let selectedItem = null;
let selectedOrderForItem = null;
let selectedItemId = null;
let selectedItemIndex = null;

function openItemDetailModalByKey(orderId, itemIndex, itemId, dataKey) {
  console.log('Debug - openItemDetailModalByKey called');
  console.log('dataKey:', dataKey);
  console.log('itemDataStore:', window.itemDataStore);
  
  const itemData = window.itemDataStore && window.itemDataStore[dataKey];
  if (!itemData) {
    console.error('Item data not found for key:', dataKey);
    console.error('Available keys:', window.itemDataStore ? Object.keys(window.itemDataStore) : 'No itemDataStore');
    showErrorModal('Data item tidak ditemukan. Silakan refresh halaman dan coba lagi.');
    return;
  }
  
  console.log('Found itemData:', itemData);
  openItemDetailModal(orderId, itemIndex, itemId, itemData);
}

function openItemDetailModal(orderId, itemIndex, itemId, itemData) {
  // Reset custom reason input UI and show both buttons
  const customReasonContainer = document.getElementById('custom-reason-container-item');
  const customReasonInput = document.getElementById('custom-cancel-reason-item');
  const btnAlasanLain = document.getElementById('btn-alasan-lain-item');
  const btnConfirmAlasanLain = document.getElementById('btn-confirm-alasan-lain-item');
  const btnHabis = document.querySelector('#btn-habis-item, .modal-btn-habis');
  if (customReasonContainer && customReasonInput && btnAlasanLain && btnConfirmAlasanLain) {
    customReasonContainer.classList.add('hidden');
    customReasonInput.value = '';
    btnAlasanLain.classList.remove('hidden');
    btnConfirmAlasanLain.classList.add('hidden');
    if (btnHabis) btnHabis.classList.remove('hidden');
  }
  console.log('Debug - openItemDetailModal called');
  console.log('orderId:', orderId, 'itemIndex:', itemIndex, 'itemId:', itemId);
  console.log('itemData:', itemData);
  
  selectedOrderForItem = orderId;
  selectedItemIndex = itemIndex;
  selectedItemId = itemId;
  selectedItem = itemData;

  console.log('After setting - selectedItem:', selectedItem);

  // Populate modal with item data
  document.getElementById('item-detail-name').textContent = itemData.menu_name;
  document.getElementById('item-detail-quantity').textContent = `Qty: ${itemData.quantity}`;
  const prefEl = document.getElementById('item-detail-preference');
  if (itemData.preference) {
    prefEl.textContent = `(${itemData.preference})`;
    prefEl.classList.remove('hidden');
  } else {
    prefEl.textContent = '';
    prefEl.classList.add('hidden');
  }

  // Persist context on modal dataset for robust retrieval later
  const modalEl = document.getElementById('item-detail-modal');
  modalEl.dataset.orderId = orderId || '';
  modalEl.dataset.menuName = itemData.menu_name || '';
  modalEl.dataset.itemId = (itemData.id != null ? String(itemData.id) : '');
  modalEl.dataset.itemIndex = String(itemIndex);
  modalEl.dataset.preference = itemData.preference || '';
  modalEl.dataset.notes = itemData.notes || '';
  // Store additional order context for cancelled items
  const orderCard = document.querySelector(`[data-order-id="${orderId}"]`);
  if (orderCard) {
    const customerName = orderCard.querySelector('.customer-name')?.textContent || 'John Doe';
    const roomName = orderCard.querySelector('.location-text')?.textContent || 'Regular';
    modalEl.dataset.customerName = customerName;
    modalEl.dataset.roomName = roomName;
  }
  const notesElement = document.getElementById('item-detail-notes');
  if (itemData.notes) {
    notesElement.innerHTML = `<strong>Notes:</strong> ${itemData.notes}`;
    notesElement.classList.remove('hidden');
  } else {
    notesElement.classList.add('hidden');
    notesElement.innerHTML = '';
  }
  // Show modal
  document.getElementById('item-detail-modal').classList.remove('hidden');
}

function closeItemDetailModal() {
  selectedItem = null;
  selectedOrderForItem = null;
  selectedItemId = null;
  selectedItemIndex = null;
  // Keep dataset for robustness until modal is actually hidden
  document.getElementById('item-detail-modal').classList.add('hidden');
}

async function confirmCancelItem(type) {
  // type: 'lainnya' | 'habis'
  console.log('Debug - confirmCancelItem called');
  console.log('selectedOrderForItem:', selectedOrderForItem);
  console.log('selectedItem:', selectedItem);

  // Prefer dataset values from the modal for robustness
  const modalEl = document.getElementById('item-detail-modal');
  let orderId = (modalEl?.dataset?.orderId) || selectedOrderForItem || '';
  let itemId = modalEl?.dataset?.itemId || '';
  let menuName = (modalEl?.dataset?.menuName) || (selectedItem && selectedItem.menu_name) || document.getElementById('item-detail-name')?.textContent || '';

  console.log('Resolved values -> orderId:', orderId, 'itemId:', itemId, 'menuName:', menuName);

  if (!orderId || (!itemId && !menuName)) {
    showErrorModal('Data item tidak valid.');
    return;
  }

  let reason = '';
  if (type === 'lainnya') {
    // Ambil alasan dari input
    const input = document.getElementById('custom-cancel-reason-item');
    reason = input ? input.value.trim() : '';
    if (!reason) {
      showErrorModal('Mohon masukkan alasan pembatalan.');
      if (input) input.focus();
      return;
    }
  } else if (type === 'habis') {
    reason = 'Stok Habis';
  } else {
    reason = '';
  }

  if (!reason) {
    showErrorModal('Pilih alasan pembatalan.');
    return;
  }
  // Reset custom reason input UI
  const customReasonContainer = document.getElementById('custom-reason-container-item');
  const customReasonInput = document.getElementById('custom-cancel-reason-item');
  const btnAlasanLain = document.getElementById('btn-alasan-lain-item');
  const btnConfirmAlasanLain = document.getElementById('btn-confirm-alasan-lain-item');
  if (customReasonContainer && customReasonInput && btnAlasanLain && btnConfirmAlasanLain) {
    customReasonContainer.classList.add('hidden');
    customReasonInput.value = '';
    btnAlasanLain.classList.remove('hidden');
    btnConfirmAlasanLain.classList.add('hidden');
  }

  try {
    // Build payload preferring item_id when available
    const payload = itemId ? { order_id: orderId, item_id: itemId, reason } : { order_id: orderId, menu_name: menuName, reason };

    const response = await fetch('/cancel_order_item', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let errMsg = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData?.message) errMsg = errorData.message;
      } catch {}
      throw new Error(errMsg);
    }
    
    const result = await response.json();
    
    if (result.status === 'success') {
      console.log('✅ Item cancelled successfully:', result);
      
      // Add cancelled item to store
      const itemData = {
        menu_name: menuName,
        quantity: document.getElementById('item-detail-quantity').textContent.replace('Quantity: ', ''),
        preference: modalEl?.dataset?.preference || '',
        notes: modalEl?.dataset?.notes || '',
        customer_name: modalEl?.dataset?.customerName || result?.data?.customer_name || 'John Doe',
        room_name: modalEl?.dataset?.roomName || result?.data?.room_name || 'Regular'
      };
      
      console.log('Adding cancelled item to store:', { orderId, itemData, reason });
      addCancelledItem(orderId, itemData, reason);
      
      // Close modal before showing success modal to avoid flicker
      closeItemDetailModal();
      // Show success modal
      showSuccessModal(result.message || 'Item berhasil dibatalkan.');
      
      // Play notification sound
      try {
        document.getElementById("sound-status-update").play();
      } catch (e) {
        console.log('Sound notification failed:', e);
      }
      
      // Refresh orders to show updated data
      fetchOrders();
      
      // Refresh cancelled items from database and render
      await fetchCancelledItems();
      
      // Log the cancellation
      const loggedName = payload.menu_name || (result?.data?.cancelled_item?.menu_name) || menuName;
      logHistory(orderId, 'item_cancelled', `Item ${loggedName}: ${reason}`);
      
    } else {
      showErrorModal(result.message || 'Gagal membatalkan item.');
    }
  } catch (error) {
    console.error('Error canceling item:', error);
    showErrorModal(`Gagal membatalkan item: ${error.message}`);
  }
}

async function confirmCancel(type) {
  if (type === 'cancel') {
    showCustomReasonInputCancel();
    return;
  }
  let reason = '';
  if (type === 'habis') {
    reason = 'Habis';
    closeModal('confirm-modal');
    const finalStatus = selectedOrderStatus || 'cancelled';
    await cancelOrder(selectedOrderId, reason, finalStatus);
    return;
  } else if (type === 'lainnya') {
    const input = document.getElementById('custom-cancel-reason-cancel');
    reason = input ? input.value.trim() : '';
    if (!reason) {
      showErrorModal('Mohon masukkan alasan pembatalan.');
      if (input) input.focus();
      return;
    }
    closeModal('confirm-modal');
    const finalStatus = selectedOrderStatus || 'cancelled';
    await cancelOrder(selectedOrderId, reason, finalStatus);
    return;
  } else {
    // Default: do nothing
    return;
  }
}

function openConfirmModal(orderId, status) {
  selectedOrderId = orderId;
  selectedOrderStatus = status || 'cancelled';
  // Reset confirm modal state (input hidden, buttons reset)
  const customReasonContainer = document.getElementById('custom-reason-container-cancel');
  const customReasonInput = document.getElementById('custom-cancel-reason-cancel');
  const btnAlasanLain = document.getElementById('btn-alasan-lain-cancel');
  const btnConfirmAlasanLain = document.getElementById('btn-confirm-alasan-lain-cancel');
  const btnHabis = document.getElementById('btn-habis-cancel');
  if (customReasonContainer && customReasonInput && btnAlasanLain && btnConfirmAlasanLain && btnHabis) {
    customReasonContainer.classList.add('hidden');
    customReasonInput.value = '';
    btnAlasanLain.disabled = false;
    btnAlasanLain.classList.remove('disabled');
    btnAlasanLain.classList.remove('hidden');
    btnConfirmAlasanLain.classList.add('hidden');
    btnHabis.classList.remove('hidden');
  }
  document.getElementById('confirm-modal').classList.remove('hidden');
}
window.openConfirmModal = openConfirmModal;
// Show custom reason input for order cancel modal
function showCustomReasonInputCancel() {
  const customReasonContainer = document.getElementById('custom-reason-container-cancel');
  const customReasonInput = document.getElementById('custom-cancel-reason-cancel');
  const btnAlasanLain = document.getElementById('btn-alasan-lain-cancel');
  const btnConfirmAlasanLain = document.getElementById('btn-confirm-alasan-lain-cancel');
  const btnHabis = document.getElementById('btn-habis-cancel');
  if (customReasonContainer && customReasonInput && btnAlasanLain && btnConfirmAlasanLain && btnHabis) {
    customReasonContainer.classList.remove('hidden');
    customReasonInput.value = '';
    customReasonInput.focus();
    btnAlasanLain.classList.add('hidden'); // hide 'Alasan Lain' button
    btnConfirmAlasanLain.classList.remove('hidden'); // show OK button
    btnHabis.classList.add('hidden');
  }
}
window.showCustomReasonInputItem = showCustomReasonInputItem;
// Show custom reason input for item cancel modal
function showCustomReasonInputItem() {
  document.getElementById('custom-reason-container-item').classList.remove('hidden');
  document.getElementById('btn-alasan-lain-item').classList.add('hidden');
  document.getElementById('btn-confirm-alasan-lain-item').classList.remove('hidden');
  var btnHabis = document.querySelector('#btn-habis-item, .modal-btn-habis');
  if (btnHabis) btnHabis.classList.add('hidden');
  setTimeout(() => {
    document.getElementById('custom-cancel-reason-item').focus();
  }, 100);
}

// New function to cancel order using proper endpoint
async function cancelOrder(orderId, reason, status = 'cancelled') {
  try {
    const response = await fetch('/cancel_order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        order_id: orderId,
        cancel_reason: reason || 'Dibatalkan',
        reason: reason || 'Dibatalkan',
        status: status
      })
    });

    if (!response.ok) {
      let errMsg = `HTTP error! status: ${response.status}`;
      try {
        const errBody = await response.json();
        if (errBody?.message || errBody?.error) {
          errMsg = errBody.message || errBody.error;
        }
      } catch {}
      throw new Error(errMsg);
    }
    
    const result = await response.json();
    
    if (result.status === 'success') {
      document.getElementById("sound-status-update").play().catch(() => {});
      fetchOrders();
    logHistory(orderId, 'cancelled', reason || 'Dibatalkan');
    try { await fetchCancelledItems(); } catch (e) { console.warn('fetchCancelledItems after cancelOrder failed:', e); }
    showSuccessModal('Pesanan berhasil dibatalkan');
    } else {
      showErrorModal(result.message || 'Gagal membatalkan pesanan');
    }
  } catch (err) {
    showErrorModal("Gagal membatalkan pesanan: " + err.message);
  }
}

// Cancelled Items Functions
function addCancelledItem(orderId, itemData, reason) {
  if (!cancelledItemsStore[orderId]) {
    // Get queue number from global mapping
    const queueNumber = (window._orderIdToQueue && window._orderIdToQueue[orderId]) ? window._orderIdToQueue[orderId] : orderId;
    
    cancelledItemsStore[orderId] = {
      order_id: orderId,
      queue_number: queueNumber,
      customer_name: itemData.customer_name || 'John Doe',
      room_name: itemData.room_name || 'Regular',
      // Temporary; will be replaced by server-provided value on next fetchCancelledItems
      time_cancelled: new Date().toISOString(),
      cancelled_items: []
    };
  }
  
  cancelledItemsStore[orderId].cancelled_items.push({
    menu_name: itemData.menu_name,
    quantity: itemData.quantity,
    preference: itemData.preference,
    notes: itemData.notes,
    cancel_reason: reason,
    cancelled_at: new Date().toISOString(),
    item_id: itemData.id || undefined
  });
}

function createCancelledItemCard(cancelledOrder) {
  const card = document.createElement("div");
  card.className = "order-card"; // Menggunakan class yang sama dengan order card
  card.setAttribute('data-order-id', cancelledOrder.order_id);
  
  // Tambahkan click handler untuk modal detail
  card.onclick = () => openCancelledOrderDetailModal(cancelledOrder);

  const time = cancelledOrder.time_cancelled 
    ? new Date(cancelledOrder.time_cancelled).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) 
    : "-";
  const totalCancelledItems = cancelledOrder.cancelled_items.length;
  
  // Ambil queue number dari mapping global atau gunakan fallback
  const queueNumber = (window._orderIdToQueue && window._orderIdToQueue[cancelledOrder.order_id]) ? 
    window._orderIdToQueue[cancelledOrder.order_id] : 
    cancelledOrder.queue_number || cancelledOrder.order_id;

  const itemsHtml = cancelledOrder.cancelled_items.map(item => {
    return `
      <div class="order-item order-item-readonly order-item-cancelled">
        <div class="item-content">
          <div class="item-main">
            <span class="item-name item-name-cancelled">${item.menu_name}${item.preference ? ' <span class="item-variant">(' + item.preference + ')</span>' : ''}</span>
            <span class="item-quantity">${item.quantity}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Status badge untuk cancelled
  const statusBadge = '<span class="status-badge status-cancel"><i class="fa-solid fa-xmark"></i> CANCELLED</span>';
  const actionButton = `<button class="action-btn action-btn-red-disabled">CANCELLED</button>`;

  card.innerHTML = `
    <div class="order-header">
      <span class="order-number">${queueNumber ? `#${queueNumber}` : ''}</span>
      <span class="customer-name">${cancelledOrder.customer_name}</span>
    </div>
    <div class="order-contents">
        <div class="order-location">
            <span class="location-icon"><i class="fa-solid fa-location-dot"></i></span>
            <span class="location-text">${cancelledOrder.room_name}</span>
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

function openCancelledOrderDetailModal(cancelledOrder) {
  const box = document.getElementById("detail-content");
  
  // Buat detail string dari cancelled items
  const detailItems = cancelledOrder.cancelled_items.map(item => {
    return `${item.menu_name}${item.preference ? ' (' + item.preference + ')' : ''} - ${item.quantity}x${item.notes ? `\nNotes: ${item.notes}` : ''}`;
  }).join('\n');
  
  const queueNumber = (window._orderIdToQueue && window._orderIdToQueue[cancelledOrder.order_id]) ? 
    window._orderIdToQueue[cancelledOrder.order_id] : 
    cancelledOrder.queue_number || cancelledOrder.order_id;
  
  const time = cancelledOrder.time_cancelled 
    ? new Date(cancelledOrder.time_cancelled).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) 
    : "-";
  
  box.innerHTML = `
    <h3>📦 Detail Pesanan</h3>
    <p><strong>Order ID:</strong> ${cancelledOrder.order_id}</p>
    <p><strong>Nomor Antrian:</strong> #${queueNumber}</p>
    <p><strong>Nama:</strong> ${cancelledOrder.customer_name}</p>
    <p><strong>Ruangan:</strong> ${cancelledOrder.room_name}</p>
    <p><strong>Status:</strong> <span style="color: #dc3545; font-weight: bold;">CANCELLED</span></p>
    <p><strong>Waktu Pembatalan:</strong> ${time}</p>
    <p><strong>Detail Item yang Dibatalkan:</strong></p>
    <div style="background: #f8f9fa; padding: 10px; border-radius: 5px; margin: 10px 0; white-space: pre-line;">${detailItems}</div>
    
    <h4 style="color: #dc3545; margin-top: 20px;">📝 Alasan Pembatalan:</h4>
    <div style="background: #fee2e2; padding: 10px; border-radius: 5px; border-left: 4px solid #dc3545;">
      ${cancelledOrder.cancelled_items.map(item => {
        const r = item.cancel_reason || item.cancelled_reason || item.reason || 'Tidak ada alasan';
        return `• ${item.menu_name}: ${r}`;
      }).join('<br>')}
    </div>
  `;
  
  document.getElementById("detail-modal").classList.remove("hidden");
}

function renderCancelledItems() {
  const cancelOrderColumn = document.getElementById("cancel-order-column");
  if (!cancelOrderColumn) return;

  // Clear existing cancelled cards
  cancelOrderColumn.innerHTML = '';

  // Create cards for each cancelled order
  const entries = Object.values(cancelledItemsStore || {});
  entries.forEach(cancelledOrder => {
    const card = createCancelledItemCard(cancelledOrder);
    cancelOrderColumn.appendChild(card);
  });
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
    showErrorModal("Gagal update status ke kitchen/order service");
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
  const queueNumber = order.queue_number || (window._orderIdToQueue && window._orderIdToQueue[order.order_id]) || order.order_id;

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

  // Filter out cancelled items for active orders
  const activeItems = items.filter(it => !isItemCancelled(order.order_id, it.menu_name, it.preference, it.id));
  
  // If no active items, don't show the card in active columns
  if (activeItems.length === 0 && ['receive', 'making', 'deliver'].includes(order.status)) {
    // All items are cancelled, skip rendering in Active columns
    return null;
  }

  const itemsHtml = activeItems.map((item, index) => {
    // Create unique item identifier
    const itemIdentifier = item.id || `${order.order_id}_${index}_${item.menu_name}`;
    
    // Store item data in a global object to avoid JSON parsing issues
    if (!window.itemDataStore) window.itemDataStore = {};
    const dataKey = `${order.order_id}_${index}`;
    window.itemDataStore[dataKey] = item;
    
    // For done/cancelled orders, don't add interactive elements
    const isInteractive = ["receive", "making"].includes(order.status);
    const itemClass = isInteractive ? "order-item" : "order-item order-item-readonly";
    const onclickHandler = isInteractive ? `onclick="event.stopPropagation(); openItemDetailModalByKey('${order.order_id}', ${index}, '${itemIdentifier}', '${dataKey}')"` : '';
    
    return `
      <div class="${itemClass}" data-item-index="${index}" data-item-id="${itemIdentifier}" ${onclickHandler}>
        <div class="item-content-wrapper">
          <div class="item-content">
            <div class="item-main">
              <span class="item-name">${item.menu_name}${item.preference ? ' <span class="item-variant">(' + item.preference + ')</span>' : ''}</span>
              <span class="item-quantity">${item.quantity}</span>
            </div>
            ${item.notes ? `<div class="item-notes"><span class="notes-label">Notes:</span> ${item.notes}</div>` : ''}
        </div>
      </div> 
      ${isInteractive ? `
      <div class="item-actions">
        <button class="item-action-btn" onclick="event.stopPropagation(); openItemDetailModalByKey('${order.order_id}', ${index}, '${itemIdentifier}', '${dataKey}')" title="Cancel Item">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
      ` : ''}
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
    statusBadge = '<span class="status-badge status-deliver"><i class="fa-solid fa-bell-concierge"></i> DELIVER</span>';
    actionButton = `<button class="action-btn action-btn-green" onclick="event.stopPropagation(); syncUpdate('${order.order_id}', 'done')">DONE <i class="fa-solid fa-arrow-right"></i></button>`;
  }
  else if (order.status === 'done') {
    statusBadge = '<span class="status-badge status-done"><i class="fa-solid fa-check"></i> DONE</span>';
    actionButton = `<button class="action-btn action-btn-green-disabled">DONE</button>`;
  }
  else if (order.status === 'cancelled') {
    statusBadge = '<span class="status-badge status-cancel"><i class="fa-solid fa-xmark"></i> CANCELLED</span>';
    actionButton = `<button class="action-btn action-btn-red-disabled">CANCELLED</button>`;
  }
  else if (order.status === 'cancel') {
    statusBadge = '<span class="status-badge status-cancel"><i class="fa-solid fa-xmark"></i> CANCELLED</span>';
    actionButton = `<button class="action-btn action-btn-red-disabled">CANCELLED</button>`;
  }
  else if (order.status === 'habis') {
    statusBadge = '<span class="status-badge status-cancel"><i class="fa-solid fa-xmark"></i> CANCELLED</span>';
    actionButton = `<button class="action-btn action-btn-red-disabled">CANCELLED</button>`;
  }

  card.innerHTML = `
    <div class="order-header">
      <span class="order-number">${queueNumber ? `#${queueNumber}` : ''}</span>
      <span class="customer-name">${order.customer_name ?? 'John Doe'}</span>
  ${["receive", "making"].includes(order.status) ? `<button class="order-close" onclick=\"event.stopPropagation(); openConfirmModal('${order.order_id}', 'cancelled')\">&times;</button>` : ""}
    </div>
    <div class="order-contents">
        <div class="order-location">
            <span class="location-icon"><i class="fa-solid fa-location-dot"></i></span>
            <span class="location-text">${order.room_name ?? 'Regular'}</span>           
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
    if (!orderCard) {
      // Skip orders that have no active items to display
      return;
    }
    
    // Place order in appropriate column based on status
    if (order.status === 'receive') {
      newOrderColumn.appendChild(orderCard);
    } else if (order.status === 'making') {
      makingColumn.appendChild(orderCard);
    } else if (order.status === 'deliver') {
      deliverColumn.appendChild(orderCard);
    } else if (order.status === 'done') {
      doneOrderColumn.appendChild(orderCard);
    } else if (order.status === 'cancel' || order.status === 'habis' || order.status === 'cancelled') {
      cancelOrderColumn.appendChild(orderCard);
    }
  });
  
  // Render cancelled items in the cancel column
  renderCancelledItems();
  
  // Update sidebar summary with fresh data
  updateSummary(validOrders);
}

// Cache to stabilize queue mapping during a render cycle
let _queueMapVersion = 0;
function updateSummary(orders) {
  const version = ++_queueMapVersion;
  // Reset global mapping to prevent stale data
  const newMap = {};
  
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
    // Prefer backend-provided queue_number to avoid flicker; fallback to sequential index only if missing
    const qn = (order.queue_number != null && order.queue_number !== undefined) ? order.queue_number : (idx + 1);
    orderIdToQueue[order.order_id] = qn;
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
    
    // Exclude already-cancelled items from summary
    const activeItemsForSummary = items.filter(it => !isItemCancelled(order.order_id, it.menu_name, it.preference));

    activeItemsForSummary.forEach(item => {
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

  // Commit the queue map atomically to avoid flicker
  if (version === _queueMapVersion) {
    window._orderIdToQueue = orderIdToQueue;
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
  if (_isLoadingCancelled) {
    // Avoid flicker: delay until cancelled-items loading completes
    setTimeout(fetchOrders, 80);
    return;
  }
  
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
    if (!res.ok) {
      throw new Error('Failed to fetch kitchen status');
    }
    const data = await res.json();
    updateKitchenStatusUI(data.is_open);
  } catch (error) {
    console.error('Error fetching kitchen status:', error);
    updateKitchenStatusUI(false);
  }
}

async function setKitchenStatus(isOpen) {
  try {
    const res = await fetch("/kitchen/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_open: isOpen })
    });
    
    if (!res.ok) {
      throw new Error('Failed to update kitchen status');
    }
    
    await fetchKitchenStatus();
  } catch (error) {
    console.error('Error setting kitchen status:', error);
    showErrorModal("Gagal mengubah status dapur. Silakan coba lagi.");
    // Revert toggle to match actual status
    fetchKitchenStatus();
  }
}

function updateKitchenStatusUI(isOpen) {
  const toggle = document.getElementById('kitchen-toggle');
  const offBanner = document.getElementById('kitchen-off-banner');
  // Update toggle state
  toggle.checked = isOpen;
  // Show/hide banner
  if (!isOpen) {
    offBanner.classList.remove('hidden');
    // Hanya disable tombol tambah pesanan baru
    const addOrderBtn = document.querySelector('.add-order-btn');
    if (addOrderBtn) addOrderBtn.disabled = true;
    // Pastikan tombol update status pesanan tetap aktif
    document.querySelectorAll('.action-btn').forEach(btn => {
      if (!btn.classList.contains('add-order-btn')) {
        btn.disabled = false;
      }
    });
  } else {
    offBanner.classList.add('hidden');
    // Enable semua tombol
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.disabled = false;
    });
    const addOrderBtn = document.querySelector('.add-order-btn');
    if (addOrderBtn) addOrderBtn.disabled = false;
  }
}

let pollingInterval = null;
let lastOrderId = null;

function startOrderPolling() {
  if (pollingInterval) return;
  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch("/kitchen/orders");
      const orders = await res.json();
      renderOrders(orders);

      if (orders && orders.length > 0) {
        const newestOrder = orders[orders.length - 1];
        if (lastOrderId !== newestOrder.order_id) {
          lastOrderId = newestOrder.order_id;
          const audio = document.getElementById("sound-new-order");
          if (audio) audio.play().catch(() => {});
        }
      }
    } catch (err) {
      document.getElementById("offline-banner").classList.remove("hidden");
    }
  }, 5000);
}

function stopOrderPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = null;
}

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
    eventSource.close();
    startOrderPolling();
  };
  
  eventSource.onopen = () => {
    console.log('EventSource connected');
    document.getElementById("offline-banner").classList.add("hidden");
    stopOrderPolling();
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
  switchOrderTab('regular'); // Default ke tab regular
  renderOrderItemsList();
  renderCustomOrderItemsList();
  fetchMenuOptions();
  fetchAllFlavors(); // Ambil semua flavour dari database
}

function closeAddOrderModal() {
  document.getElementById('add-order-modal').classList.add('hidden');
  document.getElementById('add-order-form').reset();
  orderItems = [{ menu_name: '', quantity: 1, preference: '', notes: '' }];
  customOrderItems = [{ menu_name: '', quantity: 1, preference: '', notes: '', custom_flavour: true }];
  renderOrderItemsList();
  renderCustomOrderItemsList();
}

// Fungsi untuk menghapus semua kelas invalid-field
function clearInvalidFields() {
  const invalidFields = document.querySelectorAll('.invalid-field');
  invalidFields.forEach(field => {
    field.classList.remove('invalid-field');
  });
}

// Tab switching untuk modal order
function switchOrderTab(tab) {
  // Hapus semua kelas invalid-field saat tab diubah
  clearInvalidFields();
  
  const regularTab = document.getElementById('tab-regular-order');
  const customTab = document.getElementById('tab-custom-order');
  const regularContent = document.getElementById('regular-order-content');
  const customContent = document.getElementById('custom-order-content');
  
  if (tab === 'regular') {
    regularTab.classList.add('modal-tab-active');
    customTab.classList.remove('modal-tab-active');
    regularContent.classList.remove('hidden');
    customContent.classList.add('hidden');
    currentOrderTab = 'regular';
  } else {
    regularTab.classList.remove('modal-tab-active');
    customTab.classList.add('modal-tab-active');
    regularContent.classList.add('hidden');
    customContent.classList.remove('hidden');
    currentOrderTab = 'custom';
  }
}

// State untuk order items
let menuOptions = [];
let orderItems = [{ menu_name: '', quantity: 1, preference: '', notes: '' }];
let customOrderItems = [{ menu_name: '', quantity: 1, preferences: [], notes: '', custom_flavour: true }];
let currentOrderTab = 'regular';
async function fetchMenuOptions() {
  console.log('Fetching menu options...');
  try {
    const res = await fetch('/menu');
    console.log('Menu fetch response status:', res.status);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    console.log('Raw menu data received:', data);
    
    if (Array.isArray(data) && data.length > 0) {
      menuOptions = data;
      console.log('Menu options set successfully:', menuOptions);
    } else {
      console.warn('Menu data is empty or not in expected format:', data);
      menuOptions = [];
    }
    
    renderOrderItemsList();
    renderCustomOrderItemsList(); // Pastikan custom order items juga dirender
  } catch (e) {
    console.error('Error fetching menu options:', e); // Tambahkan log error
    menuOptions = [];
    renderOrderItemsList();
    renderCustomOrderItemsList(); // Pastikan custom order items juga dirender
  }
}
function renderOrderItemsList() {
  const list = document.getElementById('order-items-list');
  if (!list) {
    console.error('order-items-list element not found');
    return;
  }
  
  list.innerHTML = '';
  console.log('Rendering order items:', orderItems);
  console.log('Menu options available for regular orders:', menuOptions);
  
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
    // Hapus atribut required untuk menghindari masalah validasi
    // dan tangani validasi secara manual saat submit
    menuSelect.name = `menu_name_${idx}`;
    menuSelect.id = `menu_name_${idx}`;
    menuSelect.style = 'margin-bottom:0;';
    menuSelect.onchange = async function() {
      // Hapus kelas invalid-field saat pengguna memilih menu
      this.classList.remove('invalid-field');
      orderItems[idx].menu_name = this.value;
      orderItems[idx].preference = '';
      await renderOrderItemsList();
    };
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Select One';
    menuSelect.appendChild(defaultOpt);
    
    if (menuOptions && menuOptions.length > 0) {
      menuOptions.forEach(menu => {
        const opt = document.createElement('option');
        opt.value = menu.base_name_en;
        opt.textContent = menu.base_name_en;
        if (item.menu_name === menu.base_name_en) opt.selected = true;
        menuSelect.appendChild(opt);
      });
    } else {
      console.warn('No menu options available for regular order items');
    }
    
    block.appendChild(menuSelect);
    // Flavour
    const selectedMenu = menuOptions.find(m => m.base_name_en === item.menu_name);
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
        opt.value = f.name || f.flavor_name_en || '';
        opt.textContent = f.name || f.flavor_name_en || '';
        if ((item.preference || '') === (f.name || f.flavor_name_en || '')) opt.selected = true;
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

// Variabel untuk menyimpan semua flavour dari database
let allFlavors = [];

// Fungsi untuk mengambil semua flavour dari database
async function fetchAllFlavors() {
  console.log('Fetching all flavors...');
  try {
    const res = await fetch('/flavors');
    console.log('Flavors fetch response status:', res.status);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    console.log('Raw flavor data received:', data);
    
    if (Array.isArray(data) && data.length > 0) {
      allFlavors = data;
      console.log('All flavors set successfully:', allFlavors);
    } else {
      console.warn('Flavor data is empty or not in expected format:', data);
      allFlavors = [];
    }
  } catch (e) {
    console.error('Error fetching flavors:', e);
    allFlavors = [];
  }
}

// Panggil fetchAllFlavors dan fetchMenuOptions saat aplikasi dimulai
document.addEventListener('DOMContentLoaded', function() {
  fetchAllFlavors();
  fetchMenuOptions();
});

// Render custom order items list
function renderCustomOrderItemsList() {
  const list = document.getElementById('custom-order-items-list');
  if (!list) {
    console.error('custom-order-items-list element not found');
    return;
  }
  
  list.innerHTML = '';
  console.log('Rendering custom order items:', customOrderItems);
  console.log('Menu options available for custom orders:', menuOptions);
  
  customOrderItems.forEach((item, idx) => {
    const block = document.createElement('div');
    block.className = 'order-item-block';
    
    // Remove button
    if (customOrderItems.length > 1) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-item-btn';
      removeBtn.innerHTML = '&times;';
      removeBtn.onclick = function() {
        customOrderItems.splice(idx, 1);
        if (customOrderItems.length === 0) customOrderItems.push({ menu_name: '', quantity: 1, preferences: [], notes: '', custom_flavour: true });
        renderCustomOrderItemsList();
      };
      block.appendChild(removeBtn);
    }
    
    // Item Order
    const menuLabel = document.createElement('label');
    menuLabel.textContent = 'Item Order';
    menuLabel.setAttribute('for', `custom_menu_name_${idx}`);
    block.appendChild(menuLabel);
    
    const menuSelect = document.createElement('select');
    // Hapus atribut required untuk menghindari masalah validasi
    // dan tangani validasi secara manual saat submit
    menuSelect.name = `custom_menu_name_${idx}`;
    menuSelect.id = `custom_menu_name_${idx}`;
    menuSelect.style = 'margin-bottom:0;';
    menuSelect.onchange = async function() {
      // Hapus kelas invalid-field saat pengguna memilih menu
      this.classList.remove('invalid-field');
      customOrderItems[idx].menu_name = this.value;
      customOrderItems[idx].preferences = []; // Reset preferences when menu changes
      await renderCustomOrderItemsList();
    };
    
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Select One';
    menuSelect.appendChild(defaultOpt);
    
    if (menuOptions && menuOptions.length > 0) {
      menuOptions.forEach(menu => {
        const opt = document.createElement('option');
        opt.value = menu.base_name_en;
        opt.textContent = menu.base_name_en;
        if (item.menu_name === menu.base_name_en) opt.selected = true;
        menuSelect.appendChild(opt);
      });
    } else {
      console.warn('No menu options available for custom order items');
    }
    
    block.appendChild(menuSelect);
    
    // Flavour dari database - Multiple Selection
    const flavorLabel = document.createElement('label');
    flavorLabel.textContent = 'Flavours (Bisa pilih lebih dari 1)';
    flavorLabel.setAttribute('for', `custom_preference_${idx}`);
    block.appendChild(flavorLabel);
    
    // Container untuk flavour selections
    const flavorsContainer = document.createElement('div');
    flavorsContainer.className = 'flavors-container';
    block.appendChild(flavorsContainer);
    
    // Render existing flavours
    if (!item.preferences) {
      item.preferences = [];
    }
    
    // Function to render all selected flavours
    const renderSelectedFlavors = () => {
      // Clear container
      flavorsContainer.innerHTML = '';
      
      // Add each selected flavor with remove button
      item.preferences.forEach((flavorName, flavorIdx) => {
        const flavorTag = document.createElement('div');
        flavorTag.className = 'flavor-tag';
        
        const flavorText = document.createElement('span');
        flavorText.textContent = flavorName;
        flavorTag.appendChild(flavorText);
        
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = function() {
          item.preferences.splice(flavorIdx, 1);
          renderCustomOrderItemsList();
        };
        flavorTag.appendChild(removeBtn);
        
        flavorsContainer.appendChild(flavorTag);
      });
      
      // Add dropdown to select new flavor
      const newFlavorRow = document.createElement('div');
      newFlavorRow.className = 'new-flavor-row';
      
      const flavorSelect = document.createElement('select');
      flavorSelect.name = `custom_preference_new_${idx}`;
      flavorSelect.id = `custom_preference_new_${idx}`;
      flavorSelect.className = 'flavor-select';
      
      const defaultFlavor = document.createElement('option');
      defaultFlavor.value = '';
      defaultFlavor.textContent = 'Select Flavor';
      flavorSelect.appendChild(defaultFlavor);
      
      // Add available flavors that aren't already selected
      if (allFlavors && allFlavors.length > 0) {
        allFlavors.forEach(flavor => {
          if (flavor.isAvail && !item.preferences.includes(flavor.flavor_name_en)) {
            const opt = document.createElement('option');
            opt.value = flavor.flavor_name_en;
            opt.textContent = flavor.flavor_name_en;
            flavorSelect.appendChild(opt);
          }
        });
      }
      
      const addFlavorBtn = document.createElement('button');
      addFlavorBtn.type = 'button';
      addFlavorBtn.textContent = 'Add';
      addFlavorBtn.className = 'add-flavor-btn';
      addFlavorBtn.onclick = function() {
        const selectedFlavor = flavorSelect.value;
        if (selectedFlavor && !item.preferences.includes(selectedFlavor)) {
          item.preferences.push(selectedFlavor);
          renderCustomOrderItemsList();
        }
      };
      
      newFlavorRow.appendChild(flavorSelect);
      newFlavorRow.appendChild(addFlavorBtn);
      flavorsContainer.appendChild(newFlavorRow);
    };
    
    renderSelectedFlavors();
    
    // Notes
    const notesLabel = document.createElement('label');
    notesLabel.textContent = 'Notes';
    notesLabel.setAttribute('for', `custom_notes_${idx}`);
    block.appendChild(notesLabel);
    
    const notesInput = document.createElement('textarea');
    notesInput.id = `custom_notes_${idx}`;
    notesInput.placeholder = 'e.g. Less ice';
    notesInput.value = item.notes || '';
    notesInput.oninput = function() { customOrderItems[idx].notes = this.value; };
    block.appendChild(notesInput);
    
    // Quantity
    const qtyLabel = document.createElement('label');
    qtyLabel.textContent = 'Quantity';
    qtyLabel.setAttribute('for', `custom_quantity_${idx}`);
    block.appendChild(qtyLabel);
    
    const qtyRow = document.createElement('div');
    qtyRow.className = 'quantity-row';
    
    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'quantity-btn';
    minusBtn.textContent = '−';
    minusBtn.onclick = function() {
      if (customOrderItems[idx].quantity > 1) {
        customOrderItems[idx].quantity--;
        renderCustomOrderItemsList();
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
      customOrderItems[idx].quantity++;
      renderCustomOrderItemsList();
    };
    
    qtyRow.appendChild(minusBtn);
    qtyRow.appendChild(qtyVal);
    qtyRow.appendChild(plusBtn);
    block.appendChild(qtyRow);
    
    list.appendChild(block);
  });
}

// Add custom order item button
document.getElementById('add-custom-order-item-btn').onclick = function() {
  customOrderItems.push({ menu_name: '', quantity: 1, preferences: [], notes: '', custom_flavour: true });
  renderCustomOrderItemsList();
};

// Tambahkan CSS untuk menampilkan field yang tidak valid dan styling untuk flavor tags
const style = document.createElement('style');
style.textContent = `
  .invalid-field {
    border: 2px solid #ff3860 !important;
    background-color: rgba(255, 56, 96, 0.05) !important;
  }
  select.invalid-field:focus, input.invalid-field:focus, textarea.invalid-field:focus {
    box-shadow: 0 0 0 0.125em rgba(255, 56, 96, 0.25) !important;
  }
  
  .flavors-container {
    margin-bottom: 15px;
  }
  
  .flavor-tag {
    display: inline-flex;
    align-items: center;
    background: #f0f0f0;
    padding: 5px 10px;
    margin: 0 5px 5px 0;
    border-radius: 15px;
    font-size: 14px;
  }
  
  .flavor-tag button {
    background: none;
    border: none;
    color: #666;
    margin-left: 5px;
    cursor: pointer;
    font-size: 16px;
  }
  
  .flavor-tag button:hover {
    color: #ff3860;
  }
  
  .new-flavor-row {
    display: flex;
    margin-top: 5px;
  }
  
  .flavor-select {
    flex: 1;
    margin-right: 5px;
  }
  
  .add-flavor-btn {
    padding: 5px 10px;
    background-color: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
  }
  
  .add-flavor-btn:hover {
    background-color: #e0e0e0;
  }
`;
document.head.appendChild(style);

// Tambahkan event listener untuk menghapus kelas invalid-field saat input berubah
document.addEventListener('DOMContentLoaded', function() {
  const customerNameInput = document.getElementById('customer_name');
  const roomNameInput = document.getElementById('room_name');
  
  if (customerNameInput) {
    customerNameInput.addEventListener('input', function() {
      this.classList.remove('invalid-field');
    });
  }
  
  if (roomNameInput) {
    roomNameInput.addEventListener('input', function() {
      this.classList.remove('invalid-field');
    });
  }
});

// Handle open modal
const addOrderBtn = document.querySelector('.add-order-btn');
if (addOrderBtn) addOrderBtn.onclick = openAddOrderModal;

// Handle submit
const addOrderForm = document.getElementById('add-order-form');

addOrderForm.onsubmit = async function(e) {
  e.preventDefault();
  
  // Hapus semua kelas invalid-field saat form disubmit
  clearInvalidFields();
  
  const customer_name = document.getElementById('customer_name').value.trim();
  // Only Room field exists, so use it for both room_name and table_no
  const room_name = document.getElementById('room_name').value.trim();
  const table_no = room_name; // Use room_name as table_no for now
  
  // Determine which items to use based on current tab
  let orders = [];
  let endpoint = '/create_order'
  let is_custom = false;
  
  if (currentOrderTab === 'regular') {
    orders = orderItems.filter(i => i.menu_name && i.quantity > 0).map(i => ({
      menu_name: i.menu_name,
      quantity: i.quantity,
      preference: i.preference,
      notes: i.notes,
      telegram_id: "0" // Otomatis mengisi telegram_id dengan "0"
    }));
  } else {
    // Custom order tab
    endpoint = '/custom_order'
    orders = customOrderItems.filter(i => i.menu_name && i.quantity > 0).map(i => {
      // Jika preferences adalah array dan tidak kosong, gabungkan menjadi string dengan koma
      let preference = '';
      if (Array.isArray(i.preferences) && i.preferences.length > 0) {
        preference = i.preferences.join(', ');
      }
      
      return {
        menu_name: i.menu_name,
        quantity: i.quantity,
        preference: preference, // Kirim preferences sebagai string dengan pemisah koma
        notes: i.notes,
        // custom_flavour: true, // Pastikan flag custom_flavour tetap ada
        telegram_id: "0" // Otomatis mengisi telegram_id dengan "0"
      };
    });
    is_custom = true;
  }
  
  const telegram_id = "0"; // Ensure top-level telegram_id is always provided

  // Validasi form secara manual
  let isValid = true;
  
  // Validasi customer_name
  const customerNameInput = document.getElementById('customer_name');
  if (!customer_name) {
    customerNameInput.classList.add('invalid-field');
    isValid = false;
  }
  
  // Validasi room_name
  const roomNameInput = document.getElementById('room_name');
  if (!room_name) {
    roomNameInput.classList.add('invalid-field');
    isValid = false;
  }
  
  if (!isValid) {
    showErrorModal('Mohon lengkapi nama pelanggan dan ruangan.');
    return;
  }
  
  if (orders.length === 0) {
    showErrorModal('Mohon tambahkan minimal 1 item pesanan.');
    return;
  }
  
  // Validasi setiap item pesanan
  let invalidItems = false;
  let invalidFlavors = false;
  
  // Daftar menu yang memerlukan flavour
  const flavor_required_menus = ["Caffe Latte", "Cappuccino", "Milkshake", "Squash"];
  
  orders.forEach((item, index) => {
    // Validasi menu name
    if (!item.menu_name || item.menu_name.trim() === '') {
      invalidItems = true;
      // Fokus ke elemen yang bermasalah
      const elementId = currentOrderTab === 'regular' ? `menu_name_${index}` : `custom_menu_name_${index}`;
      const element = document.getElementById(elementId);
      if (element) {
        element.focus();
        element.classList.add('invalid-field');
      }
    }
    
    // Validasi flavour untuk menu yang memerlukan flavour
    if (flavor_required_menus.includes(item.menu_name) && (!item.preference || item.preference.trim() === '')) {
      invalidFlavors = true;
      // Untuk custom order dengan multiple flavours, highlight container
      if (currentOrderTab === 'custom') {
        const flavorContainer = document.querySelector(`#custom-order-items-list .order-item-block:nth-child(${index + 1}) .flavors-container`);
        if (flavorContainer) {
          flavorContainer.style.border = '2px solid #ff3860';
          flavorContainer.style.borderRadius = '4px';
          flavorContainer.style.padding = '5px';
        }
      } else {
        // Untuk regular order, highlight dropdown
        const flavorElement = document.getElementById(`preference_${index}`);
        if (flavorElement) {
          flavorElement.classList.add('invalid-field');
        }
      }
    }
  });
  
  if (invalidItems) {
    showErrorModal('Mohon pilih menu untuk semua item pesanan.');
    return;
  }
  
  if (invalidFlavors) {
    showErrorModal('Mohon pilih minimal 1 flavour untuk menu yang memerlukan flavour.');
    return;
  }
  
  const submitBtn = addOrderForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';
  
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        customer_name, 
        table_no, 
        room_name, 
        orders,
        telegram_id,
        is_custom // Mengirim flag untuk menandai apakah ini custom order
      })
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || `Gagal membuat pesanan: ${res.statusText}`);
    }
    
    const data = await res.json();
    if (data.status === 'success') {
      closeAddOrderModal();
      fetchOrders();
      showSuccessModal(data.message || 'Pesanan berhasil ditambahkan!');
    } else {
      showErrorModal(data.message || 'Gagal membuat pesanan.');
    }
  } catch (err) {
    console.error('Error creating order:', err);
    showErrorModal('Gagal terhubung ke server order.');
  }
  
  submitBtn.disabled = false;
  submitBtn.textContent = 'Save Order';
};

// Fungsi untuk menampilkan data user dari token JWT
function displayUserInfo() {
  try {
    const token = localStorage.getItem('access_token');
    if (token) {
      const userData = parseJwt(token);
      const username = userData.sub || 'User';
      
      // Update header subtitle (nama dan peran)
      const headerSubtitle = document.querySelector('.header-subtitle');
      if (headerSubtitle) {
        headerSubtitle.textContent = `${username}`;
      }
      
      // Update greeting message
      const greetingMessage = document.querySelector('.greeting-message h2');
      if (greetingMessage) {
        greetingMessage.textContent = `Hi, ${username}, here's today's orders!`;
      }
    }
  } catch (error) {
    console.error('Error displaying user info:', error);
  }
}

// Fungsi untuk memperbarui tanggal greeting (English with ordinal)
function updateGreetingDate() {
  const dateElement = document.getElementById('greeting-date');
  if (!dateElement) return;
  const today = new Date();
  const day = today.getDate();
  const weekday = today.toLocaleDateString('en-US', { weekday: 'long' });
  const month = today.toLocaleDateString('en-US', { month: 'long' });
  const year = today.getFullYear();
  const ordinalSuffix = day > 3 && day < 21 ? 'th' : ['th', 'st', 'nd', 'rd'][day % 10] || 'th';
  const formattedDate = `${weekday}, ${day}${ordinalSuffix} ${month} ${year}`;
  dateElement.textContent = formattedDate;
}

// Initialize all functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
  console.log('DOM loaded, initializing...');
  initializeKitchenToggle(); // This now calls fetchKitchenStatus internally
  initializeSearch();
  initializeTabs(); // Initialize tab functionality
  displayUserInfo(); // Menampilkan info user dari token JWT
  updateGreetingDate(); // Memperbarui tanggal greeting

  // Load cancelled items first to avoid flicker of cancelled entries in Active on initial render
  try {
    await fetchCancelledItems();
  } catch (e) {
    console.warn('Initial fetchCancelledItems failed:', e);
  }

  // Now render Active tab (this triggers fetchOrders inside switchTab)
  switchTab('active');

  // Start event stream after initial state is consistent
  initializeEventSource();

  // Other non-blocking initializations
  fetchAllFlavors();
  fetchMenuOptions();
  // setupNavigation();
});

// Initialize tab functionality
function initializeTabs() {
  const activeBtn = document.getElementById('tab-active');
  const doneBtn = document.getElementById('tab-done');
  
  console.log('Initializing tabs:', { activeBtn, doneBtn });
  
  if (activeBtn) {
    activeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('Active tab clicked');
      switchTab('active');
    });
  }
  
  if (doneBtn) {
    doneBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('Done tab clicked');
      switchTab('done');
    });
  }
}

// Global functions for event handlers
window.switchTab = switchTab;
window.openConfirmModal = openConfirmModal;
window.confirmCancel = confirmCancel;
window.openDetailModal = openDetailModal;
window.closeDetailModal = closeDetailModal;
window.openCancelledOrderDetailModal = openCancelledOrderDetailModal;
window.openItemDetailModal = openItemDetailModal;
window.closeItemDetailModal = closeItemDetailModal;
window.confirmCancelItem = confirmCancelItem;
window.openItemDetailModalByKey = openItemDetailModalByKey;
window.syncUpdate = syncUpdate;
window.showSuccessModal = showSuccessModal;
window.showErrorModal = showErrorModal;
window.openAddOrderModal = openAddOrderModal;
window.closeAddOrderModal = closeAddOrderModal;
window.showSuccessModal = showSuccessModal;
window.switchOrderTab = switchOrderTab; // Expose tab switching function for modal
