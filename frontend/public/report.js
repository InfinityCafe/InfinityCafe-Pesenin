// Login guard
if (!localStorage.getItem('access_token')) {
  window.location.href = '/login';
}

// Fungsi logout
function logout() {
  localStorage.removeItem('access_token');
  window.location.href = '/login';
}

// Tambahkan tombol logout ke header setelah DOM siap
window.addEventListener('DOMContentLoaded', function () {
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
});

let barChart, pieChart, ingredientChart;
let currentReportData = null;
let currentPage = 1;
let itemsPerPage = 10;
let filteredData = [];
let baseData = [];
let isRefreshing = false;
let autoRefreshEnabled = false;

// Kitchen Report Variables
let kitchenData = [];
let ingredientData = {};
let menuRecipes = {};
let menuConsumption = {}; // { menuName: { ingredientId: { totalQuantity, unit } } }
let menuOrderCount = {};   // { menuName: totalQuantityOrdered }
let menuFlavorUsage = {};  // { menuName: { flavorNameLower: totalQty } }
let variantConsumption = {}; // { key: { menuName, flavorName, orderQty, ingredients: { ingId: { totalQuantity, unit } } } }
let menuValidFlavors = {}; // { menuName: Set(lowercase flavor names) }
let kitchenOrdersCache = [];
let globalFlavorMap = {};
let ingredientMenuFlavorGroups = {}; // global store for menu+flavor groups per date

// ========== MODAL FUNCTIONS ==========
function closePieModal() {
    document.getElementById("pie-modal").classList.add("hidden");
}

function closeIngredientModal() {
    document.getElementById("ingredient-modal").classList.add("hidden");
}

function openSuggestionModal() {
    document.getElementById("suggestion-modal").classList.remove("hidden");
}

function closeSuggestionModal() {
    document.getElementById("suggestion-modal").classList.add("hidden");
    document.getElementById("suggestion-menu-name").value = "";
    document.getElementById("suggestion-customer-name").value = "";
}

async function submitSuggestion() {
    const menuName = document.getElementById("suggestion-menu-name").value.trim();
    const customerName = document.getElementById("suggestion-customer-name").value.trim();
    
    if (!menuName) {
        alert("Nama menu harus diisi!");
        return;
    }

    try {
        const response = await fetch('/menu_suggestion', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                menu_name: menuName,
                customer_name: customerName || null
            })
        });

        if (response.ok) {
            alert("✅ Usulan menu berhasil dikirim!");
            closeSuggestionModal();
            // Refresh suggested menu list if report is loaded
            if (currentReportData) {
                await fetchSuggestedMenu();
            }
        } else {
            const error = await response.json();
            alert(`❌ Gagal mengirim usulan: ${error.detail || 'Unknown error'}`);
        }
    } catch (err) {
        console.error("Error submitting suggestion:", err);
        alert("❌ Gagal mengirim usulan. Periksa koneksi.");
    }
}

