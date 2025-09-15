// QR Cart Management System - Utility Functions
function updateGreetingDate() {
    const now = new Date();
    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    };
    const dateString = now.toLocaleDateString('id-ID', options);
    
    const greetingElements = document.querySelectorAll('.greeting-date');
    greetingElements.forEach(element => {
        if (element) {
            element.textContent = dateString;
        }
    });
}

// QR Cart Management System
class QRCartManager {
    constructor() {
        this.cart = [];
        this.customerName = '';
        this.roomName = '';
        this.orderId = null;
        
        this.init();
    }

    init() {
        this.loadCartData();
        this.extractRoomFromURL();
        this.setupEventListeners();
        this.renderCartItems();
        this.updateOrderSummary();
        this.updateDateDisplay();
        updateGreetingDate();
    }

    loadCartData() {
        try {
            const cartData = sessionStorage.getItem('qr_cart');
            const customerData = sessionStorage.getItem('qr_customer');
            const roomData = sessionStorage.getItem('qr_room');
            
            // Check if we have order tracking data (post-checkout state)
            const orderId = sessionStorage.getItem('qr_order_id');
            const customerName = sessionStorage.getItem('qr_customer_name');
            const roomName = sessionStorage.getItem('qr_room_name');
            
            // If we have tracking data but no cart data, redirect to tracking
            if (orderId && customerName && roomName && !cartData) {
                console.log('Post-checkout state detected, redirecting to tracking');
                this.goToTracking();
                return;
            }
            
            // If we don't have the required session data for cart, redirect to menu
            if (!cartData || !customerData || !roomData) {
                this.redirectToMenu();
                return;
            }
            
            this.cart = JSON.parse(cartData);
            this.customerName = customerData;
            this.roomName = roomData;
            
            document.getElementById('customer-display').textContent = this.customerName;
            document.getElementById('room-display').textContent = `${this.roomName}`;
            
        } catch (error) {
            console.error('Error loading cart data:', error);
            this.redirectToMenu();
        }
    }

    extractRoomFromURL() {
        // Lock room to session value; ignore URL changes and strip it if present
        const roomFromSession = sessionStorage.getItem('qr_room');
        if (roomFromSession) this.roomName = roomFromSession;
        try {
            const cleanUrl = window.location.pathname;
            history.replaceState({}, '', cleanUrl);
        } catch (e) {}
        document.getElementById('room-display').textContent = `${this.roomName}`;
    }

    setupEventListeners() {
        // Auto-update confirm button state
        this.updateConfirmButton();
        
        // Event delegation for cart items
        const cartContainer = document.getElementById('cart-items');
        if (cartContainer) {
            cartContainer.addEventListener('click', (e) => {
                const cartItem = e.target.closest('.cart-item');
                if (!cartItem) return;
                
                const index = parseInt(cartItem.dataset.index);
                
                // Handle notes edit button click
                if (e.target.closest('.notes-edit-btn')) {
                    this.startInlineEdit(index);
                }
                
                // Handle save button click
                else if (e.target.closest('.btn-save-inline')) {
                    this.saveInlineNotes(index);
                }
                
                // Handle cancel button click
                else if (e.target.closest('.btn-cancel-inline')) {
                    this.cancelInlineEdit(index);
                }
                
                // Handle quantity controls
                else if (e.target.closest('.btn-decrease')) {
                    this.updateQuantity(index, -1);
                }
                
                else if (e.target.closest('.btn-increase')) {
                    this.updateQuantity(index, 1);
                }
                
                // Handle remove button
                else if (e.target.closest('.btn-remove')) {
                    this.removeItem(index);
                }
            });
        }
    }

