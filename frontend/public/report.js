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
// let currentPage = 1;
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

//Pagination Variables
let reportCurrentPage = 1;
let reportPageSize = 10;

// Initialize jsPDF
if (window.jspdf && window.jspdf.jsPDF) {
    window.jsPDF = window.jspdf.jsPDF;
} else {
    console.error('jsPDF not found. Make sure the library is loaded.');
}
let reportTotalPages = 1;

// ================== DATE PARSING HELPERS (INGREDIENT ANALYSIS) ==================
// Semua fungsi ini dipakai untuk memastikan parsing tanggal konsisten tanpa efek timezone.
function _toIsoDateLocal(dateObj) {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return null;
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseAnyDateToIso(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.trim();
    // yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // dd/mm/yyyy
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
        const [dd, mm, yyyy] = s.split('/');
        return `${yyyy}-${mm}-${dd}`;
    }
    // Ambil bagian tanggal sebelum spasi (misal dd/mm/yyyy HH:MM)
    const head = s.split(/\s+/)[0];
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(head)) {
        const [dd, mm, yyyy] = head.split('/');
        return `${yyyy}-${mm}-${dd}`;
    }
    const dt = new Date(s);
    return _toIsoDateLocal(dt);
}

function getLogIsoDate(row) {
    if (!row || typeof row !== 'object') return null;
    const candidates = [row.date, row.created_at, row.updated_at, row.timestamp, row.time, row.time_done, row.time_receive];
    for (const c of candidates) {
        if (!c) continue;
        const iso = parseAnyDateToIso(String(c));
        if (iso) return iso;
    }
    return null;
}

