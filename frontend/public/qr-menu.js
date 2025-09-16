// QR Menu Ordering System - Utility Functions
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

// QR Menu Ordering System
class QRMenuManager {
  constructor() {
    this.customerName = '';
    this.roomName = '';
    this.menus = [];
    this.flavors = [];
    this.categoryToMenus = {};
    this.activeCategory = '';
    this.cart = [];
    this.currentMenuItem = null;
    this.currentFlavor = null;

    this.init();
  }

  init() {
    this.extractRoomFromURL();
    this.setupEventListeners();
    this.loadMenus();
    this.loadFlavors();
    this.updateDateDisplay();
    updateGreetingDate();
    this.ensureResumeFromSession();
  }

  extractRoomFromURL() {
    // Lock room to session; if not set, read once from URL then strip it
    const sessionRoom = sessionStorage.getItem('qr_room');
    if (sessionRoom) {
      this.roomName = sessionRoom;
    } else {
      const urlParams = new URLSearchParams(window.location.search);
      this.roomName = urlParams.get('room') || 'Unknown';
      sessionStorage.setItem('qr_room', this.roomName);
      try {
        const cleanUrl = window.location.pathname;
        history.replaceState({}, '', cleanUrl);
      } catch (e) { }
    }
    const display = document.getElementById('room-display');
    if (display) display.textContent = `Ruangan: ${this.roomName}`;
  }

