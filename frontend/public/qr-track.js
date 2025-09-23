// QR Order Tracking System - Utility Functions
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

// QR Order Tracking System
class QRTrackManager {
    constructor() {
        this.orderId = null;
        this.customerName = '';
        this.roomName = '';
        this.currentOrder = null;
        this.updateInterval = null;
        this.isComplete = false;
        this.loadRetryCount = 0;
        
        this.init();
    }

    init() {
        this.loadOrderData();
        this.extractRoomFromURL();
        this.setupEventListeners();
        this.lockNavigation();
        this.startAutoUpdate();
        this.updateDateDisplay();
        updateGreetingDate();
    }

    loadOrderData() {
        try {
            console.log('=== TRACK PAGE LOADING ORDER DATA ===');
            
            // PRIORITIZE URL parameters first (more reliable)
            const urlParams = new URLSearchParams(window.location.search);
            let orderId = urlParams.get('order_id');
            let customerName = urlParams.get('customer');
            let roomName = urlParams.get('room');
            
            console.log('URL Parameters:', {
                order_id: orderId,
                customer: customerName,
                room: roomName
            });
            
            // Fall back to session storage only if URL params are empty
            if (!orderId) {
                orderId = sessionStorage.getItem('qr_order_id');
                console.log('Fallback to session storage for order ID:', orderId);
            }
            if (!customerName) {
                customerName = sessionStorage.getItem('qr_customer_name') || sessionStorage.getItem('qr_customer');
                console.log('Fallback to session storage for customer:', customerName);
            }
            if (!roomName) {
                roomName = sessionStorage.getItem('qr_room_name') || sessionStorage.getItem('qr_room');
                console.log('Fallback to session storage for room:', roomName);
            }
            
            console.log('Final tracking data:', {
                orderId: orderId,
                customerName: customerName,
                roomName: roomName
            });
            
            // ONLY redirect if absolutely no order ID found anywhere
            if (!orderId || orderId === 'null' || orderId === 'undefined') {
                console.log('❌ Absolutely no order ID found anywhere, redirecting to menu');
                console.log('Debug info - all session storage:');
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    console.log(`  ${key}: ${sessionStorage.getItem(key)}`);
                }
                
                // Give one more chance with a short delay
                if (this.loadRetryCount < 1) {
                    this.loadRetryCount++;
                    console.log('⏰ Giving one more chance in 1 second...');
                    setTimeout(() => {
                        this.loadOrderData();
                    }, 1000);
                    return;
                }
                
                this.redirectToMenu();
                return;
            }
            
            // Try to get customer and room data from multiple sources
            if (!customerName) {
                customerName = sessionStorage.getItem('qr_customer');
            }
            
            if (!roomName) {
                roomName = sessionStorage.getItem('qr_room');
            }
            
            // Set defaults if still missing
            if (!customerName) {
                customerName = 'Customer';
            }
            
            if (!roomName) {
                roomName = 'Unknown';
            }
            
            console.log('Track page loaded with data:', {
                orderId: orderId,
                customerName: customerName,
                roomName: roomName
            });
            
            this.orderId = orderId;
            this.customerName = customerName;
            this.roomName = roomName;
            
            // Ensure session storage has the correct format
            sessionStorage.setItem('qr_customer_name', customerName);
            sessionStorage.setItem('qr_room_name', roomName);
            
            document.getElementById('customer-display').textContent = this.customerName;
            document.getElementById('room-display').textContent = `Ruangan: ${this.roomName}`;
            
            // Ensure main content becomes visible if a loader exists
            const loader = document.getElementById('loading-screen');
            const main = document.getElementById('main-content');
            if (loader && main) {
                loader.style.display = 'none';
                main.style.display = 'block';
            }
            
        } catch (error) {
            console.error('Error loading order data:', error);
            
            // Don't immediately redirect on error - try to continue with default values
            console.log('🔄 Error occurred but attempting to continue with default values');
            this.orderId = 'unknown';
            this.customerName = 'Customer';  
            this.roomName = 'Unknown';
            
            // Update display with fallback values
            document.getElementById('customer-display').textContent = this.customerName;
            document.getElementById('room-display').textContent = `Ruangan: ${this.roomName}`;
        }
    }

    extractRoomFromURL() {
        // Lock room to session; ignore URL and strip it
        const roomFromSession = sessionStorage.getItem('qr_room_name') || sessionStorage.getItem('qr_room');
        if (roomFromSession) this.roomName = roomFromSession;
        try {
            const cleanUrl = window.location.pathname;
            history.replaceState({}, '', cleanUrl);
        } catch (e) {}
        document.getElementById('room-display').textContent = `Ruangan: ${this.roomName}`;
    }

    setupEventListeners() {
        // Auto-refresh polling every 5 seconds
        this.updateInterval = setInterval(() => {
            if (!this.isComplete) {
                this.fetchOrderStatus();
            }
        }, 5000);
    }

    lockNavigation() {
        try {
            // Push two states so that back attempts will be consumed and we can re-push
            history.pushState({ locked: true }, '', location.href);
            history.pushState({ locked: true }, '', location.href);
            const onPop = () => {
                if (!this.isComplete) {
                    // Re-push to keep user on this page
                    history.pushState({ locked: true }, '', location.href);
                }
            };
            window.addEventListener('popstate', onPop);
        } catch (e) {}
    }

    async fetchOrderStatus() {
        try {
            const response = await fetch(`/order/status/${this.orderId}?cb=${Date.now()}`, {
                cache: 'no-store'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            this.currentOrder = data;
            this.updateOrderDisplay();
            
            // Check if order is complete
            if (data.status === 'done' && !this.isComplete) {
                this.isComplete = true;
                this.showCompleteModal();
                this.stopAutoUpdate();
            }
            if (data.status === 'cancel' || data.status === 'cancelled') {
                this.stopAutoUpdate();
                this.showCancelModal();
            }
            
        } catch (error) {
            console.error('Error fetching order status:', error);
        }
    }

    updateOrderDisplay() {
        if (!this.currentOrder) return;
        
        // Update basic info
        document.getElementById('queue-number').textContent = `#${this.currentOrder.queue_number}`;
        document.getElementById('info-queue').textContent = this.currentOrder.queue_number;
        document.getElementById('info-customer').textContent = this.currentOrder.customer_name;
        document.getElementById('info-room').textContent = this.currentOrder.room_name;
        document.getElementById('info-time').textContent = this.formatDateTime(this.currentOrder.created_at);
        document.getElementById('info-status').textContent = this.getStatusText(this.currentOrder.status);
        document.getElementById('info-status').className = `status-badge ${this.getStatusClass(this.currentOrder.status)}`;
        
        // Update status display
        this.updateStatusDisplay(this.currentOrder.status);
        
        // Update progress bar
        this.updateProgressBar(this.currentOrder.status);
        
        // Update order items
        this.updateOrderItems();
        
        // Toggle cancel button (only in receive)
        const cancelBtn = document.getElementById('cancel-btn');
        if (cancelBtn) cancelBtn.style.display = this.currentOrder.status === 'receive' ? 'inline-flex' : 'none';

        // Toggle "Pesan Lagi" button only when order is done
        const orderNewBtn = document.getElementById('order-new-btn');
        if (orderNewBtn) orderNewBtn.style.display = this.currentOrder.status === 'done' ? 'inline-flex' : 'none';

        // Update estimated time
        this.updateEstimatedTime();
    }

    updateStatusDisplay(status) {
        const statusIcon = document.getElementById('status-icon');
        const statusTitle = document.getElementById('status-title');
        const statusDescription = document.getElementById('status-description');
        
        const statusConfig = this.getStatusConfig(status);
        
        statusIcon.innerHTML = statusConfig.icon;
        statusTitle.textContent = statusConfig.title;
        statusDescription.textContent = statusConfig.description;
    }

    updateProgressBar(status) {
        const progressFill = document.getElementById('progress-fill');
        const labels = ['label-receive', 'label-making', 'label-deliver', 'label-done'];
        
        // Reset all labels
        labels.forEach(label => {
            document.getElementById(label).classList.remove('active', 'completed');
        });
        
        let progress = 0;
        let activeIndex = 0;
        
        switch (status) {
            case 'receive':
                progress = 25;
                activeIndex = 0;
                break;
            case 'making':
                progress = 50;
                activeIndex = 1;
                break;
            case 'deliver':
                progress = 75;
                activeIndex = 2;
                break;
            case 'done':
                progress = 100;
                activeIndex = 3;
                break;
        }
        
        progressFill.style.width = `${progress}%`;
        
        // Mark completed steps
        for (let i = 0; i < activeIndex; i++) {
            document.getElementById(labels[i]).classList.add('completed');
        }
        
        // Mark current step as active
        if (activeIndex < labels.length) {
            document.getElementById(labels[activeIndex]).classList.add('active');
        }
    }

    updateOrderItems() {
        if (!this.currentOrder || !this.currentOrder.items) return;
        
        const container = document.getElementById('order-items');
        container.innerHTML = '';
        
        this.currentOrder.items.forEach(item => {
            const itemElement = this.createOrderItemElement(item);
            container.appendChild(itemElement);
        });
    }

    createOrderItemElement(item) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'order-item';
        
        const flavorText = item.preference ? `<div class="item-flavor">Rasa: ${item.preference}</div>` : '';
        const notesText = item.notes ? `<div class="item-notes">Catatan: ${item.notes}</div>` : '';
        
        itemDiv.innerHTML = `
            <div class="item-info">
                <div class="item-name">${item.menu_name}</div>
                ${flavorText}
                ${notesText}
            </div>
            <div class="item-quantity">${item.quantity}x</div>
        `;

        return itemDiv;
    }

    updateEstimatedTime() {
        if (!this.currentOrder) return;
        
        const createdTime = new Date(this.currentOrder.created_at);
        const estimatedMinutes = this.calculateEstimatedTime();
        const estimatedTime = new Date(createdTime.getTime() + (estimatedMinutes * 60000));
        
        document.getElementById('info-estimated').textContent = this.formatDateTime(estimatedTime);
    }

    calculateEstimatedTime() {
        if (!this.currentOrder || !this.currentOrder.items) return 0;
        
        // Calculate based on making time of items
        const maxMakingTime = Math.max(...this.currentOrder.items.map(item => {
            // Assuming making_time is stored in item or we can estimate
            return 5; // Default 5 minutes per item
        }));
        
        // Add buffer time based on status
        const statusBuffer = {
            'receive': 0,
            'making': 2,
            'deliver': 5,
            'done': 10
        };
        
        return maxMakingTime + (statusBuffer[this.currentOrder.status] || 0);
    }

    getStatusConfig(status) {
        const configs = {
            'receive': {
                icon: '<i class="fas fa-clock"></i>',
                title: 'Pesanan Diterima',
                description: 'Pesanan Anda telah diterima dan sedang dalam antrian'
            },
            'making': {
                icon: '<i class="fas fa-utensils"></i>',
                title: 'Sedang Dibuat',
                description: 'Pesanan Anda sedang dibuat di dapur'
            },
            'deliver': {
                icon: '<i class="fas fa-truck"></i>',
                title: 'Sedang Diantar',
                description: 'Pesanan Anda dalam perjalanan menuju Anda'
            },
            'done': {
                icon: '<i class="fas fa-check-double"></i>',
                title: 'Pesanan Selesai',
                description: 'Pesanan Anda telah selesai'
            },
            'cancel': {
                icon: '<i class="fas fa-times-circle"></i>',
                title: 'Pesanan Dibatalkan',
                description: 'Pesanan Anda telah dibatalkan'
            }
        };
        
        return configs[status] || configs['receive'];
    }

    getStatusText(status) {
        const texts = {
            'receive': 'Diterima',
            'making': 'Dibuat',
            'deliver': 'Diantar',
            'done': 'Selesai',
            'cancel': 'Dibatalkan'
        };
        
        return texts[status] || 'Tidak Diketahui';
    }

    getStatusClass(status) {
        const classes = {
            'receive': 'status-receive',
            'making': 'status-process',
            'deliver': 'status-deliver',
            'done': 'status-done',
            'cancel': 'status-cancel'
        };
        
        return classes[status] || 'status-default';
    }

    async cancelOrder() {
        if (!this.currentOrder || this.currentOrder.status !== 'receive') return;
        try {
            const res = await fetch('/cancel_order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: this.currentOrder.order_id, reason: 'Cancelled by customer via QR' })
            });
            const data = await res.json();
            if (data.status === 'success') {
                this.refreshStatus();
            } else {
                alert('Gagal membatalkan pesanan');
            }
        } catch (e) {
            console.error('Cancel error', e);
            alert('Gagal membatalkan pesanan');
        }
    }

    formatDateTime(dateString) {
        const date = new Date(dateString);
        return date.toLocaleString('id-ID', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    showCompleteModal() {
        document.getElementById('complete-queue').textContent = this.currentOrder.queue_number;
        document.getElementById('complete-room').textContent = this.currentOrder.room_name;
        document.getElementById('complete-modal').classList.remove('hidden');
    }

    showCancelModal() {
        const modal = document.getElementById('cancel-modal');
        if (modal) modal.classList.remove('hidden');
    }

    startAutoUpdate() {
        // Initial fetch
        this.fetchOrderStatus();
    }

    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    // Manual refresh disabled (auto-refresh already running)
    refreshStatus() {}

    orderNew() {
        // Clear session data and redirect to menu (new session)
        sessionStorage.removeItem('qr_order_id');
        sessionStorage.removeItem('qr_customer_name');
        sessionStorage.removeItem('qr_room_name');
        sessionStorage.removeItem('qr_cart');
        sessionStorage.removeItem('qr_customer');
        sessionStorage.removeItem('qr_room');
        const roomParam = this.roomName ? `?room=${encodeURIComponent(this.roomName)}` : '';
        window.location.replace(`/qr-menu${roomParam}`);
    }

    redirectToMenu() {
        const roomParam = this.roomName ? `?room=${encodeURIComponent(this.roomName)}` : '';
        window.location.href = `/qr-menu${roomParam}`;
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
}

// Global functions for onclick handlers
function orderNew() {
    qrTrackManager.orderNew();
}

function refreshStatus() {
    qrTrackManager.refreshStatus();
}

function cancelOrder() {
    qrTrackManager.cancelOrder();
}

// Initialize when DOM is loaded
let qrTrackManager;
document.addEventListener('DOMContentLoaded', () => {
    qrTrackManager = new QRTrackManager();
});
