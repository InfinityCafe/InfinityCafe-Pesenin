const BASE_URL = "";

// Global variables for pagination and filtering
let allMenus = [];
let allFlavors = [];
let filteredMenus = [];
let filteredFlavors = [];
let selectedFlavorIds = [];
let allIngredients = [];
let recipeIngredients = [];

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
    const cb = Date.now();
    // Use /menu/all endpoint to get all menus (including unavailable ones) for admin view
    const response = await fetch(`${BASE_URL}/menu/all?cb=${cb}`, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    let menus;
    try {
        menus = await response.json();
    } catch (parseError) {
        throw new Error('Invalid JSON response from server');
    }
    
    // Normalize menu data to use base_name_en as primary display name
    allMenus = (menus || []).map(menu => ({
      id: menu.id,
      base_name_en: menu.base_name_en,
      base_name_id: menu.base_name_id,
      base_price: menu.base_price,
      isAvail: menu.isAvail,
      making_time_minutes: menu.making_time_minutes,
      flavors: menu.flavors || []
    }));
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
    const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">Error loading menus: ' + errorMessage + '</td></tr>';
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
            <td>${menu.base_name_en}</td>
            <td>Rp ${menu.base_price.toLocaleString()}</td>
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
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1rem">No menus found</td></tr>';
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
        const promises = [];
        if (!menusLoaded) promises.push(loadMenus());
        if (!flavorsLoaded) promises.push(loadFlavors());
        if (allIngredients.length === 0) promises.push(loadAllIngredients());
        await Promise.all(promises);
    } catch (error) {
        console.error('Error ensuring data is loaded:', error);
        // menusLoaded = false;
        // flavorsLoaded = false;
        throw error;
    }
}

