const BASE_URL = "";

// Global variables for pagination and filtering
let allMenus = [];
let allFlavors = [];
let filteredMenus = [];
let filteredFlavors = [];
let selectedFlavorIds = [];

// Data loading state
let menusLoaded = false;
let flavorsLoaded = false;

// Menu pagination state
let menuCurrentPage = 1;
let menuPageSize = 10;
let menuTotalPages = 1;

// Flavor pagination state
let flavorCurrentPage = 1;
let flavorPageSize = 10;
let flavorTotalPages = 1;

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('tab-active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('tab-active');
    document.getElementById(`tab-${tab}-content`).classList.add('active');
    
    // Update button text based on active tab
    const addButton = document.getElementById('add-new-btn');
    if (tab === 'flavors') {
    addButton.textContent = 'ADD NEW FLAVOUR';
    loadFlavors();
    } else if (tab === 'menu') {
    addButton.textContent = 'ADD NEW MENU';
    // Load menus (flavors are included in menu data)
    loadMenus().catch(error => {
        console.error('Error loading data for menu tab:', error);
    });
    }
}

// Load all menus with pagination
async function loadMenus() {
    try {
    // Use /menu/all endpoint to get all menus (including unavailable ones) for admin view
    const response = await fetch(`${BASE_URL}/menu/all`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    let menus;
    try {
        menus = await response.json();
    } catch (parseError) {
        throw new Error('Invalid JSON response from server');
    }
    
    allMenus = menus || [];
    filteredMenus = [...allMenus];
    menusLoaded = true;
    
    // Reset pagination to first page when data changes
    menuCurrentPage = 1;
    
    // Always render table, flavors are included in menu data
    await renderMenuTable();
    updateMenuPagination();
    
    // Load flavors separately for flavor selector (if not loaded yet)
    if (!flavorsLoaded) {
        try {
        await loadFlavors();
        } catch (error) {
        console.error('Error loading flavors for selector:', error);
        }
    }
    
    return allMenus; // Return menus for promise chaining
    } catch (error) {
    console.error('Error loading menus:', error);
    const tbody = document.querySelector('#menu-table tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">Error loading menus: ' + error.message + '</td></tr>';
    throw error;
    }
}

// Render menu table with pagination
async function renderMenuTable() {
    const tbody = document.querySelector('#menu-table tbody');
    tbody.innerHTML = '';
    
    // Ensure menu data is loaded before rendering
    if (!menusLoaded) {
        await loadMenus();
    }
    
    const startIndex = (menuCurrentPage - 1) * menuPageSize;
    const endIndex = startIndex + menuPageSize;
    const currentPageData = filteredMenus.slice(startIndex, endIndex);
    
    // Debug logging
    console.log('Rendering menu table with:', {
    allMenus: allMenus.length,
    allFlavors: allFlavors.length,
    currentPageData: currentPageData.length
    });
    
    if (currentPageData.length > 0) {
    currentPageData.forEach((menu, index) => {
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${startIndex + index + 1}</td>
            <td>${menu.base_name}</td>
            <td>${menu.base_price}</td>
            <td>
            ${menu.isAvail ? '<span class="status-badge status-available">Available</span>' : '<span class="status-badge status-unavailable">Unavailable</span>'}
            </td>
            <td class="action-header">
            <button class="table-action-btn" onclick="viewMenu('${menu.id}')"><i class="fas fa-eye"></i></button>
            <button class="table-action-btn" onclick="editMenu('${menu.id}')"><i class="fas fa-edit"></i></button>
            <button class="table-action-btn" onclick="deleteMenu('${menu.id}')"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(row);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No menus found</td></tr>';
    }
    
    updateMenuTableInfo();
}

// Update menu pagination
function updateMenuPagination() {
    menuTotalPages = Math.ceil(filteredMenus.length / menuPageSize);
    if (menuTotalPages === 0) menuTotalPages = 1;
    
    if (menuCurrentPage > menuTotalPages) {
    menuCurrentPage = menuTotalPages;
    }
    
    renderMenuPagination();
}

// Render menu pagination controls
function renderMenuPagination() {
    const pageNumbers = document.getElementById('menu-page-numbers');
    const prevBtn = document.getElementById('menu-prev-btn');
    const nextBtn = document.getElementById('menu-next-btn');
    const paginationInfo = document.getElementById('menu-pagination-info');
    
    // Update pagination info
    paginationInfo.textContent = `Page ${menuCurrentPage} of ${menuTotalPages}`;
    
    // Update prev/next buttons
    prevBtn.disabled = menuCurrentPage === 1;
    nextBtn.disabled = menuCurrentPage === menuTotalPages;
    
    // Generate page numbers
    pageNumbers.innerHTML = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, menuCurrentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(menuTotalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement('button');
    pageBtn.className = `page-number ${i === menuCurrentPage ? 'active' : ''}`;
    pageBtn.textContent = i;
    pageBtn.onclick = () => {
        menuCurrentPage = i;
        renderMenuTable();
        renderMenuPagination();
    };
    pageNumbers.appendChild(pageBtn);
    }
}

// Update menu table info
function updateMenuTableInfo() {
    const tableInfo = document.getElementById('menu-table-info');
    const startIndex = (menuCurrentPage - 1) * menuPageSize + 1;
    const endIndex = Math.min(menuCurrentPage * menuPageSize, filteredMenus.length);
    const total = filteredMenus.length;
    
    tableInfo.textContent = `Showing ${startIndex} to ${endIndex} of ${total} entries`;
}

// Change menu page
async function changeMenuPage(direction) {
    const newPage = menuCurrentPage + direction;
    if (newPage >= 1 && newPage <= menuTotalPages) {
    menuCurrentPage = newPage;
    await renderMenuTable();
    renderMenuPagination();
    }
}

// Change menu page size
async function changeMenuPageSize() {
    menuPageSize = parseInt(document.getElementById('menu-page-size').value);
    menuCurrentPage = 1;
    updateMenuPagination();
    await renderMenuTable();
}

// Ensure data is loaded
async function ensureDataLoaded() {
    try {
    if (!menusLoaded) {
        await loadMenus();
    }
    // Only load flavors if needed for flavor selector
    if (!flavorsLoaded) {
        await loadFlavors();
    }
    } catch (error) {
    console.error('Error ensuring data is loaded:', error);
    // Set flags to false to allow retry
    menusLoaded = false;
    flavorsLoaded = false;
    throw error;
    }
}

// Load flavors with pagination
async function loadFlavors() {
    try {
    // Use /flavors/all endpoint to get all flavors (including unavailable ones) for admin view
    const response = await fetch(`${BASE_URL}/flavors/all`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    let flavors;
    try {
        flavors = await response.json();
    } catch (parseError) {
        throw new Error('Invalid JSON response from server');
    }
    
    allFlavors = flavors || [];
    filteredFlavors = [...allFlavors];
    flavorsLoaded = true;
    
    // Reset pagination to first page when data changes
    flavorCurrentPage = 1;
    
    renderFlavorTable();
    updateFlavorPagination();
    
    // Also update flavor checkboxes in menu modal if it's open
    if (document.getElementById('add-menu-modal').classList.contains('hidden') === false) {
        populateFlavorCheckboxes();
    }
    
    return allFlavors; // Return flavors for promise chaining
    } catch (error) {
    console.error('Error loading flavors:', error);
    const tbody = document.querySelector('#flavors-table tbody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Error loading flavors: ' + error.message + '</td></tr>';
    throw error;
    }
}

// Render flavor table with pagination
function renderFlavorTable() {
    const tbody = document.querySelector('#flavors-table tbody');
    tbody.innerHTML = '';
    
    const startIndex = (flavorCurrentPage - 1) * flavorPageSize;
    const endIndex = startIndex + flavorPageSize;
    const currentPageData = filteredFlavors.slice(startIndex, endIndex);
    
    if (currentPageData.length > 0) {
    currentPageData.forEach((flavor, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
        <td>${startIndex + index + 1}</td>
            <td>${flavor.flavor_name}</td>
            <td>${flavor.additional_price}</td>
            <td>${flavor.isAvail ? '<span class="status-badge status-available">Available</span>' : '<span class="status-badge status-unavailable">Unavailable</span>'}</td>
            <td class="action-header">
            <button class="table-action-btn" onclick="viewFlavor('${flavor.id}')"><i class="fas fa-eye"></i></button>
            <button class="table-action-btn" onclick="editFlavor('${flavor.id}')"><i class="fas fa-edit"></i></button>
            <button class="table-action-btn" onclick="deleteFlavor('${flavor.id}')"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(row);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No flavors found</td></tr>';
    }
    
    updateFlavorTableInfo();
}

// Update flavor pagination
function updateFlavorPagination() {
    flavorTotalPages = Math.ceil(filteredFlavors.length / flavorPageSize);
    if (flavorTotalPages === 0) flavorTotalPages = 1;
    
    if (flavorCurrentPage > flavorTotalPages) {
    flavorCurrentPage = flavorTotalPages;
    }
    
    renderFlavorPagination();
}

// Render flavor pagination controls
function renderFlavorPagination() {
    const pageNumbers = document.getElementById('flavor-page-numbers');
    const prevBtn = document.getElementById('flavor-prev-btn');
    const nextBtn = document.getElementById('flavor-next-btn');
    const paginationInfo = document.getElementById('flavor-pagination-info');
    
    // Update pagination info
    paginationInfo.textContent = `Page ${flavorCurrentPage} of ${flavorTotalPages}`;
    
    // Update prev/next buttons
    prevBtn.disabled = flavorCurrentPage === 1;
    nextBtn.disabled = flavorCurrentPage === flavorTotalPages;
    
    // Generate page numbers
    pageNumbers.innerHTML = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, flavorCurrentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(flavorTotalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement('button');
    pageBtn.className = `page-number ${i === flavorCurrentPage ? 'active' : ''}`;
    pageBtn.textContent = i;
    pageBtn.onclick = () => {
        flavorCurrentPage = i;
        renderFlavorTable();
        renderFlavorPagination();
    };
    pageNumbers.appendChild(pageBtn);
    }
}

// Update flavor table info
function updateFlavorTableInfo() {
    const tableInfo = document.getElementById('flavor-table-info');
    const startIndex = (flavorCurrentPage - 1) * flavorPageSize + 1;
    const endIndex = Math.min(flavorCurrentPage * flavorPageSize, filteredFlavors.length);
    const total = filteredFlavors.length;
    
    tableInfo.textContent = `Showing ${startIndex} to ${endIndex} of ${total} entries`;
}

// Change flavor page
function changeFlavorPage(direction) {
    const newPage = flavorCurrentPage + direction;
    if (newPage >= 1 && newPage <= flavorTotalPages) {
    flavorCurrentPage = newPage;
    renderFlavorTable();
    renderFlavorPagination();
    }
}

// Change flavor page size
function changeFlavorPageSize() {
    flavorPageSize = parseInt(document.getElementById('flavor-page-size').value);
    flavorCurrentPage = 1;
    updateFlavorPagination();
    renderFlavorTable();
}

// Filter functions
function toggleFilterMenu() {
    const dropdown = document.getElementById('menu-filter-dropdown');
    dropdown.classList.toggle('show');
}

function toggleFilterFlavor() {
    const dropdown = document.getElementById('flavor-filter-dropdown');
    dropdown.classList.toggle('show');
}

async function applyMenuFilter() {
    const searchTerm = document.getElementById('menu-search').value.toLowerCase();
    const statusFilter = document.getElementById('menu-status-filter').value;
    const priceMin = document.getElementById('menu-price-min').value;
    const priceMax = document.getElementById('menu-price-max').value;
    
    filteredMenus = allMenus.filter(menu => {
    // Search filter
    const matchesSearch = menu.base_name.toLowerCase().includes(searchTerm) ||
                        menu.base_price.toString().includes(searchTerm);
    
    // Status filter
    const matchesStatus = !statusFilter || 
                        (statusFilter === 'Yes' && menu.isAvail) ||
                        (statusFilter === 'No' && !menu.isAvail);
    
    // Price filter
    const matchesPrice = (!priceMin || menu.base_price >= parseInt(priceMin)) &&
                        (!priceMax || menu.base_price <= parseInt(priceMax));
    
    return matchesSearch && matchesStatus && matchesPrice;
    });
    
    menuCurrentPage = 1;
    updateMenuPagination();
    await renderMenuTable();
    
    // Close dropdown
    document.getElementById('menu-filter-dropdown').classList.remove('show');
}

async function clearMenuFilter() {
    document.getElementById('menu-search').value = '';
    document.getElementById('menu-status-filter').value = '';
    document.getElementById('menu-price-min').value = '';
    document.getElementById('menu-price-max').value = '';
    
    filteredMenus = [...allMenus];
    menuCurrentPage = 1;
    updateMenuPagination();
    await renderMenuTable();
    
    // Close dropdown
    document.getElementById('menu-filter-dropdown').classList.remove('show');
}

function applyFlavorFilter() {
    const searchTerm = document.getElementById('flavor-search').value.toLowerCase();
    const statusFilter = document.getElementById('flavor-status-filter').value;
    const priceMin = document.getElementById('flavor-price-min').value;
    const priceMax = document.getElementById('flavor-price-max').value;
    
    filteredFlavors = allFlavors.filter(flavor => {
    // Search filter
    const matchesSearch = flavor.flavor_name.toLowerCase().includes(searchTerm) ||
                        flavor.additional_price.toString().includes(searchTerm);
    
    // Status filter
    const matchesStatus = !statusFilter || 
                        (statusFilter === 'Yes' && flavor.isAvail) ||
                        (statusFilter === 'No' && !flavor.isAvail);
    
    // Price filter
    const matchesPrice = (!priceMin || flavor.additional_price >= parseInt(priceMin)) &&
                        (!priceMax || flavor.additional_price <= parseInt(priceMax));
    
    return matchesSearch && matchesStatus && matchesPrice;
    });
    
    flavorCurrentPage = 1;
    updateFlavorPagination();
    renderFlavorTable();
    
    // Close dropdown
    document.getElementById('flavor-filter-dropdown').classList.remove('show');
}

function clearFlavorFilter() {
    document.getElementById('flavor-search').value = '';
    document.getElementById('flavor-status-filter').value = '';
    document.getElementById('flavor-price-min').value = '';
    document.getElementById('flavor-price-max').value = '';
    
    filteredFlavors = [...allFlavors];
    flavorCurrentPage = 1;
    updateFlavorPagination();
    renderFlavorTable();
    
    // Close dropdown
    document.getElementById('flavor-filter-dropdown').classList.remove('show');
}

// Close filter dropdowns when clicking outside
document.addEventListener('click', function(event) {
    const menuFilterDropdown = document.getElementById('menu-filter-dropdown');
    const flavorFilterDropdown = document.getElementById('flavor-filter-dropdown');
    
    if (!event.target.closest('.filter-container')) {
    menuFilterDropdown.classList.remove('show');
    flavorFilterDropdown.classList.remove('show');
    }
});

// Save or update menu
async function saveMenu() {
    const menuId = document.getElementById('add-menu-form').getAttribute('data-menu-id') || null;
    const baseName = document.getElementById('base-name').value;
    const basePrice = parseInt(document.getElementById('base-price').value);
    const isAvail = document.querySelector('input[name="is-avail"]:checked').value === 'true';

    // Client-side validation for non-negative price
    if (isNaN(basePrice) || basePrice < 0) {
    	showErrorModal('Harga menu tidak boleh negatif.');
    	return;
    }

    const data = {
    base_name: baseName,
    base_price: basePrice,
    isAvail: isAvail,
    flavor_ids: selectedFlavorIds
    };

    try {
    let response;
    if (menuId) {
        response = await fetch(`${BASE_URL}/menu/${menuId}`, {
        method: "PUT",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
        });
    } else {
        response = await fetch(`${BASE_URL}/menu`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
        });
    }

    if (!response.ok) {
        let errorMessage = 'Failed to save menu';
        try {
        const errorData = await response.json();
        console.log('Menu save error response:', errorData);
        // Backend returns error message in 'message' field, not 'detail'
        errorMessage = errorData.message || errorData.detail || errorData.error || errorMessage;
        } catch (parseError) {
        // If response is not JSON (e.g., HTML error page)
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
    }
    
    let result;
    try {
        result = await response.json();
        console.log('Menu saved successfully:', result);
    } catch (parseError) {
        console.log('Menu saved successfully (no JSON response)');
    }
    
    // Reset selectedFlavorIds before closing modal
    selectedFlavorIds = [];
    closeAddMenuModal();
    await loadMenus();
    
    // Menu table will be re-rendered automatically by loadMenus
    
    // Show success message
    showSuccessModal(result.message || 'Menu berhasil disimpan');
    } catch (error) {
    console.error('Error saving menu:', error);
    showErrorModal('Error saving menu: ' + error.message);
    }
}

// Edit menu
function editMenu(menuId) {
    fetch(`${BASE_URL}/menu/${menuId}`)
    .then(response => response.json())
    .then(menu => {
        document.getElementById('base-name').value = menu.base_name;
        document.getElementById('base-price').value = menu.base_price;
        
        // Set radio button based on isAvail value
        if (menu.isAvail) {
        document.getElementById('is-avail-true').checked = true;
        } else {
        document.getElementById('is-avail-false').checked = true;
        }
        
        // Set selected flavors
        selectedFlavorIds = menu.flavors ? menu.flavors.map(f => f.id) : [];
        console.log('Selected flavor IDs for edit:', selectedFlavorIds);
        
        document.getElementById('add-menu-form').setAttribute('data-menu-id', menuId);
        openAddMenuModal();
    })
    .catch(error => {
        console.error('Error loading menu for edit:', error);
        showErrorModal('Error loading menu for edit: ' + error.message);
    });
}

// Delete menu
async function deleteMenu(menuId) {
    // Get menu name for confirmation message
    const menu = allMenus.find(m => m.id === menuId);
    const menuName = menu ? menu.base_name : 'this menu';
    
    showDeleteConfirmModal(
    `Apakah Anda yakin ingin menghapus menu "${menuName}"?`,
    async () => {
        try {
        const response = await fetch(`${BASE_URL}/menu/${menuId}`, {
            method: "DELETE"
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.log('Menu delete error response:', errorData);
            
            // Backend returns error message in 'message' field, not 'detail'
            const errorMessage = errorData.message || errorData.detail || 'Gagal menghapus menu';
            showErrorModal(errorMessage);
            return;
        }
        
        const result = await response.json();
        await loadMenus();
        
        showSuccessModal(result.message || 'Menu berhasil dihapus');
        } catch (error) {
        console.error('Error deleting menu:', error);
        showErrorModal('Error deleting menu: ' + error.message);
        }
    }
    );
}

// View menu
async function viewMenu(menuId) {
    try {
    const response = await fetch(`${BASE_URL}/menu/${menuId}`);
    if (!response.ok) throw new Error('Failed to fetch menu details');
    
    const menu = await response.json();
    
    document.getElementById('view-menu-name').textContent = menu.base_name;
    document.getElementById('view-menu-price').textContent = `Rp ${menu.base_price.toLocaleString()}`;
    document.getElementById('view-menu-available').innerHTML =
    `<span class="status-badge ${menu.isAvail ? 'status-available' : 'status-unavailable'}">
        ${menu.isAvail ? 'Available' : 'Unavailable'}
    </span>`;
    
    // Display available flavors
    let flavorsText = 'None';
    console.log('viewMenu menu.flavors:', menu.flavors);
    if (menu.flavors && menu.flavors.length > 0) {
        const flavorItems = [];
        for (const flavor of menu.flavors) {
        flavorItems.push(`<div class="flavor-item">${flavor.flavor_name}<span class="flavor-price">(+Rp ${flavor.additional_price.toLocaleString()})</span></div>`);
        }
        flavorsText = flavorItems.join('');
    }
    document.getElementById('view-menu-flavors').innerHTML = flavorsText;
    
    // Store the menu ID for edit functionality
    document.getElementById('view-menu-modal').setAttribute('data-menu-id', menuId);
    
    document.getElementById('view-menu-modal').classList.remove('hidden');
    } catch (error) {
    console.error('Error viewing menu:', error);
    showErrorModal('Error loading menu details: ' + error.message);
    }
}

// View flavor
async function viewFlavor(flavorId) {
    try {
    const response = await fetch(`${BASE_URL}/flavors/${flavorId}`);
    if (!response.ok) throw new Error('Failed to fetch flavor details');
    
    const flavor = await response.json();
    
    document.getElementById('view-flavor-name').textContent = flavor.flavor_name;
    document.getElementById('view-flavor-price').textContent = `Rp ${flavor.additional_price.toLocaleString()}`;
    document.getElementById('view-flavor-available').innerHTML =
    `<span class="status-badge ${flavor.isAvail ? 'status-available' : 'status-unavailable'}">
        ${flavor.isAvail ? 'Available' : 'Unavailable'}
    </span>`;
    
    // Store the flavor ID for edit functionality
    document.getElementById('view-flavor-modal').setAttribute('data-flavor-id', flavorId);
    
    document.getElementById('view-flavor-modal').classList.remove('hidden');
    } catch (error) {
    console.error('Error viewing flavor:', error);
    showErrorModal('Error loading flavor details: ' + error.message);
    }
}

// Edit flavor
async function editFlavor(flavorId) {
    try {
    const response = await fetch(`${BASE_URL}/flavors/${flavorId}`);
    if (!response.ok) throw new Error('Failed to fetch flavor details');
    
    const flavor = await response.json();
    
    document.getElementById('flavour-name').value = flavor.flavor_name;
    document.getElementById('additional-price').value = flavor.additional_price;
    // Set radio button berdasarkan isAvail
    if (flavor.isAvail) {
        document.getElementById('is-flavour-avail-true').checked = true;
    } else {
        document.getElementById('is-flavour-avail-false').checked = true;
    }
    // Ubah judul modal menjadi Edit Flavour
    const modalTitle = document.querySelector('#add-flavour-modal .modal-title');
    if (modalTitle) modalTitle.textContent = 'Edit Flavour';
    document.getElementById('add-flavour-form').setAttribute('data-flavour-id', flavorId);
    openAddFlavourModal();
    } catch (error) {
    console.error('Error loading flavor for edit:', error);
    showErrorModal('Error loading flavor for edit: ' + error.message);
    }
}

// Delete flavor
async function deleteFlavor(flavorId) {
    // Get flavor name for confirmation message
    const flavor = allFlavors.find(f => f.id === flavorId);
    const flavorName = flavor ? flavor.flavor_name : 'this flavor';
    
    showDeleteConfirmModal(
    `Apakah Anda yakin ingin menghapus varian rasa "${flavorName}"?`,
    async () => {
        try {
        const response = await fetch(`${BASE_URL}/flavors/${flavorId}`, {
            method: "DELETE"
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.log('Flavor delete error response:', errorData);
            
            // Backend returns error message in 'message' field, not 'detail'
            const errorMessage = errorData.message || errorData.detail || 'Gagal menghapus varian rasa';
            showErrorModal(errorMessage);
            return;
        }
        
        const result = await response.json();
        
        // Refresh flavors data
        await loadFlavors();
        
        // Also refresh menu data to update flavor associations
        await loadMenus();
        
        showSuccessModal(result.message || 'Varian rasa berhasil dihapus');
        } catch (error) {
        console.error('Error deleting flavor:', error);
        showErrorModal('Error deleting flavor: ' + error.message);
        }
    }
    );
}

// Modal Functions
function openAddModal() {
    const activeTab = document.querySelector('.tab-btn.tab-active').id.replace('tab-', '');
    if (activeTab === 'flavors') {
    openAddFlavourModal();
    } else {
    openAddMenuModal();
    }
}

function openAddMenuModal() {
    // Load flavors if not already loaded
    if (allFlavors.length === 0) {
    loadFlavors().then(() => {
        populateFlavorCheckboxes();
    });
    } else {
    populateFlavorCheckboxes();
    }
    
    // Set modal title based on whether we're editing or adding
    const modalTitle = document.querySelector('#add-menu-modal .modal-title');
    const isEditing = document.getElementById('add-menu-form').hasAttribute('data-menu-id');
    modalTitle.textContent = isEditing ? 'Edit Menu' : 'Add New Menu';
    
    // If editing, ensure selectedFlavorIds are preserved
    if (isEditing) {
    console.log('Opening edit modal with selectedFlavorIds:', selectedFlavorIds);
    // Re-populate checkboxes to ensure selected flavors are checked
    setTimeout(() => {
        populateFlavorCheckboxes();
    }, 100);
    }
    
    document.getElementById('add-menu-modal').classList.remove('hidden');
}

function closeAddMenuModal() {
    document.getElementById('add-menu-form').reset();
    document.getElementById('add-menu-form').removeAttribute('data-menu-id');
    document.getElementById('form-error').textContent = '';
    document.getElementById('form-error').style.color = '';
    // Reset radio button to default (True)
    document.getElementById('is-avail-true').checked = true;
    // Reset flavor selection (only if not already reset)
    if (selectedFlavorIds.length > 0) {
    selectedFlavorIds = [];
    populateFlavorCheckboxes();
    }
    // Reset modal title
    const modalTitle = document.querySelector('#add-menu-modal .modal-title');
    modalTitle.textContent = 'Add New Menu';
    document.getElementById('add-menu-modal').classList.add('hidden');
}

function openAddFlavourModal() {
    // Pastikan judul default saat create
    const modalTitle = document.querySelector('#add-flavour-modal .modal-title');
    if (modalTitle && !document.getElementById('add-flavour-form').getAttribute('data-flavour-id')) {
        modalTitle.textContent = 'Create New Flavour';
    }
    document.getElementById('add-flavour-modal').classList.remove('hidden');
}

function closeAddFlavourModal() {
    document.getElementById('add-flavour-form').reset();
    document.getElementById('add-flavour-form').removeAttribute('data-flavour-id');
    document.getElementById('flavour-form-error').textContent = '';
    document.getElementById('flavour-form-error').style.color = '';
    // Reset radio ke default Available
    const availTrue = document.getElementById('is-flavour-avail-true');
    if (availTrue) availTrue.checked = true;
    document.getElementById('add-flavour-modal').classList.add('hidden');
}

// View modal functions
function closeViewMenuModal() {
    document.getElementById('view-menu-modal').classList.add('hidden');
    document.getElementById('view-menu-modal').removeAttribute('data-menu-id');
}

function closeViewFlavorModal() {
    document.getElementById('view-flavor-modal').classList.add('hidden');
    document.getElementById('view-flavor-modal').removeAttribute('data-flavor-id');
}

function editFromView() {
    const menuId = document.getElementById('view-menu-modal').getAttribute('data-menu-id');
    closeViewMenuModal();
    editMenu(menuId);
}

function editFlavorFromView() {
    const flavorId = document.getElementById('view-flavor-modal').getAttribute('data-flavor-id');
    closeViewFlavorModal();
    editFlavor(flavorId);
}

// Enhanced search functionality with real-time filtering
function setupSearch() {
    const menuSearch = document.getElementById('menu-search');
    const flavorSearch = document.getElementById('flavor-search');

    if (menuSearch) {
    menuSearch.addEventListener('input', function() {
        applyMenuFilter();
    });
    }

    if (flavorSearch) {
    flavorSearch.addEventListener('input', function() {
        applyFlavorFilter();
    });
    }
}

// Save or update flavour
async function saveFlavour() {
    const flavourId = document.getElementById('add-flavour-form').getAttribute('data-flavour-id') || null;
    const flavourName = document.getElementById('flavour-name').value;
    const additionalPrice = parseInt(document.getElementById('additional-price').value);
    const isAvail = document.querySelector('input[name="flavour-is-avail"]:checked').value === 'true';

    // Client-side validation for non-negative additional price
    if (isNaN(additionalPrice) || additionalPrice < 0) {
    	showErrorModal('Harga tambahan tidak boleh negatif.');
    	return;
    }

    const data = {
    flavor_name: flavourName,
    additional_price: additionalPrice,
    isAvail: isAvail
    };

    try {
    let response;
    if (flavourId) {
        response = await fetch(`${BASE_URL}/flavors/${flavourId}`, {
        method: "PUT",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
        });
    } else {
        response = await fetch(`${BASE_URL}/flavors`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
        });
    }

    if (!response.ok) {
        let errorMessage = 'Failed to save flavour';
        try {
        const errorData = await response.json();
        console.log('Flavour save error response:', errorData);
        // Backend returns error message in 'message' field, not 'detail'
        errorMessage = errorData.message || errorData.detail || errorData.error || errorMessage;
        } catch (parseError) {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
    }
    
    let result;
    try {
        result = await response.json();
        console.log('Flavour saved successfully:', result);
    } catch (parseError) {
        console.log('Flavour saved successfully (no JSON response)');
    }
    
    closeAddFlavourModal();
    loadFlavors();
    
    // Show success message
    showSuccessModal(result.message || 'Varian rasa berhasil disimpan');
    } catch (error) {
    console.error('Error saving flavour:', error);
    showErrorModal('Error saving flavour: ' + error.message);
    }
}

// Event listeners
document.getElementById('add-menu-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveMenu();
});

document.getElementById('add-flavour-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveFlavour();
});

// setupNavigation is provided globally by script.js; remove page-specific duplicate

// Flavor Selector Functions
function populateFlavorCheckboxes() {
    const flavorCheckboxes = document.getElementById('flavor-checkboxes');
    flavorCheckboxes.innerHTML = '';
    
    console.log('Populating flavor checkboxes with selectedFlavorIds:', selectedFlavorIds);
    
    // Filter out any selected flavor IDs that no longer exist in allFlavors
    selectedFlavorIds = selectedFlavorIds.filter(id => 
    allFlavors.some(flavor => flavor.id === id)
    );
    
    allFlavors.forEach(flavor => {
    const checkboxItem = document.createElement('div');
    checkboxItem.className = 'flavor-checkbox-item';
    const isChecked = selectedFlavorIds.includes(flavor.id);
    checkboxItem.innerHTML = `
        <input type="checkbox" id="flavor-${flavor.id}" value="${flavor.id}" 
                ${isChecked ? 'checked' : ''} 
                onchange="updateSelectedFlavors()">
        <label for="flavor-${flavor.id}">
        ${flavor.flavor_name}
        <span class="flavor-price">(+Rp ${flavor.additional_price.toLocaleString()})</span>
        </label>
    `;
    flavorCheckboxes.appendChild(checkboxItem);
    });
}

function updateSelectedFlavors() {
    selectedFlavorIds = [];
    const checkboxes = document.querySelectorAll('#flavor-checkboxes input[type="checkbox"]:checked');
    checkboxes.forEach(checkbox => {
    selectedFlavorIds.push(checkbox.value);
    });
}

function toggleAllFlavors() {
    const checkboxes = document.querySelectorAll('#flavor-checkboxes input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach(checkbox => {
    checkbox.checked = !allChecked;
    });
    
    updateSelectedFlavors();
}

function clearAllFlavors() {
    const checkboxes = document.querySelectorAll('#flavor-checkboxes input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
    checkbox.checked = false;
    });
    
    selectedFlavorIds = [];
}

// Modal Functions for Delete, Success, and Error
function showDeleteConfirmModal(message, onConfirm) {
    document.getElementById('delete-confirm-message').textContent = message;
    document.getElementById('delete-confirm-modal').classList.remove('hidden');
    
    // Set up confirm button action
    const confirmBtn = document.getElementById('delete-confirm-btn');
    confirmBtn.onclick = () => {
    closeDeleteConfirmModal();
    onConfirm();
    };
}

function closeDeleteConfirmModal() {
    document.getElementById('delete-confirm-modal').classList.add('hidden');
}

function showSuccessModal(message) {
    // Hide error modal if visible
    const err = document.getElementById('error-modal');
    if (err) err.classList.add('hidden');
    document.getElementById('success-message').textContent = message;
    document.getElementById('success-modal').classList.remove('hidden');
}

function closeSuccessModal() {
    document.getElementById('success-modal').classList.add('hidden');
}

function showErrorModal(message) {
    // Hide success modal if visible
    const suc = document.getElementById('success-modal');
    if (suc) suc.classList.add('hidden');
    document.getElementById('error-message').textContent = message;
    document.getElementById('error-modal').classList.remove('hidden');
}

function closeErrorModal() {
    document.getElementById('error-modal').classList.add('hidden');
}

// Initial load
window.addEventListener('load', async () => {
    try {
    // Load menus (flavors are included in menu data)
    await loadMenus();
    
    // Load flavors separately for flavor selector
    await loadFlavors();
    
    switchTab('menu'); // Set default tab
    setupNavigation(); // Setup navigation
    setupSearch(); // Setup search functionality
    
    // Ensure navigation is properly set up after DOM is fully loaded
    setTimeout(() => {
        setupNavigation();
    }, 100);
    } catch (error) {
    console.error('Error during initial load:', error);
    // Show error message to user
    const tbody = document.querySelector('#menu-table tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">Error loading data: ' + error.message + '</td></tr>';
    }
    }
});