// ========== LOADING FUNCTIONS ==========
function showLoading() {
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

// ========== KITCHEN REPORT FUNCTIONS ==========
function showKitchenReport() {
    document.getElementById('kitchen-report-section').classList.remove('hidden');
    document.getElementById('summary').classList.add('hidden');
    document.getElementById('insight-box').classList.add('hidden');
    document.querySelector('.table-container').classList.add('hidden');
    document.querySelectorAll('.dashboard-layout').forEach(el => el.classList.add('hidden'));
    
    // Load kitchen data
    loadKitchenData();
    loadIngredientAnalysis();
}

function hideKitchenReport() {
    document.getElementById('kitchen-report-section').classList.add('hidden');
    document.getElementById('summary').classList.remove('hidden');
    document.getElementById('insight-box').classList.remove('hidden');
    document.querySelector('.table-container').classList.remove('hidden');
    document.querySelectorAll('.dashboard-layout').forEach(el => el.classList.remove('hidden'));
}

// ========== INGREDIENT ANALYSIS FUNCTIONS ==========
function showIngredientAnalysis() {
    document.getElementById('ingredient-analysis-section').classList.remove('hidden');
    document.getElementById('summary').classList.add('hidden');
    document.getElementById('insight-box').classList.add('hidden');
    document.querySelector('.table-container').classList.add('hidden');
    document.querySelectorAll('.dashboard-layout').forEach(el => el.classList.add('hidden'));
    document.getElementById('kitchen-report-section').classList.add('hidden');
    
    // Set default dates
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
    
    document.getElementById('ingredient-start-date').value = lastMonth.toISOString().split('T')[0];
    document.getElementById('ingredient-end-date').value = today.toISOString().split('T')[0];
    
    // Load ingredient analysis data
    loadIngredientAnalysisData();
}

function hideIngredientAnalysis() {
    document.getElementById('ingredient-analysis-section').classList.add('hidden');
    document.getElementById('summary').classList.remove('hidden');
    document.getElementById('insight-box').classList.remove('hidden');
    document.querySelector('.table-container').classList.remove('hidden');
    document.querySelectorAll('.dashboard-layout').forEach(el => el.classList.remove('hidden'));
}

async function loadIngredientAnalysisData() {
    try {
        showLoading();
        
        // Dates for filtering done orders
        const startEl = document.getElementById('ingredient-start-date');
        const endEl = document.getElementById('ingredient-end-date');
        const startDate = startEl && startEl.value ? new Date(startEl.value + 'T00:00:00') : null;
        const endDate = endEl && endEl.value ? new Date(endEl.value + 'T23:59:59') : null;
        
        // Load all menu data (optional) and inventory and kitchen orders and flavor mappings
        const [menuResponse, inventoryResponse, kitchenResponse, flavorMapResp] = await Promise.all([
            fetch('/menu/list'),
            fetch('/inventory/list'),
            fetch('/kitchen/orders'),
            fetch('/inventory/flavor_mapping')
        ]);
        const [menuData, inventoryData, kitchenOrders, flavorMapData] = await Promise.all([
            menuResponse.json(),
            inventoryResponse.json(),
            kitchenResponse.json(),
            flavorMapResp.json()
        ]);
        kitchenOrdersCache = Array.isArray(kitchenOrders) ? kitchenOrders : [];
        
        // Build flavor mapping: flavor_name (lower) -> list of {ingredient_id, quantity_per_serving, unit}
        let flavorMap = {};
        if (flavorMapData) {
            // support both {mappings: []} and [] shapes
            const mappingsArr = Array.isArray(flavorMapData)
                ? flavorMapData
                : (Array.isArray(flavorMapData.mappings) ? flavorMapData.mappings : (Array.isArray(flavorMapData.data) ? flavorMapData.data : []));
            for (const m of mappingsArr) {
                const fname = (m.flavor_name || m.flavor || '').toLowerCase();
                const ingId = m.ingredient_id ?? m.inventory_id ?? m.id;
                const qty = Number(m.quantity_per_serving ?? m.quantity ?? 0) || 0;
                const unit = m.unit || m.unit_name || '';
                if (!fname || !ingId || qty <= 0) continue;
                if (!flavorMap[fname]) flavorMap[fname] = [];
                flavorMap[fname].push({ ingredient_id: ingId, quantity_per_serving: qty, unit });
            }
        }
        globalFlavorMap = flavorMap;
        
        // Normalize menus (may be empty; we will derive from orders anyway)
        let menusArray = Array.isArray(menuData) ? menuData : (menuData && Array.isArray(menuData.data) ? menuData.data : []);
        
        // Filter kitchen orders: only done (and match date range if given)
        const doneOrders = Array.isArray(kitchenOrders) ? kitchenOrders.filter(o => {
            if (o.status !== 'done') return false;
            if (!startDate && !endDate) return true;
            const dt = o.time_done ? new Date(o.time_done) : null;
            if (!dt) return false;
            if (startDate && dt < startDate) return false;
            if (endDate && dt > endDate) return false;
            return true;
        }) : [];
        
        // Derive menu names from done orders
        let menuNames = [...new Set(doneOrders.flatMap(o => (o.items || []).map(i => i.menu_name)).filter(Boolean))];
        // Fallback to menus list if no orders found
        if (menuNames.length === 0) {
            menuNames = menusArray.map(m => m && m.base_name).filter(Boolean);
        }
        
        if (menuNames.length > 0) {
            // Load recipes for these menus
            const recipeResponse = await fetch('/recipes/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ menu_names: menuNames })
            });
            if (recipeResponse.ok) {
                const recipeData = await recipeResponse.json();
                menuRecipes = recipeData.recipes || {};
                
                // Normalize inventory
                if (inventoryData && Array.isArray(inventoryData)) {
                    ingredientData = inventoryData.reduce((acc, item) => { acc[item.id] = item; return acc; }, {});
                } else if (inventoryData && Array.isArray(inventoryData.data)) {
                    ingredientData = inventoryData.data.reduce((acc, item) => { acc[item.id] = item; return acc; }, {});
                } else {
                    ingredientData = {};
                }
                
                // Skip remote flavor fetch; rely on order preference/flavor mapping only
                menuValidFlavors = {};
                
                // Compute consumption from done orders (base recipe + flavor mapping)
                menuConsumption = {};
                menuOrderCount = {};
                menuFlavorUsage = {};
                variantConsumption = {};
                for (const order of doneOrders) {
                    const items = order.items || [];
                    for (const it of items) {
                        const mName = it.menu_name;
                        const qty = Number(it.quantity) || 0;
                        if (!mName || qty <= 0) continue;
                        if (!menuConsumption[mName]) menuConsumption[mName] = {};
                        if (!menuOrderCount[mName]) menuOrderCount[mName] = 0;
                        if (!menuFlavorUsage[mName]) menuFlavorUsage[mName] = {};
                        menuOrderCount[mName] += qty;

                        // Determine flavor using validation against menuValidFlavors
                        const candidatePref = (it.preference || '').trim();
                        const candidateAlt = normalizeFlavorForKey(getItemFlavorRaw(it));
                        const validSet = menuValidFlavors[mName] || new Set();
                        let chosen = '';
                        if (candidatePref && validSet.has(candidatePref.toLowerCase())) {
                            chosen = candidatePref;
                        } else if (candidateAlt && validSet.has(candidateAlt.toLowerCase())) {
                            chosen = candidateAlt;
                        } else if (candidatePref) {
                            // if menu has no set (service unavailable), still use candidatePref
                            if (validSet.size === 0) chosen = candidatePref;
                        } else if (candidateAlt) {
                            if (validSet.size === 0) chosen = candidateAlt;
                        }
                        const flavorDisplay = chosen || '-';
                        const prefLower = flavorDisplay.toLowerCase();
                        const key = `${mName}||${flavorDisplay}`;
                        if (!variantConsumption[key]) variantConsumption[key] = { menuName: mName, flavorName: flavorDisplay, orderQty: 0, ingredients: {} };
                        variantConsumption[key].orderQty += qty;

                        // Base recipe consumption
                        const recipes = menuRecipes[mName] || [];
                        for (const r of recipes) {
                            const ingId = r.ingredient_id;
                            const useQty = (Number(r.quantity) || 0) * qty;
                            // Aggregate per-menu general
                            if (!menuConsumption[mName][ingId]) menuConsumption[mName][ingId] = { totalQuantity: 0, unit: r.unit };
                            menuConsumption[mName][ingId].totalQuantity += useQty;
                            // Aggregate per-variant
                            if (!variantConsumption[key].ingredients[ingId]) variantConsumption[key].ingredients[ingId] = { totalQuantity: 0, unit: r.unit };
                            variantConsumption[key].ingredients[ingId].totalQuantity += useQty;
                        }

                        // Flavor-based consumption
                        if (prefLower && prefLower !== '-') {
                            menuFlavorUsage[mName][prefLower] = (menuFlavorUsage[mName][prefLower] || 0) + qty;
                            if (flavorMap[prefLower]) {
                                for (const fm of flavorMap[prefLower]) {
                                    const fIngId = fm.ingredient_id;
                                    const fUse = (Number(fm.quantity_per_serving) || 0) * qty;
                                    // per-menu
                                    if (!menuConsumption[mName][fIngId]) menuConsumption[mName][fIngId] = { totalQuantity: 0, unit: fm.unit };
                                    menuConsumption[mName][fIngId].totalQuantity += fUse;
                                    if (!menuConsumption[mName][fIngId].unit && fm.unit) menuConsumption[mName][fIngId].unit = fm.unit;
                                    // per-variant
                                    if (!variantConsumption[key].ingredients[fIngId]) variantConsumption[key].ingredients[fIngId] = { totalQuantity: 0, unit: fm.unit };
                                    variantConsumption[key].ingredients[fIngId].totalQuantity += fUse;
                                    if (!variantConsumption[key].ingredients[fIngId].unit && fm.unit) variantConsumption[key].ingredients[fIngId].unit = fm.unit;
                                }
                            }
                        }
                    }
                }
                
                                renderIngredientAnalysis();
                updateIngredientSummary();

                // Integrate into main report table and pagination/search
                currentDataType = 'ingredient';
                
                // Determine ingredient view mode: daily vs logs
                const viewSelect = document.getElementById('ingredient-view-select');
                const viewMode = viewSelect ? viewSelect.value : 'daily';
                const startParam = startDate ? startDate.toISOString().slice(0,10) : null;
                const endParam = endDate ? endDate.toISOString().slice(0,10) : null;
                let ingredientRows = [];
                let menuFlavorGroups = {}; // Initialize menuFlavorGroups for both view modes
                
                if (viewMode === 'daily') {
                    // Build from logs: group by date with better daily aggregation
                    const logsRes = await fetch('/inventory/history?limit=500');
                    const logsJson = await logsRes.json().catch(() => ({ history: [] }));
                    const logs = Array.isArray(logsJson.history) ? logsJson.history : [];
                    
                    // Group logs by date with more comprehensive data
                    const byDate = {};
                    logs.forEach(l => {
                        // Normalize date for range filtering: backend returns dd/mm/yyyy HH:MM
                        const rawDisplay = (l.date || '').slice(0,10); // dd/mm/yyyy
                        let iso = rawDisplay;
                        if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDisplay)) {
                            const [dd, mm, yyyy] = rawDisplay.split('/');
                            iso = `${yyyy}-${mm}-${dd}`; // yyyy-mm-dd
                        }
                        if (!rawDisplay) return;
                        if (startParam && endParam) {
                            if (iso < startParam || iso > endParam) return;
                        }
                        if (!byDate[rawDisplay]) {
                            byDate[rawDisplay] = { 
                                total_orders: 0, 
                                ingredients_affected: 0,
                                unique_menus: new Set(),
                                total_consumption: 0,
                                order_ids: new Set()
                            };
                        }
                        byDate[rawDisplay].total_orders += 1;
                        byDate[rawDisplay].ingredients_affected += (l.ingredients_affected || 0);
                        byDate[rawDisplay].total_consumption += (l.ingredients_affected || 0);
                        byDate[rawDisplay].order_ids.add(l.order_id);
                        
                        // Try to get menu details from kitchen orders for menu count
                        const kitchenOrder = kitchenOrdersCache.find(o => o.order_id === l.order_id);
                        if (kitchenOrder && kitchenOrder.items && kitchenOrder.items.length > 0) {
                            kitchenOrder.items.forEach(item => {
                                if (item.menu_name) {
                                    byDate[rawDisplay].unique_menus.add(item.menu_name);
                                }
                            });
                        }
                    });
                    
                    // Create daily rows with better information
                    ingredientRows = Object.entries(byDate).sort((a,b)=>{
                        // sort by ISO date descending using conversion
                        const [ad] = a; const [bd] = b;
                        const toIso = (s) => /^\d{2}\/\d{2}\/\d{4}$/.test(s) ? `${s.split('/')[2]}-${s.split('/')[1]}-${s.split('/')[0]}` : s;
                        return toIso(bd).localeCompare(toIso(ad));
                    }).map(([displayDate, v]) => ({
                        order_id: `Daily ${displayDate}`,
                        date: displayDate, // keep dd/mm/yyyy for UI
                        status_text: `${v.total_orders} pesanan • ${v.unique_menus.size} menu`,
                        ingredients_affected: v.total_consumption,
                        total_qty: v.total_consumption,
                        daily_summary: {
                            total_orders: v.total_orders,
                            unique_menus: v.unique_menus.size,
                            total_consumption: v.total_consumption,
                            order_ids: Array.from(v.order_ids)
                        }
                    }));
                    
                    // For daily view, also create menuFlavorGroups from the same logs data
                    // This allows us to show detailed breakdown when clicking detail button
                    for (const log of logs) {
                        const rawDisplay = (log.date || '').slice(0,10); // dd/mm/yyyy
                        if (!rawDisplay) continue;
                        // Try to get menu details from kitchen orders
                        const kitchenOrder = kitchenOrdersCache.find(o => o.order_id === log.order_id);
                        if (kitchenOrder && kitchenOrder.items && kitchenOrder.items.length > 0) {
                            for (const menuItem of kitchenOrder.items) {
                                const menuName = menuItem.menu_name || 'Unknown Menu';
                                const flavor = menuItem.preference || 'Default';
                                const key = `${menuName}|${flavor}`;
                                
                                if (!menuFlavorGroups[key]) {
                                    menuFlavorGroups[key] = {
                                        menu_name: menuName,
                                        flavor: flavor,
                                        total_orders: 0,
                                        total_ingredients: 0,
                                        order_ids: new Set(),
                                        date: rawDisplay,
                                        status_text: 'DIKONSUMSI'
                                    };
                                }
                                
                                menuFlavorGroups[key].total_orders += 1;
                                menuFlavorGroups[key].total_ingredients += (log.ingredients_affected || 0);
                                menuFlavorGroups[key].order_ids.add(log.order_id);
                            }
                        } else {
                            // Fallback removed to keep table clean
                        }
                    }
                } else {
                    // Logs view: fetch recent consumption logs and group by menu/flavor
                    let logsUrl = '/inventory/history?limit=100';
                    const logsRes = await fetch(logsUrl);
                    const logsJson = await logsRes.json().catch(() => ({ history: [] }));
                    const logs = Array.isArray(logsJson.history) ? logsJson.history : [];
                    const filteredLogs = logs.filter(row => {
                        if (!startParam || !endParam) return true;
                        // date format already formatted, cannot reliably filter; keep all when not exact
                        return true;
                    });
                    
                    // Use actual order data from kitchen service to get real menu names and flavors
                    // This data comes from the dashboard and contains the actual menu items ordered
                    const orderDetails = {};
                    
                    // First, get the kitchen orders data that was already fetched
                    const kitchenOrdersResponse = await fetch('/kitchen/orders');
                    let kitchenOrdersData = [];
                    if (kitchenOrdersResponse.ok) {
                        kitchenOrdersData = await kitchenOrdersResponse.json();
                    }
                    
                    console.log('Kitchen orders data:', kitchenOrdersData);
                    
                    // Create a mapping from order_id to kitchen order data
                    const orderIdToKitchenOrder = {};
                    for (const order of kitchenOrdersData) {
                        if (order.items && Array.isArray(order.items)) {
                            orderIdToKitchenOrder[order.order_id] = order;
                            console.log(`Order ${order.order_id} has items:`, order.items);
                        }
                    }
                    
                    console.log('Order ID to kitchen order mapping:', orderIdToKitchenOrder);
                    
                    // Now process consumption logs and match with kitchen order data
                    for (const log of filteredLogs) {
                        const orderId = log.order_id;
                        const kitchenOrder = orderIdToKitchenOrder[orderId];
                        
                        if (!orderDetails[orderId]) {
                            orderDetails[orderId] = {
                                order_id: orderId,
                                date: log.date,
                                status: log.status,
                                status_text: log.status === 'consumed' ? 'DIKONSUMSI' : 
                                             log.status === 'rolled_back' ? 'DIBATALKAN' : 'PENDING',
                                ingredients_affected: log.ingredients_affected || 0,
                                menu_items: kitchenOrder ? kitchenOrder.items : []
                            };
                        }
                        
                        console.log(`Log ${orderId} matched with kitchen order:`, kitchenOrder ? 'YES' : 'NO');
                        if (kitchenOrder) {
                            console.log(`Kitchen order items for ${orderId}:`, kitchenOrder.items);
                        }
                    }
                    
                    // Group by actual menu name and flavor from kitchen orders
                    for (const orderId in orderDetails) {
                        const order = orderDetails[orderId];
                        
                        if (order.menu_items && order.menu_items.length > 0) {
                            // Calculate per-item share to prevent inflating totals
                            const itemsCount = Math.max(1, order.menu_items.length);
                            const perItemIngredients = Math.max(0, Math.round((order.ingredients_affected || 0) / itemsCount));

                            // Process each menu item with its actual name and flavor from dashboard
                            for (const menuItem of order.menu_items) {
                                const menuName = menuItem.menu_name || 'Unknown Menu';
                                const flavor = (menuItem.preference && menuItem.preference.trim()) ? menuItem.preference : 'Default';
                                const key = `${menuName}|${flavor}`;
                                
                                console.log(`Processing menu item: ${menuName} with flavor: ${flavor}`);
                                
                                if (!menuFlavorGroups[key]) {
                                    menuFlavorGroups[key] = {
                                        menu_name: menuName,
                                        flavor: flavor,
                                        total_orders: 0,
                                        total_ingredients: 0,
                                        order_ids: new Set(),
                                        date: order.date,
                                        status_text: order.status_text
                                    };
                                }
                                
                                menuFlavorGroups[key].total_orders += 1;
                                // Add only the per-item share to avoid duplication across items
                                menuFlavorGroups[key].total_ingredients += perItemIngredients;
                                menuFlavorGroups[key].order_ids.add(orderId);
                            }
                        } else {
                            // If we cannot map to a menu item, skip creating generic rows to keep table clean
                            continue;
                        }
                    }
                    
                    console.log('Final menu flavor groups:', menuFlavorGroups);
                    
                    // Convert grouped data to table rows
                    ingredientRows = Object.values(menuFlavorGroups).map(group => ({
                        menu_name: group.menu_name,
                        flavor: group.flavor,
                        date: group.date,
                        status_text: `${group.total_orders} pesanan`,
                        ingredients_affected: group.total_ingredients,
                        total_qty: group.total_ingredients,
                        order_ids: Array.from(group.order_ids),
                        // Add order_id for compatibility with daily view
                        order_id: Array.from(group.order_ids)[0] || ''
                    }));
                    
                    // Debug: log the data structure
                    console.log('Ingredient rows data:', ingredientRows);
                    console.log('Sample item structure:', ingredientRows[0]);
                }
                
                // Also create daily aggregated data for daily view
                const dailyGroups = {};
                for (const group of Object.values(menuFlavorGroups)) {
                    const dateKey = group.date;
                    if (!dailyGroups[dateKey]) {
                        dailyGroups[dateKey] = {
                            date: dateKey,
                            total_ingredients: 0,
                            total_orders: 0,
                            order_ids: new Set(),
                            status_text: 'DIKONSUMSI'
                        };
                    }
                    dailyGroups[dateKey].total_ingredients += group.total_ingredients;
                    dailyGroups[dateKey].total_orders += group.total_orders;
                    group.order_ids.forEach(id => dailyGroups[dateKey].order_ids.add(id));
                }
                
                // Create daily rows
                const dailyRows = Object.values(dailyGroups).map(group => ({
                    date: group.date,
                    status_text: `${group.total_orders} pesanan`,
                    ingredients_affected: group.total_ingredients,
                    order_id: Array.from(group.order_ids)[0] || '',
                    // For daily view, we don't need menu_name and flavor
                    menu_name: undefined,
                    flavor: undefined,
                    order_ids: Array.from(group.order_ids),
                    total_qty: group.total_ingredients,
                    // Provide summary for table and detail panel
                    daily_summary: {
                        total_orders: group.total_orders,
                        unique_menus: group.unique_menus ? group.unique_menus.size || group.unique_menus : 0,
                        total_consumption: group.total_ingredients,
                        order_ids: Array.from(group.order_ids)
                    }
                }));
                
                // Debug: log the data structure
                console.log('Ingredient rows data:', ingredientRows);
                console.log('Daily rows data:', dailyRows);
                console.log('Sample item structure:', ingredientRows[0]);
                
                // Store both data sets
                baseData = {
                    logs: ingredientRows,
                    daily: dailyRows
                };
                // Expose groups globally for details panel usage
                ingredientMenuFlavorGroups = menuFlavorGroups;
                
                // Get current view mode and set appropriate data
                const currentViewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
                const currentViewData = baseData[currentViewMode] || [];
                // Update header/badge for clarity
                setIngredientViewHeader(currentViewMode);
                
                const tableSearch = document.getElementById('table-search-input');
                const term = tableSearch ? tableSearch.value.toLowerCase() : '';
                filteredData = term
                    ? currentViewData.filter(i => 
                        (i.menu_name || '').toLowerCase().includes(term) || 
                        (i.flavor || '').toLowerCase().includes(term) || 
                        (i.order_id || '').toLowerCase().includes(term) || 
                        (i.date || '').toLowerCase().includes(term) || 
                        (i.status_text || '').toLowerCase().includes(term)
                    )
                    : [...currentViewData];
                currentPage = 1;
                renderTablePage();
                updatePagination();
            } else {
                // On failure, clear
                menuRecipes = {};
                menuConsumption = {};
                const details = document.getElementById('ingredient-details');
                if (details) details.innerHTML = '<div class="ingredient-menu-item">Tidak ada data resep untuk dianalisis.</div>';
                // Clear main table data when failure in ingredient mode
                if (currentDataType === 'ingredient') {
                    baseData = [];
                    filteredData = [];
                    currentPage = 1;
                    renderTablePage();
                    updatePagination();
                }
                // Clear global groups when failing
                ingredientMenuFlavorGroups = {};
            }
        } else {
            menuRecipes = {};
            menuConsumption = {};
            const details = document.getElementById('ingredient-details');
            if (details) details.innerHTML = '<div class="ingredient-menu-item">Tidak ada data pesanan selesai pada periode ini.</div>';
            if (currentDataType === 'ingredient') {
                baseData = [];
                filteredData = [];
                currentPage = 1;
                renderTablePage();
                updatePagination();
            }
            ingredientMenuFlavorGroups = {};
        }
        
        hideLoading();
    } catch (error) {
        console.error('Error loading ingredient analysis data:', error);
        hideLoading();
        alert('Gagal memuat data analisis bahan');
    }
}