// Load flavors with pagination
async function loadFlavors() {
    try {
        const cb = Date.now();
        const response = await fetch(`${BASE_URL}/flavors/all?cb=${cb}`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        let flavors;
        try {
            flavors = await response.json();
        } catch (parseError) {
            throw new Error('Invalid JSON response from server');
        }
        
        // Normalize flavor data to use flavor_name_en as primary display name
        allFlavors = (flavors || []).map(flavor => ({
            id: flavor.id,
            flavor_name_en: flavor.flavor_name_en,
            flavor_name_id: flavor.flavor_name_id,
            additional_price: flavor.additional_price,
            isAvail: flavor.isAvail
        }));
        filteredFlavors = [...allFlavors];
        flavorsLoaded = true;
        
        flavorCurrentPage = 1;
        renderFlavorTable();
        updateFlavorPagination();
        
        if (document.getElementById('add-menu-modal').classList.contains('hidden') === false) {
            populateFlavorCheckboxes();
        }
        
        return allFlavors;
    } catch (error) {
        console.error('Error loading flavors:', error);
        const tbody = document.querySelector('#flavors-table tbody');
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Error loading flavors: ' + errorMessage + '</td></tr>';
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
                <td>${flavor.flavor_name_en}</td>
                <td>Rp ${flavor.additional_price.toLocaleString()}</td>
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
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1rem;">No flavors found</td></tr>';
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
        const matchesSearch = menu.base_name_en.toLowerCase().includes(searchTerm) ||
                             menu.base_name_id.toLowerCase().includes(searchTerm) ||
                             menu.base_price.toString().includes(searchTerm);
        
        const matchesStatus = !statusFilter || 
                             (statusFilter === 'Yes' && menu.isAvail) ||
                             (statusFilter === 'No' && !menu.isAvail);
        
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
        const matchesSearch = flavor.flavor_name_en.toLowerCase().includes(searchTerm) ||
                             flavor.flavor_name_id.toLowerCase().includes(searchTerm) ||
                             flavor.additional_price.toString().includes(searchTerm);
        
        const matchesStatus = !statusFilter || 
                             (statusFilter === 'Yes' && flavor.isAvail) ||
                             (statusFilter === 'No' && !flavor.isAvail);
        
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

document.addEventListener('click', function(event) {
    const menuFilterDropdown = document.getElementById('menu-filter-dropdown');
    const flavorFilterDropdown = document.getElementById('flavor-filter-dropdown');
    
    if (!event.target.closest('.filter-container')) {
        menuFilterDropdown.classList.remove('show');
        flavorFilterDropdown.classList.remove('show');
    }
});

async function loadAllIngredients() {
    if (allIngredients.length > 0) return;
    try {
        const response = await fetch(`${BASE_URL}/inventory/list?show_unavailable=true`); 
        if (!response.ok) throw new Error('Failed to fetch ingredients');
        const data = await response.json();
        allIngredients = data.data || [];
        console.log("Successfully loaded ingredients:", allIngredients);
    } catch (error) {
        console.error("Error loading ingredients:", error);
        showErrorModal("Could not load ingredients. Please try again.");
    }
}

function renderRecipeIngredients() {
    const container = document.getElementById('recipe-ingredients-list');
    container.innerHTML = '';

    recipeIngredients.forEach((recipeItem, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'recipe-item';

        const ingredientOptions = allIngredients.map(ing => 
            `<option value="${ing.id}" data-unit="${ing.unit}" ${ing.id == recipeItem.ingredient_id ? 'selected' : ''}>${ing.name}</option>`
        ).join('');

        itemDiv.innerHTML = `
            <select class="recipe-ingredient-select" data-index="${index}">
                <option value="">Select Ingredient</option>
                ${ingredientOptions}
            </select>
            <input type="number" class="recipe-quantity-input" placeholder="Qty" value="${recipeItem.quantity || ''}" data-index="${index}" min="0" step="0.01">
            <div class="recipe-unit-display">${recipeItem.unit || 'Unit'}</div>
            <button class="remove-ingredient-btn" data-index="${index}">&times;</button>
        `;
        container.appendChild(itemDiv);
    });

    document.querySelectorAll('#recipe-ingredients-list .recipe-ingredient-select').forEach(select => {
        select.onchange = function() {
            const index = parseInt(this.dataset.index);
            const selectedOption = this.options[this.selectedIndex];
            recipeIngredients[index].ingredient_id = this.value ? parseInt(this.value) : '';
            recipeIngredients[index].unit = selectedOption.dataset.unit || '';
            renderRecipeIngredients();
        };
    });
    document.querySelectorAll('#recipe-ingredients-list .recipe-quantity-input').forEach(input => {
        input.oninput = function() {
            const index = parseInt(this.dataset.index);
            recipeIngredients[index].quantity = this.value ? parseFloat(this.value) : '';
        };
    });
    document.querySelectorAll('#recipe-ingredients-list .remove-ingredient-btn').forEach(btn => {
        btn.onclick = function() {
            const index = parseInt(this.dataset.index);
            recipeIngredients.splice(index, 1);
            if (recipeIngredients.length === 0) {
                recipeIngredients.push({ ingredient_id: '', quantity: '', unit: '' });
            }
            renderRecipeIngredients();
        };
    });
}

function renderEditRecipeIngredients() {
    const container = document.getElementById('edit-recipe-ingredients-list');
    container.innerHTML = '';

    console.log('Rendering edit recipe ingredients:', {
        recipeIngredients: recipeIngredients,
        allIngredients: allIngredients,
        allIngredientsLength: allIngredients.length
    });

    recipeIngredients.forEach((recipeItem, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'recipe-item';

        const ingredientOptions = allIngredients.map(ing => 
            `<option value="${ing.id}" data-unit="${ing.unit}" ${ing.id == recipeItem.ingredient_id ? 'selected' : ''}>${ing.name}</option>`
        ).join('');

        itemDiv.innerHTML = `
            <select class="recipe-ingredient-select" data-index="${index}">
                <option value="">Select Ingredient</option>
                ${ingredientOptions}
            </select>
            <input type="number" class="recipe-quantity-input" placeholder="Qty" value="${recipeItem.quantity || ''}" data-index="${index}" min="0" step="0.01">
            <div class="recipe-unit-display">${recipeItem.unit || 'Unit'}</div>
            <button class="remove-ingredient-btn" data-index="${index}">&times;</button>
        `;
        container.appendChild(itemDiv);
    });

    document.querySelectorAll('#edit-recipe-ingredients-list .recipe-ingredient-select').forEach(select => {
        select.onchange = function() {
            const index = parseInt(this.dataset.index);
            const selectedOption = this.options[this.selectedIndex];
            console.log('Ingredient changed:', { index, value: this.value, selectedOption });
            
            recipeIngredients[index].ingredient_id = this.value ? parseInt(this.value) : '';
            recipeIngredients[index].unit = selectedOption.dataset.unit || '';
            
            console.log('Updated recipeIngredients:', recipeIngredients);
            renderEditRecipeIngredients();
        };
    });
    
    document.querySelectorAll('#edit-recipe-ingredients-list .recipe-quantity-input').forEach(input => {
        input.oninput = function() {
            const index = parseInt(this.dataset.index);
            const value = this.value;
            console.log('Quantity changed:', { index, value });
            
            recipeIngredients[index].quantity = value ? parseFloat(value) : '';
            console.log('Updated recipeIngredients:', recipeIngredients);
        };
    });
    
    document.querySelectorAll('#edit-recipe-ingredients-list .remove-ingredient-btn').forEach(btn => {
        btn.onclick = function() {
            const index = parseInt(this.dataset.index);
            console.log('Removing ingredient at index:', index);
            
            recipeIngredients.splice(index, 1);
            if (recipeIngredients.length === 0) {
                recipeIngredients.push({ ingredient_id: '', quantity: '', unit: '' });
            }
            
            console.log('Updated recipeIngredients after removal:', recipeIngredients);
            renderEditRecipeIngredients();
        };
    });
}

// Save or update menu
async function saveMenu() {
    const menuId = document.getElementById('add-menu-form').getAttribute('data-menu-id') || null;
    const baseNameEn = document.getElementById('base-name-en').value.trim();
    const baseNameId = document.getElementById('base-name-id').value.trim();
    const basePrice = parseInt(document.getElementById('base-price').value);
    const isAvail = document.querySelector('input[name="is-avail"]:checked').value === 'true';
    const makingTimeMinutes = parseFloat(document.getElementById('making-time-minutes').value) || 0;
    
    const validRecipeIngredients = recipeIngredients
        .filter(item => item.ingredient_id && item.quantity > 0)
        .map(item => ({
            ingredient_id: parseInt(item.ingredient_id),
            quantity: parseFloat(item.quantity),
            unit: item.unit
        }));
    
    if (!baseNameEn || !baseNameId) {
        showErrorModal('Nama menu (EN dan ID) tidak boleh kosong.');
        return;
    }

    if (isNaN(basePrice) || basePrice <= 0) {
        showErrorModal('Harga menu harus lebih dari 0.');
        return;
    }

    if (!recipeIngredients || recipeIngredients.length === 0) {
        showErrorModal('Recipe ingredients tidak boleh kosong.');
        return;
    }
    if (validRecipeIngredients.length === 0) {
        showErrorModal('Menu must have at least one valid ingredient in its recipe.');
        return;
    }

    const data = {
        base_name_en: baseNameEn,
        base_name_id: baseNameId,
        base_price: basePrice,
        isAvail: isAvail,
        making_time_minutes: makingTimeMinutes,
        flavor_ids: selectedFlavorIds,
        recipe_ingredients: validRecipeIngredients
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
                errorMessage = errorData.message || errorData.detail || errorData.error || errorMessage;
            } catch (parseError) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        console.log('Menu saved successfully:', result);

        if (result.status === 'error') {
            throw new Error(result.message || 'Terjadi kesalahan dari server.');
        }

        // Save recipe ingredients via dedicated endpoint
        try {
            const createdMenuId = (result && result.id) ? result.id : (menuId || (result.data && result.data.id));
            if (createdMenuId && validRecipeIngredients && validRecipeIngredients.length > 0) {
                const recipeRes = await fetch(`${BASE_URL}/menu/${createdMenuId}/recipe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(validRecipeIngredients)
                });
                if (!recipeRes.ok) {
                    let errMsg = 'Failed to save recipe';
                    try { const ed = await recipeRes.json(); errMsg = ed.message || ed.detail || errMsg; } catch (_) {}
                    throw new Error(errMsg);
                }
                const recipeResult = await recipeRes.json();
                console.log('Recipe saved successfully:', recipeResult);
            }
        } catch (recipeError) {
            console.error('Error saving recipe after menu save:', recipeError);
            const em = recipeError && recipeError.message ? recipeError.message : 'Unknown error occurred';
            showErrorModal('Menu saved but recipe update failed: ' + em);
        }
        
        selectedFlavorIds = [];
        closeAddMenuModal();
        await loadMenus();
        
        showSuccessModal(result.message || 'Menu berhasil disimpan');
    } catch (error) {
        console.error('Error saving menu:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error saving menu: ' + errorMessage);
    }
}

// Save edited menu
async function saveEditMenu() {
    const menuId = document.getElementById('edit-menu-form').getAttribute('data-menu-id') || null;
    console.log('Edit form menu ID:', menuId); // Debug log
    
    const baseNameEn = document.getElementById('edit-base-name-en').value.trim();
    const baseNameId = document.getElementById('edit-base-name-id').value.trim();
    const basePrice = parseInt(document.getElementById('edit-base-price').value);
    const isAvail = document.querySelector('input[name="edit-is-avail"]:checked').value === 'true';
    const makingTimeMinutes = parseFloat(document.getElementById('edit-making-time-minutes').value) || 0;
    
    console.log('Recipe ingredients before validation:', recipeIngredients);
    
    const validRecipeIngredients = recipeIngredients
        .filter(item => item.ingredient_id && item.quantity > 0)
        .map(item => ({
            ingredient_id: parseInt(item.ingredient_id),
            quantity: parseFloat(item.quantity),
            unit: item.unit
        }));
    
    console.log('Valid recipe ingredients after validation:', validRecipeIngredients);
    
    if (!baseNameEn || !baseNameId) {
        showErrorModal('Nama menu (EN dan ID) tidak boleh kosong.');
        return;
    }

    if (isNaN(basePrice) || basePrice <= 0) {
        showErrorModal('Harga menu harus lebih dari 0.');
        return;
    }

    if (!recipeIngredients || recipeIngredients.length === 0) {
        showErrorModal('Recipe ingredients tidak boleh kosong.');
        return;
    }
    if (validRecipeIngredients.length === 0) {
        showErrorModal('Menu must have at least one valid ingredient in its recipe.');
        return;
    }

    if (!menuId) {
        showErrorModal('Menu ID tidak ditemukan untuk update.');
        return;
    }

    const data = {
        base_name_en: baseNameEn,
        base_name_id: baseNameId,
        base_price: basePrice,
        isAvail: isAvail,
        making_time_minutes: makingTimeMinutes,
        flavor_ids: selectedFlavorIds,
        recipe_ingredients: validRecipeIngredients
    };
    
    console.log('=== SAVE EDIT MENU DEBUG ===');
    console.log('Data being sent to API:', data);
    console.log('Recipe ingredients in data:', data.recipe_ingredients);
    console.log('Original recipeIngredients array:', recipeIngredients);
    console.log('Valid recipe ingredients:', validRecipeIngredients);
    console.log('============================');

    try {
        const response = await fetch(`${BASE_URL}/menu/${menuId}`, {
            method: "PUT",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            let errorMessage = 'Failed to update menu';
            try {
                const errorData = await response.json();
                console.log('Menu update error response:', errorData);
                errorMessage = errorData.message || errorData.detail || errorData.error || errorMessage;
            } catch (parseError) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        console.log('Menu updated successfully:', result);

        // Update recipe ingredients via dedicated endpoint
        try {
            const currentMenuId = menuId || (result && result.id) || (result.data && result.data.id);
            if (currentMenuId && validRecipeIngredients && validRecipeIngredients.length > 0) {
                const recipeRes = await fetch(`${BASE_URL}/menu/${currentMenuId}/recipe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(validRecipeIngredients)
                });
                if (!recipeRes.ok) {
                    let errMsg = 'Failed to update recipe';
                    try { const ed = await recipeRes.json(); errMsg = ed.message || ed.detail || errMsg; } catch (_) {}
                    throw new Error(errMsg);
                }
                const recipeResult = await recipeRes.json();
                console.log('Recipe updated successfully:', recipeResult);
            }
        } catch (recipeError) {
            console.error('Error updating recipe after menu update:', recipeError);
            const em = recipeError && recipeError.message ? recipeError.message : 'Unknown error occurred';
            showErrorModal('Menu updated but recipe update failed: ' + em);
        }

        selectedFlavorIds = [];
        closeEditMenuModal();
        await loadMenus();
        
        showSuccessModal(result.message || 'Menu berhasil diupdate');
    } catch (error) {
        console.error('Error updating menu:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error updating menu: ' + errorMessage);
    }
}

// Edit menu
async function editMenu(menuId) {
    try {
        // Ensure ingredients are loaded first
        await loadAllIngredients();
        
        const [menuRes, recipeRes] = await Promise.all([
            fetch(`${BASE_URL}/menu/${menuId}`),
            fetch(`${BASE_URL}/menu/${menuId}/recipe`)
        ]);

        if (!menuRes.ok) throw new Error(`Failed to fetch menu details: HTTP ${menuRes.status}`);
        if (!recipeRes.ok) throw new Error(`Failed to fetch recipe details: HTTP ${recipeRes.status}`);

        const menu = await menuRes.json() || {};
        const recipeData = await recipeRes.json() || { data: { recipe_ingredients: [] } };

        console.log('Menu data:', menu);
        console.log('Recipe data:', recipeData);

        // Validasi data menu
        if (!menu.base_name_en || !menu.base_name_id) {
            throw new Error('Menu data is missing or incomplete');
        }

        // Populate edit form fields
        document.getElementById('edit-base-name-en').value = menu.base_name_en || '';
        document.getElementById('edit-base-name-id').value = menu.base_name_id || '';
        document.getElementById('edit-base-price').value = menu.base_price || '';
        document.getElementById('edit-making-time-minutes').value = menu.making_time_minutes || '';
        document.getElementById(menu.isAvail ? 'edit-is-avail-true' : 'edit-is-avail-false').checked = true;

        // Set selected flavors for edit form
        selectedFlavorIds = menu.flavors ? menu.flavors.map(f => f.id) : [];
        
        // Set recipe ingredients for edit form
        recipeIngredients = recipeData.data && recipeData.data.recipe_ingredients 
            ? recipeData.data.recipe_ingredients.map(ing => ({
                  ingredient_id: ing.ingredient_id,
                  quantity: ing.quantity,
                  unit: ing.unit
              }))
            : [{ ingredient_id: '', quantity: '', unit: '' }];

        console.log('=== EDIT MENU DEBUG ===');
        console.log('Recipe data from API:', recipeData);
        console.log('Initialized recipeIngredients:', recipeIngredients);
        console.log('========================');

        // Set menu ID for edit form
        document.getElementById('edit-menu-form').setAttribute('data-menu-id', menuId);
        console.log('Set edit form menu ID to:', menuId); // Debug log
        
        // Open edit modal instead of add modal
        openEditMenuModal();
    } catch (error) {
        console.error('Error loading menu for edit:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error loading menu for edit: ' + errorMessage);
    }
}

// Delete menu
async function deleteMenu(menuId) {
    // Get menu name for confirmation message
    const menu = allMenus.find(m => m.id === menuId);
    const menuName = menu ? `${menu.base_name_en} / ${menu.base_name_id}` : 'this menu';
    
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
                    const errorMessage = errorData.message || errorData.detail || 'Gagal menghapus menu';
                    showErrorModal(errorMessage);
                    return;
                }
                
                const result = await response.json();
                await loadMenus();
                
                showSuccessModal(result.message || 'Menu berhasil dihapus');
            } catch (error) {
                console.error('Error deleting menu:', error);
                const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
                showErrorModal('Error deleting menu: ' + errorMessage);
            }
        }
    );
}

