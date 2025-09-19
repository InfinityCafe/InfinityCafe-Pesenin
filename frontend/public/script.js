// script.js
// file js yang berisi function yang akan digunakan di seluruh file

// Global variable untuk modal
let selectedOrderId = null;
let selectedOrderStatus = 'cancelled';

// Fungsi untuk menampilkan tanggal
function updateGreetingDate(format = 'en') {
    const dateElement = document.getElementById('greeting-date');
    if (!dateElement) {
        console.warn("Greeting date element not found in DOM");
        return;
    }

    const today = new Date();

    if (format === 'id') {
        // Format Indonesia
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        dateElement.textContent = today.toLocaleDateString('id-ID', options);
    } else if (format === 'en') {
        // Format English dengan ordinal suffix
        const day = today.getDate();
        const weekday = today.toLocaleDateString('en-US', { weekday: 'long' });
        const month = today.toLocaleDateString('en-US', { month: 'long' });
        const year = today.getFullYear();
        const ordinalSuffix = day > 3 && day < 21 ? 'th' : ['th', 'st', 'nd', 'rd'][day % 10] || 'th';
        const formattedDate = `${weekday}, ${day}${ordinalSuffix} ${month} ${year}`;
        dateElement.textContent = formattedDate;
    }
}

function switchTab(tabId) {
    const page = document.body.getAttribute('data-page');

    // Remove active classes from all tab buttons and panels
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('tab-active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

    if (page === 'menu') {
        // Handle menu.html tab switching
        if (tabId === 'menu' || tabId === 'flavors') {
            const tabButton = document.getElementById(`tab-${tabId}`);
            const tabContent = document.getElementById(`tab-${tabId}-content`);
            if (tabButton && tabContent) {
                tabButton.classList.add('tab-active');
                tabContent.classList.add('active');
                // Update add button text
                const addButton = document.getElementById('add-new-btn');
                if (addButton) {
                    addButton.textContent = tabId === 'flavors' ? 'ADD NEW FLAVOUR' : 'ADD NEW MENU';
                }
                // Load appropriate data with error handling
                if (tabId === 'flavors' && typeof loadFlavors === 'function') {
                    loadFlavors().catch(error => {
                        console.error('Failed to load flavors:', error);
                        showErrorModal('Gagal memuat data varian rasa: ' + error.message);
                    });
                } else if (tabId === 'menu' && typeof loadMenus === 'function') {
                    loadMenus().catch(error => {
                        console.error('Failed to load menus:', error);
                        showErrorModal('Gagal memuat data menu: ' + error.message);
                    });
                }
            } else {
                console.warn(`Tab element not found: tab-${tabId} or tab-${tabId}-content`);
            }
        }
    } else if (page === 'menu_suggestion') {
        // Handle menu-suggestion.html (visual feedback only)
        const suggestionButton = document.getElementById('tab-menu-suggestion');
        if (suggestionButton) {
            suggestionButton.classList.add('tab-active');
        }
    }
}

// Fungsi navigasi navbar
function setupNavigation() {
    console.log('Setting up navigation...');
    const navButtons = document.querySelectorAll('.nav-btn');
    if (navButtons.length === 0) {
        console.warn("No navigation buttons found in DOM");
        return;
    }

    const currentPage = document.body.dataset.page;

    // Map judul halaman berdasarkan data-page
    const pageTitles = {
        dashboard: "Dashboard Kitchen",
        menu: "Menu Management",
        pesanan: "Daftar Pesanan",
        inventory: "Stock Management",
        menu_suggestion: "Menu Suggestion",
        report: "Reports",
        // Tambah halaman lain di sini
    };

    // Highlight tombol nav yang aktif
    const pageToNavId = {
        dashboard: 'nav-dashboard',
        menu: 'nav-menu',
        inventory: 'nav-stok',
        menu_suggestion: 'nav-menu',
        report: 'nav-report',
    };
    const activeNavId = pageToNavId[currentPage];
    navButtons.forEach(btn => {
        btn.classList.remove('active');
        if (activeNavId && btn.id === activeNavId) {
            btn.classList.add('active');
        }
    });

    // Navigasi saat tombol diklik
    navButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            const targetUrl = this.getAttribute('data-url');
            const overrideRoutes = {
                'nav-dashboard': '/dashboard',
                'nav-menu': '/menu-management',
                'nav-stok': '/stock-management',
                'nav-suggestion': '/menu-suggestion',
                'nav-report': '/reportKitchen',
                // Tambahkan mapping khusus di sini jika perlu
            };

            const route = overrideRoutes[this.id] || (targetUrl ? `/${targetUrl}.html` : null);

            if (route) {
                console.log('Navigating to:', route);
                const token = localStorage.getItem('access_token');
                if (token) {
                    // Create a temporary token for secure navigation
                    const tempToken = btoa(token).substring(0, 20) + Date.now();
                    sessionStorage.setItem('temp_token', token);
                    sessionStorage.setItem('temp_token_id', tempToken);
                    
                    // Navigate with temporary token that will be immediately removed
                    window.location.href = `${route}?temp=${tempToken}`;
                } else {
                    window.location.href = '/login';
                }
            }
        });
    });

    // Set judul navbar secara dinamis
    const navbarTitle = document.getElementById('navbar-title');
    if (navbarTitle && pageTitles[currentPage]) {
        navbarTitle.textContent = pageTitles[currentPage];
    }
}


