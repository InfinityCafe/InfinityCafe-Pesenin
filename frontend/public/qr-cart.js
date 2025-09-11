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
            
            if (!cartData || !customerData || !roomData) {
                this.redirectToMenu();
                return;
            }
            
            this.cart = JSON.parse(cartData);
            this.customerName = customerData;
            this.roomName = roomData;
            
            document.getElementById('customer-display').textContent = this.customerName;
            document.getElementById('room-display').textContent = `Ruangan: ${this.roomName}`;
            
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
        document.getElementById('room-display').textContent = `Ruangan: ${this.roomName}`;
    }

    setupEventListeners() {
        // Auto-update confirm button state
        this.updateConfirmButton();
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
        
        const flavorText = item.preference ? `<div class="item-flavor">Rasa: ${item.preference}</div>` : '';
        const notesText = item.notes ? `<div class="item-notes">Catatan: ${item.notes}</div>` : '';
        
        itemDiv.innerHTML = `
            <div class="item-info">
                <div class="item-name">${item.menu_name}</div>
                <div class="item-name-id">${item.menu_name_id}</div>
                ${flavorText}
                ${notesText}
                <div class="item-time">
                    <i class="fas fa-clock"></i>
                    ${item.making_time} menit
                </div>
            </div>
            <div class="item-controls">
                <div class="quantity-controls">
                    <button onclick="qrCartManager.updateQuantity(${index}, -1)" class="quantity-btn">-</button>
                    <span class="quantity-display">${item.quantity}</span>
                    <button onclick="qrCartManager.updateQuantity(${index}, 1)" class="quantity-btn">+</button>
                </div>
                <div class="item-price">Rp ${(item.price * item.quantity).toLocaleString('id-ID')}</div>
                <button onclick="qrCartManager.removeItem(${index})" class="remove-btn">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;

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
                this.orderId = result.data.queue_number;
                this.showSuccessModal(result.data);
                this.clearCartData();
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
                    <span>Ruangan:</span>
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
        
        // Store order ID for tracking
        sessionStorage.setItem('qr_order_id', this.orderId);
        sessionStorage.setItem('qr_customer_name', this.customerName);
        sessionStorage.setItem('qr_room_name', this.roomName);
        
        document.getElementById('success-modal').classList.remove('hidden');
    }

    clearCartData() {
        sessionStorage.removeItem('qr_cart');
        sessionStorage.removeItem('qr_customer');
        sessionStorage.removeItem('qr_room');
    }

    redirectToMenu() {
        // Go back to menu (room locked via session; no URL param)
        window.location.href = `/qr-menu`;
    }

    goToTracking() {
        window.location.replace(`/qr-track`);
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
        alert('Error: ' + message);
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