// View menu
async function viewMenu(menuId) {
    try {
        // Ensure ingredients are loaded first
        await loadAllIngredients();
        
        const cacheBust = `cb=${Date.now()}`;
        const [menuResponse, recipeResponse] = await Promise.all([
            fetch(`${BASE_URL}/menu/${menuId}?${cacheBust}`, { cache: 'no-store' }),
            fetch(`${BASE_URL}/menu/${menuId}/recipe?${cacheBust}`, { cache: 'no-store' })
        ]);

        if (!menuResponse.ok) {
            throw new Error(`Failed to fetch menu details: HTTP ${menuResponse.status}`);
        }
        if (!recipeResponse.ok) {
            throw new Error(`Failed to fetch recipe details: HTTP ${recipeResponse.status}`);
        }

        const menu = await menuResponse.json() || {};
        const recipeData = await recipeResponse.json() || { data: { recipe_ingredients: [] } };

        if (!menu.base_name_en || !menu.base_name_id) {
            throw new Error('Menu data is missing or incomplete');
        }

        document.getElementById('view-menu-name').textContent = `${menu.base_name_en || 'Unknown'} / ${menu.base_name_id || 'Unknown'}`;
        document.getElementById('view-menu-price').textContent = `Rp ${(menu.base_price || 0).toLocaleString()}`;
        document.getElementById('view-menu-available').innerHTML =
            `<span class="status-badge ${menu.isAvail ? 'status-available' : 'status-unavailable'}">
                ${menu.isAvail ? 'Available' : 'Unavailable'}
            </span>`;
        
        let flavorsText = 'None';
        if (menu.flavors && menu.flavors.length > 0) {
            const flavorItems = menu.flavors.map(flavor => 
                `<div class="flavor-item">${flavor.flavor_name_en || 'Unknown' }<span class="flavor-price">(+Rp ${flavor.additional_price.toLocaleString()})</span></div>`
            );
            flavorsText = flavorItems.join('');
        }
        document.getElementById('view-menu-flavors').innerHTML = flavorsText;

        let recipeText = 'None';
        if (recipeData.data && recipeData.data.recipe_ingredients && recipeData.data.recipe_ingredients.length > 0) {
            const recipeItems = recipeData.data.recipe_ingredients.map(ingredient => {
                const fromInventory = allIngredients.find(ing => ing.id === ingredient.ingredient_id)?.name;
                const ingredientName = ingredient.ingredient_name || fromInventory || 'Unknown';
                return `<div class="recipe-item">${ingredientName}: ${ingredient.quantity || 0} ${ingredient.unit || ''}</div>`;
            });
            recipeText = recipeItems.join('');
        }
        document.getElementById('view-menu-recipe').innerHTML = recipeText;

        document.getElementById('view-menu-modal').setAttribute('data-menu-id', menuId);
        document.getElementById('view-menu-modal').classList.remove('hidden');
    } catch (error) {
        console.error('Error viewing menu:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error loading menu details: ' + errorMessage);
    }
}