    renderCartItems() {
        const container = document.getElementById('cart-items');
        const itemCount = this.cart.reduce((sum, item) => sum + item.quantity, 0);
        
        document.getElementById('item-count').textContent = `${itemCount} item`;
        
        if (this.cart.length === 0) {
            container.innerHTML = `
                <div class="empty-cart">
                    <i class="fas fa-shopping-cart"></i>
                    <p>Keranjang kosong</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        this.cart.forEach((item, index) => {
            const itemElement = this.createCartItemElement(item, index);
            container.appendChild(itemElement);
        });
    }

    createCartItemElement(item, index) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'cart-item';
        itemDiv.dataset.index = index;
        
        const flavorText = item.preference ? `<div class="item-flavor">Rasa: ${item.preference}</div>` : '';
        
        // Enhanced notes section with edit functionality
        let notesSection = '';
        if (item.notes) {
            notesSection = `
                <div class="notes-display" id="notes-display-${index}">
                    <div class="notes-content">
                        <span class="notes-text">Catatan: ${item.notes}</span>
                    </div>
                    <button class="notes-edit-btn">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                </div>
                <div class="notes-inline-edit" id="notes-edit-${index}" style="display: none;">
                    <textarea class="notes-inline-input" id="notes-input-${index}" placeholder="Tulis catatan untuk pesanan ini...">${item.notes}</textarea>
                    <div class="notes-actions">
                        <div class="keyboard-hint">Tekan Ctrl+Enter untuk simpan, Esc untuk batal</div>
                        <div class="notes-action-buttons">
                            <button class="btn-save-inline">
                                <i class="fas fa-check"></i> Simpan
                            </button>
                            <button class="btn-cancel-inline">
                                <i class="fas fa-times"></i> Batal
                            </button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            notesSection = `
                <div class="notes-display" id="notes-display-${index}">
                    <div class="notes-content notes-empty">
                        <span class="notes-text">Tidak ada catatan</span>
                    </div>
                    <button class="notes-edit-btn">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                </div>
                <div class="notes-inline-edit" id="notes-edit-${index}" style="display: none;">
                    <textarea class="notes-inline-input" id="notes-input-${index}" placeholder="Tulis catatan untuk pesanan ini..."></textarea>
                    <div class="notes-actions">
                        <div class="keyboard-hint">Tekan Ctrl+Enter untuk simpan, Esc untuk batal</div>
                        <div class="notes-action-buttons">
                            <button class="btn-save-inline">
                                <i class="fas fa-check"></i> Simpan
                            </button>
                            <button class="btn-cancel-inline">
                                <i class="fas fa-times"></i> Batal
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
        
        itemDiv.innerHTML = `
            <div class="item-header">
                <div class="item-name">${item.menu_name}</div>
                <button class="remove-btn btn-remove">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
            <div class="item-name-id">${item.menu_name_id}</div>
            ${flavorText}

            ${notesSection}
    
            <div class="item-time">
                <i class="fas fa-clock"></i>
                ${item.making_time} menit
            </div>
            <div class="item-footer">
                <div class="item-price">Rp ${(item.price * item.quantity).toLocaleString('id-ID')}</div>
                <div class="quantity-controls">
                    <button class="quantity-btn btn-decrease">-</button>
                    <span class="quantity-display">${item.quantity}</span>
                    <button class="quantity-btn btn-increase">+</button>
                </div>
            </div>
        `;

        // Add keyboard event listeners after element is created
        setTimeout(() => {
            const textarea = itemDiv.querySelector(`#notes-input-${index}`);
            if (textarea) {
                textarea.addEventListener('keydown', (e) => {
                    if (e.ctrlKey && e.key === 'Enter') {
                        e.preventDefault();
                        this.saveInlineNotes(index);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        this.cancelInlineEdit(index);
                    }
                });
            }
        }, 0);

