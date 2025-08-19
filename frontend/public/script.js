// script.js
// file js yang berisi function yang akan digunakan di seluruh file

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
        // Tambah halaman lain di sini
    };

    // Highlight tombol nav yang aktif
    const pageToNavId = {
        dashboard: 'nav-dashboard',
        menu: 'nav-menu',
        inventory: 'nav-stok',
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
                // Tambahkan mapping khusus di sini jika perlu
            };

            const route = overrideRoutes[this.id] || (targetUrl ? `/${targetUrl}.html` : null);

            if (route) {
                console.log('Navigating to:', route);
                window.location.href = route;
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
    localStorage.removeItem('access_token');
    window.location.href = '/login';
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

// Login guard
function checkAuth() {
    console.log('Checking auth...');
    const publicPages = ['login'];
    const currentPage = document.body.dataset.page || window.location.pathname.split('/').pop().replace('.html', '');
    
    if (!publicPages.includes(currentPage) && !localStorage.getItem('access_token')) {
        console.log('No access token, redirecting to /login');
        window.location.href = '/login';
    } else {
        console.log('Auth passed, current page:', currentPage);
    }
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
                headerSubtitle.textContent = `${username} | Barista`;
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
                } else {
                    greetingMessage.textContent = `Hi, ${username}!`;
                }
            }
        }
    } catch (error) {
        console.error('Error displaying user info:', error);
    }
}

// Inisialisasi kode bersama saat DOM dimuat
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOMContentLoaded event triggered in script.js');
    checkAuth();
    updateGreetingDate();
    setupNavigation();
    initializeKitchenToggle();
    fetchKitchenStatus();
    setupLogoutButton();
    displayUserInfo();
});