// View flavor
async function viewFlavor(flavorId) {
    try {
        const response = await fetch(`${BASE_URL}/flavors/${flavorId}`);
        if (!response.ok) throw new Error('Failed to fetch flavor details');
        
        const flavor = await response.json();
        
        document.getElementById('view-flavor-name').textContent = `${flavor.flavor_name_en} / ${flavor.flavor_name_id}`;
        document.getElementById('view-flavor-price').textContent = `Rp ${flavor.additional_price.toLocaleString()}`;
        document.getElementById('view-flavor-available').innerHTML =
            `<span class="status-badge ${flavor.isAvail ? 'status-available' : 'status-unavailable'}">
                ${flavor.isAvail ? 'Available' : 'Unavailable'}
            </span>`;
        
        document.getElementById('view-flavor-modal').setAttribute('data-flavor-id', flavorId);
        
        document.getElementById('view-flavor-modal').classList.remove('hidden');
    } catch (error) {
        console.error('Error viewing flavor:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error loading flavor details: ' + errorMessage);
    }
}

// Edit flavor
async function editFlavor(flavorId) {
    try {
        const response = await fetch(`${BASE_URL}/flavors/${flavorId}`);
        if (!response.ok) throw new Error('Failed to fetch flavor details');
        
        const flavor = await response.json();
        
        document.getElementById('flavour-name-en').value = flavor.flavor_name_en;
        document.getElementById('flavour-name-id').value = flavor.flavor_name_id;
        document.getElementById('additional-price').value = flavor.additional_price;
        
        if (flavor.isAvail) {
            document.getElementById('is-flavour-avail-true').checked = true;
        } else {
            document.getElementById('is-flavour-avail-false').checked = true;
        }
        
        const modalTitle = document.querySelector('#add-flavour-modal .modal-title');
        if (modalTitle) modalTitle.textContent = 'Edit Flavour';
        document.getElementById('add-flavour-form').setAttribute('data-flavour-id', flavorId);
        openAddFlavourModal();
    } catch (error) {
        console.error('Error loading flavor for edit:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error loading flavor for edit: ' + errorMessage);
    }
}