        return itemDiv;
    }

    updateQuantity(index, change) {
        const item = this.cart[index];
        const newQuantity = item.quantity + change;
        
        if (newQuantity <= 0) {
            this.removeItem(index);
            return;
        }
        
        // No upper limit
        
        item.quantity = newQuantity;
        this.saveCartData();
        this.renderCartItems();
        this.updateOrderSummary();
    }

    removeItem(index) {
        this.cart.splice(index, 1);
        this.saveCartData();
        this.renderCartItems();
        this.updateOrderSummary();
        
        if (this.cart.length === 0) {
            this.redirectToMenu();
        }
    }

    saveCartData() {
        try {
            sessionStorage.setItem('qr_cart', JSON.stringify(this.cart));
        } catch (e) {
            console.error('Failed to persist cart to sessionStorage', e);
        }
    }

    // Inline Notes Editing Methods
    startInlineEdit(index) {
        const displayElement = document.getElementById(`notes-display-${index}`);
        const editElement = document.getElementById(`notes-edit-${index}`);
        const textarea = document.getElementById(`notes-input-${index}`);
        
        if (displayElement && editElement && textarea) {
            displayElement.style.display = 'none';
            editElement.style.display = 'block';
            
            // Focus on textarea and select all text if editing existing notes
            textarea.focus();
            if (textarea.value.trim()) {
                textarea.select();
            }
            
            // Store original value for cancel functionality
            textarea.setAttribute('data-original', textarea.value);
        }
    }

    saveInlineNotes(index) {
        const textarea = document.getElementById(`notes-input-${index}`);
        const displayElement = document.getElementById(`notes-display-${index}`);
        const editElement = document.getElementById(`notes-edit-${index}`);
        
        if (textarea && displayElement && editElement) {
            const newNotes = textarea.value.trim();
            
            // Update cart data
            this.cart[index].notes = newNotes;
            this.saveCartData();
            
            // Update display
            if (newNotes) {
                displayElement.innerHTML = `
                    <div class="notes-content">
                        <span class="notes-text">Catatan: ${newNotes}</span>
                    </div>
                    <button class="notes-edit-btn">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                `;
            } else {
                displayElement.innerHTML = `
                    <div class="notes-content notes-empty">
                        <span class="notes-text">Tidak ada catatan</span>
                    </div>
                    <button class="notes-edit-btn">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                `;
            }
            
            // Hide edit mode
            displayElement.style.display = 'flex';
            editElement.style.display = 'none';
        }
    }

    cancelInlineEdit(index) {
        const textarea = document.getElementById(`notes-input-${index}`);
        const displayElement = document.getElementById(`notes-display-${index}`);
        const editElement = document.getElementById(`notes-edit-${index}`);
        
        if (textarea && displayElement && editElement) {
            // Restore original value
            const originalValue = textarea.getAttribute('data-original') || '';
            textarea.value = originalValue;
            
            // Hide edit mode
            displayElement.style.display = 'flex';
            editElement.style.display = 'none';
        }
    }

    updateOrderSummary() {
        const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);
        const totalPrice = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const maxTime = Math.max(...this.cart.map(item => item.making_time), 0);
        
        document.getElementById('total-items').textContent = totalItems;
        document.getElementById('total-price').textContent = `Rp ${totalPrice.toLocaleString('id-ID')}`;
        document.getElementById('estimated-time').textContent = `${maxTime} menit`;
        
        this.updateConfirmButton();
    }

    updateConfirmButton() {
        const confirmBtn = document.getElementById('confirm-btn');
        confirmBtn.disabled = this.cart.length === 0;
    }

    async confirmOrder() {
        if (this.cart.length === 0) return;
        
        this.showLoadingModal();
        
        try {
            const tg = sessionStorage.getItem('telegram_id') || '0';
            const orderData = {
                customer_name: this.customerName,
                room_name: this.roomName,
                orders: this.cart.map(item => ({
                    menu_name: item.menu_name,
                    quantity: item.quantity,
                    preference: item.preference || '',
                    notes: item.notes || '',
                    telegram_id: tg
                })),
                telegram_id: tg
            };
            
            const response = await fetch('/create_order', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(orderData)
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                console.log('Full order result:', result);
                // Always keep both order_id (string) and queue_number (display)
                const orderId = (result.data && (result.data.order_id || result.data.id || result.data.orderId)) || null;
                const queueNumber = (result.data && (result.data.queue_number || result.data.queue || result.data.number)) || null;
                
                // Use order_id as the canonical tracking ID, and queue_number strictly from backend
                this.orderId = orderId || null;
                this.queueNumber = queueNumber || null; // no fallback to orderId
                
                console.log('Order successful, ID:', this.orderId, 'Queue:', this.queueNumber);
                console.log('Customer data:', this.customerName, 'Room:', this.roomName);
                
                // Store tracking data FIRST before clearing cart
                if (this.orderId) sessionStorage.setItem('qr_order_id', this.orderId);
                if (this.queueNumber) sessionStorage.setItem('qr_queue_number', this.queueNumber);
                sessionStorage.setItem('qr_customer_name', this.customerName);
                sessionStorage.setItem('qr_room_name', this.roomName);
                console.log('Tracking data stored preemptively:', {
                    orderId: this.orderId,
                    queueNumber: this.queueNumber,
                    customerName: this.customerName,
                    roomName: this.roomName
                });
                
                // Verify it was stored correctly
                console.log('Verification - stored session data:', {
                    qr_order_id: sessionStorage.getItem('qr_order_id'),
                    qr_queue_number: sessionStorage.getItem('qr_queue_number'),
                    qr_customer_name: sessionStorage.getItem('qr_customer_name'),
                    qr_room_name: sessionStorage.getItem('qr_room_name')
                });
                
                // Persist a durable local session for the track page (prevents tampering via URL)
                try {
                    const orderSession = {
                        orderId: this.orderId,
                        queueNumber: this.queueNumber,
                        customerName: this.customerName,
                        roomNumber: this.roomName,
                        status: 'receive',
                        items: this.cart.map(i => ({
                            menu_name: i.menu_name,
                            quantity: i.quantity,
                            preference: i.preference || '',
                            notes: i.notes || ''
                        })),
                        timestamp: Date.now(),
                        isActive: true
                    };
                    localStorage.setItem('qr_order_session', JSON.stringify(orderSession));
                    console.log('Local order session saved');
                } catch (e) {
                    console.warn('Failed to save local order session:', e);
                }
                
                this.showSuccessModal(result.data);
                // Don't clear cart data immediately - let it persist until user successfully reaches track page
                console.log('Order confirmed, cart data preserved for tracking');
            } else {
                throw new Error(result.message || 'Gagal membuat pesanan');
            }
            
        } catch (error) {
            console.error('Error creating order:', error);
            this.hideLoadingModal();
            this.showError('Gagal membuat pesanan: ' + error.message);
        }
    }

    showLoadingModal() {
        document.getElementById('loading-modal').classList.remove('hidden');
    }

    hideLoadingModal() {
        document.getElementById('loading-modal').classList.add('hidden');
    }

    showSuccessModal(orderData) {
        this.hideLoadingModal();
        
        document.getElementById('success-message').textContent = 
            `Pesanan Anda telah diterima dengan nomor antrian: ${orderData.queue_number}`;
        
        const orderDetails = document.getElementById('order-details');
        orderDetails.innerHTML = `
            <div class="order-info">
                <div class="info-row">
                    <span>Nomor Antrian:</span>
                    <span class="queue-number">${orderData.queue_number}</span>
                </div>
                <div class="info-row">
                    <span>Nama:</span>
                    <span>${orderData.customer_name}</span>
                </div>
                <div class="info-row">
                    <span>${orderData.room_name}</span>
                </div>
                <div class="info-row">
                    <span>Total Item:</span>
                    <span>${orderData.total_items}</span>
                </div>
                <div class="info-row">
                    <span>Status:</span>
                    <span class="status-receive">Diterima</span>
                </div>
            </div>
        `;
        
        // Data already stored in confirmOrder method
        console.log('Success modal shown, data already stored');
        
        document.getElementById('success-modal').classList.remove('hidden');
        
        // No automatic timer - user clicks button to proceed to tracking
        console.log('Success modal displayed, ready for user to click track button');
    }

    clearCartData() {
        // Only clear cart data, keep customer and room data for tracking
        sessionStorage.removeItem('qr_cart');
        // Keep qr_customer and qr_room for tracking page
    }

    clearAllSessionData() {
        // Method to completely clear all QR session data when needed
        sessionStorage.removeItem('qr_cart');
        sessionStorage.removeItem('qr_customer');
        sessionStorage.removeItem('qr_room');
        sessionStorage.removeItem('qr_order_id');
        sessionStorage.removeItem('qr_customer_name');
        sessionStorage.removeItem('qr_room_name');
    }

    redirectToMenu() {
        // Go back to menu (room locked via session; no URL param)
        window.location.href = `/qr-menu`;
    }

    goToTracking() {
        console.log('=== STARTING REDIRECT TO TRACK ===');
        console.log('Current instance data:', {
            orderId: this.orderId,
            customerName: this.customerName,
            roomName: this.roomName
        });
        
        // Check current session storage
        console.log('Current session storage before redirect:', {
            qr_order_id: sessionStorage.getItem('qr_order_id'),
            qr_customer_name: sessionStorage.getItem('qr_customer_name'),
            qr_room_name: sessionStorage.getItem('qr_room_name'),
            qr_customer: sessionStorage.getItem('qr_customer'),
            qr_room: sessionStorage.getItem('qr_room')
        });
        
        // Force store the data again to be absolutely sure
        if (this.orderId) {
            sessionStorage.setItem('qr_order_id', this.orderId);
            console.log('Stored order ID:', this.orderId);
        }
        if (this.customerName) {
            sessionStorage.setItem('qr_customer_name', this.customerName);
            console.log('Stored customer name:', this.customerName);
        }
        if (this.roomName) {
            sessionStorage.setItem('qr_room_name', this.roomName);
            console.log('Stored room name:', this.roomName);
        }
        
        console.log('Final session storage before redirect:', {
            qr_order_id: sessionStorage.getItem('qr_order_id'),
            qr_customer_name: sessionStorage.getItem('qr_customer_name'),
            qr_room_name: sessionStorage.getItem('qr_room_name')
        });
        
        console.log('=== REDIRECTING TO /qr-track ===');
        
        // Clear cart data just before redirect (after session storage is set)
        this.clearCartData();
        console.log('Cart cleared just before redirect');
        
        // Use a small timeout to ensure session storage is fully committed
        setTimeout(() => {
            console.log('Executing redirect now...');
            // Redirect to clean URL (no params) so user cannot tamper
            window.location.href = `/qr-track`;
        }, 100);
    }

    updateDateDisplay() {
        const now = new Date();
        const options = { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        };
        const dateString = now.toLocaleDateString('id-ID', options);
        document.getElementById('greeting-date').textContent = dateString;
    }

    showError(message) {
        // Create or show error modal instead of alert
        let errorModal = document.getElementById('error-modal');
        if (!errorModal) {
            // Create error modal if it doesn't exist
            errorModal = document.createElement('div');
            errorModal.id = 'error-modal';
            errorModal.className = 'modal hidden';
            errorModal.innerHTML = `
                <div class="modal-content">
                    <div class="error-icon" style="width: 80px; height: 80px; background: linear-gradient(135deg, #dc3545, #c82333); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; box-shadow: 0 12px 24px rgba(220, 53, 69, 0.3);">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: white;"></i>
                    </div>
                    <div class="error-title" style="font-size: 1.5rem; font-weight: 700; color: #312929; margin-bottom: 1rem;">Terjadi Kesalahan</div>
                    <div class="error-message" id="error-message-text" style="font-size: 1rem; color: #685454; margin-bottom: 1.5rem; line-height: 1.6;"></div>
                    <button onclick="document.getElementById('error-modal').classList.add('hidden')" class="btn-primary" style="background: linear-gradient(135deg, #dc3545, #c82333); box-shadow: 0 6px 20px rgba(220, 53, 69, 0.3);">
                        Tutup
                    </button>
                </div>
            `;
            document.body.appendChild(errorModal);
        }
        
        document.getElementById('error-message-text').textContent = message;
        errorModal.classList.remove('hidden');
    }
}

// Global functions for onclick handlers
function goBackToMenu() {
    qrCartManager.redirectToMenu();
}

function confirmOrder() {
    qrCartManager.confirmOrder();
}

function goToTracking() {
    qrCartManager.goToTracking();
}

// Initialize when DOM is loaded
let qrCartManager;
document.addEventListener('DOMContentLoaded', () => {
    qrCartManager = new QRCartManager();
});