// Validasi khusus rentang tanggal analisis bahan.
// Menghasilkan { valid: boolean, message?: string, fields: {start:boolean,end:boolean} }
function validateIngredientDateRange(startVal, endVal) {
    const res = { valid: true, message: '', fields: { start: false, end: false } };
    if (!startVal && !endVal) return res; // keduanya kosong: dianggap bebas
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (startVal && !dateRegex.test(startVal)) {
        res.valid = false; res.fields.start = true; res.message = 'Format tanggal awal tidak valid (harus yyyy-mm-dd).';
        return res;
    }
    if (endVal && !dateRegex.test(endVal)) {
        res.valid = false; res.fields.end = true; res.message = 'Format tanggal akhir tidak valid (harus yyyy-mm-dd).';
        return res;
    }
    if (startVal && endVal && startVal > endVal) {
        res.valid = false; res.fields.start = true; res.fields.end = true; res.message = 'Tanggal awal tidak boleh melebihi tanggal akhir.';
        return res;
    }
    return res;
}

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
    // Helper lokal untuk empty/error agar bisa dipakai di try & catch
    const handleEmptyOrError = (message) => {
        menuRecipes = {};
        menuConsumption = {};
        ingredientMenuFlavorGroups = {};
        const details = document.getElementById('ingredient-details');
        if (details) details.innerHTML = `<div class="ingredient-menu-item">${message}</div>`;
        baseData = { daily: [], logs: [] };
        const currentViewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
        filteredData = baseData[currentViewMode] || [];
        reportCurrentPage = 1;
        renderReportTable();
        updateReportPagination();
        updateIngredientSummary();
    };

    try {
        showLoading();
        currentDataType = 'ingredient';

        // (handleEmptyOrError sudah didefinisikan di atas scope try)
        
        // ========== Ambil & Validasi Rentang Tanggal (Analisis Bahan) ==========
        const startEl = document.getElementById('ingredient-start-date');
        const endEl = document.getElementById('ingredient-end-date');
        const globalStartEl = document.getElementById('start_date');
        const globalEndEl = document.getElementById('end_date');
        const startVal = (startEl && startEl.value) ? startEl.value : (globalStartEl && globalStartEl.value ? globalStartEl.value : '');
        const endVal = (endEl && endEl.value) ? endEl.value : (globalEndEl && globalEndEl.value ? globalEndEl.value : '');

        const validation = validateIngredientDateRange(startVal, endVal);
        [startEl, endEl].forEach(el => { if (el) el.classList.remove('input-error'); });
        if (!validation.valid) {
            if (validation.fields.start && startEl) startEl.classList.add('input-error');
            if (validation.fields.end && endEl) endEl.classList.add('input-error');
            handleEmptyOrError(validation.message || 'Rentang tanggal tidak valid');
            hideLoading();
            return;
        }
        const startDate = startVal ? new Date(startVal + 'T00:00:00') : null;
        const endDate = endVal ? new Date(endVal + 'T23:59:59') : null;
        
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
                
                // Determine ingredient view mode: daily vs logs
                const viewSelect = document.getElementById('ingredient-view-select');
                const viewMode = viewSelect ? viewSelect.value : 'daily';
                // Ambil tanggal dari input khusus ingredient, fallback ke global range jika kosong
                const globalStartEl = document.getElementById('start_date');
                const globalEndEl = document.getElementById('end_date');
                const startParam = (startEl && startEl.value) ? startEl.value : (globalStartEl && globalStartEl.value ? globalStartEl.value : null);
                const endParam = (endEl && endEl.value) ? endEl.value : (globalEndEl && globalEndEl.value ? globalEndEl.value : null);
                if (startParam && endParam && startParam > endParam) {
                    console.warn('[Ingredient] Rentang tanggal tidak valid: start > end');
                }
                let ingredientRows = [];
                let menuFlavorGroups = {}; // Initialize menuFlavorGroups for both view modes
                
                if (viewMode === 'daily') {
                    // Build from logs: group by date with better daily aggregation
                    // Sertakan start_date & end_date jika tersedia (backend boleh abaikan jika tidak didukung)
                    const qsDaily = new URLSearchParams({ limit: '500' });
                    if (startParam) qsDaily.append('start_date', startParam);
                    if (endParam) qsDaily.append('end_date', endParam);
                    const logsRes = await fetch(`/inventory/history?${qsDaily.toString()}`);
                    const logsJson = await logsRes.json().catch(() => ({ history: [] }));
                    const logs = Array.isArray(logsJson.history) ? logsJson.history : [];
                    
                    // Group logs by date with more comprehensive data
                    const byDate = {};
                    const addDailyAggregate = (map, displayDate, logRow) => {
                        if (!map[displayDate]) {
                            map[displayDate] = {
                                total_orders: 0,
                                ingredients_affected: 0,
                                unique_menus: new Set(),
                                total_consumption: 0,
                                order_ids: new Set()
                            };
                        }
                        map[displayDate].total_orders += 1;
                        map[displayDate].ingredients_affected += (logRow.ingredients_affected || 0);
                        map[displayDate].total_consumption += (logRow.ingredients_affected || 0);
                        map[displayDate].order_ids.add(logRow.order_id);
                    };

                    logs.forEach(l => {
                        const iso = getLogIsoDate(l);
                        if (!iso) { console.warn('[Ingredient-Daily] Gagal parse tanggal log', l); return; }
                        if (startParam && iso < startParam) return;
                        if (endParam && iso > endParam) return;
                        const displayDate = `${iso.split('-')[2]}/${iso.split('-')[1]}/${iso.split('-')[0]}`;
                        addDailyAggregate(byDate, displayDate, l);
                        // Try to get menu details from kitchen orders
                        const kitchenOrder = kitchenOrdersCache.find(o => o.order_id === l.order_id);
                        if (kitchenOrder && kitchenOrder.items) {
                            kitchenOrder.items.forEach(item => {
                                if (item.menu_name) byDate[displayDate].unique_menus.add(item.menu_name);
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
                        status_text: `${v.total_orders} order • ${v.unique_menus.size} menu`,
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
                        const iso = getLogIsoDate(log);
                        if (!iso) continue;
                        const rawDisplay = `${iso.split('-')[2]}/${iso.split('-')[1]}/${iso.split('-')[0]}`;
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
                    // Tambah query start/end jika ada
                    const qsLogs = new URLSearchParams({ limit: '100' });
                    if (startParam) qsLogs.set('start_date', startParam);
                    if (endParam) qsLogs.set('end_date', endParam);
                    logsUrl = `/inventory/history?${qsLogs.toString()}`;
                    const logsRes = await fetch(logsUrl);
                    const logsJson = await logsRes.json().catch(() => ({ history: [] }));
                    const logs = Array.isArray(logsJson.history) ? logsJson.history : [];
                    // Terapkan filter tanggal pada mode per-order (logs)
                    // Catatan: Backend mengembalikan format dd/mm/yyyy HH:MM, sehingga perlu konversi manual
                    // ke yyyy-mm-dd untuk perbandingan string konsisten tanpa efek timezone.
                    // Kita menghindari penggunaan Date+toISOString agar tidak terjadi pergeseran hari.
                    const filteredLogs = logs.filter(row => {
                        const iso = getLogIsoDate(row);
                        if (!iso) return false;
                        if (startParam && iso < startParam) return false;
                        if (endParam && iso > endParam) return false;
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

                        // Only include orders that are completed (done); skip cancelled and others
                        if (!kitchenOrder || kitchenOrder.status !== 'done') {
                            continue;
                        }
                        
                        if (!orderDetails[orderId]) {
                            orderDetails[orderId] = {
                                order_id: orderId,
                                date: log.date,
                                status: kitchenOrder.status,
                                status_text: 'Selesai',
                                ingredients_affected: log.ingredients_affected || 0,
                                menu_items: kitchenOrder.items || []
                            };
                        }
                        
                        console.log(`Log ${orderId} matched with kitchen order (status=${kitchenOrder.status}):`, 'YES');
                            console.log(`Kitchen order items for ${orderId}:`, kitchenOrder.items);
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
                        status_text: `${group.total_orders} order`,
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
                    status_text: `${group.total_orders} completed orders`,
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
                updateReportTableHeader();

                // Update status badge
                const statusEl = document.getElementById('summary-status-badge');
                if (statusEl) {
                  statusEl.textContent = currentViewMode === 'daily' ? 'Analisis Bahan — Harian' : 'Analisis Bahan — Per-Order (Logs)';
                  statusEl.className = 'status-badge status-deliver';
                }
                
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
                reportCurrentPage = 1;
                renderReportTable();
                updateReportPagination();
            } else {
                handleEmptyOrError('No recipe data available for analysis.');
            }
        } else {
            handleEmptyOrError('No completed order data for this period.');
        }
        
        hideLoading();
    } catch (error) {
        console.error('Error loading ingredient analysis data:', error);
        hideLoading();
        alert('Failed to load material analysis data.');
        
        handleEmptyOrError('Error occurred during data loading.');
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
        data: { labels, datasets: [{ label: 'Total Ingredients Used', data: totals, backgroundColor: '#DCD0A8', borderColor: '#C1B8A0', borderWidth: 1 }] },
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
                    <th>No</th>
                    <th>Menu</th>
                    <th>Flavor</th>
                    <th>Ingredients Total</th>
                    <th>Order Detail</th>`;
            }
             // Show aggregated daily consumption data
             await showDailyAggregatedConsumption(dateStr, statusText);
             return;
        } else {
            // Restore header for per-order ingredient details (6 columns)
            if (headRow) {
                headRow.innerHTML = `
                    <th>No</th>
                    <th>Ingredient Name</th>
                    <th>Qty Terpakai</th>
                    <th>Unit</th>
                    <th>Stok Sebelum</th>
                    <th>Stok Sesudah</th>`;
            }
        }

        const res = await fetch(`/report/order/${encodeURIComponent(orderId)}/ingredients`, { cache: 'no-store' });
        
        // Check if response is ok
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const json = await res.json();
        
        // Handle different possible response structures
        const details = json?.ingredients_breakdown?.details ||
                        json?.data?.ingredients_breakdown?.details ||
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
                    <td>${idx + 1}</td>
                    <td>${ingredientName}</td>
                    <td>${Number(quantityConsumed).toLocaleString()}</td>
                    <td>${unit}</td>
                    <td>${Number(stockBefore).toLocaleString()}</td>
                    <td>${Number(stockAfter).toLocaleString()}</td>
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
                 <td>${idx + 1}</td>
                 <td>${group.menu_name}</td>
                 <td>${group.flavor}</td>
                 <td>${group.total_ingredients.toLocaleString()}</td>
                 <td>${group.total_orders}</td>
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

// ========== INGREDIENT ANALYSIS EXPORT FUNCTIONS ==========
function exportIngredientExcel() {
    // Get current data based on the active view
    let exportData = [];
    let headers = [];
    
    if (document.getElementById('ingredient-daily-view').classList.contains('active')) {
        // Daily consumption view
        headers = ['No', 'Tanggal', 'Ringkasan', 'Total Pesanan', 'Total Konsumsi', 'Detail'];
        exportData = (Array.isArray(baseData) ? baseData : []).map((r, index) => [
            index + 1,
            r.date || '-',
            r.daily_summary ? `${r.daily_summary.total_orders || 0} pesanan, ${r.daily_summary.unique_menus || 0} menu unik` : '-',
            r.daily_summary?.total_orders || 0,
            r.daily_summary?.total_consumption || 0,
            'Lihat detail untuk informasi lengkap'
        ]);
    } else {
        // Grouped consumption view (logs)
        headers = ['No', 'Menu', 'Flavor', 'Tanggal', 'Status', 'Bahan Terpengaruh', 'Order IDs'];
        exportData = (Array.isArray(baseData) ? baseData : []).map((r, index) => [
            index + 1,
            r.menu_name || '-',
            r.flavor || '-',
            r.date || '-',
            r.status_text || '-',
            r.ingredients_affected ?? 0,
            Array.isArray(r.order_ids) ? r.order_ids.join(', ') : (r.order_id || '-')
        ]);
    }
    
    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...exportData]);
    
    // Set column widths
    const colWidths = headers.map((header, index) => {
        if (header.includes('Detail') || header.includes('Bahan yang Digunakan')) {
            return { wch: 50 };
        } else if (header.includes('Tanggal') || header.includes('Menu')) {
            return { wch: 25 };
        } else {
            return { wch: 15 };
        }
    });
    ws['!cols'] = colWidths;
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Ingredient Analysis');
    
    // Add summary sheet
    const summaryData = [
        ['Ingredient Analysis Summary'],
        [''],
        ['Total Records', exportData.length],
        ['Analysis Type', document.getElementById('ingredient-daily-view').classList.contains('active') ? 'Daily Consumption' : 'Grouped by Menu+Flavor'],
        [''],
        ['Generated on', new Date().toLocaleString('id-ID')]
    ];
    
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    
    // Save file
    const fileName = `ingredient_analysis_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
}
 
 function exportIngredientCSV() {
    // Export aligned with ingredient mode (daily history aggregation)
    let exportData = [];
    let headers = [];

    if (document.getElementById('ingredient-daily-view').classList.contains('active')) {
        // Daily consumption view
        headers = ['No', 'Tanggal', 'Order ID', 'Status', 'Total Bahan', 'Total Qty', 'Detail Bahan'];
        exportData = (Array.isArray(baseData) ? baseData : []).map((r, index) => [
            index + 1,
        r.date || '-',
            r.order_id || '-',
        r.status_text || '-',
        r.ingredients_affected ?? 0,
            r.total_qty ?? 0,
            r.ingredients_detail || '-'
        ]);
    } else {
        // Grouped consumption view
        headers = ['No', 'Menu + Flavor', 'Total Order', 'Bahan yang Digunakan'];
        exportData = Object.entries(ingredientMenuFlavorGroups).map(([key, data], index) => {
            const [menuName, flavorName] = key.split('|');
            const ingredients = Object.entries(data.ingredients || {})
                .map(([ingId, ingData]) => {
                    const ingredient = ingredientData[ingId];
                    return `${ingredient?.name || 'Unknown'}: ${ingData.totalQuantity} ${ingData.unit}`;
                })
                .join('; ');
            
            return [
                index + 1,
                `${menuName} (${flavorName})`,
                data.totalOrder || 0,
                ingredients || 'Tidak ada data'
            ];
        });
    }
    
    const csvContent = [
        headers,
        ...exportData
    ].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ingredient_analysis_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function exportIngredientPDF() {
    const isDaily = document.getElementById('ingredient-daily-view').classList.contains('active');
    const rows = Array.isArray(baseData) ? baseData : [];
    const startDate = (document.getElementById('ingredient-start-date')?.value) || '-';
    const endDate = (document.getElementById('ingredient-end-date')?.value) || '-';

    const jsPdfNs = (window.jspdf || window.jsPDF || null);
    const JSPDF_CTOR = jsPdfNs ? (jsPdfNs.jsPDF || jsPdfNs) : null;
    if (!JSPDF_CTOR) { alert('jsPDF tidak tersedia.'); return; }
    const doc = new JSPDF_CTOR('p','mm','a4');

    // Theme colors aligned with app
    const colorPrimary = [68, 45, 45]; // #442D2D
    const colorAccent = [220, 208, 168]; // #DCD0A8
    const colorBg = [245, 239, 230]; // #F5EFE6

    // Header
    doc.setFillColor(colorBg[0], colorBg[1], colorBg[2]);
    doc.rect(10, 10, 190, 18, 'F');
    doc.setFont('helvetica','bold');
    doc.setTextColor(colorPrimary[0], colorPrimary[1], colorPrimary[2]);
    doc.setFontSize(14);
    doc.text('Ingredient Analysis - Infinity Cafe', 14, 20);

    // Meta
    doc.setFont('helvetica','normal');
    doc.setFontSize(10);
    doc.text(`Periode: ${startDate} s/d ${endDate}`, 14, 30);
    doc.text(`Mode: ${isDaily ? 'Harian' : 'Per-Order (Logs)'}`, 120, 30);

    // Summary box
    let y = 38;
    doc.setDrawColor(colorAccent[0], colorAccent[1], colorAccent[2]);
    doc.setLineWidth(0.4);
    doc.rect(10, y, 190, 20);
    doc.setFont('helvetica','bold'); doc.text('Ringkasan', 14, y+7);
    doc.setFont('helvetica','normal');
    if (isDaily) {
        const totals = rows.reduce((acc, r)=>{ const ds=r.daily_summary||{}; acc.days++; acc.orders+=(ds.total_orders||0); acc.cons+=(ds.total_consumption||0); return acc;}, {days:0,orders:0,cons:0});
        doc.text(`Total Hari: ${totals.days}`, 14, y+14);
        doc.text(`Total Pesanan: ${totals.orders}`, 70, y+14);
        doc.text(`Total Konsumsi: ${totals.cons}`, 140, y+14);
    } else {
        const totals = rows.reduce((acc, r)=>{ acc.logs++; acc.aff+=(r.ingredients_affected||0); return acc;}, {logs:0,aff:0});
        doc.text(`Total Log: ${totals.logs}`, 14, y+14);
        doc.text(`Total Bahan Terpengaruh: ${totals.aff}`, 70, y+14);
    }
    y += 28;

    // Table using AutoTable for consistent layout
    const headers = isDaily
        ? ['No','Tanggal','Ringkasan','Total Pesanan','Total Konsumsi']
        : ['No','Menu','Flavor','Tanggal','Status','Bahan Terpengaruh'];
    const body = isDaily
        ? rows.map((r,i)=>[
            i+1,
            r.date || '-',
            r.daily_summary ? `${r.daily_summary.total_orders || 0} pesanan, ${r.daily_summary.unique_menus || 0} menu unik` : '-',
            r.daily_summary?.total_orders || 0,
            r.daily_summary?.total_consumption || 0
        ])
        : rows.map((r,i)=>[
            i+1,
            r.menu_name || '-',
            r.flavor || '-',
            r.date || '-',
            r.status_text || '-',
            r.ingredients_affected ?? 0
        ]);

    const auto = doc.autoTable || (doc.autoTable && typeof doc.autoTable === 'function');
    if (!doc.autoTable) { alert('AutoTable tidak tersedia.'); return; }
    doc.autoTable({
        startY: y,
        head: [headers],
        body,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, textColor: [68,45,45] },
        headStyles: { fillColor: colorAccent, textColor: [68,45,45], halign: 'left' },
        alternateRowStyles: { fillColor: [250, 247, 240] },
        tableLineColor: colorAccent,
        tableLineWidth: 0.2,
        margin: { left: 10, right: 10 }
    });

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(9);
        doc.setTextColor(120);
        doc.text(`Generated: ${new Date().toLocaleString('id-ID')}  |  Page ${i}/${pageCount}` , 10, 290);
    }

    doc.save(`ingredient_analysis_${new Date().toISOString().split('T')[0]}.pdf`);
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

// ========== EXPORT AGGREGATION UTILITIES ==========
function computeKitchenKPIs(allOrders) {
    const totals = { totalOrders: 0, done: 0, cancelled: 0, durations: [] };
    const statusCountMap = {};
    for (const order of (allOrders || [])) {
        totals.totalOrders += 1;
        statusCountMap[order.status] = (statusCountMap[order.status] || 0) + 1;
        if (order.status === 'done') totals.done += 1;
        if (order.status === 'cancelled') totals.cancelled += 1;
        if (order.time_receive && order.time_done) {
            const start = new Date(order.time_receive);
            const end = new Date(order.time_done);
            const diffMin = Math.max(0, Math.round((end - start) / 60000));
            if (Number.isFinite(diffMin)) totals.durations.push(diffMin);
        }
    }
    const avg = totals.durations.length ? Math.round(totals.durations.reduce((a,b)=>a+b,0)/totals.durations.length) : 0;
    const sorted = totals.durations.slice().sort((a,b)=>a-b);
    const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length-1)/2] : Math.round((sorted[sorted.length/2-1]+sorted[sorted.length/2])/2)) : 0;
    const p95 = sorted.length ? sorted[Math.min(sorted.length-1, Math.floor(0.95 * sorted.length))] : 0;
    const doneRate = totals.totalOrders ? Math.round((totals.done / totals.totalOrders) * 100) : 0;
    const cancelRate = totals.totalOrders ? Math.round((totals.cancelled / totals.totalOrders) * 100) : 0;
    return { statusCountMap, avgDurationMin: avg, medianDurationMin: median, p95DurationMin: p95, doneRatePct: doneRate, cancelRatePct: cancelRate };
}

function buildTopMenus(allOrders, limit = 10) {
    const menuCount = {};
    for (const order of (allOrders || [])) {
        if (!order.items) continue;
        for (const item of order.items) {
            const key = item.menu_name || 'Unknown';
            menuCount[key] = (menuCount[key] || 0) + (item.quantity || 0);
        }
    }
    const totalQty = Object.values(menuCount).reduce((a,b)=>a+b,0) || 1;
    return Object.entries(menuCount)
        .sort((a,b)=>b[1]-a[1])
        .slice(0, limit)
        .map(([menuName, qty]) => ({ menuName, totalQty: qty, contributionPct: Math.round((qty/totalQty)*100) }));
}

function buildTopIngredients(allOrders, limit = 10) {
    const ingredientTotals = {}; // { ingName: { qty, unit } }
    for (const order of (allOrders || [])) {
        const usage = getOrderIngredientUsage(order) || [];
        for (const u of usage) {
            const name = u.name || 'Unknown';
            if (!ingredientTotals[name]) ingredientTotals[name] = { qty: 0, unit: u.unit || '' };
            ingredientTotals[name].qty += Number(u.totalQuantity || 0);
            if (!ingredientTotals[name].unit && u.unit) ingredientTotals[name].unit = u.unit;
        }
    }
    const totalQty = Object.values(ingredientTotals).reduce((a,b)=>a + (b.qty||0), 0) || 1;
    return Object.entries(ingredientTotals)
        .map(([name, v]) => ({ ingredientName: name, totalQty: v.qty, unit: v.unit, contributionPct: Math.round((v.qty/totalQty)*100) }))
        .sort((a,b)=>b.totalQty-a.totalQty)
        .slice(0, limit);
}

function normalizeKitchenOrdersRaw(allOrders) {
    // One row per ordered menu item for analysis
    const rows = [];
    (allOrders || []).forEach((order) => {
        const base = {
            order_id: order.order_id,
            customer: order.customer_name || '',
            room: order.room_name || '',
            status: getStatusText(order.status),
            time_receive: order.time_receive || '',
            time_done: order.time_done || ''
        };
        if (order.items && order.items.length) {
            order.items.forEach((item) => {
                rows.push({
                    ...base,
                    menu_name: item.menu_name || 'Unknown',
                    quantity: item.quantity || 0
                });
            });
        } else {
            rows.push({ ...base, menu_name: order.detail || '-', quantity: 0 });
        }
    });
    return rows;
}

function normalizeKitchenIngredientLines(allOrders) {
    // One row per ingredient usage
    const rows = [];
    (allOrders || []).forEach((order) => {
        const usage = getOrderIngredientUsage(order) || [];
        usage.forEach((u) => {
            rows.push({
                order_id: order.order_id,
                status: getStatusText(order.status),
                ingredient: u.name || 'Unknown',
                total_qty: u.totalQuantity || 0,
                unit: u.unit || ''
            });
        });
    });
    return rows;
}

// ========== KITCHEN EXPORT FUNCTIONS ==========
function exportKitchenExcel() {
    const statusFilter = document.getElementById('kitchen-status-filter').value;
    const allOrders = Array.isArray(kitchenData) ? kitchenData : [];
    const filteredData = statusFilter ? allOrders.filter(o => o.status === statusFilter) : allOrders;
    
    // Prepare data for Excel (Orders Summary)
    const excelData = [
        ['No', 'Order ID', 'Customer', 'Room', 'Menu Items', 'Status', 'Time Receive', 'Time Done', 'Durasi (menit)']
    ];
    
    filteredData.forEach((order, index) => {
            const ingredientUsage = getOrderIngredientUsage(order);
        const ingredientSummary = ingredientUsage.length > 0 ? ingredientUsage.map(ing => `${ing.name} (${ing.totalQuantity} ${ing.unit})`).join('; ') : 'Tidak ada data bahan';
        
        // Calculate duration
        let duration = '-';
        if (order.time_receive && order.time_done) {
            const start = new Date(order.time_receive);
            const end = new Date(order.time_done);
            const diffMs = end - start;
            duration = Math.round(diffMs / (1000 * 60)); // Convert to minutes
        }
        
        excelData.push([
            index + 1,
                order.order_id,
                order.customer_name || '',
                order.room_name || '',
            order.items ? order.items.map(item => `${item.menu_name} (${item.quantity})`).join('; ') : order.detail || '-',
            getStatusText(order.status),
                order.time_receive || '',
            order.time_done || '',
            duration
        ]);
    });
    
    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(excelData);
    
    // Set column widths
    ws['!cols'] = [
        { wch: 5 },   // No
        { wch: 15 },  // Order ID
        { wch: 20 },  // Customer
        { wch: 15 },  // Room
        { wch: 40 },  // Menu Items
        { wch: 12 },  // Status
        { wch: 20 },  // Time Receive
        { wch: 20 },  // Time Done
        { wch: 12 }   // Durasi
    ];
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Orders Summary');
    
    // Executive Summary
    const kpis = computeKitchenKPIs(allOrders);
    const topMenus = buildTopMenus(allOrders, 10);
    const topIngredients = buildTopIngredients(allOrders, 10);
    const summaryData = [
        ['Kitchen Executive Summary'],
        ['Generated on', new Date().toLocaleString('id-ID')],
        ['Total Orders', allOrders.length],
        ['Done Rate (%)', kpis.doneRatePct],
        ['Cancel Rate (%)', kpis.cancelRatePct],
        ['Avg Duration (min)', kpis.avgDurationMin],
        ['Median Duration (min)', kpis.medianDurationMin],
        ['P95 Duration (min)', kpis.p95DurationMin],
        [''],
        ['Orders by Status'],
        ...Object.entries(kpis.statusCountMap).map(([s,c]) => [getStatusText(s), c]),
        [''],
        ['Top 10 Menus'],
        ['Menu Name','Total Qty','Contribution %'],
        ...topMenus.map(m => [m.menuName, m.totalQty, m.contributionPct]),
        [''],
        ['Top 10 Ingredients'],
        ['Ingredient','Total Qty','Unit','Contribution %'],
        ...topIngredients.map(i => [i.ingredientName, i.totalQty, i.unit, i.contributionPct])
    ];
    
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

    // Orders Raw (normalized per item)
    const ordersRawRows = normalizeKitchenOrdersRaw(allOrders);
    const ordersRawHeader = ['Order ID','Customer','Room','Status','Time Receive','Time Done','Menu Name','Quantity'];
    const ordersRawAoA = [ordersRawHeader, ...ordersRawRows.map(r => [r.order_id, r.customer, r.room, r.status, r.time_receive, r.time_done, r.menu_name, r.quantity])];
    const ordersRawWs = XLSX.utils.aoa_to_sheet(ordersRawAoA);
    XLSX.utils.book_append_sheet(wb, ordersRawWs, 'Orders Raw');

    // Ingredient Lines (normalized per ingredient)
    const ingLines = normalizeKitchenIngredientLines(allOrders);
    const ingHeader = ['Order ID','Status','Ingredient','Total Qty','Unit'];
    const ingAoA = [ingHeader, ...ingLines.map(r => [r.order_id, r.status, r.ingredient, r.total_qty, r.unit])];
    const ingWs = XLSX.utils.aoa_to_sheet(ingAoA);
    XLSX.utils.book_append_sheet(wb, ingWs, 'Ingredient Lines');
    
    // Save file
    const fileName = `kitchen_report_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
}

function exportKitchenCSV() {
    const statusFilter = document.getElementById('kitchen-status-filter').value;
    const allOrders = Array.isArray(kitchenData) ? kitchenData : [];
    const filteredData = statusFilter ? allOrders.filter(o => o.status === statusFilter) : allOrders;
    
    const kpis = computeKitchenKPIs(allOrders);
    const topMenus = buildTopMenus(allOrders, 5);
    const topIngredients = buildTopIngredients(allOrders, 5);
    
    const headerSummary = [
        ['Kitchen Executive Summary'],
        ['Generated on', new Date().toLocaleString('id-ID')],
        ['Total Orders', allOrders.length],
        ['Done Rate (%)', kpis.doneRatePct],
        ['Cancel Rate (%)', kpis.cancelRatePct],
        ['Avg Duration (min)', kpis.avgDurationMin],
        ['Median Duration (min)', kpis.medianDurationMin],
        ['P95 Duration (min)', kpis.p95DurationMin],
        [''],
        ['Orders by Status'],
        ...Object.entries(kpis.statusCountMap).map(([s,c]) => [getStatusText(s), c]),
        [''],
        ['Top 5 Menus'],
        ['Menu Name','Total Qty','Contribution %'],
        ...topMenus.map(m => [m.menuName, m.totalQty, m.contributionPct]),
        [''],
        ['Top 5 Ingredients'],
        ['Ingredient','Total Qty','Unit','Contribution %'],
        ...topIngredients.map(i => [i.ingredientName, i.totalQty, i.unit, i.contributionPct]),
        [''],
        ['Orders Summary'],
        ['No','Order ID','Customer','Room','Menu Items','Status','Time Receive','Time Done','Durasi (menit)']
    ];
    
    const dataRows = filteredData.map((order, index) => {
            const ingredientUsage = getOrderIngredientUsage(order);
            const ingredientSummary = ingredientUsage.length > 0 ? 
                ingredientUsage.map(ing => `${ing.name} (${ing.totalQuantity} ${ing.unit})`).join('; ') : 'Tidak ada data bahan';
            
            // Calculate duration
            let duration = '-';
            if (order.time_receive && order.time_done) {
                const start = new Date(order.time_receive);
                const end = new Date(order.time_done);
                const diffMs = end - start;
                duration = Math.round(diffMs / (1000 * 60)); // Convert to minutes
            }
            
            return [index + 1, order.order_id, order.customer_name || '', order.room_name || '', order.items ? order.items.map(item => `${item.menu_name} (${item.quantity})`).join('; ') : order.detail || '-', getStatusText(order.status), order.time_receive || '', order.time_done || '', duration];
    });
    
    const csvContent = [...headerSummary, ...dataRows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kitchen_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function exportKitchenPDF() {
    if (!window.jsPDF) {
        alert('Error: PDF library not loaded. Please refresh the page.');
        return;
    }

    try {
        // Create new PDF document
        const pdf = new window.jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });
        
        // Get filtered data
        const filterStatus = document.getElementById('kitchen-status-filter').value;
        const selectedOrders = filterStatus ? 
            kitchenData.filter(order => order.status === filterStatus) : 
            kitchenData;

        // Modern color scheme
        const colorTheme = {
            primary: [65, 46, 39],      // Dark brown
            accent: [179, 142, 93],     // Warm brown
            background: [245, 239, 230], // Soft cream
            text: [49, 41, 41],         // Dark gray
            lightText: [108, 117, 125],  // Medium gray
            status: {
                receive: [41, 128, 185],   // Blue
                making: [243, 156, 18],    // Orange
                deliver: [46, 204, 113],   // Green
                done: [39, 174, 96],       // Dark Green
                cancelled: [231, 76, 60],  // Red
                pending: [149, 165, 166]   // Gray
            }
        };

        // Header background
        pdf.setFillColor(...colorTheme.background);
        pdf.rect(0, 0, 297, 35, 'F');
        
        // Accent line
        pdf.setFillColor(...colorTheme.accent);
        pdf.rect(0, 35, 297, 2, 'F');

        // Title
        pdf.setFontSize(24);
        pdf.setTextColor(...colorTheme.primary);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Infinity Cafe', 20, 20);

        // Subtitle
        pdf.setFontSize(16);
        pdf.setTextColor(...colorTheme.text);
        pdf.text('Kitchen Report', 20, 30);

        // Report info
        pdf.setFontSize(10);
        pdf.setTextColor(...colorTheme.lightText);
        pdf.setFont('helvetica', 'normal');
        
        const pdfTimestamp = new Date().toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        pdf.text(`Generated: ${pdfTimestamp}`, 150, 20);
        pdf.text(`Total Orders: ${selectedOrders.length}`, 150, 30);
        
        if (filterStatus) {
            pdf.text(`Filter: ${getStatusText(filterStatus)}`, 240, 20);
        }

        // Order summary section
        let verticalPos = 50;
        const orderCounts = selectedOrders.reduce((acc, order) => {
            acc[order.status] = (acc[order.status] || 0) + 1;
            return acc;
        }, {});

        // Summary section header
        pdf.setFillColor(...colorTheme.primary);
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.rect(15, verticalPos - 6, 60, 8, 'F');
        pdf.text('Order Summary', 20, verticalPos);

        // Status cards
        verticalPos += 10;
        let cardX = 20;
        const card = {
            width: 50,
            height: 25,
            gap: 10
        };

        Object.entries(orderCounts).forEach(([status, count]) => {
            // Card background
            pdf.setFillColor(...colorTheme.background);
            pdf.rect(cardX, verticalPos, card.width, card.height, 'F');

            // Status label
            pdf.setTextColor(...colorTheme.primary);
            pdf.setFontSize(9);
            pdf.text(getStatusText(status), cardX + 5, verticalPos + 8);

            // Count value
            pdf.setTextColor(...colorTheme.accent);
            pdf.setFontSize(14);
            pdf.text(count.toString(), cardX + 5, verticalPos + 20);

            // "orders" label
            pdf.setTextColor(...colorTheme.lightText);
            pdf.setFontSize(8);
            pdf.text('orders', cardX + 15, verticalPos + 20);

            cardX += card.width + card.gap;
        });

        // Order details table
        verticalPos += card.height + 15;
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...colorTheme.primary);
        pdf.text('Order Details', 20, verticalPos);

        // Table headers
        verticalPos += 10;
        const tableColumns = ['No', 'Order ID', 'Customer', 'Menu Items', 'Status', 'Time Receive', 'Time Done'];
        const colWidths = [15, 30, 35, 85, 30, 35, 35];
        const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);
        let headerX = 20;

        // Header background
        pdf.setFillColor(...colorTheme.background);
        pdf.rect(headerX, verticalPos - 5, tableWidth, 10, 'F');

        // Header text
        pdf.setTextColor(...colorTheme.primary);
        pdf.setFontSize(9);
        tableColumns.forEach((header, index) => {
            pdf.text(header, headerX + 2, verticalPos);
            headerX += colWidths[index];
        });

        // Table rows
        verticalPos += 8;
        let rowNum = 1;
        selectedOrders.forEach((order) => {
            const rowFields = [
                rowNum.toString(),
                order.orderId,
                order.customerName || 'N/A',
                order.items.map(item => `${item.quantity}x ${item.name}`).join(', '),
                getStatusText(order.status),
                order.timeReceive ? new Date(order.timeReceive).toLocaleTimeString() : 'N/A',
                order.timeDone ? new Date(order.timeDone).toLocaleTimeString() : 'N/A'
            ];

            if (verticalPos > 180) { // Add new page if near bottom
                pdf.addPage();
                verticalPos = 20;
            }

            headerX = 20;
            pdf.setTextColor(...colorTheme.text);
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'normal');

            // Status background
            const statusX = headerX + colWidths.slice(0, 4).reduce((a, b) => a + b, 0);
            pdf.setFillColor(...(colorTheme.status[order.status] || colorTheme.status.pending));
            pdf.setTextColor(255, 255, 255);
            pdf.rect(statusX, verticalPos - 4, colWidths[4], 6, 'F');

            rowFields.forEach((cell, index) => {
                if (index === 4) { // Status cell
                    pdf.setTextColor(255, 255, 255);
                } else {
                    pdf.setTextColor(...colorTheme.text);
                }
                pdf.text(cell.toString(), headerX + 2, verticalPos);
                headerX += colWidths[index];
            });

            verticalPos += 8;
            rowNum++;
        });

        // Save PDF
        const pdfFilename = `kitchen-report-${new Date().toISOString().split('T')[0]}.pdf`;
        pdf.save(pdfFilename);
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error generating PDF. Please try again.');
    }
}

function getStatusText(status) {
    const statusMap = {
        'receive': 'Receive',
        'making': 'Making',
        'deliver': 'Deliver',
        'done': 'Done',
        'cancelled': 'Cancelled'
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

function updateSummaryWithFinancialData(data, type = 'sales') {
    const summaryPeriod = document.getElementById("summary-period");
    const summaryIncome = document.getElementById("summary-income");
    const summaryOrders = document.getElementById("summary-orders");
    const statusEl = document.getElementById("summary-status-badge");
    
    if (summaryPeriod) {
        const dateRange = data.report_info?.date_range;
        if (dateRange) {
            summaryPeriod.textContent = `${dateRange.start_date || 'N/A'} to ${dateRange.end_date || 'N/A'}`;
        } else {
            summaryPeriod.textContent = 'N/A';
        }
    }
    
    if (summaryIncome) {
        const summary = data.summary;
        if (summary) {
            summaryIncome.textContent = `Rp ${(summary.total_omzet || 0).toLocaleString()}`;
        } else {
            summaryIncome.textContent = 'Rp 0';
        }
    }
    
    if (summaryOrders) {
        const summary = data.summary;
        if (summary) {
            summaryOrders.textContent = `${summary.total_transactions || 0}`;
        } else {
            summaryOrders.textContent = '0';
        }
    }
    
    if (statusEl) {
        statusEl.textContent = type === 'best' ? 'Best Seller' : 'Data Sales';
        statusEl.className = `status-badge ${type === 'best' ? 'status-warning' : 'status-deliver'}`;
    }
}

// ========== UTILITY FUNCTIONS ==========
function showEmptyState(message, type = 'info') {
    // Get appropriate tbody based on current data type
    let tbody;
    if (currentDataType === 'ingredient') {
      const viewSelect = document.getElementById('ingredient-view-select');
      const viewMode = viewSelect ? viewSelect.value : 'daily';
      tbody = viewMode === 'daily' 
          ? document.getElementById("ingredient-tbody") 
          : document.getElementById("ingredient-logs-tbody");
    } else if (currentDataType === 'best') {
      tbody = document.getElementById("bestseller-tbody");
    } else {
      tbody = document.getElementById("sales-tbody");
    }

    if (!tbody) return;

    // Dynamic column count based on current data type and view mode
    let colspan = 6; // default for sales
    if (currentDataType === 'ingredient') {
      const viewSelect = document.getElementById('ingredient-view-select');
      const viewMode = viewSelect ? viewSelect.value : 'daily';
      colspan = viewMode === 'daily' ? 6 : 7;
    } else if (currentDataType === 'best') {
      colspan = 5;
    }

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
                    Please select a different date range or verify the order data.
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
            statusEl.textContent = "Empty";
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
            <label>Total:</label>
            <span>${value} item</span>
        </div>
        <div class="view-item">
            <label>Percentage:</label>
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
                label: "Quantity Sold", 
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
    
    // Show loading state
    showLoading();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
            // Build URL with optional menu filter - use financial_sales endpoint for flavor data
            let url = `/report/financial_sales?start_date=${start}&end_date=${end}`;
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

            // Update summary with new structure
        updateSummaryWithFinancialData(data, 'sales');
            applyModeLayout('sales');

            // Use transactions array for detailed data with flavor information
            const rawDetails = Array.isArray(data.transactions) ? data.transactions : [];
        console.log('Report transactions:', rawDetails);
        console.log('Data structure:', data);
        console.log('Transactions length:', rawDetails.length);
        
            // Aggregate sales data by menu + flavor combination
            const details = aggregateSalesData(rawDetails);
        console.log('Aggregated sales data:', details);
        
            const newHash = computeDataHash(details);
        // Always update data and render, regardless of hash
                lastReportHash = newHash;
                baseData = details;
                // preserve current search if any
                const tableSearch = document.getElementById('table-search-input');
                const term = tableSearch ? tableSearch.value : '';
                filteredData = term ? baseData.filter(i => (i.menu_name || '').toLowerCase().includes(term.toLowerCase())) : [...baseData];
                reportCurrentPage = 1;
                renderReportTable();
                updateReportPagination();
                // Re-render charts only when data changed (using aggregated data)
        const chartData = details.map(item => ({
            menu_name: item.menu_name || 'N/A',
            quantity: item.quantity || 0,
            unit_price: item.base_price || 0,
            total: item.total_price || 0
        }));
        renderCharts(chartData);

        if (details.length === 0) {
            console.log('No sales data found');
            // Show empty state instead of fallback
            baseData = [];
            filteredData = [];
            reportCurrentPage = 1;
            renderReportTable();
            updateReportPagination();
            showEmptyState('Tidak ada data penjualan untuk periode ini', 'info');
        }
    } catch (err) {
        console.error("Error loading report:", err);
        showEmptyState(err.message || 'Gagal memuat data laporan', 'error');
    } finally {
        clearTimeout(timeout);
        hideLoading();
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
                reportCurrentPage = 1;
                renderReportTable();
                updateReportPagination();
                renderCharts(chartData);
                // Update table header for best seller data
                updateReportTableHeader();
            }
        } else {
            console.log('No best seller data found');
            // Show empty chart and table
            renderCharts([]);
            baseData = [];
            filteredData = [];
            renderReportTable();
            updateReportPagination();
            updateSummaryWithData(data, 'empty');
            // Update table header for empty state
            updateReportTableHeader();
        }

    } catch (err) {
        console.error("Error loading best seller data:", err);
        // Show error in table
        baseData = [];
        filteredData = [];
        renderReportTable();
        updateReportPagination();
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

// ========== GLOBAL EXPORT DISPATCHERS (AGGREGATED) ==========
function exportCSV() {
    const kitchenVisible = !document.getElementById('kitchen-report-section')?.classList.contains('hidden');
    const ingredientVisible = !document.getElementById('ingredient-analysis-section')?.classList.contains('hidden');
    if (kitchenVisible) { return exportKitchenCSV(); }
    if (ingredientVisible) { return exportIngredientCSV(); }
    return exportSalesCSVEnhanced();
}

async function exportPDF() {
    const kitchenVisible = !document.getElementById('kitchen-report-section')?.classList.contains('hidden');
    const ingredientVisible = !document.getElementById('ingredient-analysis-section')?.classList.contains('hidden');
    if (kitchenVisible) { return exportKitchenPDF(); }
    if (ingredientVisible) { return exportIngredientPDF(); }
    return exportSalesPDFEnhanced();
}

// ========== GLOBAL EXCEL EXPORT DISPATCHER ==========
function exportExcel() {
    const kitchenVisible = !document.getElementById('kitchen-report-section')?.classList.contains('hidden');
    const ingredientVisible = !document.getElementById('ingredient-analysis-section')?.classList.contains('hidden');
    if (kitchenVisible) {
        return exportKitchenExcel();
    }
    if (ingredientVisible) {
        return exportIngredientExcel();
    }
    return exportSalesExcelEnhanced();
}

// ========== SALES EXPORT (AGGREGATED) ==========
function exportSalesExcelEnhanced() {
    const data = Array.isArray(baseData) ? baseData : [];
    const wb = XLSX.utils.book_new();
    
    // Determine data type and structure
    const dataType = currentDataType || 'sales';
    let totalQty = 0, totalRevenue = 0;
    const itemMap = {};
    
    // Process data based on current data type
    data.forEach(r => {
        let qty, price, total, menu, flavor;
        
        if (dataType === 'sales') {
            // Sales data structure (aggregated by menu + flavor)
            qty = Number(r.quantity || 0);
            price = Number(r.base_price || 0);
            total = Number(r.total_price || 0);
            menu = r.menu_name || 'Unknown';
            flavor = r.flavor || '-';
        } else if (dataType === 'best') {
            // Best seller data structure
            qty = Number(r.total_quantity || r.quantity || 0);
            price = Number(r.unit_price || 0);
            total = Number(r.total_revenue || r.total || 0);
            menu = r.menu_name || 'Unknown';
            flavor = '-'; // Best seller doesn't have flavor
        } else {
            // Fallback for other data types
            qty = Number(r.qty || r.quantity || r.amount || 0);
            price = Number(r.price || r.price_per_unit || r.unit_price || 0);
            total = Number(r.total || r.revenue || (qty * price));
            menu = r.menu_name || r.name || r.menu || 'Unknown';
            flavor = r.flavor || '-';
        }
        
        totalQty += qty; 
        totalRevenue += total;
        
        // Create unique key for aggregation (include flavor for sales)
        const key = dataType === 'sales' ? `${menu}|${flavor}` : menu;
        if (!itemMap[key]) itemMap[key] = { qty: 0, revenue: 0, menu, flavor };
        itemMap[key].qty += qty; 
        itemMap[key].revenue += total;
    });
    
    const topItems = Object.entries(itemMap)
        .map(([key, v]) => ({ name: v.menu, flavor: v.flavor, qty: v.qty, revenue: v.revenue }))
        .sort((a,b) => b.qty - a.qty)
        .slice(0, 10);
    const allItems = Object.entries(itemMap)
        .map(([key, v]) => ({ name: v.menu, flavor: v.flavor, qty: v.qty, revenue: v.revenue }))
        .sort((a,b) => b.qty - a.qty);
    
    // Executive Summary
    const summaryAoA = [
        [`${dataType === 'sales' ? 'Sales' : dataType === 'best' ? 'Best Seller' : 'Data'} Executive Summary`],
        ['Generated on', new Date().toLocaleString('id-ID')],
        ['Data Type', dataType === 'sales' ? 'Data Sales' : dataType === 'best' ? 'Best Seller' : 'Data'],
        ['Total Records', data.length],
        ['Total Qty', totalQty],
        ['Total Revenue', totalRevenue],
        [''],
        ['Top 10 Items (by Qty)'],
        dataType === 'sales' ? ['Item','Flavor','Qty','Revenue'] : ['Item','Qty','Revenue'],
        ...topItems.map(i => dataType === 'sales' ? [i.name, i.flavor, i.qty, i.revenue] : [i.name, i.qty, i.revenue]),
        [''],
        ['All Items Summary'],
        dataType === 'sales' ? ['Item','Flavor','Qty','Revenue'] : ['Item','Qty','Revenue'],
        ...allItems.map(i => dataType === 'sales' ? [i.name, i.flavor, i.qty, i.revenue] : [i.name, i.qty, i.revenue])
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoA);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    
    // Data Summary (raw rows)
    const dataAoA = dataType === 'sales' ? 
        [['No','Item','Flavor','Qty','Price','Total']] : 
        [['No','Item','Qty','Price','Total']];
    
    data.forEach((r, i) => {
        let name, flavor, qty, price, total;
        
        if (dataType === 'sales') {
            name = r.menu_name || '-';
            flavor = r.flavor || '-';
            qty = Number(r.quantity || 0);
            price = Number(r.base_price || 0);
            total = Number(r.total_price || 0);
            dataAoA.push([i+1, name, flavor, qty, price, total]);
        } else if (dataType === 'best') {
            name = r.menu_name || '-';
            qty = Number(r.total_quantity || r.quantity || 0);
            price = Number(r.unit_price || 0);
            total = Number(r.total_revenue || r.total || 0);
            dataAoA.push([i+1, name, qty, price, total]);
        } else {
            name = r.menu_name || r.name || r.menu || '-';
            flavor = r.flavor || '-';
            qty = Number(r.qty || r.quantity || r.amount || 0);
            price = Number(r.price || r.price_per_unit || r.unit_price || 0);
            total = Number(r.total || r.revenue || (qty * price));
            dataAoA.push([i+1, name, flavor, qty, price, total]);
        }
    });
    
    const wsData = XLSX.utils.aoa_to_sheet(dataAoA);
    wsData['!cols'] = dataType === 'sales' ? 
        [{wch:6},{wch:30},{wch:18},{wch:10},{wch:12},{wch:14}] :
        [{wch:6},{wch:30},{wch:10},{wch:12},{wch:14}];
    XLSX.utils.book_append_sheet(wb, wsData, dataType === 'sales' ? 'Sales Data' : dataType === 'best' ? 'Best Seller Data' : 'Data');
    
    XLSX.writeFile(wb, `${dataType}_report_${new Date().toISOString().slice(0,10)}.xlsx`);
}
function exportSalesCSVEnhanced() {
    const data = Array.isArray(baseData) ? baseData : [];
    const dataType = currentDataType || 'sales';
    
    // Process data based on current data type
    let totalOrders = data.length;
    let totalQty = 0;
    let totalRevenue = 0;
    const itemMap = {};
    
    data.forEach(r => {
        let qty, price, total, menu, flavor;
        
        if (dataType === 'sales') {
            qty = Number(r.quantity || 0);
            price = Number(r.base_price || 0);
            total = Number(r.total_price || 0);
            menu = r.menu_name || 'Unknown';
            flavor = r.flavor || '-';
        } else if (dataType === 'best') {
            qty = Number(r.total_quantity || r.quantity || 0);
            price = Number(r.unit_price || 0);
            total = Number(r.total_revenue || r.total || 0);
            menu = r.menu_name || 'Unknown';
            flavor = '-';
        } else {
            qty = Number(r.qty || r.quantity || r.amount || 0);
            price = Number(r.price || r.price_per_unit || r.unit_price || 0);
            total = Number(r.total || r.revenue || (qty * price));
            menu = r.menu_name || r.name || r.menu || 'Unknown';
            flavor = r.flavor || '-';
        }
        
        totalQty += qty;
        totalRevenue += total;
        
        const key = dataType === 'sales' ? `${menu}|${flavor}` : menu;
        if (!itemMap[key]) itemMap[key] = { qty: 0, revenue: 0, menu, flavor };
        itemMap[key].qty += qty;
        itemMap[key].revenue += total;
    });
    
    const topItems = Object.entries(itemMap)
        .map(([key, v]) => ({ name: v.menu, flavor: v.flavor, qty: v.qty, revenue: v.revenue }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);
    const allItems = Object.entries(itemMap)
        .map(([key, v]) => ({ name: v.menu, flavor: v.flavor, qty: v.qty, revenue: v.revenue }))
        .sort((a, b) => b.qty - a.qty);

    // Build CSV content: Executive Summary + Table
    const summary = [
        [`${dataType === 'sales' ? 'Sales' : dataType === 'best' ? 'Best Seller' : 'Data'} Executive Summary`],
        ['Generated on', new Date().toLocaleString('id-ID')],
        ['Data Type', dataType === 'sales' ? 'Data Sales' : dataType === 'best' ? 'Best Seller' : 'Data'],
        ['Total Records', totalOrders],
        ['Total Qty', totalQty],
        ['Total Revenue', totalRevenue],
        [''],
        ['Top 10 Items (by Qty)'],
        dataType === 'sales' ? ['Item','Flavor','Qty','Revenue'] : ['Item','Qty','Revenue'],
        ...topItems.map(i => dataType === 'sales' ? [i.name, i.flavor, i.qty, i.revenue] : [i.name, i.qty, i.revenue]),
        [''],
        ['All Items Summary'],
        dataType === 'sales' ? ['Item','Flavor','Qty','Revenue'] : ['Item','Qty','Revenue'],
        ...allItems.map(i => dataType === 'sales' ? [i.name, i.flavor, i.qty, i.revenue] : [i.name, i.qty, i.revenue]),
        [''],
        [dataType === 'sales' ? 'Sales Summary' : dataType === 'best' ? 'Best Seller Summary' : 'Data Summary'],
        dataType === 'sales' ? ['No','Item','Flavor','Qty','Price','Total'] : ['No','Item','Qty','Price','Total']
    ];

    const table = [];
    if (data.length) {
        data.forEach((r, i) => {
            let name, flavor, qty, price, total;
            
            if (dataType === 'sales') {
                name = r.menu_name || '-';
                flavor = r.flavor || '-';
                qty = Number(r.quantity || 0);
                price = Number(r.base_price || 0);
                total = Number(r.total_price || 0);
                table.push([i+1, name, flavor, qty, price, total]);
            } else if (dataType === 'best') {
                name = r.menu_name || '-';
                qty = Number(r.total_quantity || r.quantity || 0);
                price = Number(r.unit_price || 0);
                total = Number(r.total_revenue || r.total || 0);
                table.push([i+1, name, qty, price, total]);
            } else {
                name = r.menu_name || r.name || r.menu || '-';
                flavor = r.flavor || '-';
                qty = Number(r.qty || r.quantity || r.amount || 0);
                price = Number(r.price || r.price_per_unit || r.unit_price || 0);
                total = Number(r.total || r.revenue || (qty * price));
                table.push([i+1, name, flavor, qty, price, total]);
            }
        });
    } else {
        // Fallback read from DOM
        document.querySelectorAll('#report-tbody tr').forEach((tr, i) => {
            const tds = [...tr.children].map(td => td.innerText.trim());
            if (dataType === 'sales' && tds.length >= 6) {
                table.push([i+1, tds[1], tds[2], tds[3], tds[4], tds[5]]);
            } else if (dataType === 'best' && tds.length >= 5) {
                table.push([i+1, tds[1], tds[2], tds[3], tds[4]]);
            } else if (tds.length >= 5) {
                table.push([i+1, tds[1], '-', tds[2], tds[3], tds[4]]);
            }
        });
    }

    const csvContent = [...summary, ...table].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dataType}_report_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function exportSalesPDFEnhanced() {
    const jsPdfNs = (window.jspdf || window.jsPDF || null);
    const JSPDF_CTOR = jsPdfNs ? (jsPdfNs.jsPDF || jsPdfNs) : null;
    if (!JSPDF_CTOR) { alert('jsPDF tidak tersedia.'); return; }
    const doc = new JSPDF_CTOR('p','mm','a4');
    
    // Theme colors aligned with app UI
    const colorPrimary = [68, 45, 45]; // #442D2D
    const colorAccent = [220, 208, 168]; // #DCD0A8
    const colorBg = [245, 239, 230]; // #F5EFE6

    // Header bar
    doc.setFillColor(colorBg[0], colorBg[1], colorBg[2]);
    doc.rect(10, 10, 190, 16, 'F');
    doc.setFont('helvetica','bold');
    doc.setTextColor(colorPrimary[0], colorPrimary[1], colorPrimary[2]);
    doc.setFontSize(14);
    
    const dataType = currentDataType || 'sales';
    const title = dataType === 'sales' ? 'Sales Executive Summary' : dataType === 'best' ? 'Best Seller Executive Summary' : 'Data Executive Summary';
    doc.text(`${title} - Infinity Cafe`, 14, 20);
    
    // Meta font
    doc.setFont('helvetica','normal');
    doc.setTextColor(0,0,0);
    doc.setFontSize(10);

    const data = Array.isArray(baseData) ? baseData : [];
    let totalQty = 0, totalAmount = 0;
    const itemMap = {};
    
    data.forEach(r => {
        let qty, price, total, menu, flavor;
        
        if (dataType === 'sales') {
            qty = Number(r.quantity || 0);
            price = Number(r.base_price || 0);
            total = Number(r.total_price || 0);
            menu = r.menu_name || 'Unknown';
            flavor = r.flavor || '-';
        } else if (dataType === 'best') {
            qty = Number(r.total_quantity || r.quantity || 0);
            price = Number(r.unit_price || 0);
            total = Number(r.total_revenue || r.total || 0);
            menu = r.menu_name || 'Unknown';
            flavor = '-';
        } else {
            qty = Number(r.qty || r.quantity || 0);
            price = Number(r.price || 0);
            total = Number(r.total || (qty * price));
            menu = r.menu_name || r.name || 'Unknown';
            flavor = r.flavor || '-';
        }
        
        totalQty += qty; 
        totalAmount += total;
        
        const key = dataType === 'sales' ? `${menu}|${flavor}` : menu;
        if (!itemMap[key]) itemMap[key] = { qty: 0, total: 0, menu, flavor };
        itemMap[key].qty += qty; 
        itemMap[key].total += total;
    });
    
    const topItems = Object.entries(itemMap)
        .map(([key, v]) => ({ name: v.menu, flavor: v.flavor, qty: v.qty, total: v.total }))
        .sort((a,b) => b.qty - a.qty)
        .slice(0, 10);

    // Summary card (appearance only; content unchanged)
    let y = 30;
    doc.setDrawColor(colorAccent[0], colorAccent[1], colorAccent[2]);
    doc.setLineWidth(0.4);
    doc.rect(10, y, 190, 18);
    doc.setFont('helvetica','bold'); doc.text('Ringkasan', 14, y+7);
    doc.setFont('helvetica','normal');
    doc.text(`Generated: ${new Date().toLocaleString('id-ID')}`, 60, y+7);
    doc.text(`Total Records: ${data.length}`, 120, y+7);
    doc.text(`Total Qty: ${totalQty}`, 60, y+14);
    doc.text(`Total Revenue: ${totalAmount}`, 120, y+14);
    y += 26;

    doc.setFont('helvetica','bold'); doc.text('Top 10 Items (by Qty):', 14, y); y+=6; doc.setFont('helvetica','normal');
    topItems.forEach((it, idx) => { 
        if (y>270){doc.addPage(); y=20;} 
        const itemText = dataType === 'sales' ? 
            `${idx+1}. ${it.name} (${it.flavor}) - Qty: ${it.qty} | Total: ${it.total}` :
            `${idx+1}. ${it.name} - Qty: ${it.qty} | Total: ${it.total}`;
        doc.text(itemText, 14, y); y+=6; 
    });

    y+=6; if (y>270){doc.addPage(); y=20;}
    const summaryTitle = dataType === 'sales' ? 'Sales Summary (first 25 rows):' : dataType === 'best' ? 'Best Seller Summary (first 25 rows):' : 'Data Summary (first 25 rows):';
    doc.setFont('helvetica','bold'); doc.text(summaryTitle, 14, y); y+=4; doc.setFont('helvetica','normal');

    // Build table data (content unchanged)
    const tableHead = dataType === 'sales' ? ['No', 'Item', 'Flavor', 'Qty', 'Price', 'Total'] : ['No', 'Item', 'Qty', 'Price', 'Total'];
    const tableBody = data.slice(0, 25).map((r, i) => {
        if (dataType === 'sales') {
            const name = r.menu_name || '-';
            const flavor = r.flavor || '-';
            const qty = Number(r.quantity || 0);
            const price = Number(r.base_price || 0);
            const total = Number(r.total_price || 0);
            return [i+1, name, flavor, qty, price, total];
        } else if (dataType === 'best') {
            const name = r.menu_name || '-';
            const qty = Number(r.total_quantity || r.quantity || 0);
            const price = Number(r.unit_price || 0);
            const total = Number(r.total_revenue || r.total || 0);
            return [i+1, name, qty, price, total];
        } else {
            const name = r.menu_name || r.name || '-';
            const flavor = r.flavor || '-';
            const qty = Number(r.qty || r.quantity || 0);
            const price = Number(r.price || 0);
            const total = Number(r.total || (qty * price));
            return [i+1, name, flavor, qty, price, total];
        }
    });

    if (!doc.autoTable) { alert('AutoTable tidak tersedia.'); doc.save(`${dataType}_report_${new Date().toISOString().slice(0,10)}.pdf`); return; }
    doc.autoTable({
        startY: y + 4,
        head: [tableHead],
        body: tableBody,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, textColor: [68,45,45] },
        headStyles: { fillColor: colorAccent, textColor: [68,45,45], halign: 'left' },
        alternateRowStyles: { fillColor: [250, 247, 240] },
        tableLineColor: colorAccent,
        tableLineWidth: 0.2,
        margin: { left: 10, right: 10 }
    });

    doc.save(`${dataType}_report_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ========== DATA AGGREGATION FUNCTIONS ==========
function aggregateSalesData(rawTransactions) {
    // Group transactions by menu_name + flavor combination
    const groupedData = {};
    
    rawTransactions.forEach(transaction => {
        const menuName = transaction.menu_name || 'Unknown';
        const flavor = transaction.flavor || 'Default';
        const key = `${menuName}|${flavor}`;
        
        if (!groupedData[key]) {
            groupedData[key] = {
                menu_name: menuName,
                flavor: flavor,
                quantity: 0,
                base_price: transaction.base_price || 0,
                total_price: 0,
                transaction_count: 0
            };
        }
        
        // Aggregate quantities and totals
        groupedData[key].quantity += (transaction.quantity || 0);
        groupedData[key].total_price += (transaction.total_price || 0);
        groupedData[key].transaction_count += 1;
    });
    
    // Convert grouped data to array and sort by total_price descending
    return Object.values(groupedData).sort((a, b) => b.total_price - a.total_price);
}

// ========== PAGINATION FUNCTIONS ==========
// function changePage(direction) {
//     const newPage = reportCurrentPage + direction;
//     const maxPage = Math.ceil(filteredData.length / itemsPerPage);
    
//     if (newPage >= 1 && newPage <= maxPage) {
//         reportCurrentPage = newPage;
//         renderReportTable();
//         updateReportPagination();
//     }
// }

function initPagination() {
    const prevBtn = document.getElementById('report-prev-btn');
    const nextBtn = document.getElementById('report-next-btn');
    const pageSizeSelect = document.getElementById('report-page-size');

    prevBtn.addEventListener('click', () => changeReportPage(-1));
    nextBtn.addEventListener('click', () => changeReportPage(1));
    pageSizeSelect.addEventListener('change', changeReportPageSize);
}

async function changeReportPage(direction) {
    const newPage = reportCurrentPage + direction;

    if (newPage >= 1 && newPage <= reportTotalPages) {
        reportCurrentPage = newPage;
        renderReportTable();
        renderReportPagination();
    }
}

async function changeReportPageSize() {
    reportPageSize = parseInt(document.getElementById('report-page-size').value);
    reportCurrentPage = 1;
    updateReportPagination();
    renderReportTable();
}

function updateReportPagination() {
    reportTotalPages = Math.ceil(filteredData.length / reportPageSize);
    if (reportTotalPages === 0) reportTotalPages = 1;

    if (reportCurrentPage > reportTotalPages) {
        reportCurrentPage = reportTotalPages;
    }

    renderReportPagination();
}

function renderReportPagination() {
    const pageNumbers = document.getElementById('report-page-numbers');
    const prevBtn = document.getElementById('report-prev-btn');
    const nextBtn = document.getElementById('report-next-btn');
    const paginationInfo = document.getElementById('report-pagination-info');

    paginationInfo.textContent = `Page ${reportCurrentPage} of ${reportTotalPages}`;

    prevBtn.disabled = reportCurrentPage === 1;
    nextBtn.disabled = reportCurrentPage === reportTotalPages;

    pageNumbers.innerHTML = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, reportCurrentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(reportTotalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.className = `page-number ${i === reportCurrentPage ? 'active' : ''}`;
        pageBtn.textContent = i;
        pageBtn.onclick = () => {
            reportCurrentPage = i;
            renderReportTable();
            renderReportPagination();
        };
        pageNumbers.appendChild(pageBtn);
    }
}

function updateReportTableInfo() {
    const tableInfo = document.getElementById('report-table-info');
    const startIndex = (reportCurrentPage -1) * reportPageSize + 1;
    const endIndex = Math.min(reportCurrentPage * reportPageSize, filteredData.length);
    const total = filteredData.length;

    if (total === 0) {
        tableInfo.textContent = "No entries available";
    } else {
        tableInfo.textContent = `Showing ${startIndex} to ${endIndex} of ${total} entries`;
    }
}

function updateReportTableHeader() {
    // Hide all tables first
    const salesTable = document.getElementById('sales-table');
    const bestsellerTable = document.getElementById('bestseller-table');
    const ingredientTable = document.getElementById('ingredient-table');
    const ingredientLogsTable = document.getElementById('ingredient-logs-table');

    if (salesTable) salesTable.classList.add('hidden');
    if (bestsellerTable) bestsellerTable.classList.add('hidden');
    if (ingredientTable) ingredientTable.classList.add('hidden');
    if (ingredientLogsTable) ingredientLogsTable.classList.add('hidden');

    // Show appropriate table based on current data type
    if (currentDataType === 'ingredient') {
      const viewSelect = document.getElementById('ingredient-view-select');
      const viewMode = viewSelect ? viewSelect.value : 'daily';

      if (viewMode === 'daily') {
        // Show daily view table
        if (ingredientTable) {
          ingredientTable.classList.remove('hidden');
        }
      } else {
        // Show logs view table
        if (ingredientLogsTable) {
          ingredientLogsTable.classList.remove('hidden');
        }
      }
    } else if (currentDataType === 'best') {
      if (bestsellerTable) bestsellerTable.classList.remove('hidden');
    } else {
      // Default to sales
      if (salesTable) salesTable.classList.remove('hidden');
    }
}

function renderReportTable() {
    // Update table header first to match current data type
    updateReportTableHeader();

      const startIndex = (reportCurrentPage - 1) * reportPageSize;
      const endIndex = startIndex + reportPageSize;
      const currentPageData = filteredData.slice(startIndex, endIndex);

    // Get appropriate tbody based on current data type
    let tbody;
    if (currentDataType === 'ingredient') {
      const viewSelect = document.getElementById('ingredient-view-select');
      const viewMode = viewSelect ? viewSelect.value : 'daily';

      if (viewMode === 'daily') {
        tbody = document.getElementById("ingredient-tbody");
      } else {
        tbody = document.getElementById("ingredient-logs-tbody");
      }
    } else if (currentDataType === 'best') {
      tbody = document.getElementById("bestseller-tbody");
    } else {
      tbody = document.getElementById("sales-tbody");
    }

    if (!tbody) return;
    tbody.innerHTML = "";
    
    if (currentPageData.length > 0) {
        currentPageData.forEach((item, i) => {
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
                                <button class="table-action-btn" onclick="event.stopPropagation(); openGroupedConsumptionModal('${(item.order_ids || []).join(',')}', '${item.date || ''}', '${item.status_text || ''}', '${item.menu_name || ''}', '${item.flavor || ''}')" title="Lihat Detail">
                                    <i class="fas fa-eye"></i>
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
                                    <span style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; padding:.2rem .5rem; border-radius:9999px; font-weight:600;">${totalOrders} total orders</span>
                                    <span style="background:#F5F3FF; color:#4C1D95; border:1px solid #DDD6FE; padding:.2rem .5rem; border-radius:9999px; font-weight:600;">${uniqueMenus} unique menus</span>
                                 </div>
                             </td>
                             <td style="text-align: center; font-weight: 600; color: #059669;">${totalOrders.toLocaleString()}</td>
                             <td style="text-align: center; font-weight: 600; color: #DC2626;">${totalConsumption.toLocaleString()}</td>
                             <td>
                                 <button class="table-action-btn" onclick="event.stopPropagation(); viewConsumptionDetails('Daily-${item.date || ''}', '${item.date || ''}', '${item.status_text || ''}')" style="white-space: nowrap; min-width: 80px;">
                                    <i class="fas fa-eye"></i>
                                 </button>
                             </td>
                         </tr>`;
                 }
            } else if (currentDataType === 'sales') {
                // Sales data - show aggregated flavor information
                console.log('Rendering sales item:', item);
                const flavor = item.flavor || '-';
                const totalPrice = item.total_price || 0;
                const unitPrice = item.base_price || 0;
                const quantity = item.quantity || 0;
                const transactionCount = item.transaction_count || 1;
                
                tbody.innerHTML += `
                    <tr>
                        <td>${actualIndex + 1}</td>
                        <td>${item.menu_name || 'N/A'}</td>
                        <td>${flavor}</td>
                        <td>${quantity.toLocaleString()}</td>
                        <td>Rp ${unitPrice.toLocaleString()}</td>
                        <td>Rp ${totalPrice.toLocaleString()}</td>
                    </tr>`;
            } else {
                // Best Seller data - aggregated view
                console.log('Rendering best seller item:', item);
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
        if (currentDataType === 'ingredient' && currentPageData[0] && !currentPageData[0].menu_name) {
            const totals = currentPageData.reduce((acc, it) => {
                const s = it.daily_summary || {};
                acc.orders += (s.total_orders || 0);
                acc.ingredients += (s.total_consumption || 0);
                return acc;
            }, { orders: 0, ingredients: 0 });
            tbody.innerHTML += `
                <tr style="background:#F9FAFB; font-weight:600;">
                    <td colspan="3" style="text-align:right; padding-right:8px;">Daily Total</td>
                    <td style="text-align:center; color:#059669;">${totals.orders.toLocaleString()}</td>
                    <td style="text-align:center; color:#DC2626; border-top-right-radius: 0.5rem; border-bottom-right-radius: 0.5rem;">${totals.ingredients.toLocaleString()}</td>
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
    
    updateReportTableInfo();
}

let elements = {};

function init() {
    initializeElements();
    // setupEventListeners();
    initPagination();
    loadReport();
    startAutoRefresh();
}

function initializeElements() {
    elements.prevPageBtn = document.getElementById('report-prev-btn');
    elements.nextPageBtn = document.getElementById('report-next-btn');
    elements.pageSizeSelect = document.getElementById('report-page-size');
    elements.pageNumbers = document.getElementById('report-page-numbers');
    elements.paginationInfo = document.getElementById('report-pagination-info');
    elements.reportBody = document.getElementById('report-body')
};


    
    // function updatePagination() {
    //     const maxPage = Math.ceil(filteredData.length / itemsPerPage);
    //     const pageNumbers = document.getElementById("page-numbers");
    //     const prevBtn = document.getElementById("prev-page");
    //     const nextBtn = document.getElementById("next-page");
        
    //     // Update button states
    //     prevBtn.disabled = reportCurrentPage === 1;
    //     nextBtn.disabled = reportCurrentPage === maxPage;
        
    //     // Generate page numbers
    //     pageNumbers.innerHTML = "";
    //     const startPage = Math.max(1, reportCurrentPage - 2);
    //     const endPage = Math.min(maxPage, reportCurrentPage + 2);
        
    //     for (let i = startPage; i <= endPage; i++) {
    //         const pageBtn = document.createElement("button");
    //         pageBtn.className = `page-number ${i === reportCurrentPage ? 'active' : ''}`;
    //         pageBtn.textContent = i;
    //         pageBtn.onclick = () => {
    //             reporturrentPage = i;
    //             renderReportTable();
    //             updateReportPagination();
    //         };
    //         pageNumbers.appendChild(pageBtn);
    //     }
    // }
    
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
    } else if (currentDataType === 'sales') {
        // Sales data: filter by menu name and flavor
        filteredData = term
            ? source.filter(item => 
                (item.menu_name || '').toLowerCase().includes(term) ||
                (item.flavor || '').toLowerCase().includes(term)
            )
            : [...source];
    } else {
        // Best seller data: filter by menu name only
    filteredData = term
        ? source.filter(item => (item.menu_name || '').toLowerCase().includes(term))
        : [...source];
    }
    
    reportCurrentPage = 1;
    renderReportTable();
    updateReportPagination();
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

function closeReportFilter() {
    const dd = document.getElementById('report-filter-dropdown');
    console.log('Closing filter dropdown, element found:', dd);
    if (!dd) {
        console.log('Filter dropdown element not found!');
        return;
    }
    dd.classList.remove('show');
    console.log('Filter dropdown closed, classes:', dd.className);
}

async function applyReportFilter() {
    console.log('applyReportFilter called');
    const dataTypeSelect = document.getElementById('data-type-select');
    const sortSelect = document.getElementById('sort-select');
    const start = document.getElementById("start_date").value;
    const end = document.getElementById("end_date").value;
    
    toggleReportFilter();
    
    if (dataTypeSelect) {
        const dataType = dataTypeSelect.value;
        
        if (dataType === 'ingredient') {
            const ingredientViewSelect = document.getElementById('ingredient-view-select');
            if (ingredientViewSelect) {
                ingredientViewSelect.value = 'daily';
            }
            // Load ingredient analysis data
            await loadIngredientAnalysisData();
            applyIngredientModeLayout();
            return;
        } else if (dataType === 'best') {
            // Load best seller data
            resetToNormalMode();
            if (start && end) {
                await loadBestSellerData(start, end);
            } else {
                applyModeLayout('best');
                // Clear data if no dates
                baseData = [];
                filteredData = [];
                reportCurrentPage = 1;
                renderReportTable();
                updateReportPagination();
            }
      // Ensure header is updated after best seller data load
      updateReportTableHeader();
        } else {
            // Load sales data
            resetToNormalMode();
            if (start && end) {
                await loadReport();
            } else {
                applyModeLayout('sales');
                // Clear data if no dates
                baseData = [];
                filteredData = [];
                reportCurrentPage = 1;
                renderReportTable();
                updateReportPagination();
            }
      // Ensure header is updated after sales data load
      updateReportTableHeader();
        }
    }
    
    
    
    if (sortSelect && filteredData && filteredData.length) {
        const val = sortSelect.value;
        if (currentDataType === 'ingredient') {
            // Penyortiran untuk data analisis bahan
            const currentViewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
            const dataToSort = baseData[currentViewMode] || [];
            dataToSort.sort((a, b) => {
                if (val === 'name') return (a.date || a.menu_name || '').localeCompare(b.date || b.menu_name || '');
                if (val === 'qty') return (b.ingredients_affected ?? 0) - (a.ingredients_affected ?? 0);
                if (val === 'total') return (b.total_qty ?? 0) - (a.total_qty ?? 0);
                return 0;
            });
             // Terapkan kembali filter pencarian setelah menyortir
            const term = document.getElementById('table-search-input')?.value.toLowerCase() || '';
            filteredData = term ? dataToSort.filter(i => 
                (i.menu_name || '').toLowerCase().includes(term) || 
                (i.flavor || '').toLowerCase().includes(term) || 
                (i.order_id || '').toLowerCase().includes(term) || 
                (i.date || '').toLowerCase().includes(term) || 
                (i.status_text || '').toLowerCase().includes(term)
            ) : [...dataToSort];

        } else {
            // Penyortiran untuk sales dan best seller
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
        reportCurrentPage = 1;
        renderReportTable();
        updateReportPagination();
    }
}

function clearReportFilter() {
    console.log('clearReportFilter called');
    const sortSelect = document.getElementById('sort-select');
    const dataTypeSelect = document.getElementById('data-type-select');
    if (sortSelect) sortSelect.value = 'name';
    if (dataTypeSelect) dataTypeSelect.value = 'sales';
    
    // Close filter dropdown immediately
    const dd = document.getElementById('report-filter-dropdown');
    console.log('Filter dropdown element (reset):', dd);
    if (dd) {
        console.log('Before closing (reset) - classes:', dd.className);
        dd.classList.remove('show');
        console.log('After closing (reset) - classes:', dd.className);
        console.log('Filter dropdown closed on reset');
        
        // Also try to close it after a short delay to ensure it closes
        setTimeout(() => {
            if (dd.classList.contains('show')) {
                dd.classList.remove('show');
                console.log('Filter dropdown closed with delay (reset)');
            }
        }, 100);
    } else {
        console.log('Filter dropdown element not found on reset!');
    }
    
    // Re-load sales view by default
    const start = document.getElementById("start_date").value;
    const end = document.getElementById("end_date").value;
    resetToNormalMode();
    loadReport(start, end);
    applyModeLayout('sales');
    // Ensure header is updated after clearing filter
    updateReportTableHeader();
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
            <th>Flavor</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
        `;
    }
    
    // Reset titles
    if (barTitle) barTitle.textContent = '📊 Top Bestselling Menu';
    if (pieTitle) pieTitle.textContent = '🥧 Sales Composition';
    
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
    updateReportTableHeader();

    if (chartBar) chartBar.style.display = 'flex';
    if (chartPie) chartPie.style.display = 'flex';
    if (loyal) loyal.style.display = 'none';
    if (usulan) usulan.style.display = 'none';

    // Update summary with ingredient analysis insights
    updateIngredientSummary();
}

function updateIngredientSummary() {
    const data = Array.isArray(baseData) ? baseData : [];
    if (data.length === 0) return;
    
    // Calculate ingredient analysis insights
    let totalOrders = 0;
    let totalIngredients = 0;
    let uniqueMenus = new Set();
    let totalConsumption = 0;
    
    data.forEach(item => {
        if (item.daily_summary) {
            // Daily view data
            totalOrders += item.daily_summary.total_orders || 0;
            totalConsumption += item.daily_summary.total_consumption || 0;
        } else if (item.menu_name) {
            // Logs view data
            totalOrders += 1;
            totalIngredients += item.ingredients_affected || 0;
            uniqueMenus.add(item.menu_name);
        }
    });
    
    // Update summary display
    const summaryPeriod = document.getElementById('summary-period');
    const summaryIncome = document.getElementById('summary-income');
    const summaryOrders = document.getElementById('summary-orders');
    
    if (summaryPeriod) {
        const startDate = document.getElementById('ingredient-start-date')?.value || 'N/A';
        const endDate = document.getElementById('ingredient-end-date')?.value || 'N/A';
        summaryPeriod.textContent = `${startDate} - ${endDate}`;
    }
    
    if (summaryIncome) {
        summaryIncome.textContent = `${totalConsumption.toLocaleString()} bahan`;
    }
    
    if (summaryOrders) {
        summaryOrders.textContent = `${totalOrders.toLocaleString()} pesanan`;
    }
}

function applyModeLayout(mode) {
    const isBest = mode === 'best';
    const isSales = mode === 'sales';
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

    // Update table header based on mode
    if (tableHeader) {
        if (isSales) {
            // Sales mode: show flavor column
            tableHeader.innerHTML = `
            <th>No</th>
            <th>Menu</th>
                <th>Flavor</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
            `;
        } else if (isBest) {
            // Best Seller mode: no flavor column
            tableHeader.innerHTML = `
            <th>No</th>
            <th>Menu</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
        `;
        }
    }

    // Sync dropdown and state
    if (dataTypeSelect && dataTypeSelect.value !== (isBest ? 'best' : 'sales')) {
        dataTypeSelect.value = isBest ? 'best' : 'sales';
    }
    currentDataType = isBest ? 'best' : 'sales';

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
        barTitle.textContent = isBest ? '🏆 Top Bestselling Menu' : '📊 Top Bestselling Menu';
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
        updateReportTableHeader();
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
                reportCurrentPage = 1;
                const dataType = document.getElementById('data-type-select')?.value || 'sales';
                if (dataType === 'ingredient') {
                    // For ingredient mode, we don't use pagination, so just re-render the table
                    renderIngredientTable();
                } else {
                renderReportTable();
                updateReportPagination();
                }
            });
        }

        // Data type select (Sales / Best Seller / Ingredient Analysis)
        // Removed auto-change event listener - now only applies when "Terapkan" button is clicked

        // Auto refresh start
        startAutoRefresh();
        
        // Load initial data if dates are set
        const startDate = document.getElementById("start_date").value;
        const endDate = document.getElementById("end_date").value;
        if (startDate && endDate) {
            // Load sales data by default
            loadReport();
        }

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
            reportCurrentPage = 1;
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

        // Close filter dropdown when clicking outside
        document.addEventListener('click', function(event) {
            const filterDropdown = document.getElementById('report-filter-dropdown');
            const filterBtn = document.querySelector('.filter-btn');
            
            if (filterDropdown && !event.target.closest('.filter-container')) {
                filterDropdown.classList.remove('show');
            }
        });
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
                <span class="summary-detail--order">📅 Date: <strong>${dateStr || '-'}</strong></span>
                <span class="summary-detail--order">📊 Status: <strong>${statusText || ''}</strong></span>
            </div>
            <div class="table-container">
                <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
                    <table id="ingredient-detail-log">
                        <thead>
                            <tr>
                                <th>No</th>
                                <th>Order ID</th>
                                <th>Waktu</th>
                                <th>Items</th>
                                <th class="action-header">Aksi</th>
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