// Delete flavor
async function deleteFlavor(flavorId) {
    // Get flavor name for confirmation message
    const flavor = allFlavors.find(f => f.id === flavorId);
    if (!flavor) {
        showErrorModal(`Varian rasa dengan ID ${flavorId} tidak ditemukan.`);
        return;
    }
    const flavorName = `${flavor.flavor_name_en} / ${flavor.flavor_name_id}`;

    // Pre-check usage: prevent deletion if still used by any menu for better UX
    const menusUsingFlavor = (allMenus || []).filter(m => Array.isArray(m.flavors) && m.flavors.some(f => f.id === flavorId));
    if (menusUsingFlavor.length > 0) {
        const usedBy = menusUsingFlavor.map(m => `${m.base_name_en} / ${m.base_name_id}`).join(', ');
        showErrorModal(`Varian rasa tidak dapat dihapus karena masih digunakan oleh menu: ${usedBy}`);
        return;
    }
    
    showDeleteConfirmModal(
        `Apakah Anda yakin ingin menghapus varian rasa "${flavorName}"?`,
        async () => {
            const confirmBtn = document.getElementById('delete-confirm-btn');
            const originalText = confirmBtn ? confirmBtn.textContent : '';
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Deleting...';
            }
            try {
                const response = await fetch(`${BASE_URL}/flavors/${flavorId}`, {
                    method: "DELETE"
                });
                
                if (!response.ok) {
                    let errorMessage = 'Gagal menghapus varian rasa';
                    try {
                    const errorData = await response.json();
                        errorMessage = errorData?.message || errorData?.detail || `HTTP ${response.status}: ${response.statusText}`;
                    } catch (_) {
                        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                    }
                    showErrorModal(errorMessage);
                    return;
                }
                
                let result;
                try { result = await response.json(); } catch (_) { result = null; }

                // Update UI lists - optimistic update
                allFlavors = allFlavors.filter(f => f.id !== flavorId);
                filteredFlavors = filteredFlavors.filter(f => f.id !== flavorId);
                renderFlavorTable();

                // Also refresh from server to be safe
                await loadFlavors();
                await loadMenus();
                
                const successMsg = (result && (result.message || (result.data && result.data.message))) || 'Varian rasa berhasil dihapus';
                showSuccessModal(successMsg);
            } catch (error) {
                let errorMessage = 'Unknown error occurred';
                if (error && typeof error === 'object' && error.message) errorMessage = error.message;
                else if (typeof error === 'string') errorMessage = error;
                showErrorModal('Error deleting flavor: ' + errorMessage);
            } finally {
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = originalText;
                }
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

async function openAddMenuModal() {
    document.getElementById('add-menu-form').reset();
    document.getElementById('add-menu-form').removeAttribute('data-menu-id');
    document.querySelector('#add-menu-modal .modal-title').textContent = 'Add New Menu';
    
    recipeIngredients = [{ ingredient_id: '', quantity: '', unit: '' }];
    selectedFlavorIds = [];
    
    await ensureDataLoaded();
    
    populateFlavorCheckboxes();
    renderRecipeIngredients();
    
    document.getElementById('add-menu-modal').classList.remove('hidden');
}

function closeAddMenuModal() {
    document.getElementById('add-menu-form').reset();
    document.getElementById('add-menu-form').removeAttribute('data-menu-id');
    document.getElementById('form-error').textContent = '';
    document.getElementById('form-error').style.color = '';
    document.getElementById('is-avail-true').checked = true;
    // Reset flavor selection (only if not already reset)
    selectedFlavorIds = [];
    populateFlavorCheckboxes();
    // Reset modal title
    const modalTitle = document.querySelector('#add-menu-modal .modal-title');
    modalTitle.textContent = 'Add New Menu';
    document.getElementById('add-menu-modal').classList.add('hidden');
}

async function openEditMenuModal() {
    document.querySelector('#edit-menu-modal .modal-title').textContent = 'Edit Menu';
    
    await ensureDataLoaded();
    
    populateEditFlavorCheckboxes();
    renderEditRecipeIngredients();
    
    document.getElementById('edit-menu-modal').classList.remove('hidden');
}

function closeEditMenuModal() {
    document.getElementById('edit-menu-form').reset();
    document.getElementById('edit-menu-form').removeAttribute('data-menu-id');
    document.getElementById('edit-form-error').textContent = '';
    document.getElementById('edit-form-error').style.color = '';
    document.getElementById('edit-is-avail-true').checked = true;
    // Reset flavor selection
    selectedFlavorIds = [];
    populateEditFlavorCheckboxes();
    // Reset modal title
    const modalTitle = document.querySelector('#edit-menu-modal .modal-title');
    modalTitle.textContent = 'Edit Menu';
    document.getElementById('edit-menu-modal').classList.add('hidden');
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
    const flavourNameEn = document.getElementById('flavour-name-en').value.trim();
    const flavourNameId = document.getElementById('flavour-name-id').value.trim();
    const additionalPrice = parseInt(document.getElementById('additional-price').value);
    const isAvail = document.querySelector('input[name="flavour-is-avail"]:checked').value === 'true';

    if (isNaN(additionalPrice) || additionalPrice < 0) {
        showErrorModal('Harga tambahan tidak boleh negatif.');
        return;
    }

    if (!flavourNameEn || !flavourNameId) {
        showErrorModal('Nama rasa (EN dan ID) tidak boleh kosong.');
        return;
    }

    const data = {
        flavor_name_en: flavourNameEn,
        flavor_name_id: flavourNameId,
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
                errorMessage = errorData.message || errorData.detail || errorData.error || errorMessage;
            } catch (parseError) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }
        
        const result = await response.json();
        console.log('Flavour saved successfully:', result);
        
        closeAddFlavourModal();
        await loadFlavors();
        
        showSuccessModal(result.message || 'Varian rasa berhasil disimpan');
    } catch (error) {
        console.error('Error saving flavour:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error saving flavour: ' + errorMessage);
    }
}

