// script.js
// file js yang berisi function yang akan digunakan di seluruh file

// Fungsi untuk menampilkan tanggal
function updateGreetingDate(format = 'en') {
    const dateElement = document.getElementById('greeting-date');
    if (!dateElement) return; // Pemeriksaan keamanan

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
    const navButtons = document.querySelectorAll('.nav-btn');
    if (navButtons.length === 0) return;

    const currentPage = document.body.dataset.page;

    // Map judul halaman berdasarkan data-page
    const pageTitles = {
        dashboard: "Dashboard Kitchen",
        menu: "Menu Management",
        pesanan: "Daftar Pesanan",
        // kelola-stok : "Stock Management",
        // Tambah halaman lain di sini
    };

    // Highlight tombol nav yang aktif
    navButtons.forEach(btn => {
        const btnPage = btn.id.replace('nav-', '');
        btn.classList.remove('active');
        if (btnPage === currentPage) {
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
    const toggle = document.getElementById('kitchen-toggle');
    if (!toggle) return;

    // const statusText = document.getElementById('kitchen-status-text');

    toggle.addEventListener('change', function() {
        const isOpen = this.checked;
        setKitchenStatus(isOpen);
        // statusText.textContent = isOpen ? 'BUKA' : 'TUTUP';
    });

    fetchKitchenStatus();
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

// Fungsi logout
function logout() {
    localStorage.removeItem('access_token');
    window.location.href = '/login';
}

// Fungsi untuk menambahkan tombol logout ke header
function setupLogoutButton() {
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
    const publicPages = ['login'];
    const currentPage = document.body.dataset.page || window.location.pathname.split('/').pop().replace('.html', '');
    
    if (!publicPages.includes(currentPage) && !localStorage.getItem('access_token')) {
        window.location.href = '/login';
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
                } else if (currentPage === 'kelola-stok') {
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
    checkAuth();
    updateGreetingDate();
    setupNavigation();
    initializeKitchenToggle();
    fetchKitchenStatus();
    setupLogoutButton();
    displayUserInfo();
});