// Fungsi status dapur
function initializeKitchenToggle() {
    console.log('Initializing kitchen toggle...');
    const toggle = document.getElementById('kitchen-toggle');
    if (!toggle) {
        console.warn("Kitchen toggle not found in DOM");
        return;
    }

    toggle.addEventListener('change', function() {
        const isOpen = this.checked;
        console.log('Kitchen toggle changed to:', isOpen);
        setKitchenStatus(isOpen);
        // statusText.textContent = isOpen ? 'BUKA' : 'TUTUP';
    });

    fetchKitchenStatus();
}

async function fetchKitchenStatus() {
    try {
        console.log('Fetching kitchen status...');
        const res = await fetch("/kitchen/status/now");
        if (!res.ok) {
        throw new Error('Failed to fetch kitchen status');
        }
        const data = await res.json();
        console.log('Kitchen status fetched:', data);
        updateKitchenStatusUI(data.is_open);
    } catch (error) {
        console.error('Error fetching kitchen status:', error);
        updateKitchenStatusUI(false);
    }
}

async function setKitchenStatus(isOpen) {
    try {
        console.log('Setting kitchen status to:', isOpen);
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

    if (toggle) toggle.checked = isOpen;
    if (offBanner) offBanner.classList.toggle('hidden', isOpen);

    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.disabled = !isOpen;
    });
}

// Fungsi logout
function logout() {
    console.log('Logging out...');
    // Hapus semua token dari storage
    try {
        localStorage.removeItem('access_token');
        sessionStorage.removeItem('temp_token');
        sessionStorage.removeItem('temp_token_id');
    } catch (e) {
        console.warn('Error clearing storage on logout:', e);
    }
    // Redirect pakai replace agar tidak bisa back ke halaman sebelumnya
    window.location.replace('/login');
}

// Fungsi untuk menambahkan tombol logout ke header
function setupLogoutButton() {
    console.log('Setting up logout button...');
    const headerRight = document.querySelector('.header-right');
    if (headerRight && !document.getElementById('logout-btn')) {
        const logoutBtn = document.createElement('button');
        logoutBtn.className = 'nav-btn';
        logoutBtn.id = 'logout-btn';
        logoutBtn.textContent = 'Logout';
        logoutBtn.style.marginLeft = '1rem';
        logoutBtn.onclick = logout;
        headerRight.appendChild(logoutBtn);
    }
}

// JWT validation function (client-side)
function validateJWTClient(token) {
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
            console.log('Token expired on client side');
            localStorage.removeItem('access_token');
            return false;
        }
        
        // Check if token has required fields
        if (!payload.sub) {
            console.log('Token missing subject on client side');
            return false;
        }
        
        return true;
    } catch (error) {
        console.log('JWT validation error on client:', error.message);
        localStorage.removeItem('access_token');
        return false;
    }
}