  setupEventListeners() {
    // Name input
    const nameInput = document.getElementById('customer-name');
    const startBtn = document.getElementById('start-btn');

    nameInput.addEventListener('input', (e) => {
      const name = e.target.value.trim();
      startBtn.disabled = name.length < 2;
    });

    nameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !startBtn.disabled) {
        this.startOrdering();
      }
    });

    // Menu search
    document.getElementById('menu-search').addEventListener('input', (e) => {
      this.filterMenus(e.target.value);
    });

    // Category tabs handled via click events created dynamically

    // Quantity controls
    document.getElementById('item-quantity').addEventListener('change', (e) => {
      const value = parseInt(e.target.value);
      if (isNaN(value) || value < 1) e.target.value = 1;
    });
  }

  async loadMenus() {
    try {
      const response = await fetch('/menu?cb=' + Date.now(), {
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this.menus = Array.isArray(data) ? data : data.value || [];

      this.buildCategories();
      this.renderCategoryTabs();
      this.renderMenuCategories();

    } catch (error) {
      console.error('Error loading menus:', error);
      this.showError('Gagal memuat menu. Silakan refresh halaman.');
    }
  }

  async loadFlavors() {
    try {
      const response = await fetch('/flavors/all?cb=' + Date.now(), {
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      // Normalize flavor object fields to a consistent shape
      const rawFlavors = Array.isArray(data) ? data : data.value || [];
      this.flavors = rawFlavors.map(f => ({
        id: f.id,
        name: f.name || f.flavor_name_en || f.flavor_name_id || f.base_name_en || 'Flavor',
        additional_price: f.additional_price || 0,
        isAvail: f.isAvail !== false
      }));

    } catch (error) {
      console.error('Error loading flavors:', error);
    }
  }

  buildCategories() {
    const getBroadCategory = (menu) => {
      const text = [menu.category, menu.base_name_en, menu.base_name_id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const includesAny = (arr) => arr.some(k => text.includes(k));

      if (includesAny(['coffee', 'kopi', 'espresso', 'americano', 'latte', 'cappuccino', 'capuccino', 'mocha'])) return 'Coffee';
      if (includesAny(['susu', 'milk'])) return 'Susu';
      if (includesAny(['tea', 'teh', 'chai'])) return 'Tea';
      if (includesAny(['juice', 'jus', 'lemon', 'jeruk'])) return 'Juice';
      if (includesAny(['non coffee', 'matcha', 'chocolate', 'coklat', 'red velvet', 'taro'])) return 'Non Coffee';
      if (includesAny(['snack', 'cake', 'cookie', 'donut', 'pastry', 'dessert'])) return 'Snack';
      if (includesAny(['food', 'makanan', 'rice', 'nasi', 'noodle', 'mie', 'bread', 'roti', 'pasta'])) return 'Food';
      return 'Lainnya';
    };

    const categoryMap = {};
    this.menus.forEach(menu => {
      if (!menu.isAvail) return;
      const cat = getBroadCategory(menu);
      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push(menu);
    });
    this.categoryToMenus = categoryMap;
    this.activeCategory = '';
  }

  renderCategoryTabs() {
    const tabs = document.getElementById('category-tabs');
    if (!tabs) return;
    const order = ['Coffee', 'Non Coffee', 'Susu', 'Tea', 'Juice', 'Food', 'Snack', 'Lainnya'];
    const existing = Object.keys(this.categoryToMenus);
    const categories = order.filter(o => existing.includes(o));
    tabs.innerHTML = '';
    // Add "Semua" tab
    const allBtn = document.createElement('button');
    allBtn.className = `tab-btn ${this.activeCategory === '' ? 'active' : ''}`;
    allBtn.textContent = 'Semua';
    allBtn.onclick = () => { this.activeCategory = ''; this.renderCategoryTabs(); this.renderMenuCategories(); };
    tabs.appendChild(allBtn);
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = `tab-btn ${this.activeCategory === cat ? 'active' : ''}`;
      btn.textContent = cat;
      btn.onclick = () => { this.activeCategory = cat; this.renderCategoryTabs(); this.renderMenuCategories(); };
      tabs.appendChild(btn);
    });
  }

  renderMenuCategories() {
    const container = document.getElementById('menu-categories');
    const searchInput = document.getElementById('menu-search');
    const searchTerm = searchInput ? (searchInput.value || '').toLowerCase() : '';

    // Decide source menus based on active tab
    let sourceMenus = this.menus;
    if (this.activeCategory) {
      sourceMenus = this.categoryToMenus[this.activeCategory] || [];
    }

    // Group menus by base_name_en (as product name)
    const menuGroups = {};
    sourceMenus.forEach(menu => {
      if (!menu.isAvail) return;
      const menuName = menu.base_name_en || '';
      const menuNameId = menu.base_name_id || '';
      const price = menu.base_price || 0;

      // Filter by search term
      if (searchTerm && !menuName.toLowerCase().includes(searchTerm) && !menuNameId.toLowerCase().includes(searchTerm)) {
        return;
      }

      if (!menuGroups[menuName]) {
        // Normalize flavors to use consistent name fields
        const normalizedFlavors = (menu.flavors || []).map(f => ({
          id: f.id,
          name: f.name || f.flavor_name_en || f.flavor_name_id || 'Flavor',
          additional_price: f.additional_price || 0,
          isAvail: f.isAvail !== false
        }));

        menuGroups[menuName] = {
          name: menuName,
          nameId: menuNameId,
          price: price,
          flavors: normalizedFlavors,
          makingTime: menu.making_time_minutes || 0
        };
      }
    });

    // Render menu groups
    container.innerHTML = '';
    Object.values(menuGroups).forEach(menuGroup => {
      const categoryCard = this.createMenuCategoryCard(menuGroup);
      container.appendChild(categoryCard);
    });

    if (Object.keys(menuGroups).length === 0) {
      container.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-search"></i>
                    <p>Tidak ada menu yang ditemukan</p>
                </div>
            `;
    }
  }

  createMenuCategoryCard(menuGroup) {
    const card = document.createElement('div');
    card.className = 'summary-item menu-category-card';

    const hasFlavors = menuGroup.flavors && menuGroup.flavors.length > 0;
    const flavorText = hasFlavors ?
      `<div class="menu-flavors">${menuGroup.flavors.filter(f => f.isAvail).map(f => f.name).join(', ')}</div>` : '';

    card.innerHTML = `
            <div class="summary-header">
                <span class="summary-name">${menuGroup.name}</span>
                <span class="menu-price">Rp ${menuGroup.price.toLocaleString('id-ID')}</span>
            </div>
            <div class="menu-info">
                <div class="menu-name-id">${menuGroup.nameId}</div>
                ${flavorText}
                <div class="menu-time">
                    <i class="fas fa-clock"></i>
                    ${menuGroup.makingTime} menit
                </div>
            </div>
            <button onclick="qrMenuManager.openMenuModal('${menuGroup.name}')" 
                    class="action-btn action-btn-green">
                <i class="fas fa-plus"></i>
                Pilih Menu
            </button>
        `;

    return card;
  }

  openMenuModal(menuName) {
    const menu = this.menus.find(m => m.base_name_en === menuName);
    if (!menu) return;

    this.currentMenuItem = menu;

    // Set modal content
    document.getElementById('modal-menu-name').textContent = menu.base_name_en;
    document.getElementById('modal-menu-price').textContent = `Rp ${menu.base_price.toLocaleString('id-ID')}`;
    document.getElementById('modal-menu-description').textContent = menu.base_name_id;

    // Handle flavors
    const flavorSection = document.getElementById('flavor-section');
    const flavorOptions = document.getElementById('flavor-options');

    if (menu.flavors && menu.flavors.length > 0) {
      flavorSection.style.display = 'block';
      flavorOptions.innerHTML = '';

      menu.flavors.filter(f => f.isAvail !== false).forEach(flavor => {
        const option = document.createElement('div');
        option.className = 'flavor-option';
        option.innerHTML = `
                    <input type="radio" name="flavor" value="${flavor.id}" id="flavor-${flavor.id}">
                    <label for="flavor-${flavor.id}">${flavor.name || flavor.flavor_name_en || flavor.flavor_name_id || 'Flavor'}</label>
                `;
        flavorOptions.appendChild(option);
      });

      // Select first flavor by default
      const available = menu.flavors.filter(f => f.isAvail !== false);
      if (available.length > 0) {
        this.currentFlavor = available[0];
        const first = document.getElementById(`flavor-${available[0].id}`);
        if (first) first.checked = true;
      }
    } else {
      flavorSection.style.display = 'none';
      this.currentFlavor = null;
    }

    // Reset quantity and notes
    document.getElementById('item-quantity').value = 1;
    document.getElementById('item-notes').value = '';

    // Show modal
    document.getElementById('menu-modal').classList.remove('hidden');
  }

  closeMenuModal() {
    document.getElementById('menu-modal').classList.add('hidden');
    this.currentMenuItem = null;
    this.currentFlavor = null;
  }

  addToCart() {
    if (!this.currentMenuItem) return;

    const quantity = parseInt(document.getElementById('item-quantity').value);
    const notes = document.getElementById('item-notes').value.trim();

    // Get selected flavor
    const selectedFlavor = document.querySelector('input[name="flavor"]:checked');
    let flavorName = '';
    if (selectedFlavor) {
      const selectedId = selectedFlavor.value;
      const fromMenu = (this.currentMenuItem.flavors || []).find(f => String(f.id) === String(selectedId));
      flavorName = (fromMenu && (fromMenu.name || fromMenu.flavor_name_en || fromMenu.flavor_name_id)) || '';
    }

    const cartItem = {
      id: Date.now() + Math.random(),
      menu_name: this.currentMenuItem.base_name_en,
      menu_name_id: this.currentMenuItem.base_name_id,
      price: this.currentMenuItem.base_price,
      quantity: quantity,
      preference: flavorName,
      notes: notes,
      making_time: this.currentMenuItem.making_time_minutes || 0
    };

    this.cart.push(cartItem);
    this.updateCartSummary();
    this.closeMenuModal();
    this.showSuccess(`${cartItem.menu_name} ditambahkan ke keranjang!`);
  }

  updateCartSummary() {
    const cartCount = this.cart.reduce((sum, item) => sum + item.quantity, 0);
    const cartTotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    document.getElementById('cart-count').textContent = cartCount;
    document.getElementById('cart-total').textContent = cartTotal.toLocaleString('id-ID');

    // Fix: Update cart-count-text to match cart-count
    const cartCountText = document.getElementById('cart-count-text');
    if (cartCountText) {
      cartCountText.textContent = cartCount;
    }

    const cartSummary = document.getElementById('cart-summary');
    cartSummary.style.display = cartCount > 0 ? 'block' : 'none';

    const cartFab = document.getElementById('cart-fab');
    const cartFabCount = document.getElementById('cart-fab-count');
    if (cartFab && cartFabCount) {
      cartFabCount.textContent = cartCount;
      // Visibility of FAB on mobile is handled via CSS media queries; ensure count updates
    }
  }

  filterMenus(searchTerm) {
    this.renderMenuCategories();
  }

  filterMenusByCategory(category) {
    this.renderMenuCategories();
  }

  startOrdering() {
    const name = document.getElementById('customer-name').value.trim();
    if (name.length < 2) return;

    this.customerName = name;
    document.getElementById('customer-display').textContent = name;

    // Persist name and keep any existing cart if user returns from cart page
    sessionStorage.setItem('qr_customer', this.customerName);

    document.getElementById('name-input-section').style.display = 'none';
    document.getElementById('menu-section').style.display = 'block';
  }

  // When loading the page, if we already have session data (from cart), skip name input
  ensureResumeFromSession() {
    const savedName = sessionStorage.getItem('qr_customer');
    if (savedName) {
      this.customerName = savedName;
      const savedRoom = sessionStorage.getItem('qr_room');
      if (savedRoom) this.roomName = savedRoom;
      document.getElementById('customer-display').textContent = this.customerName;
      document.getElementById('name-input-section').style.display = 'none';
      document.getElementById('menu-section').style.display = 'block';
      // restore cart if any
      const savedCart = sessionStorage.getItem('qr_cart');
      if (savedCart) {
        try { this.cart = JSON.parse(savedCart) || []; } catch { }
        this.updateCartSummary();
      }
    }
  }

  goToCart() {
    if (this.cart.length === 0) return;

    // Store cart data in sessionStorage
    sessionStorage.setItem('qr_cart', JSON.stringify(this.cart));
    sessionStorage.setItem('qr_customer', this.customerName);
    sessionStorage.setItem('qr_room', this.roomName);

    // Redirect to cart page (room comes from session)
    window.location.replace(`/qr-cart`);
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
    document.getElementById('menu-greeting-date').textContent = dateString;
  }

  showError(message) {
    // Simple error display - you can enhance this with a proper modal
    alert('Error: ' + message);
  }

  showSuccess(message) {
    // Simple success display - you can enhance this with a proper modal
    console.log('Success: ' + message);
  }
}

// Global functions for onclick handlers
function startOrdering() {
  qrMenuManager.startOrdering();
}

function openMenuModal(menuName) {
  qrMenuManager.openMenuModal(menuName);
}

function closeMenuModal() {
  qrMenuManager.closeMenuModal();
}

function decreaseQuantity() {
  const input = document.getElementById('item-quantity');
  const value = parseInt(input.value);
  if (value > 1) {
    input.value = value - 1;
  }
}

function increaseQuantity() {
  const input = document.getElementById('item-quantity');
  const value = parseInt(input.value);
  input.value = value + 1;
}

function addToCart() {
  qrMenuManager.addToCart();
}

function goToCart() {
  qrMenuManager.goToCart();
}

function updateMenuCategoriesPadding() {
    const card = document.getElementById('card-container');
    const cartSummary = document.getElementById('cart-summary');
    const cartFab = document.getElementById('cart-fab');
    // Deteksi apakah cart summary/fab sedang tampil
    const isCartVisible = (cartSummary && cartSummary.style.display !== 'none') ||
                          (cartFab && cartFab.style.display !== 'none');
    if (isCartVisible) {
        // Padding bawah sesuai tinggi card keranjang
        if (window.innerWidth <= 768) {
            card.style.marginBottom = '160px';
        } else {
            card.style.marginBottom = '120px';
        }
    } else {
        card.style.marginBottom = '';
    }
}

window.addEventListener('resize', updateMenuCategoriesPadding);
setInterval(updateMenuCategoriesPadding, 400);
document.addEventListener('DOMContentLoaded', updateMenuCategoriesPadding);

// Initialize when DOM is loaded
let qrMenuManager;
document.addEventListener('DOMContentLoaded', () => {
  qrMenuManager = new QRMenuManager();
});