function renderIngredientAnalysis() {
    renderIngredientConsumptionChart();
    renderIngredientConsumptionDetails();
    renderIngredientConsumptionTable();
}

function renderIngredientConsumptionChart() {
    const ctx = document.getElementById('ingredientChart');
    if (!ctx) return;
    if (ingredientChart) ingredientChart.destroy();
    // Adapt to daily history summary if baseData present
    const rows = Array.isArray(baseData) ? baseData : [];
    const labels = rows.map(r => r.date || r.order_id || '-');
    const totals = rows.map(r => Number(r.total_qty || 0));
    ingredientChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Total Bahan Terpakai', data: totals, backgroundColor: '#DCD0A8', borderColor: '#C1B8A0', borderWidth: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
    });
}

function renderIngredientConsumptionDetails() {
    const container = document.getElementById('ingredient-details');
    if (!container) return;
    container.innerHTML = '';
}

function renderIngredientConsumptionTable() {
    const tbody = document.getElementById('ingredient-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
}

function updateIngredientSummary() {
    // Adapt summary to ingredient mode table (daily)
    const totalMenu = 0;
    const allIngredients = (Array.isArray(baseData) ? baseData : []).reduce((s, r) => s + (r.ingredients_affected ?? 0), 0);
    document.getElementById('ingredient-total-menu').textContent = baseData ? baseData.length : 0;
    document.getElementById('ingredient-total-ingredients').textContent = allIngredients;
    document.getElementById('ingredient-most-ingredients').textContent = '-';
    document.getElementById('ingredient-most-used').textContent = '-';
}

function hideIngredientDetailsPanel() {
    const panel = document.getElementById('ingredient-details-panel');
    if (panel) panel.classList.add('hidden');
}

async function viewConsumptionDetails(orderId, dateStr, statusText) {
    try {
        // If orderId looks like aggregated daily row, show aggregated data
        const isAggregated = (orderId || '').toLowerCase().startsWith('daily');
        const panel = document.getElementById('ingredient-details-panel');
        const body = document.getElementById('ingredient-details-body');
        const headRow = document.querySelector('#ingredient-details-table thead tr');
        document.getElementById('detail-order-id').textContent = isAggregated ? `Harian - ${dateStr}` : (orderId || '-');
        document.getElementById('detail-order-date').textContent = dateStr || '-';
        document.getElementById('detail-order-status').textContent = statusText || '-';
        body.innerHTML = '';
        if (panel) panel.classList.remove('hidden');
        
        if (isAggregated) {
            // Switch header to menu breakdown for daily view (5 columns)
            if (headRow) {
                headRow.innerHTML = `
                    <th style="background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;">No</th>
                    <th style="background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;">Menu</th>
                    <th style="background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;">Flavor</th>
                    <th style="background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;">Total Bahan</th>
                    <th style="background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;">Total Pesanan</th>`;
            }
            // Show aggregated daily consumption data
            await showDailyAggregatedConsumption(dateStr, statusText);
            return;
        } else {
            // Restore header for per-order ingredient details (6 columns)
            if (headRow) {
                headRow.innerHTML = `
                    <th style=\"background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;\">No</th>
                    <th style=\"background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;\">Nama Bahan</th>
                    <th style=\"background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;\">Qty Terpakai</th>
                    <th style=\"background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;\">Unit</th>
                    <th style=\"background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;\">Stok Sebelum</th>
                    <th style=\"background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6;\">Stok Sesudah</th>`;
            }
        }

        const res = await fetch(`/inventory/order/${encodeURIComponent(orderId)}/ingredients`);
        
        // Check if response is ok
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const json = await res.json();
        
        // Handle different possible response structures
        const details = json?.data?.ingredients_breakdown?.details || 
                       json?.ingredients_breakdown?.details || 
                       json?.details || 
                       [];

        if (!Array.isArray(details)) {
            console.warn('Expected array of details but got:', details);
            body.innerHTML = '<tr><td colspan="6">No ingredient details available</td></tr>';
            return;
        }

        // Debug: Log the actual data structure
        console.log('Raw API response:', json);
        console.log('Details array:', details);
        console.log('First detail item:', details[0]);

        // Generate table rows with correct field mapping
        body.innerHTML = details.map((d, idx) => {
            // Use correct field names based on API response
            const ingredientName = d?.ingredient_name || '-';
            const quantityConsumed = d?.consumed_quantity || 0;
            const unit = d?.unit || '-';
            const stockBefore = d?.stock_before_consumption || 0;
            const stockAfter = d?.stock_after_consumption || 0;
            
            return `
                <tr style="border-bottom: 1px solid #F3F4F6;">
                    <td style="padding: 0.75rem; color: #1F2937; font-weight: 500;">${idx + 1}</td>
                    <td style="padding: 0.75rem; color: #1F2937; font-weight: 600;">${ingredientName}</td>
                    <td style="padding: 0.75rem; color: #1F2937; text-align: center; font-weight: 500;">${Number(quantityConsumed).toLocaleString()}</td>
                    <td style="padding: 0.75rem; color: #1F2937; text-align: center; font-weight: 500;">${unit}</td>
                    <td style="padding: 0.75rem; color: #1F2937; text-align: center; font-weight: 500;">${Number(stockBefore).toLocaleString()}</td>
                    <td style="padding: 0.75rem; color: #1F2937; text-align: center; font-weight: 500;">${Number(stockAfter).toLocaleString()}</td>
                </tr>
            `;
        }).join('');
        
    } catch (e) {
        console.error('Failed loading consumption details for orderId:', orderId, 'Error:', e);
        
        // Show error message in the table
        const body = document.getElementById('ingredient-details-body');
        if (body) {
            body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 1.5rem; font-weight: 500;">Failed to load ingredient details</td></tr>';
        }
         }
}

async function showDailyAggregatedConsumption(dateStr, statusText) {
    try {
        const body = document.getElementById('ingredient-details-body');
        
        // Get the daily summary data for the specific date
        const dailyItem = filteredData.find(item => 
            item.date === dateStr && item.daily_summary
        );
        
        if (!dailyItem || !dailyItem.daily_summary) {
            body.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #615a5a; padding: 1.5rem; font-weight: 500;">Tidak ada data detail untuk tanggal ini</td></tr>';
            return;
        }
        
        const dailySummary = dailyItem.daily_summary;
        
        // Create a summary header row
        const summaryRow = `
            <tr style="background-color: #F9FAFB; border-bottom: 2px solid #E5E7EB;">
                <td colspan="5" style="padding: 1rem; text-align: center;">
                    <div style="font-size: 1.1rem; font-weight: 700; color: #1F2937; margin-bottom: 0.5rem;">
                        📅 Ringkasan Konsumsi Harian - ${dateStr}
                    </div>
                    <div style="display: flex; justify-content: center; gap: 2rem; flex-wrap: wrap;">
                        <div style="text-align: center;">
                            <div style="font-size: 1.5rem; font-weight: 700; color: #059669;">${dailySummary.total_orders}</div>
                            <div style="font-size: 0.9rem; color: #6B7280;">Total Pesanan</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 1.5rem; font-weight: 700; color: #7C3AED;">${dailySummary.unique_menus}</div>
                            <div style="font-size: 0.9rem; color: #6B7280;">Menu Unik</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 1.5rem; font-weight: 700; color: #DC2626;">${dailySummary.total_consumption.toLocaleString()}</div>
                            <div style="font-size: 0.9rem; color: #6B7280;">Total Bahan</div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
        
        // Use global groups captured during load
        const dateMenuData = Object.values(ingredientMenuFlavorGroups).filter(group => 
            group.date === dateStr
        );
        
        if (dateMenuData.length === 0) {
            body.innerHTML = summaryRow + `
                <tr>
                    <td colspan="5" style="text-align: center; color: #6B7280; padding: 1.5rem; font-weight: 500;">
                        Tidak ada detail menu untuk tanggal ini
                    </td>
                </tr>
            `;
            return;
        }
        
        // Generate table rows for menu breakdown (5 columns)
        const menuRows = dateMenuData.map((group, idx) => `
            <tr style="border-bottom: 1px solid #F3F4F6;">
                <td style="padding: 0.75rem; color: #1F2937; font-weight: 500; text-align: center;">${idx + 1}</td>
                <td style="padding: 0.75rem; color: #1F2937; font-weight: 600;">${group.menu_name}</td>
                <td style="padding: 0.75rem; color: #1F2937; text-align: center; font-weight: 500;">${group.flavor}</td>
                <td style="padding: 0.75rem; color: #1F2937; text-align: center; font-weight: 500;">${group.total_ingredients.toLocaleString()}</td>
                <td style="padding: 0.75rem; color: #1F2937; text-align: center; font-weight: 500;">${group.total_orders}</td>
            </tr>
        `).join('');
        
        body.innerHTML = summaryRow + menuRows;
        
    } catch (e) {
        console.error('Failed to load daily aggregated consumption:', e);
        const body = document.getElementById('ingredient-details-body');
        if (body) {
            body.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 1.5rem; font-weight: 500;">Gagal memuat data konsumsi harian</td></tr>';
        }
    }
}

function exportIngredientCSV() {
    // Export aligned with ingredient mode (daily history aggregation)
    const rows = (Array.isArray(baseData) ? baseData : []).map(r => [
        r.order_id || '-',
        r.date || '-',
        r.status_text || '-',
        r.ingredients_affected ?? 0,
        r.total_qty ?? 0
    ]);
    const csvContent = [
        ['Order ID/Day', 'Tanggal', 'Status', 'Total Bahan', 'Total Qty'],
        ...rows
    ].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ingredient_consumption_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

async function loadKitchenData() {
    try {
        showLoading();
        
        // Load kitchen orders
        const kitchenResponse = await fetch('/kitchen/orders');
        const kitchenOrders = await kitchenResponse.json();
        
        // Load inventory data for ingredient analysis
        const inventoryResponse = await fetch('/inventory/list');
        const inventoryData = await inventoryResponse.json();
        
        if (kitchenOrders && Array.isArray(kitchenOrders)) {
            kitchenData = kitchenOrders;
            renderKitchenTable();
            updateKitchenSummary();
        }
        
        if (inventoryData && inventoryData.data) {
            ingredientData = inventoryData.data.reduce((acc, item) => {
                acc[item.id] = item;
                return acc;
            }, {});
        }
        
        hideLoading();
    } catch (error) {
        console.error('Error loading kitchen data:', error);
        hideLoading();
        alert('Gagal memuat data dapur');
    }
}

async function loadIngredientAnalysis() {
    try {
        // Get unique menu names from kitchen orders
        const menuNames = [...new Set(kitchenData.flatMap(order => 
            order.items ? order.items.map(item => item.menu_name) : []
        ))].filter(Boolean);
        
        if (menuNames.length > 0) {
            // Load recipes for these menus
            const recipeResponse = await fetch('/recipes/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ menu_names: menuNames })
            });
            
            if (recipeResponse.ok) {
                const recipeData = await recipeResponse.json();
                menuRecipes = recipeData.recipes || {};
                renderIngredientChart();
                renderIngredientDetails();
            }
        }
    } catch (error) {
        console.error('Error loading ingredient analysis:', error);
    }
}

function renderKitchenTable() {
    const tbody = document.getElementById('kitchen-body');
    const statusFilter = document.getElementById('kitchen-status-filter').value;
    
    let filteredKitchenData = kitchenData;
    if (statusFilter) {
        filteredKitchenData = kitchenData.filter(order => order.status === statusFilter);
    }
    
    tbody.innerHTML = filteredKitchenData.map((order, index) => {
        // Get ingredient usage for this order
        const ingredientUsage = getOrderIngredientUsage(order);
        
        return `
            <tr>
                <td>${index + 1}</td>
                <td>${order.order_id}</td>
                <td>${order.queue_number || '-'}</td>
                <td>${order.customer_name || '-'}</td>
                <td>${order.room_name || '-'}</td>
                <td>
                    ${order.items ? order.items.map(item => 
                        `<div class="menu-item-tag">${item.menu_name} (${item.quantity})</div>`
                    ).join('') : order.detail || '-'}
                </td>
                <td>
                    <div class="ingredient-usage-summary">
                        ${ingredientUsage.length > 0 ? 
                            ingredientUsage.slice(0, 3).map(ing => 
                                `<span class="ingredient-tag">${ing.name} (${ing.totalQuantity} ${ing.unit})</span>`
                            ).join('') + (ingredientUsage.length > 3 ? 
                                `<span class="ingredient-tag-more">+${ingredientUsage.length - 3} bahan lain</span>` : '') 
                            : '<span class="no-ingredients">Tidak ada data bahan</span>'
                        }
                    </div>
                </td>
                <td>
                    <span class="status-badge status-${order.status}">${getStatusText(order.status)}</span>
                </td>
                <td>${formatDateTime(order.time_receive)}</td>
                <td>${order.time_done ? formatDateTime(order.time_done) : '-'}</td>
                <td>
                    <button onclick="viewOrderIngredients('${order.order_id}')" class="btn-secondary btn-sm">
                        🥤 Detail Bahan
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateKitchenSummary() {
    const total = kitchenData.length;
    const inProgress = kitchenData.filter(order => 
        ['receive', 'making', 'deliver'].includes(order.status)
    ).length;
    const completed = kitchenData.filter(order => order.status === 'done').length;
    const cancelled = kitchenData.filter(order => order.status === 'cancelled').length;
    
    document.getElementById('kitchen-total-orders').textContent = total;
    document.getElementById('kitchen-in-progress').textContent = inProgress;
    document.getElementById('kitchen-completed').textContent = completed;
    document.getElementById('kitchen-cancelled').textContent = cancelled;
}

function renderIngredientChart() {
    const ctx = document.getElementById('ingredientChart');
    if (!ctx) return;
    
    if (ingredientChart) {
        ingredientChart.destroy();
    }
    
    // Calculate ingredient usage per menu
    const menuIngredientUsage = {};
    Object.keys(menuRecipes).forEach(menuName => {
        const recipes = menuRecipes[menuName];
        let totalIngredients = 0;
        recipes.forEach(recipe => {
            totalIngredients += recipe.quantity;
        });
        menuIngredientUsage[menuName] = totalIngredients;
    });
    
    const sortedMenus = Object.entries(menuIngredientUsage)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10);
    
    ingredientChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedMenus.map(([menu]) => menu),
            datasets: [{
                label: 'Total Bahan',
                data: sortedMenus.map(([,count]) => count),
                backgroundColor: '#DCD0A8',
                borderColor: '#C1B8A0',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Jumlah Bahan'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

function renderIngredientDetails() {
    const container = document.getElementById('ingredient-details');
    
    const menuDetails = Object.entries(menuRecipes).map(([menuName, recipes]) => {
        const ingredientList = recipes.map(recipe => {
            const ingredient = ingredientData[recipe.ingredient_id];
            return ingredient ? `${ingredient.name} (${recipe.quantity} ${recipe.unit})` : `ID ${recipe.ingredient_id} (${recipe.quantity} ${recipe.unit})`;
        }).join(', ');
        
        return `
            <div class="ingredient-menu-item">
                <h5>${menuName}</h5>
                <p><strong>Bahan:</strong> ${ingredientList}</p>
                <button onclick="viewMenuIngredients('${menuName}')" class="btn-secondary btn-sm">
                    📋 Detail Lengkap
                </button>
            </div>
        `;
    }).join('');
    
    container.innerHTML = menuDetails;
}

async function viewOrderIngredients(orderId) {
    try {
        const response = await fetch(`/order/${orderId}/ingredients`);
        const data = await response.json();
        
        if (data.success && data.data) {
            const ingredients = data.data.ingredients_detail || [];
            const menuInfo = data.data.menu_info || [];
            
            let modalContent = `
                <h4>Order ${orderId}</h4>
                <div class="order-ingredients">
                    <h5>Menu yang Dipesan:</h5>
                    <ul>
                        ${menuInfo.map(item => `<li>${item.menu_name} (${item.quantity})</li>`).join('')}
                    </ul>
                    
                    <h5>Bahan yang Digunakan:</h5>
                    <table class="ingredient-table">
                        <thead>
                            <tr>
                                <th>Bahan</th>
                                <th>Jumlah</th>
                                <th>Unit</th>
                                <th>Stok Sebelum</th>
                                <th>Stok Sesudah</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ingredients.map(ing => `
                                <tr>
                                    <td>${ing.ingredient_name}</td>
                                    <td>${ing.consumed_quantity}</td>
                                    <td>${ing.unit}</td>
                                    <td>${ing.stock_before_consumption}</td>
                                    <td>${ing.stock_after_consumption}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            
            document.getElementById('ingredient-modal-body').innerHTML = modalContent;
            document.getElementById('ingredient-modal').classList.remove('hidden');
        } else {
            alert('Tidak dapat memuat detail bahan untuk order ini');
        }
    } catch (error) {
        console.error('Error viewing order ingredients:', error);
        alert('Gagal memuat detail bahan');
    }
}

function viewMenuIngredients(menuName) {
    // Show consumed totals per menu (aggregated)
    const ingMap = menuConsumption[menuName] || {};
    const rows = Object.entries(ingMap).map(([ingId, v]) => {
        const ing = ingredientData[ingId];
        const name = ing ? ing.name : `ID ${ingId}`;
        return `
            <tr>
                <td>${name}</td>
                <td>${(v.totalQuantity || 0).toFixed(2)}</td>
                <td>${v.unit || ''}</td>
                <td>${ing ? (ing.current_quantity ?? '-') : '-'}</td>
            </tr>
        `;
    }).join('');
    let modalContent = `
        <h4>${menuName}</h4>
        <div class="menu-ingredients">
            <h5>Konsumsi Bahan (Agregat Pesanan)</h5>
            <table class="ingredient-table">
                <thead>
                    <tr>
                        <th>Bahan</th>
                        <th>Total Terpakai</th>
                        <th>Unit</th>
                        <th>Stok Tersedia</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="4">Tidak ada data</td></tr>'}</tbody>
            </table>
        </div>
    `;
    document.getElementById('ingredient-modal-body').innerHTML = modalContent;
    document.getElementById('ingredient-modal').classList.remove('hidden');
}

function exportKitchenCSV() {
    const statusFilter = document.getElementById('kitchen-status-filter').value;
    let filteredData = kitchenData;
    
    if (statusFilter) {
        filteredData = kitchenData.filter(order => order.status === statusFilter);
    }
    
    const csvContent = [
        ['Order ID', 'Queue', 'Customer', 'Room', 'Menu Items', 'Bahan yang Digunakan', 'Status', 'Time Receive', 'Time Done'],
        ...filteredData.map(order => {
            const ingredientUsage = getOrderIngredientUsage(order);
            const ingredientSummary = ingredientUsage.length > 0 ? 
                ingredientUsage.slice(0, 3).map(ing => `${ing.name} (${ing.totalQuantity} ${ing.unit})`).join('; ') + 
                (ingredientUsage.length > 3 ? `; +${ingredientUsage.length - 3} bahan lain` : '') 
                : 'Tidak ada data bahan';
            
            return [
                order.order_id,
                order.queue_number || '',
                order.customer_name || '',
                order.room_name || '',
                order.items ? order.items.map(item => `${item.menu_name} (${item.quantity})`).join('; ') : order.detail || '',
                ingredientSummary,
                order.status,
                order.time_receive || '',
                order.time_done || ''
            ];
        })
    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kitchen_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function getStatusText(status) {
    const statusMap = {
        'receive': 'Diterima',
        'making': 'Sedang Dibuat',
        'deliver': 'Siap Antar',
        'done': 'Selesai',
        'cancelled': 'Dibatalkan'
    };
    return statusMap[status] || status;
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        return date.toLocaleString('id-ID', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        return dateString;
    }
}

function closeIngredientModal() {
    document.getElementById('ingredient-modal').classList.add('hidden');
}

function refreshKitchenData() {
    loadKitchenData();
    loadIngredientAnalysis();
}

function getOrderIngredientUsage(order) {
    if (!order.items || !menuRecipes) return [];
    
    const ingredientUsage = {};
    
    order.items.forEach(item => {
        const menuName = item.menu_name;
        const quantity = item.quantity;
        const recipes = menuRecipes[menuName] || [];
        
        recipes.forEach(recipe => {
            const ingredientId = recipe.ingredient_id;
            const ingredient = ingredientData[ingredientId];
            
            if (ingredient) {
                if (!ingredientUsage[ingredientId]) {
                    ingredientUsage[ingredientId] = {
                        name: ingredient.name,
                        unit: recipe.unit,
                        totalQuantity: 0
                    };
                }
                ingredientUsage[ingredientId].totalQuantity += recipe.quantity * quantity;
            }
        });
    });
    
    return Object.values(ingredientUsage);
}

// ========== UTILITY FUNCTIONS ==========
function showEmptyState(message, type = 'info') {
    const tbody = document.getElementById("report-tbody");
    if (!tbody) return;
    
    const colspan = currentDataType === 'ingredient' ? 7 : 5;
    const icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '📊';
    const color = type === 'error' ? '#DC2626' : type === 'warning' ? '#F59E0B' : '#6B7280';
    
    tbody.innerHTML = `
        <tr>
            <td colspan="${colspan}" style="text-align: center; padding: 2rem; color: ${color}; font-style: italic;">
                <div style="margin-bottom: 0.5rem;">
                    <span style="font-size: 2rem;">${icon}</span>
                </div>
                <div style="font-size: 1.1rem; font-weight: 500; margin-bottom: 0.5rem;">
                    ${message}
                </div>
                <div style="font-size: 0.9rem; color: #9CA3AF;">
                    Coba pilih periode tanggal yang berbeda atau periksa data pesanan
                </div>
            </td>
        </tr>`;
}

function updateSummaryWithData(data, type = 'sales') {
    const summaryPeriod = document.getElementById("summary-period");
    const summaryIncome = document.getElementById("summary-income");
    const summaryOrders = document.getElementById("summary-orders");
    const statusEl = document.getElementById("summary-status-badge");
    
    if (summaryPeriod) {
        summaryPeriod.textContent = `${data.start_date || 'N/A'} s/d ${data.end_date || 'N/A'}`;
    }
    
    if (summaryIncome) {
        if (type === 'sales') {
            summaryIncome.textContent = `Rp ${(data.total_income || 0).toLocaleString()}`;
        } else if (type === 'best') {
            const totalRevenue = data.best_sellers ? 
                data.best_sellers.reduce((sum, item) => sum + (item.total_revenue || 0), 0) : 0;
            summaryIncome.textContent = `Rp ${totalRevenue.toLocaleString()}`;
        }
    }
    
    if (summaryOrders) {
        if (type === 'sales') {
            summaryOrders.textContent = `${data.total_order || 0}`;
        } else if (type === 'best') {
            summaryOrders.textContent = `${data.processed_orders || 0}`;
        }
    }
    
    if (statusEl) {
        if (type === 'sales') {
            statusEl.textContent = "Data Sales";
            statusEl.className = 'status-badge status-deliver';
        } else if (type === 'best') {
            statusEl.textContent = "Best Seller";
            statusEl.className = 'status-badge status-warning';
        } else if (type === 'empty') {
            statusEl.textContent = "Kosong";
            statusEl.className = 'status-badge status-cancel';
        } else if (type === 'error') {
            statusEl.textContent = "Error";
            statusEl.className = 'status-badge status-cancel';
        }
    }
}

// ========== CHART FUNCTIONS ==========
function showPieModal(label, value, percent) {
    document.getElementById("pie-modal-content").innerHTML = `
        <div class="view-item">
            <label>Menu:</label>
            <span><strong>${label}</strong></span>
        </div>
        <div class="view-item">
            <label>Jumlah:</label>
            <span>${value} item</span>
        </div>
        <div class="view-item">
            <label>Kontribusi:</label>
            <span>${percent}%</span>
        </div>`;
    document.getElementById("pie-modal").classList.remove("hidden");
}

function renderCharts(details) {
    const labels = details.map(d => d.menu_name);
    const quantities = details.map(d => d.quantity);
    
    if (barChart) barChart.destroy();
    if (pieChart) pieChart.destroy();

    // Bar Chart
    barChart = new Chart(document.getElementById("barChart"), {
        type: 'bar',
        data: { 
            labels, 
            datasets: [{ 
                label: "Jumlah Terjual", 
                data: quantities, 
                backgroundColor: "#8D7272",
                borderColor: "#503A3A",
                borderWidth: 2
            }] 
        },
        options: { 
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#312929',
                        font: {
                            family: 'Inter',
                            size: 14
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#312929'
                    }
                },
                x: {
                    ticks: {
                        color: '#312929'
                    }
                }
            }
        },
        plugins: [
            {
                id: 'responsiveCanvasBar',
                beforeInit(chart) {
                    const canvas = chart.canvas;
                    canvas.style.width = '100%';
                    canvas.style.height = '100%';
                }
            }
        ]
    });

    // Pie Chart
    const pieCanvas = document.getElementById("pieChart");
    pieChart = new Chart(pieCanvas, {
        type: 'pie',
        data: {
            labels,
            datasets: [{ 
                data: quantities, 
                backgroundColor: [
                    '#8D7272', '#DCD0A8', '#207156', '#B3261E', '#E09B20',
                    '#503A3A', '#CAB99D', '#685454', '#60B7A6', '#F5EFE6'
                ],
                borderColor: '#FFFFFF',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { 
                animateRotate: true, 
                animateScale: true, 
                duration: 1000, 
                easing: "easeOutBounce" 
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percent = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} item (${percent}%)`;
                        }
                    }
                },
                legend: {
                    position: (pieCanvas && pieCanvas.parentElement && pieCanvas.parentElement.clientWidth < 640) ? 'bottom' : 'right',
                    labels: {
                        color: '#312929',
                        font: {
                            family: 'Inter',
                            size: 12
                        }
                    },
                    onClick: (e, legendItem, legend) => {
                        const index = legendItem.index;
                        const ci = legend.chart;
                        ci.toggleDataVisibility(index);
                        ci.update();
                    }
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const label = pieChart.data.labels[index];
                    const value = pieChart.data.datasets[0].data[index];
                    const total = pieChart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                    const percent = ((value / total) * 100).toFixed(1);
                    showPieModal(label, value, percent);
                }
            }
        },
        plugins: [
            {
                id: 'responsiveCanvasPie',
                beforeInit(chart) {
                    const canvas = chart.canvas;
                    canvas.style.width = '100%';
                    canvas.style.height = '100%';
                }
            }
        ]
    });
}

// ========== REPORT FUNCTIONS ==========
function generateInsight(data, topMenu, loyalCustomer) {
    const box = document.getElementById("insight-box");
    const content = document.getElementById("insight-content");
    const percent = topMenu && data.total_income ? ((topMenu.total || 0) / (data.total_income || 1) * 100).toFixed(1) : '0.0';
    
    const rangkuman = `📅 Periode ${data.start_date || 'N/A'} s/d ${data.end_date || 'N/A'} terjadi <strong>${data.total_order || 0}</strong> transaksi dengan total pendapatan <strong>Rp ${(data.total_income || 0).toLocaleString()}</strong>.`;
    const menuTerlaris = topMenu ? `📌 Menu paling laris: <strong>${topMenu.menu_name || 'N/A'}</strong> (${topMenu.quantity || 0} terjual), menyumbang ${percent}% pendapatan.` : "📌 Tidak ada data menu terlaris.";
    const loyal = loyalCustomer ? `🏆 Pelanggan loyal: <strong>${loyalCustomer.customer_name || 'N/A'}</strong>, ${loyalCustomer.total_orders || 0}x order, Rp ${(loyalCustomer.total_spent || 0).toLocaleString()}.` : "";
    
    content.innerHTML = [rangkuman, menuTerlaris, loyal].filter(Boolean).join('<br><br>');
    box.classList.remove("hidden");
}

// Hash helpers to detect changes without re-rendering
function computeDataHash(arr) {
    try {
        if (!Array.isArray(arr)) return '0';
        // lightweight hash: join key fields to avoid heavy stringify
        const key = arr.map(i => `${i.menu_name}|${i.quantity ?? i.total_quantity ?? 0}|${i.total ?? i.total_revenue ?? 0}`).join('#');
        let hash = 0;
        for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash) + key.charCodeAt(i) | 0;
        return String(hash);
    } catch {
        return String(Math.random());
    }
}

let lastReportHash = '';
let lastBestHash = '';
let currentDataType = 'sales';
let lastUserInputAt = 0;

async function loadReport() {
    const start = document.getElementById("start_date").value;
    const end = document.getElementById("end_date").value;
    const menuFilter = document.getElementById("menu-filter").value.trim();
    
    if (!start || !end) {
        alert("Tanggal belum diisi!");
        return;
    }
    
    if (new Date(start) > new Date(end)) {
        alert("Tanggal awal tidak boleh melebihi tanggal akhir!");
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        // Build URL with optional menu filter
        let url = `/report?start_date=${start}&end_date=${end}`;
        if (menuFilter) {
            url += `&menu_name=${encodeURIComponent(menuFilter)}`;
        }

        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.detail || "Gagal mengambil data laporan");
        }
        
        const data = await res.json();
        console.log('Report data received:', data);
        currentReportData = data;
        // Set current type as early as possible to avoid stale state
        const previousType = currentDataType;
        currentDataType = 'sales';

        // Update summary
        updateSummaryWithData(data, 'sales');
        applyModeLayout('sales');

        const details = Array.isArray(data.details) ? data.details : [];
        console.log('Report details:', details);
        
        const newHash = computeDataHash(details);
        // Force refresh if coming from a different data type to avoid stale ingredient/log rows
        if (newHash !== lastReportHash || previousType !== 'sales') {
            lastReportHash = newHash;
            baseData = details;
            // preserve current search if any
            const tableSearch = document.getElementById('table-search-input');
            const term = tableSearch ? tableSearch.value : '';
            filteredData = term ? baseData.filter(i => (i.menu_name || '').toLowerCase().includes(term.toLowerCase())) : [...baseData];
            currentPage = 1;
            renderTablePage();
            updatePagination();
            // Re-render charts only when data changed
            const chartData = details.map(item => ({
                menu_name: item.menu_name || 'N/A',
        quantity: item.quantity || 0,
        unit_price: item.unit_price || 0,
        total: item.total || 0
            }));
            renderCharts(chartData);
        } else {
            // Even if hash same, ensure header matches sales mode after returning from ingredient
            const tableHeader = document.querySelector('#report-table thead tr');
            if (tableHeader) {
                tableHeader.innerHTML = `
                    <th>No</th>
                    <th>Menu</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                `;
            }
        }

        if (details.length === 0) {
            // When no sales data, try best seller as fallback
            console.log('No sales data found, loading best seller data instead');
            await loadBestSellerData(start, end);
        }
    } catch (err) {
        console.error("Error loading report:", err);
        showEmptyState(err.message || 'Gagal memuat data laporan', 'error');
    } finally {
        clearTimeout(timeout);
    }
}

async function loadBestSellerData(start, end) {
    try {
        console.log('Fetching best seller data for:', start, 'to', end);
        const res = await fetch(`/report/best_seller?start_date=${start}&end_date=${end}`);
        
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.detail || "Gagal mengambil data best seller");
        }
        
        const data = await res.json();
        console.log('Best seller data received:', data);

        const previousType = currentDataType;
        currentDataType = 'best';

        if (data.best_sellers && data.best_sellers.length > 0) {
            console.log('Best sellers found:', data.best_sellers.length);
            // Convert best seller data to chart format
            const chartData = data.best_sellers.map(item => ({
                menu_name: item.menu_name || 'N/A',
                quantity: item.total_quantity || 0,
                unit_price: item.unit_price || 0,
                total: item.total_revenue || 0
            }));
            
            // Calculate total revenue from best sellers
            const totalRevenue = data.best_sellers.reduce((sum, item) => sum + (item.total_revenue || 0), 0);
            
            // Update summary with best seller data
            updateSummaryWithData(data, 'best');
            applyModeLayout('best');

            const best = data.best_sellers;
            const newHash = computeDataHash(best);
            // Force refresh when switching from a different type
            if (newHash !== lastBestHash || previousType !== 'best') {
                lastBestHash = newHash;
                baseData = best;
                const tableSearch = document.getElementById('table-search-input');
                const term = tableSearch ? tableSearch.value : '';
                filteredData = term ? baseData.filter(i => (i.menu_name || '').toLowerCase().includes(term.toLowerCase())) : [...baseData];
                currentPage = 1;
                renderTablePage();
                updatePagination();
                renderCharts(chartData);
                // Update table header for best seller data
                const tableHeader = document.querySelector('#report-table thead tr');
                if (tableHeader) {
                    tableHeader.innerHTML = `
                        <th>No</th>
                        <th>Menu</th>
                        <th>Total Qty</th>
                        <th>Unit Price</th>
                        <th>Total Revenue</th>`;
                }
            }
        } else {
            console.log('No best seller data found');
            // Show empty chart and table
            renderCharts([]);
            baseData = [];
            filteredData = [];
            renderTablePage();
            updatePagination();
            updateSummaryWithData(data, 'empty');
            // Update table header for empty state
            const tableHeader = document.querySelector('#report-table thead tr');
            if (tableHeader) {
                tableHeader.innerHTML = `
                    <th>No</th>
                    <th>Menu</th>
                    <th>Total Qty</th>
                    <th>Unit Price</th>
                    <th>Total Revenue</th>`;
            }
        }

    } catch (err) {
        console.error("Error loading best seller data:", err);
        // Show error in table
        baseData = [];
        filteredData = [];
        renderTablePage();
        updatePagination();
        showEmptyState(err.message || 'Gagal memuat data best seller', 'error');
    }
}

async function loadTopCustomers(start, end, salesData, topMenu) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(`/report/top_customers?start_date=${start}&end_date=${end}`, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.detail || "Gagal ambil data loyal customer");
        }
        
        const data = await res.json();

        const ul = document.getElementById("loyal-list");
        ul.innerHTML = "";
        
        if (data && data.length > 0) {
        data.forEach((cust, i) => {
                ul.innerHTML += `
                    <li style="padding: 8px 0; border-bottom: 1px solid #F3F4F6; color: #312929;">
                        <strong>${cust.customer_name || 'N/A'}</strong> — ${cust.total_orders || 0}x | Rp ${(cust.total_spent || 0).toLocaleString()}
                    </li>`;
        });
        generateInsight(salesData, topMenu, data[0]);
        } else {
            ul.innerHTML = "<li style='padding: 8px 0; color: #6B7280; font-style: italic;'>Tidak ada data customer untuk periode ini.</li>";
            generateInsight(salesData, topMenu, null);
        }
        
    } catch (err) {
        console.error("Error loading top customers:", err);
        alert(`⚠️ ${err.message || "Gagal memuat data pelanggan loyal."}`);
    }
}

async function fetchSuggestedMenu() {
    const start = document.getElementById("start_date").value;
    const end = document.getElementById("end_date").value;
    
    try {
        const res = await fetch(`/report/suggested_menu?start_date=${start}&end_date=${end}`);
        
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.detail || "Gagal memuat data usulan menu");
        }
        
        const data = await res.json();
        
        const ul = document.getElementById("usulan-list");
        ul.innerHTML = "";
        
        if (data.length === 0) {
            ul.innerHTML = "<li style='padding: 8px 0; color: #6B7280; font-style: italic;'>Tidak ada usulan pada periode ini.</li>";
        } else {
            data.forEach((item) => {
                const date = new Date(item.last_suggested || new Date()).toLocaleString("id-ID");
                ul.innerHTML += `
                    <li style="padding: 8px 0; border-bottom: 1px solid #F3F4F6; color: #312929;">
                        <strong>${item.menu_name || 'N/A'}</strong> — ${item.usulan_count || 0}x (terakhir: ${date})
                    </li>`;
            });
        }
    } catch (err) {
        console.error("Error fetching suggested menu:", err);
        const ul = document.getElementById("usulan-list");
        ul.innerHTML = `<li style='padding: 8px 0; color: #B3261E; font-style: italic;'>Error: ${err.message}</li>`;
    }
}

// ========== EXPORT FUNCTIONS ==========
function exportCSV() {
    const rows = [["No", "Menu", "Qty", "Price", "Total"]];
    document.querySelectorAll("#report-tbody tr").forEach((tr, i) => {
        const cols = [...tr.children].map(td => td.innerText);
        if (cols.length > 1 && !cols[0].includes("Tidak ada data")) {
        rows.push([i + 1, ...cols.slice(1)]);
        }
    });
    
    if (rows.length <= 1) {
        alert("Tidak ada data untuk di-export!");
        return;
    }
    
    const csv = rows.map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan_penjualan_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
}

async function exportPDF() {
    try {
        const element = document.querySelector('.main-container') || document.body;
        const canvas = await html2canvas(element, { useCORS: true, scale: 2 });
        const imgData = canvas.toDataURL("image/png");

        // Use UMD global (robust detection)
        const jspdfGlobal = window.jspdf;
        const JS_PDF = (window.jsPDF && typeof window.jsPDF === 'function')
            ? window.jsPDF
            : (jspdfGlobal && typeof jspdfGlobal.jsPDF === 'function' ? jspdfGlobal.jsPDF : null);
        if (!JS_PDF) {
            throw new Error('jsPDF tidak tersedia atau tidak valid');
        }
        const pdf = new JS_PDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save(`laporan_penjualan_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
        console.error("Error exporting PDF:", err);
        alert("❌ Gagal export PDF. Pastikan koneksi internet stabil.");
    }
}

// ========== PAGINATION FUNCTIONS ==========
function changePage(direction) {
    const newPage = currentPage + direction;
    const maxPage = Math.ceil(filteredData.length / itemsPerPage);
    
    if (newPage >= 1 && newPage <= maxPage) {
        currentPage = newPage;
        renderTablePage();
        updatePagination();
    }
}

function renderTablePage() {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageData = filteredData.slice(startIndex, endIndex);
    
    const tbody = document.getElementById("report-tbody");
    tbody.innerHTML = "";
    
    if (pageData.length > 0) {
        pageData.forEach((item, i) => {
            const actualIndex = startIndex + i;
            if (currentDataType === 'ingredient') {
                // Debug: log the item being rendered
                console.log('Rendering ingredient item:', item);
                console.log('Item has menu_name:', !!item.menu_name, 'Item has flavor:', !!item.flavor);
                
                // Check if this is logs view (has menu_name and flavor) or daily view
                if (item.menu_name && item.flavor !== undefined) {
                    console.log('Using logs view format');
                    // Logs view - show menu, flavor, and detail button
                    tbody.innerHTML += `
                        <tr onclick="openGroupedConsumptionModal('${(item.order_ids || []).join(',')}', '${item.date || ''}', '${item.status_text || ''}', '${item.menu_name || ''}', '${item.flavor || ''}')" style="cursor: pointer;">
                            <td>${actualIndex + 1}</td>
                            <td>${item.menu_name || '-'}</td>
                            <td>${item.flavor || 'Default'}</td>
                            <td>${item.date || '-'}</td>
                            <td>${item.status_text || '-'}</td>
                            <td>${(item.ingredients_affected ?? 0).toLocaleString()}</td>
                            <td>
                                <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); openGroupedConsumptionModal('${(item.order_ids || []).join(',')}', '${item.date || ''}', '${item.status_text || ''}', '${item.menu_name || ''}', '${item.flavor || ''}')" title="Lihat Detail">
                                    <i class="fas fa-eye"></i> Detail
                                </button>
                            </td>
                        </tr>`;
                } else {
                    console.log('Using daily view format');
                    // Daily view - show aggregated data with detail button
                    const dailySummary = item.daily_summary || {};
                    const totalOrders = dailySummary.total_orders || 0;
                    const uniqueMenus = dailySummary.unique_menus || 0;
                    const totalConsumption = dailySummary.total_consumption || 0;
                    
                    tbody.innerHTML += `
                        <tr onclick="viewConsumptionDetails('Daily-${item.date || ''}', '${item.date || ''}', '${item.status_text || ''}')" style="cursor: pointer;">
                            <td>${actualIndex + 1}</td>
                            <td style="font-weight: 600; color: #1F2937;">${item.date || '-'}</td>
                            <td style="color: #6B7280; line-height: 1.4;">
                                <div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center;">
                                    <span style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; padding:.2rem .5rem; border-radius:9999px; font-weight:600;">${totalOrders} pesanan</span>
                                    <span style="background:#F5F3FF; color:#4C1D95; border:1px solid #DDD6FE; padding:.2rem .5rem; border-radius:9999px; font-weight:600;">${uniqueMenus} menu unik</span>
                                </div>
                            </td>
                            <td style="text-align: center; font-weight: 600; color: #059669;">${totalOrders.toLocaleString()}</td>
                            <td style="text-align: center; font-weight: 600; color: #DC2626;">${totalConsumption.toLocaleString()}</td>
                            <td>
                                <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); viewConsumptionDetails('Daily-${item.date || ''}', '${item.date || ''}', '${item.status_text || ''}')" style="white-space: nowrap; min-width: 80px;">
                                    🔍 Detail
                                </button>
                            </td>
                        </tr>`;
                }
            } else {
                // Sales or Best Seller data
                console.log('Rendering sales/best seller item:', item);
                tbody.innerHTML += `
                    <tr>
                        <td>${actualIndex + 1}</td>
                        <td>${item.menu_name || 'N/A'}</td>
                        <td>${item.quantity || item.total_quantity || 0}</td>
                        <td>Rp ${(item.unit_price || 0).toLocaleString()}</td>
                        <td>Rp ${(item.total || item.total_revenue || 0).toLocaleString()}</td>
                    </tr>`;
            }
        });
        // Totals row for daily view (UX clarity)
        if (currentDataType === 'ingredient' && pageData[0] && !pageData[0].menu_name) {
            const totals = pageData.reduce((acc, it) => {
                const s = it.daily_summary || {}; 
                acc.orders += (s.total_orders || 0);
                acc.ingredients += (s.total_consumption || 0);
                return acc;
            }, { orders: 0, ingredients: 0 });
            tbody.innerHTML += `
                <tr style="background:#F9FAFB; font-weight:600;">
                    <td colspan="3" style="text-align:right; padding-right:8px;">Total Halaman</td>
                    <td style="text-align:center; color:#059669;">${totals.orders.toLocaleString()}</td>
                    <td style="text-align:center; color:#DC2626;">${totals.ingredients.toLocaleString()}</td>
                    <td></td>
                </tr>`;
        }
    } else {
        // No data to display
        const message = currentDataType === 'ingredient' 
            ? 'Tidak ada data konsumsi bahan untuk periode ini'
            : currentDataType === 'best' 
                ? 'Tidak ada data best seller untuk periode ini'
                : 'Tidak ada data penjualan untuk periode ini';
        
        showEmptyState(message, 'info');
    }
    
    // Update pagination info
    document.getElementById("pagination-start").textContent = startIndex + 1;
    document.getElementById("pagination-end").textContent = Math.min(endIndex, filteredData.length);
    document.getElementById("pagination-total").textContent = filteredData.length;
}
    
    function updatePagination() {
        const maxPage = Math.ceil(filteredData.length / itemsPerPage);
        const pageNumbers = document.getElementById("page-numbers");
        const prevBtn = document.getElementById("prev-page");
        const nextBtn = document.getElementById("next-page");
        
        // Update button states
        prevBtn.disabled = currentPage === 1;
        nextBtn.disabled = currentPage === maxPage;
        
        // Generate page numbers
        pageNumbers.innerHTML = "";
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(maxPage, currentPage + 2);
        
        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement("button");
            pageBtn.className = `page-number ${i === currentPage ? 'active' : ''}`;
            pageBtn.textContent = i;
            pageBtn.onclick = () => {
                currentPage = i;
                renderTablePage();
                updatePagination();
            };
            pageNumbers.appendChild(pageBtn);
        }
    }
    
    // ========== SEARCH FUNCTIONS ==========
    function filterTableData(searchTerm) {
    if (!baseData) return;
    const source = Array.isArray(baseData) ? baseData : [];
    const term = (searchTerm || '').toLowerCase();
    if (currentDataType === 'ingredient') {
        filteredData = term
            ? source.filter(item => 
                (item.menu_name || '').toLowerCase().includes(term) || 
                (item.flavor || '').toLowerCase().includes(term) ||
                (item.order_id || '').toLowerCase().includes(term) || 
                (item.date || '').toLowerCase().includes(term) || 
                (item.status_text || '').toLowerCase().includes(term)
            )
            : [...source];
    } else {
    filteredData = term
        ? source.filter(item => (item.menu_name || '').toLowerCase().includes(term))
        : [...source];
    }
    
    currentPage = 1;
    renderTablePage();
    updatePagination();
}

function filterIngredientTableData(searchTerm) {
    const term = (searchTerm || '').toLowerCase();
    const tbody = document.getElementById('ingredient-table-body');
    if (!tbody) return;
    const filtered = Object.values(variantConsumption).filter(v =>
        v.menuName.toLowerCase().includes(term) || (v.flavorName || '').toLowerCase().includes(term)
    );
    const rows = filtered.map((v, idx) => {
        const ingList = Object.entries(v.ingredients).map(([ingId, info]) => {
            const ing = ingredientData[ingId];
            const name = ing ? ing.name : `ID ${ingId}`;
            return `${name} (${(info.totalQuantity || 0).toFixed(2)} ${info.unit || ''})`;
        }).join(', ');
        return `
            <tr>
                <td>${idx + 1}</td>
                <td>${v.menuName}</td>
                <td>${v.flavorName}</td>
                <td>${v.orderQty}</td>
                <td>${ingList || '-'}</td>
            </tr>
        `;
    }).join('');
    tbody.innerHTML = rows;
}

function toggleReportFilter() {
    const dd = document.getElementById('report-filter-dropdown');
    if (!dd) return;
    dd.classList.toggle('show');
}

function applyReportFilter() {
    const dataTypeSelect = document.getElementById('data-type-select');
    const sortSelect = document.getElementById('sort-select');
    
    if (dataTypeSelect) {
        const dataType = dataTypeSelect.value;
        
        if (dataType === 'ingredient') {
            // Load ingredient analysis data
            loadIngredientAnalysisData();
            applyIngredientModeLayout();
            toggleReportFilter();
            return;
        } else {
            // Reset to normal mode when switching from ingredient to sales/best
            resetToNormalMode();
            // Apply the correct mode layout based on data type
            if (dataType === 'best') {
                applyModeLayout('best');
            } else {
                applyModeLayout('sales');
            }
        }
    }
    
    if (sortSelect && filteredData && filteredData.length) {
        const val = sortSelect.value;
        if (currentDataType === 'ingredient') {
            filteredData.sort((a, b) => {
                if (val === 'name') return (a.order_id || '').localeCompare(b.order_id || '');
                if (val === 'qty') return (b.ingredients_affected ?? 0) - (a.ingredients_affected ?? 0);
                if (val === 'total') return (b.total_qty ?? 0) - (a.total_qty ?? 0);
                return 0;
            });
        } else {
        filteredData.sort((a, b) => {
            if (val === 'name') {
                return (a.menu_name || '').localeCompare(b.menu_name || '');
            }
            if (val === 'qty') {
                const qa = a.quantity ?? a.total_quantity ?? 0;
                const qb = b.quantity ?? b.total_quantity ?? 0;
                return qb - qa; // desc
            }
            if (val === 'total') {
                const ta = a.total ?? a.total_revenue ?? 0;
                const tb = b.total ?? b.total_revenue ?? 0;
                return tb - ta; // desc
            }
            return 0;
        });
        }
        currentPage = 1;
        renderTablePage();
        updatePagination();
    }
    
    // Handle ingredient mode sorting
    const dataType = document.getElementById('data-type-select')?.value || 'sales';
    if (dataType === 'ingredient' && sortSelect && menuRecipes) {
        const val = sortSelect.value;
        const sortedMenus = Object.entries(menuRecipes).sort(([, recipesA], [, recipesB]) => {
            if (val === 'name') {
                return recipesA[0]?.menu_name || ''.localeCompare(recipesB[0]?.menu_name || '');
            }
            if (val === 'ingredients') {
                return recipesB.length - recipesA.length; // desc
            }
            if (val === 'quantity') {
                const totalA = recipesA.reduce((sum, recipe) => sum + recipe.quantity, 0);
                const totalB = recipesB.reduce((sum, recipe) => sum + recipe.quantity, 0);
                return totalB - totalA; // desc
            }
            return 0;
        });
        
        // Update ingredient table with sorted data
        const tbody = document.getElementById('ingredient-table-body');
        if (tbody) {
            const menuData = sortedMenus.map(([menuName, recipes], index) => {
                const totalIngredients = recipes.length;
                const totalQuantity = recipes.reduce((sum, recipe) => sum + recipe.quantity, 0);
                const mainIngredient = recipes.length > 0 ? 
                    (ingredientData[recipes[0].ingredient_id] ? ingredientData[recipes[0].ingredient_id].name : `ID ${recipes[0].ingredient_id}`) : 
                    'Tidak ada data';
                
                return `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${menuName}</td>
                        <td>${totalIngredients}</td>
                        <td>${totalQuantity.toFixed(2)}</td>
                        <td>${mainIngredient}</td>
                        <td>
                            <button onclick="viewMenuIngredients('${menuName}')" class="btn-secondary btn-sm">
                                📋 Detail Bahan
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
            
            tbody.innerHTML = menuData;
        }
    }
    toggleReportFilter();
}

function clearReportFilter() {
    const sortSelect = document.getElementById('sort-select');
    const dataTypeSelect = document.getElementById('data-type-select');
    if (sortSelect) sortSelect.value = 'name';
    if (dataTypeSelect) dataTypeSelect.value = 'sales';
    // Re-load sales view by default
    const start = document.getElementById("start_date").value;
    const end = document.getElementById("end_date").value;
    resetToNormalMode();
    loadReport(start, end);
    applyModeLayout('sales');
    toggleReportFilter();
}

function resetToNormalMode() {
    // Reset all UI elements to normal mode
    const chartBar = document.getElementById('chart-bar-card');
    const chartPie = document.getElementById('chart-pie-card');
    const loyal = null;
    const usulan = null;
    const tableHeader = document.querySelector('#report-table thead tr');
    const statusEl = document.getElementById('summary-status-badge');
    const barTitle = document.querySelector('#chart-bar-card .column-title');
    const pieTitle = document.querySelector('#chart-pie-card .column-title');
    const ingredientViewContainer = document.getElementById('ingredient-view-container');
    
    // Show all cards with proper display style
    if (chartBar) chartBar.style.display = 'flex';
    if (chartPie) chartPie.style.display = 'flex';
    if (loyal) loyal.style.display = 'flex';
    if (usulan) usulan.style.display = 'flex';
    
    // Reset table header
    if (tableHeader) {
        tableHeader.innerHTML = `
            <th>No</th>
            <th>Menu</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
        `;
    }
    
    // Reset titles
    if (barTitle) barTitle.textContent = '📊 Top Menu Terlaris';
    if (pieTitle) pieTitle.textContent = '🥧 Komposisi Penjualan';
    
    // Hide ingredient view container
    if (ingredientViewContainer) ingredientViewContainer.style.display = 'none';
    
    // Reset status badge
    if (statusEl) {
        statusEl.textContent = 'Data Sales';
        statusEl.className = 'status-badge status-deliver';
    }
    
    // Clear ingredient details panel
    const ingredientDetailsPanel = document.getElementById('ingredient-details-panel');
    if (ingredientDetailsPanel) ingredientDetailsPanel.classList.add('hidden');
    
    // Reset current data type
    currentDataType = 'sales';
}

function applyIngredientModeLayout() {
    const chartBar = document.getElementById('chart-bar-card');
    const chartPie = document.getElementById('chart-pie-card');
    const loyal = null;
    const usulan = null;
    const tableHeader = document.querySelector('#report-table thead tr');
    const statusEl = document.getElementById('summary-status-badge');
    const barTitle = document.querySelector('#chart-bar-card .column-title');

    if (statusEl) {
        statusEl.textContent = 'Analisis Bahan';
        statusEl.className = 'status-badge status-making';
    }

    // Show ingredient view mode selector
    const viewContainer = document.getElementById('ingredient-view-container');
    if (viewContainer) viewContainer.style.display = 'flex';

    // Update table header based on view mode
    updateIngredientTableHeader();

    if (chartBar) chartBar.style.display = 'flex';
    if (chartPie) chartPie.style.display = 'flex';
    if (loyal) loyal.style.display = 'none';
    if (usulan) usulan.style.display = 'none';
}

function updateIngredientTableHeader() {
    const tableHeader = document.querySelector('#report-table thead tr');
        const viewSelect = document.getElementById('ingredient-view-select');
        const viewMode = viewSelect ? viewSelect.value : 'daily';
        
    if (tableHeader) {
        if (viewMode === 'logs') {
            tableHeader.innerHTML = `
                <th>No</th>
                <th>Nama Menu</th>
                <th>Flavor</th>
                <th>Tanggal</th>
                <th>Status</th>
                <th>Total Bahan</th>
                <th>Aksi</th>
            `;
                 } else {
             tableHeader.innerHTML = `
                 <th>No</th>
                 <th>Tanggal</th>
                 <th>Ringkasan Harian</th>
                 <th>Total Pesanan</th>
                 <th>Total Bahan Terpakai</th>
                 <th>Aksi</th>
             `;
         }
    }
}

function applyModeLayout(mode) {
    const isBest = mode === 'best';
    const chartBar = document.getElementById('chart-bar-card');
    const chartPie = document.getElementById('chart-pie-card');
    const loyal = null;
    const usulan = null;
    const tableHeader = document.querySelector('#report-table thead tr');
    const statusEl = document.getElementById('summary-status-badge');
    const dataTypeSelect = document.getElementById('data-type-select');
    const barTitle = document.querySelector('#chart-bar-card .column-title');

    // Summary badge
    if (statusEl) {
        statusEl.textContent = isBest ? 'Best Seller' : 'Data Sales';
        statusEl.className = `status-badge ${isBest ? 'status-warning' : 'status-deliver'}`;
    }

    // Sync dropdown and state
    if (dataTypeSelect && dataTypeSelect.value !== (isBest ? 'best' : 'sales')) {
        dataTypeSelect.value = isBest ? 'best' : 'sales';
    }
    currentDataType = isBest ? 'best' : 'sales';

    // Table header
    if (tableHeader) {
        tableHeader.innerHTML = isBest ? `
            <th>No</th>
            <th>Menu</th>
            <th>Total Qty</th>
            <th>Unit Price</th>
            <th>Total Revenue</th>
        ` : `
            <th>No</th>
            <th>Menu</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
        `;
    }

    // Hide ingredient view selector when not in ingredient mode
    const viewContainer = document.getElementById('ingredient-view-container');
    if (viewContainer) viewContainer.style.display = 'none';

    // Layout visibility
    if (chartBar) chartBar.style.display = 'flex';
    if (chartPie) chartPie.style.display = isBest ? 'none' : 'flex';
    if (loyal) loyal.style.display = isBest ? 'none' : 'flex';
    if (usulan) usulan.style.display = isBest ? 'none' : 'flex';

    // Bar chart title per mode
    if (barTitle) {
        barTitle.textContent = isBest ? '🏆 Top Menu Terlaris (Best Seller)' : '📊 Top Menu Terlaris';
    }

    // Ensure charts resize correctly after visibility changes
    setTimeout(() => {
        try {
            if (barChart) barChart.resize();
            if (pieChart) {
                // Adjust pie legend position based on new width
                const pieCanvas = document.getElementById('pieChart');
                if (pieCanvas && pieChart.options && pieChart.options.plugins && pieChart.options.plugins.legend) {
                    pieChart.options.plugins.legend.position = (pieCanvas.parentElement && pieCanvas.parentElement.clientWidth < 640) ? 'bottom' : 'right';
                }
                pieChart.resize();
            }
        } catch (_) {}
    }, 0);
}

function onIngredientViewChange() {
    if (currentDataType === 'ingredient') {
        // Update table header first
        updateIngredientTableHeader();
        // Then reload data
        loadIngredientAnalysisData();
    }
}
    
// Real-time auto refresh (~5s) with visibility + in-flight guard
let autoRefreshTimer = null;
function performRefresh() {
    if (isRefreshing || document.hidden) return;
    isRefreshing = true;
    const start = document.getElementById("start_date").value;
    const end = document.getElementById("end_date").value;
    const dataType = document.getElementById('data-type-select')?.value || 'sales';
    const done = () => { isRefreshing = false; };
    if (dataType === 'best') {
        loadBestSellerData(start, end).finally(done);
    } else if (dataType === 'ingredient') {
        loadIngredientAnalysisData().finally(done);
    } else {
        loadReport().finally(done);
    }
    // Update chart titles for clarity in ingredient mode
    const barTitleEl = document.querySelector('#chart-bar-card .column-title');
    if (barTitleEl) barTitleEl.textContent = '📊 Konsumsi Bahan Harian';
    const pieTitleEl = document.querySelector('#chart-pie-card .column-title');
    if (pieTitleEl) pieTitleEl.textContent = '🥧 Komposisi Konsumsi';
}
function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    if (!autoRefreshEnabled) return;
    autoRefreshTimer = setInterval(performRefresh, 15000);
}
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) performRefresh();
});

    // ========== EVENT LISTENERS ==========
    document.addEventListener('DOMContentLoaded', function() {
        // Debounced window resize to keep charts responsive (esp. >765px)
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                try {
                    if (barChart) barChart.resize();
                    if (pieChart) pieChart.resize();
                } catch (_) {}
            }, 150);
        });
        // Add menu filter event listener
        const menuFilter = document.getElementById("menu-filter");
        if (menuFilter) {
            menuFilter.addEventListener('input', function() {
                // Auto-filter after 500ms delay
                clearTimeout(this.filterTimeout);
                this.filterTimeout = setTimeout(() => {
                    // Server-side filter for Data Sales via menu_name
                    const dataType = document.getElementById('data-type-select')?.value || 'sales';
                    if (dataType === 'best') {
                        // Best seller tidak memakai menu_name; fallback ke client-side filter
                        filterTableData(this.value);
                    } else if (dataType === 'ingredient') {
                        // Ingredient analysis: filter client-side
                        filterIngredientTableData(this.value);
                    } else {
                        // Sales: reload dari server dengan menu_name
                        loadReport();
                    }
                }, 500);
            });
        }

        // Table search input
        const tableSearch = document.getElementById('table-search-input');
        if (tableSearch) {
            tableSearch.addEventListener('input', function() {
                clearTimeout(this.filterTimeout);
                this.filterTimeout = setTimeout(() => {
                    lastUserInputAt = Date.now();
                    const dataType = document.getElementById('data-type-select')?.value || 'sales';
                    if (dataType === 'ingredient') {
                        filterIngredientTableData(this.value);
                    } else {
                        filterTableData(this.value);
                    }
                }, 300);
            });
        }

        // Entries per page select
        const entriesSelect = document.getElementById('entries-per-page');
        if (entriesSelect) {
            entriesSelect.addEventListener('change', function() {
                itemsPerPage = parseInt(this.value, 10) || 10;
                currentPage = 1;
                const dataType = document.getElementById('data-type-select')?.value || 'sales';
                if (dataType === 'ingredient') {
                    // For ingredient mode, we don't use pagination, so just re-render the table
                    renderIngredientTable();
                } else {
                    renderTablePage();
                    updatePagination();
                }
            });
        }

        // Data type select (Sales / Best Seller / Ingredient Analysis)
        const dataTypeSelect = document.getElementById('data-type-select');
        if (dataTypeSelect) {
            dataTypeSelect.addEventListener('change', async function() {
                const start = document.getElementById("start_date").value;
                const end = document.getElementById("end_date").value;
                if (this.value === 'best') {
                    resetToNormalMode();
                    await loadBestSellerData(start, end);
                    applyModeLayout('best');
                } else if (this.value === 'ingredient') {
                    await loadIngredientAnalysisData();
                    applyIngredientModeLayout();
                } else {
                    resetToNormalMode();
                    await loadReport();
                    applyModeLayout('sales');
                }
            });
        }

        // Auto refresh start
        startAutoRefresh();

        // Kitchen status filter
        const kitchenStatusFilter = document.getElementById('kitchen-status-filter');
        if (kitchenStatusFilter) {
            kitchenStatusFilter.addEventListener('change', function() {
                renderKitchenTable();
            });
        }

        // Ingredient analysis date filters
        const ingredientStartDate = document.getElementById('ingredient-start-date');
        const ingredientEndDate = document.getElementById('ingredient-end-date');
        if (ingredientStartDate) {
            ingredientStartDate.addEventListener('change', function() {
                loadIngredientAnalysisData();
            });
        }
        if (ingredientEndDate) {
            ingredientEndDate.addEventListener('change', function() {
                loadIngredientAnalysisData();
            });
        }

        // Refresh on date change
        const startInput = document.getElementById('start_date');
        const endInput = document.getElementById('end_date');
        const onDateChange = () => {
            currentPage = 1;
            const dataType = document.getElementById('data-type-select')?.value || 'sales';
            if (dataType === 'best') {
                loadBestSellerData(startInput.value, endInput.value);
            } else if (dataType === 'ingredient') {
                loadIngredientAnalysisData();
            } else {
                loadReport();
            }
        };
        if (startInput) startInput.addEventListener('change', onDateChange);
        if (endInput) endInput.addEventListener('change', onDateChange);
    });
    
    // ========== INITIALIZATION ==========
window.onload = () => {
    console.log('Window loaded, initializing report page...');
    const today = new Date().toISOString().split('T')[0];
    const startDateInput = document.getElementById("start_date");
    const endDateInput = document.getElementById("end_date");
    
    if (startDateInput && endDateInput) {
        startDateInput.value = today;
        endDateInput.value = today;
        console.log('Set default dates:', today);
        
        // Load initial data
        setTimeout(() => {
            console.log('Loading initial report data...');
            loadReport();
        }, 100);
    } else {
        console.error('Date input elements not found');
    }
    
    startAutoRefresh();
};

function getItemFlavorRaw(item) {
    if (!item || typeof item !== 'object') return '';
    // Preferred explicit fields
    const direct = item.flavor || item.rasa || item.flavour || item.variant || item.variation || item.taste;
    if (direct) return String(direct);
    // Fallback: scan keys that look like flavor
    for (const k of Object.keys(item)) {
        const low = k.toLowerCase();
        if (low.includes('flavor') || low.includes('flavour') || low.includes('rasa') || low.includes('variant')) {
            const val = item[k];
            if (val) return String(val);
        }
    }
    return '';
}

function normalizeFlavorForKey(raw) {
    return (raw || '').trim();
}

async function openGroupedConsumptionModal(orderIdsCsv, dateStr, statusText, menuName, flavorName) {
    try {
        console.log('openGroupedConsumptionModal called with:', { orderIdsCsv, dateStr, statusText, menuName, flavorName });
        const orderIds = String(orderIdsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
        console.log('Parsed order IDs:', orderIds);
        const matches = (kitchenOrdersCache || []).filter(o => orderIds.includes(String(o.order_id)));
        console.log('Found matches:', matches);
        console.log('kitchenOrdersCache length:', kitchenOrdersCache.length);

        const modal = document.getElementById('ingredient-modal');
        const modalBody = document.getElementById('ingredient-modal-body');
        if (!modal || !modalBody) {
            console.error('Modal elements not found:', { modal: !!modal, modalBody: !!modalBody });
            return;
        }

        // Build table rows for orders
        const tableRows = matches.map((o, idx) => {
            const ts = o.time_done || o.time_receive || '';
            const items = (o.items || []).map(it => `${it.menu_name}${it.preference ? ' (' + it.preference + ')' : ''} x${it.quantity}`).join(', ');
            const displayDate = new Date(ts).toLocaleString('id-ID') || '-';
            
            return `
                <tr style="border-bottom: 1px solid #F3F4F6;">
                    <td style="padding: 0.75rem; color: #1F2937; font-weight: 500; text-align: center; min-width: 50px;">${idx + 1}</td>
                    <td style="padding: 0.75rem; color: #1F2937; font-weight: 600; font-family: 'Courier New', monospace; min-width: 120px; word-break: break-all;">Order ${o.order_id}</td>
                    <td style="padding: 0.75rem; color: #1F2937; font-weight: 500; text-align: center; min-width: 140px; white-space: nowrap;">${displayDate}</td>
                    <td style="padding: 0.75rem; color: #1F2937; font-weight: 500; line-height: 1.4; min-width: 200px; word-wrap: break-word;">${items || '-'}</td>
                    <td style="padding: 0.75rem; color: #1F2937; text-align: center; min-width: 150px;">
                        <button class="btn-secondary btn-sm" onclick="closeModalAndViewConsumption('${o.order_id}', '${dateStr || ''}', '${statusText || ''}')" style="white-space: nowrap; min-width: 120px;">
                            🔍 Lihat Log
                        </button>
                    </td>
                </tr>`;
        }).join('');

        modalBody.innerHTML = `
            <div class="modal-title" style="margin-bottom: 1.5rem; font-size: 22px; font-weight: 700; color: #312929; text-align: center; padding-bottom: 1rem; border-bottom: 2px dashed rgba(68, 45, 29, 0.52); word-wrap: break-word;">
                🥤 ${menuName || 'Detail Pesanan'}${flavorName ? ' • ' + flavorName : ''}
            </div>
            <div class="summary-details" style="margin: 1rem 0 1.5rem 0; justify-content: center; flex-wrap: wrap; gap: 0.5rem;">
                <span class="summary-detail--order">📅 Tanggal: <strong>${dateStr || '-'}</strong></span>
                <span class="summary-detail--order">📊 Status: <strong>${statusText || ''}</strong></span>
            </div>
            <div class="table-container" style="margin-top: 0; border: 2px solid #DCD0A8; border-radius: 1rem; padding: 1rem; overflow: hidden;">
                <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
                    <table class="flavour-table" style="min-width: 600px; width: 100%; border-collapse: collapse; margin-top: 0;">
                        <thead>
                            <tr>
                                <th style="background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6; white-space: nowrap; min-width: 50px;">No</th>
                                <th style="background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6; white-space: nowrap; min-width: 120px;">Order ID</th>
                                <th style="background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6; white-space: nowrap; min-width: 140px;">Waktu</th>
                                <th style="background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6; min-width: 200px;">Items</th>
                                <th style="background-color: #DCD0A8; font-weight: 600; color: #442D2D; padding: 0.75rem; text-align: left; border-bottom: 1px solid #F3F4F6; white-space: nowrap; min-width: 150px;">Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows || '<tr><td colspan="5" style="text-align:center; color:#615a5a; padding: 1.5rem; font-weight: 500;">Tidak ada order yang cocok.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');
    } catch (e) {
        console.error('openGroupedConsumptionModal error:', e);
    }
}

function closeModalAndViewConsumption(orderId, dateStr, statusText) {
    // Close the modal first
    const modal = document.getElementById('ingredient-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // Then show consumption details and scroll to the panel
    setTimeout(() => {
        viewConsumptionDetails(orderId, dateStr, statusText);
        
        // Scroll to the ingredient details panel after it's shown
        setTimeout(() => {
            const panel = document.getElementById('ingredient-details-panel');
            if (panel && !panel.classList.contains('hidden')) {
                panel.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start',
                    inline: 'nearest'
                });
            }
        }, 200);
    }, 100);
}

function setIngredientViewHeader(viewMode) {
    const header = document.querySelector('#report-table thead tr');
    const statusEl = document.getElementById('summary-status-badge');
    if (header) {
        if (viewMode === 'daily') {
            header.innerHTML = `
                <th>No</th>
                <th>Tanggal</th>
                <th>Ringkasan Harian</th>
                <th>Total Pesanan</th>
                <th>Total Bahan Terpakai</th>
                <th>Aksi</th>`;
        } else {
            header.innerHTML = `
                <th>No</th>
                <th>Nama Menu</th>
                <th>Flavor</th>
                <th>Tanggal</th>
                <th>Status</th>
                <th>Total Bahan</th>
                <th>Aksi</th>`;
        }
    }
    if (statusEl) {
        statusEl.textContent = viewMode === 'daily' ? 'Analisis Bahan — Harian' : 'Analisis Bahan — Per-Order (Logs)';
        statusEl.className = 'status-badge status-deliver';
    }
}