// Login guard
function checkAuth() {
    console.log('Checking auth...');
    const publicPages = ['login'];
    const currentPage = document.body.dataset.page || window.location.pathname.split('/').pop().replace('.html', '');
    
    if (!publicPages.includes(currentPage)) {
        // Check for regular token first (persistent across refreshes)
        const regularToken = localStorage.getItem('access_token');
        const tempToken = sessionStorage.getItem('temp_token');
        const token = regularToken || tempToken;
        
        if (!token || !validateJWTClient(token)) {
            console.log('No valid access token, redirecting to /login');
            // Clean up any temporary tokens
            sessionStorage.removeItem('temp_token');
            sessionStorage.removeItem('temp_token_id');
            localStorage.removeItem('access_token');
            window.location.href = '/login';
            return;
        }
        
        // If we used a temporary token, move it to localStorage for persistence
        if (tempToken && !regularToken) {
            localStorage.setItem('access_token', tempToken);
            sessionStorage.removeItem('temp_token');
            sessionStorage.removeItem('temp_token_id');
        }
    }
    console.log('Auth passed, current page:', currentPage);
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
            
            // Update greeting message berdasarkan halaman
            const currentPage = document.body.dataset.page;
            const greetingMessage = document.querySelector('.greeting-message h2');
            if (greetingMessage) {
                if (currentPage === 'menu') {
                    greetingMessage.textContent = `Hi, ${username}, here's list menu!`;
                } else if (currentPage === 'dashboard') {
                    greetingMessage.textContent = `Hi, ${username}, here's today's orders!`;
                } else if (currentPage === 'inventory') {
                    greetingMessage.textContent = `Hi, ${username}, here's today's stock overview!`;
                } else if (currentPage === 'menu_suggestion') {
                    greetingMessage.textContent = `Hi, ${username}, here's today's menu suggestions!`;
                } else if (currentPage === 'report') {
                    greetingMessage.textContent = `Hi, ${username}, here's your sales reports!`;
                }
                else {
                    greetingMessage.textContent = `Hi, ${username}!`;
                }
            }
        }
    } catch (error) {
        console.error('Error displaying user info:', error);
    }
}

// Inisialisasi kode bersama saat DOM dimuat
function switchTab(tabId) {
    const page = document.body.getAttribute('data-page');
    console.log('switchTab called with tabId:', tabId, 'on page:', page);

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('tab-active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

    if (page === 'menu') {
        if (tabId === 'menu' || tabId === 'flavors') {
            const tabButton = document.getElementById(`tab-${tabId}`);
            const tabContent = document.getElementById(`tab-${tabId}-content`);
            if (tabButton && tabContent) {
                console.log(`Activating tab: ${tabId}`);
                tabButton.classList.add('tab-active');
                tabContent.classList.add('active');
                // Update add button text
                const addButton = document.getElementById('add-new-btn');
                if (addButton) {
                    addButton.textContent = tabId === 'flavors' ? 'ADD NEW FLAVOUR' : 'ADD NEW MENU';
                    console.log('Updated add button text to:', addButton.textContent);
                }
                if (tabId === 'flavors' && typeof loadFlavors === 'function') {
                    console.log('Calling loadFlavors');
                    loadFlavors().catch(error => {
                        console.error('Failed to load flavors:', error);
                        showErrorModal('Gagal memuat data varian rasa: ' + error.message);
                    });
                } else if (tabId === 'menu' && typeof loadMenus === 'function') {
                    console.log('Calling loadMenus');
                    loadMenus().catch(error => {
                        console.error('Failed to load menus:', error);
                        showErrorModal('Gagal memuat data menu: ' + error.message);
                    });
                }
            } else {
                console.warn(`Tab element not found: tab-${tabId} or tab-${tabId}-content`);
            }
        } else {
            console.warn(`Invalid tabId: ${tabId}, defaulting to menu`);
            switchTab('menu');
        }
    } else if (page === 'menu_suggestion') {
        const suggestionButton = document.getElementById('tab-menu-suggestion');
        if (suggestionButton) {
            suggestionButton.classList.add('tab-active');
            console.log('Activated menu_suggestion tab');
        }
    }
}

// FUNGSI UNTUK MODAL GLOBAL

async function loadGlobalModals() {
  if (document.getElementById('success-modal')) {
    return;
  }
  
  try {
    const response = await fetch('/modals.html');
    const modalHTML = await response.text();
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }
  catch (error) {
    console.error('Error loading global modals:', error);
  }
}

function showSuccessModal(message) {
  closeModal('error-modal');
  closeModal('delete-confirm-modal');

  const modal = document.getElementById('success-modal');
  const messageElement = document.getElementById('success-message');
  if (modal && messageElement) {
    messageElement.textContent = message;
    modal.classList.remove('hidden');
  }
}

function showDeleteConfirmModal(message, onConfirm) {
  closeModal('error-modal');
  closeModal('delete-confirm-modal');
  
  document.getElementById('delete-confirm-message').textContent = message;
  document.getElementById('delete-confirm-modal').classList.remove('hidden');
    
  // Set up confirm button action
  const confirmBtn = document.getElementById('delete-confirm-btn');
  confirmBtn.onclick = () => {
    closeModal('delete-confirm-modal');
    onConfirm();
  };
}

function openConfirmModal(orderId, status) {
    selectedOrderId = orderId;
    selectedOrderStatus = status || 'cancelled';
    // Reset confirm modal state
    const customReasonContainer = document.getElementById('custom-reason-container-cancel');
    const customReasonInput = document.getElementById('custom-cancel-reason-cancel');
    const btnAlasanLain = document.getElementById('btn-alasan-lain-cancel');
    const btnConfirmAlasanLain = document.getElementById('btn-confirm-alasan-lain-cancel');
    const btnHabis = document.getElementById('btn-habis-cancel');
    if (customReasonContainer && customReasonInput && btnAlasanLain && btnConfirmAlasanLain && btnHabis) {
        customReasonContainer.classList.add('hidden');
        customReasonInput.value = '';
        btnAlasanLain.classList.remove('hidden');
        btnConfirmAlasanLain.classList.add('hidden');
        btnHabis.classList.remove('hidden');
    }
    document.getElementById("confirm-modal").classList.remove("hidden");
}

function showErrorModal(message) {
  const modal = document.getElementById('error-modal');
  const messageElement = document.getElementById('error-message');
  if (modal && messageElement) {
    messageElement.textContent = message;
    modal.classList.remove('hidden');
  }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
    }
}