// Event listeners
document.getElementById('add-menu-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveMenu();
});

document.getElementById('edit-menu-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveEditMenu();
});

document.getElementById('add-flavour-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveFlavour();
});

function populateFlavorCheckboxes() {
    const flavorCheckboxes = document.getElementById('flavor-checkboxes');
    flavorCheckboxes.innerHTML = '';
    
    console.log('Populating flavor checkboxes with selectedFlavorIds:', selectedFlavorIds);
    
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
                ${flavor.flavor_name_en} / ${flavor.flavor_name_id}
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

function populateEditFlavorCheckboxes() {
    const flavorCheckboxes = document.getElementById('edit-flavor-checkboxes');
    flavorCheckboxes.innerHTML = '';
    
    console.log('Populating edit flavor checkboxes with selectedFlavorIds:', selectedFlavorIds);
    
    selectedFlavorIds = selectedFlavorIds.filter(id => 
        allFlavors.some(flavor => flavor.id === id)
    );
    
    allFlavors.forEach(flavor => {
        const checkboxItem = document.createElement('div');
        checkboxItem.className = 'flavor-checkbox-item';
        const isChecked = selectedFlavorIds.includes(flavor.id);
        checkboxItem.innerHTML = `
            <input type="checkbox" id="edit-flavor-${flavor.id}" value="${flavor.id}" 
                   ${isChecked ? 'checked' : ''} 
                   onchange="updateSelectedEditFlavors()">
            <label for="edit-flavor-${flavor.id}">
                ${flavor.flavor_name_en} / ${flavor.flavor_name_id}
                <span class="flavor-price">(+Rp ${flavor.additional_price.toLocaleString()})</span>
            </label>
        `;
        flavorCheckboxes.appendChild(checkboxItem);
    });
}

function updateSelectedEditFlavors() {
    selectedFlavorIds = [];
    const checkboxes = document.querySelectorAll('#edit-flavor-checkboxes input[type="checkbox"]:checked');
    checkboxes.forEach(checkbox => {
    selectedFlavorIds.push(checkbox.value);
    });
}

function toggleAllEditFlavors() {
    const checkboxes = document.querySelectorAll('#edit-flavor-checkboxes input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach(checkbox => {
    checkbox.checked = !allChecked;
    });
    
    updateSelectedEditFlavors();
}

