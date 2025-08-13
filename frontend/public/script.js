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
        // updateKitchenStatusUI(isOpen);
        fetchKitchenStatus();
    } catch {
        alert("Gagal mengubah status dapur");
        fetchKitchenStatus();
    }
}

function updateKitchenStatusUI(isOpen) {
    const toggle = document.getElementById('kitchen-toggle');
    const statusText = document.getElementById('kitchen-status-text');
    const offBanner = document.getElementById('kitchen-off-banner');
    const actionButtons = document.querySelectorAll('.action-btn');

    if (toggle) {
        toggle.checked = isOpen;
    }

    if (statusText) {
        statusText.textContent = isOpen ? 'BUKA' : 'TUTUP';
    }

    if (offBanner) {
        offBanner.classList.toggle('hidden', isOpen); // true = hide
    }

    if (actionButtons.length > 0) {
        actionButtons.forEach(btn => {
            btn.disabled = !isOpen;
        });
    }
}

// Inisialisasi kode bersama saat DOM dimuat
document.addEventListener('DOMContentLoaded', function() {
    updateGreetingDate();
    setupNavigation();
    initializeKitchenToggle();
    fetchKitchenStatus();
});