function showSuccessModal(message) {
  const modal = document.getElementById('success-modal');
  const messageElement = document.getElementById('success-message');
  if (modal && messageElement) {
    messageElement.textContent = message;
    modal.classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOMContentLoaded event triggered in script.js');

    await loadGlobalModals();
    
    // Clean up temporary token from URL immediately
    const urlParams = new URLSearchParams(window.location.search);
    const tempToken = urlParams.get('temp');
    if (tempToken) {
        // Verify the temporary token matches what we stored
        const storedTokenId = sessionStorage.getItem('temp_token_id');
        if (storedTokenId === tempToken) {
            // Remove temp token from URL and sessionStorage
            urlParams.delete('temp');
            const newUrl = window.location.pathname + 
                          (urlParams.toString() ? '?' + urlParams.toString() : '') + 
                          window.location.hash;
            window.history.replaceState({}, document.title, newUrl);
            sessionStorage.removeItem('temp_token_id');
            console.log('Temporary token cleaned from URL');
        } else {
            console.warn('Temporary token mismatch, redirecting to login');
            window.location.href = '/login';
            return;
        }
    }
    
    checkAuth();
    updateGreetingDate();

    const page = document.body.getAttribute('data-page');
    const hash = window.location.hash.replace('#', '');
    const validTabs = ['menu', 'flavors'];

    if (page === 'menu') {
        const activeTab = validTabs.includes(hash) ? hash : 'menu';
        switchTab(activeTab);
        if (window.location.hash) {
            window.history.replaceState({}, document.title, '/menu-management');
        }
        // Ensure data is loaded for the active tab
        if (activeTab === 'flavors' && typeof loadFlavors === 'function') {
            loadFlavors().catch(error => {
                console.error('Failed to load flavors on init:', error);
                showErrorModal('Gagal memuat data varian rasa: ' + error.message);
            });
        } else if (activeTab === 'menu' && typeof loadMenus === 'function') {
            loadMenus().catch(error => {
                console.error('Failed to load menus on init:', error);
                showErrorModal('Gagal memuat data menu: ' + error.message);
            });
        }
    } else if (page === 'menu_suggestion') {
        switchTab('menu_suggestion');
        // Ensure suggestions are loaded
        if (typeof loadSuggestions === 'function') {
            loadSuggestions().catch(error => {
                console.error('Failed to load suggestions:', error);
                showErrorModal('Gagal memuat usulan menu: ' + error.message);
            });
        }
    }

    setupNavigation();
    initializeKitchenToggle();
    fetchKitchenStatus();
    setupLogoutButton();
    displayUserInfo();
});