function clearAllEditFlavors() {
    const checkboxes = document.querySelectorAll('#edit-flavor-checkboxes input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
    checkbox.checked = false;
    });
    
    selectedFlavorIds = [];
}

// Modal Functions for Delete, Success, and Error


// Initial load
window.addEventListener('load', async () => {
    try {
    // Load menus (flavors are included in menu data)
    await loadMenus();
    await loadFlavors();
    // setupNavigation();
    setupSearch();
    // setTimeout(() => {
    //     setupNavigation();
    // }, 100);
    } catch (error) {
    console.error('Error during initial load:', error);
    // Show error message to user
    const tbody = document.querySelector('#menu-table tbody');
    if (tbody) {
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">Error loading data: ' + errorMessage + '</td></tr>';
    }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const addIngredientBtn = document.getElementById('add-ingredient-btn');
    if (addIngredientBtn) {
        addIngredientBtn.onclick = () => {
            recipeIngredients.push({ ingredient_id: '', quantity: '', unit: '' });
            renderRecipeIngredients();
        };
    }
    const editAddIngredientBtn = document.getElementById('edit-add-ingredient-btn');
    if (editAddIngredientBtn) {
        editAddIngredientBtn.onclick = () => {
            recipeIngredients.push({ ingredient_id: '', quantity: '', unit: '' });
            renderEditRecipeIngredients();
        };
    }
    setupSearch();
    setupNavigation();
});

// Navigation function for menu suggestion
function navigateToMenuSuggestion() {
    const token = localStorage.getItem('access_token');
    if (token) {
        // Create a temporary token for this session
        const tempToken = btoa(token).substring(0, 20) + Date.now();
        sessionStorage.setItem('temp_token', token);
        sessionStorage.setItem('temp_token_id', tempToken);
        
        // Navigate with temporary token that will be immediately removed
        window.location.href = `/menu-suggestion?temp=${tempToken}`;
    } else {
        window.location.href = '/login';
    }
}