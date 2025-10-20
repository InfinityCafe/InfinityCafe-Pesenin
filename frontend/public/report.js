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
let ingredientDataCache = null; // persist last successful ingredient dataset
let suppressPeriodSync = false; // prevent preset select from flipping to custom during programmatic updates
// Keep last fetched per-order per-item breakdown for details panel (logs view)
let currentPerOrderItems = { orderId: null, items: [] };
let currentPerOrderBreakdown = { orderId: null, menu_breakdown: [], details: [] };

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
    // Allow empty range (will default elsewhere)
    if (!startVal && !endVal) return res;
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
    // Logical constraints: no future dates, limit span
    const today = new Date();
    const todayIso = _toIsoDateLocal(today);
    if (startVal && startVal > todayIso) {
        res.valid = false; res.fields.start = true; res.message = 'Tanggal awal tidak boleh melebihi hari ini.';
        return res;
    }
    if (endVal && endVal > todayIso) {
        res.valid = false; res.fields.end = true; res.message = 'Tanggal akhir tidak boleh melebihi hari ini.';
        return res;
    }
    if (startVal && endVal) {
        // Limit maximum range length to 180 days to prevent heavy loads
        const start = new Date(startVal + 'T00:00:00');
        const end = new Date(endVal + 'T23:59:59');
        const diffDays = Math.ceil((end - start) / (1000*60*60*24));
        if (diffDays > 180) {
            res.valid = false; res.fields.start = true; res.fields.end = true; res.message = 'Rentang tanggal terlalu panjang (maksimal 180 hari).';
            return res;
        }
    }
    return res;
}

// ================== GLOBAL DATE RANGE HELPERS ==================
function getGlobalDateElements() {
    return {
        startEl: document.getElementById('start_date'),
        endEl: document.getElementById('end_date'),
        errorEl: document.getElementById('global-date-error')
    };
}

function clearGlobalDateError() {
    const { startEl, endEl, errorEl } = getGlobalDateElements();
    if (startEl) startEl.classList.remove('input-error');
    if (endEl) endEl.classList.remove('input-error');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }
}

function showGlobalDateError(message, invalidFields = {}) {
    const { startEl, endEl, errorEl } = getGlobalDateElements();
    if (startEl && invalidFields.start) startEl.classList.add('input-error');
    if (endEl && invalidFields.end) endEl.classList.add('input-error');
    if (errorEl) {
        errorEl.textContent = message || 'Rentang tanggal tidak valid';
        errorEl.classList.remove('hidden');
    }
}

function validateGlobalDateRange({ requireBoth = true, showMessage = true } = {}) {
    const { startEl, endEl } = getGlobalDateElements();
    const startVal = (startEl && startEl.value ? startEl.value.trim() : '') || '';
    const endVal = (endEl && endEl.value ? endEl.value.trim() : '') || '';
    let valid = true;
    let message = '';
    const invalidFields = { start: false, end: false };
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (requireBoth && (!startVal || !endVal)) {
        valid = false;
        message = 'Tanggal awal dan akhir wajib diisi.';
        invalidFields.start = !startVal;
        invalidFields.end = !endVal;
    }
    if (valid && startVal && !dateRegex.test(startVal)) {
        valid = false;
        message = 'Format tanggal awal tidak valid (YYYY-MM-DD).';
        invalidFields.start = true;
    }
    if (valid && endVal && !dateRegex.test(endVal)) {
        valid = false;
        message = 'Format tanggal akhir tidak valid (YYYY-MM-DD).';
        invalidFields.end = true;
    }
    if (valid && startVal && endVal && startVal > endVal) {
        valid = false;
        message = 'Tanggal awal tidak boleh melebihi tanggal akhir.';
        invalidFields.start = true;
        invalidFields.end = true;
    }

    if (!valid) {
        if (showMessage) {
            showGlobalDateError(message, invalidFields);
        } else {
            if (startEl && invalidFields.start) startEl.classList.add('input-error');
            if (endEl && invalidFields.end) endEl.classList.add('input-error');
        }
        return { valid: false, start: startVal, end: endVal };
    }

    clearGlobalDateError();
    return { valid: true, start: startVal, end: endVal };
}

function getValidatedGlobalRange(requireBoth = true, showMessage = true) {
    const validation = validateGlobalDateRange({ requireBoth, showMessage });
    if (!validation.valid || !validation.start || !validation.end) return null;
    return { start: validation.start, end: validation.end };
}

function computePresetRange(preset) {
    const today = new Date();
    const tzOffset = today.getTimezoneOffset();
    const normalize = (date) => {
        const local = new Date(date.getTime() - (tzOffset * 60000));
        return local.toISOString().split('T')[0];
    };

    const start = new Date(today);
    const end = new Date(today);

    switch (preset) {
        case 'today':
            return { start: normalize(start), end: normalize(end) };
        case 'yesterday':
            start.setDate(start.getDate() - 1);
            end.setDate(end.getDate() - 1);
            return { start: normalize(start), end: normalize(end) };
        case 'last7':
            start.setDate(start.getDate() - 6);
            return { start: normalize(start), end: normalize(end) };
        case 'last30':
            start.setDate(start.getDate() - 29);
            return { start: normalize(start), end: normalize(end) };
        case 'thisMonth': {
            const first = new Date(today.getFullYear(), today.getMonth(), 1);
            return { start: normalize(first), end: normalize(end) };
        }
        case 'lastMonth': {
            const firstPrev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const lastPrev = new Date(today.getFullYear(), today.getMonth(), 0);
            return { start: normalize(firstPrev), end: normalize(lastPrev) };
        }
        default:
            return null;
    }
}

function applyPeriodPreset(preset, options = {}) {
    const { triggerReload = true, updateSelect = true } = options;
    const range = computePresetRange(preset);
    if (!range) return;

    const { startEl, endEl } = getGlobalDateElements();
    if (!startEl || !endEl) return;

    suppressPeriodSync = true;
    startEl.value = range.start;
    endEl.value = range.end;
    validateGlobalDateRange({ requireBoth: true, showMessage: false });

    // Keep ingredient date inputs in sync when in ingredient mode or generally to avoid confusion
    try {
        const ingStart = document.getElementById('ingredient-start-date');
        const ingEnd = document.getElementById('ingredient-end-date');
        if (ingStart) ingStart.value = range.start;
        if (ingEnd) ingEnd.value = range.end;
    } catch (_) {}

    const periodSelect = document.getElementById('period-select');
    if (periodSelect && updateSelect !== false) {
        periodSelect.value = preset;
    }

    if (triggerReload) {
        reloadCurrentMode();
    }

    setTimeout(() => {
        suppressPeriodSync = false;
    }, 0);
}

function initializeDefaultDateRange(forceReload = true) {
    const { startVal, endVal } = getGlobalDateElements();
    if (startVal && endVal) {
        validateGlobalDateRange({ requireBoth: true, showMessage: false });
        if (forceReload) reloadCurrentMode();
        return;
    }
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) periodSelect.value = 'today';
    // Set inputs explicitly to today before applying preset to avoid any race
    const { startEl, endEl } = getGlobalDateElements();
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayIso = `${y}-${m}-${d}`;
    if (startEl) startEl.value = todayIso;
    if (endEl) endEl.value = todayIso;
    applyPeriodPreset('today', { triggerReload: forceReload, updateSelect: true });
}

function reloadCurrentMode() {
    const dataType = document.getElementById('data-type-select')?.value || 'sales';
    if (dataType === 'best') {
        const range = getValidatedGlobalRange(true, true);
        if (!range) return;
        loadBestSellerData(range);
    } else if (dataType === 'ingredient') {
        loadIngredientAnalysisData();
    } else {
        const range = getValidatedGlobalRange(true, true);
        if (!range) return;
        loadReport(range);
    }
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
    const handleEmptyOrError = (message, options = {}) => {
        const { preserveCache = false } = options;
        if (!preserveCache) {
            ingredientDataCache = { daily: [], logs: [] };
            ingredientMenuFlavorGroups = {};
            menuRecipes = {};
            menuConsumption = {};
        }
        const dataset = ingredientDataCache || { daily: [], logs: [] };
        const details = document.getElementById('ingredient-details');
        if (details) details.innerHTML = `<div class="ingredient-menu-item">${message}</div>`;
        baseData = dataset;
        const currentViewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
        const tableSearch = document.getElementById('table-search-input');
        const term = tableSearch ? tableSearch.value.toLowerCase() : '';
        const source = dataset[currentViewMode] || [];
        filteredData = term ? source.filter(i => 
            (i.menu_name || '').toLowerCase().includes(term) ||
            (i.flavor || '').toLowerCase().includes(term) ||
            (i.order_id || '').toLowerCase().includes(term) ||
            (i.date || '').toLowerCase().includes(term) ||
            (i.status_text || '').toLowerCase().includes(term)
        ) : [...source];
        reportCurrentPage = 1;
        renderReportTable();
        updateReportPagination();
        renderIngredientAnalysis(dataset);
        updateIngredientSummary(dataset);
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
        let startVal = (startEl && startEl.value) ? startEl.value : (globalStartEl && globalStartEl.value ? globalStartEl.value : '');
        let endVal = (endEl && endEl.value) ? endEl.value : (globalEndEl && globalEndEl.value ? globalEndEl.value : '');

        // If both dates are empty, default to today and reflect it in the inputs
        if (!startVal && !endVal) {
            const today = new Date();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, '0');
            const d = String(today.getDate()).padStart(2, '0');
            const todayIso = `${y}-${m}-${d}`;
            startVal = todayIso;
            endVal = todayIso;
            if (globalStartEl && !globalStartEl.value) globalStartEl.value = todayIso;
            if (globalEndEl && !globalEndEl.value) globalEndEl.value = todayIso;
            if (startEl && !startEl.value) startEl.value = todayIso;
            if (endEl && !endEl.value) endEl.value = todayIso;
            const periodSelect = document.getElementById('period-select');
            if (periodSelect && periodSelect.value !== 'today') periodSelect.value = 'today';
        }

        const validation = validateIngredientDateRange(startVal, endVal);
        [startEl, endEl].forEach(el => { if (el) el.classList.remove('input-error'); });
        if (!validation.valid) {
            if (validation.fields.start && startEl) startEl.classList.add('input-error');
            if (validation.fields.end && endEl) endEl.classList.add('input-error');
            handleEmptyOrError(validation.message || 'Rentang tanggal tidak valid', { preserveCache: true });
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
                const fname = normalizeFlavorForKey(m.flavor_name || m.flavor || '');
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
                let menuFlavorGroups = {}; // Initialize menu groups (merged across flavors)
                
                let logsRowsFinal = [];
                let dailyRowsFinal = [];

                if (viewMode === 'logs') {
                    // Aggregated logs by menu across date range (flavors merged)
                            // continue building datasets below

                    // Build detail groups for panel by fetching logs within same range
                    const qsLogsForGroups = new URLSearchParams({ limit: '2000' });
                    if (startParam) qsLogsForGroups.append('start_date', startParam);
                    if (endParam) qsLogsForGroups.append('end_date', endParam);
                    const logsRes = await fetch(`/inventory/history?${qsLogsForGroups.toString()}`);
                    const logsJson = await logsRes.json().catch(() => ({ history: [] }));
                    const logs = Array.isArray(logsJson.history) ? logsJson.history : [];
                    // Precompute range label for logs view clarity
                    const toDisp = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ? `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}` : (iso || '-');
                    const dateLabel = (startParam && endParam)
                        ? `${toDisp(startParam)} - ${toDisp(endParam)}`
                        : (startParam ? toDisp(startParam) : (endParam ? toDisp(endParam) : '-'));
                    for (const log of logs) {
                        // Skip rolled back or not yet consumed logs
                        if (!log || log.rolled_back) continue;
                        if (typeof log.consumed === 'boolean' && !log.consumed) continue;
                        const iso = getLogIsoDate(log);
                        if (!iso) continue;
                        const rawDisplay = dateLabel; // show selected range instead of per-log date
                        const kitchenOrder = kitchenOrdersCache.find(o => String(o.order_id) === String(log.order_id));
                        // Strictly allow only orders with DONE status
                        if (kitchenOrder && String(kitchenOrder.status).toLowerCase() === 'done' && kitchenOrder.items && kitchenOrder.items.length > 0) {
                            // Distribute ingredient usage proportionally by item quantity
                            const totalQty = kitchenOrder.items.reduce((a, it) => a + (Number(it.quantity) || 0), 0) || 1;
                            for (const menuItem of kitchenOrder.items) {
                                const menuName = menuItem.menu_name || 'Unknown Menu';
                                const qty = Number(menuItem.quantity || 0) || 0;
                                const share = Math.round((Number(log.ingredients_affected || 0) * qty) / totalQty);
                                const key = `${menuName}`;
                                if (!menuFlavorGroups[key]) {
                                    menuFlavorGroups[key] = {
                                        menu_name: menuName,
                                        flavor: '-',
                                        total_orders: 0,
                                        total_ingredients: 0,
                                        order_ids: new Set(),
                                        date: rawDisplay,
                                        status_text: 'Selesai'
                                    };
                                }
                                menuFlavorGroups[key].total_orders += qty;
                                menuFlavorGroups[key].total_ingredients += share;
                                menuFlavorGroups[key].order_ids.add(log.order_id);
                            }
                        } else if (kitchenOrder && String(kitchenOrder.status).toLowerCase() === 'done') {
                            // Fallback only when order is confirmed DONE but items are unavailable: use per_menu_payload
                            let payload = log.per_menu_payload;
                            if (typeof payload === 'string') {
                                try { payload = JSON.parse(payload); } catch { payload = null; }
                            }
                            if (Array.isArray(payload) && payload.length) {
                                const totalQty = payload.reduce((a, p) => a + (Number(p.quantity) || 0), 0) || 1;
                                for (const p of payload) {
                                    const menuName = p.name || p.menu_name || 'Unknown Menu';
                                    const qty = Number(p.quantity || 0) || 0;
                                    const share = Math.round((Number(log.ingredients_affected || 0) * qty) / totalQty);
                                    const key = `${menuName}`;
                                    if (!menuFlavorGroups[key]) {
                                        menuFlavorGroups[key] = {
                                            menu_name: menuName,
                                            flavor: '-',
                                            total_orders: 0,
                                            total_ingredients: 0,
                                            order_ids: new Set(),
                                            date: rawDisplay,
                                            status_text: 'Selesai'
                                        };
                                    }
                                    menuFlavorGroups[key].total_orders += qty;
                                    menuFlavorGroups[key].total_ingredients += share;
                                    menuFlavorGroups[key].order_ids.add(log.order_id);
                                }
                            }
                        } else {
                            // No kitchen order or not DONE: skip to enforce DONE-only policy
                            continue;
                        }
                    }
                    logsRowsFinal = Object.values(menuFlavorGroups).map(group => ({
                        menu_name: group.menu_name,
                        date: group.date,
                        status_text: `${group.total_orders} order`,
                        order_count: group.total_orders,
                        ingredients_affected: group.total_ingredients,
                        total_qty: group.total_ingredients,
                        order_ids: Array.from(group.order_ids),
                        order_id: Array.from(group.order_ids)[0] || ''
                    }));
                    dailyRowsFinal = ingredientRows;
                } else {
                    // Logs view: aggregate across selected range by menu (flavors merged)
                    const qsLogs = new URLSearchParams({ limit: '2000' });
                    if (startParam) qsLogs.append('start_date', startParam);
                    if (endParam) qsLogs.append('end_date', endParam);
                    const logsRes = await fetch(`/inventory/history?${qsLogs.toString()}`);
                    const logsJson = await logsRes.json().catch(() => ({ history: [] }));
                    const logs = Array.isArray(logsJson.history) ? logsJson.history : [];

                    // Build groups using kitchen orders when available; fallback to per_menu_payload
                    const groups = {};
                    const toDisp = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ? `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}` : (iso || '-');
                    const dateLabel = (startParam && endParam)
                        ? `${toDisp(startParam)} - ${toDisp(endParam)}`
                        : (startParam ? toDisp(startParam) : (endParam ? toDisp(endParam) : '-'));

                    for (const log of logs) {
                        // Skip rolled back or not yet consumed logs
                        if (!log || log.rolled_back) continue;
                        if (typeof log.consumed === 'boolean' && !log.consumed) continue;
                        const ingAffected = Number(log.ingredients_affected || 0);
                        const kOrder = kitchenOrdersCache.find(o => String(o.order_id) === String(log.order_id));
                        if (kOrder && String(kOrder.status).toLowerCase() === 'done' && Array.isArray(kOrder.items) && kOrder.items.length) {
                            const totalQty = kOrder.items.reduce((a, it) => a + (Number(it.quantity) || 0), 0) || 1;
                            for (const it of kOrder.items) {
                                const menuName = it.menu_name || 'Unknown Menu';
                                const qty = Number(it.quantity || 0) || 0;
                                const share = Math.round((ingAffected * qty) / totalQty);
                                const key = `${menuName}`;
                                if (!groups[key]) {
                                    groups[key] = { menu_name: menuName, flavor: '-', total_orders: 0, total_ingredients: 0, order_ids: new Set(), date: dateLabel, status_text: 'Selesai' };
                                }
                                groups[key].total_orders += qty;
                                groups[key].total_ingredients += share;
                                groups[key].order_ids.add(log.order_id);
                            }
                        } else if (kOrder && String(kOrder.status).toLowerCase() === 'done') {
                            let payload = log.per_menu_payload; if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
                            if (Array.isArray(payload) && payload.length) {
                                const totalQty = payload.reduce((a, p) => a + (Number(p.quantity)||0), 0) || 1;
                                for (const p of payload) {
                                    const menuName = p.name || p.menu_name || 'Unknown Menu';
                                    const qty = Number(p.quantity || 0) || 0;
                                    const share = Math.round((ingAffected * qty) / totalQty);
                                    const key = `${menuName}`;
                                    if (!groups[key]) {
                                        groups[key] = { menu_name: menuName, flavor: '-', total_orders: 0, total_ingredients: 0, order_ids: new Set(), date: dateLabel, status_text: 'Selesai' };
                                    }
                                    groups[key].total_orders += qty;
                                    groups[key].total_ingredients += share;
                                    groups[key].order_ids.add(log.order_id);
                                }
                            }
                        } else {
                            // No DONE kitchen order -> skip to enforce DONE-only
                            continue;
                        }
                    }

                    menuFlavorGroups = groups;
                    logsRowsFinal = Object.values(groups).map(g => ({
                        menu_name: g.menu_name,
                        date: g.date,
                        status_text: `${g.total_orders} order`,
                        order_count: g.total_orders,
                        ingredients_affected: g.total_ingredients,
                        total_qty: g.total_ingredients,
                        order_ids: Array.from(g.order_ids),
                        order_id: Array.from(g.order_ids)[0] || ''
                    }));
                    ingredientRows = logsRowsFinal;
                }
                
                // Also create daily aggregated data for daily view
                const dailyGroups = {};
                for (const group of Object.values(menuFlavorGroups)) {
                    // Skip non-completed if any slipped through
                    if ((group.status_text || '').toLowerCase().includes('receive')) continue;
                    const dateKey = group.date;
                    if (!dailyGroups[dateKey]) {
                        dailyGroups[dateKey] = {
                            date: dateKey,
                            total_ingredients: 0,
                            total_orders: 0,
                            order_ids: new Set(),
                            status_text: 'Selesai'
                        };
                    }
                    dailyGroups[dateKey].total_ingredients += group.total_ingredients;
                    dailyGroups[dateKey].total_orders += group.total_orders;
                    group.order_ids.forEach(id => dailyGroups[dateKey].order_ids.add(id));
                }
                
                // Create daily rows
                const dailyRows = Object.values(dailyGroups).map(group => {
                    // group.date should be in DD/MM/YYYY or YYYY-MM-DD format
                    let displayDate = group.date;
                    let isoDate = group.date;
                    
                    // Convert to proper formats if needed
                    if (/^\d{2}\/\d{2}\/\d{4}$/.test(group.date)) {
                        // Already DD/MM/YYYY
                        const parts = group.date.split('/');
                        isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(group.date)) {
                        // YYYY-MM-DD, convert to DD/MM/YYYY for display
                        const parts = group.date.split('-');
                        displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
                        isoDate = group.date;
                    }
                    
                    return {
                        date: displayDate, // Display format DD/MM/YYYY
                        date_iso: isoDate, // ISO format YYYY-MM-DD for API calls
                        status_text: `${group.total_orders} completed orders`,
                        ingredients_affected: group.total_ingredients,
                        order_id: Array.from(group.order_ids)[0] || '',
                        menu_name: undefined,
                        flavor: undefined,
                        order_ids: Array.from(group.order_ids),
                        total_qty: group.total_ingredients,
                        daily_summary: {
                            total_orders: group.total_orders,
                            unique_menus: group.unique_menus ? group.unique_menus.size || group.unique_menus : 0,
                            total_consumption: group.total_ingredients,
                            order_ids: Array.from(group.order_ids)
                        }
                    };
                });
                
                // Debug: log the data structure
                console.log('Ingredient rows data:', ingredientRows);
                console.log('Daily rows data:', dailyRows);
                console.log('Sample item structure:', ingredientRows[0]);
                
                // Store both data sets
                // Ensure cache keys always map to the correct datasets (logs vs daily), independent of current view
                if (!logsRowsFinal.length) logsRowsFinal = ingredientRows; // when built in logs branch
                if (!dailyRowsFinal.length) dailyRowsFinal = dailyRows;    // when built in logs branch
                ingredientDataCache = {
                    logs: logsRowsFinal,
                    daily: dailyRowsFinal
                };
                baseData = ingredientDataCache;
                // Expose groups globally for details panel usage
                ingredientMenuFlavorGroups = menuFlavorGroups;
                
                // Get current view mode and set appropriate data
                const currentViewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
                const currentViewData = (ingredientDataCache && ingredientDataCache[currentViewMode]) ? ingredientDataCache[currentViewMode] : [];
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
                const isLogs = (currentViewMode === 'logs');
                filteredData = term
                    ? currentViewData.filter(i => isLogs
                        ? ((i.menu_name || '').toLowerCase().includes(term) || (i.date || '').toLowerCase().includes(term) || (i.status_text || '').toLowerCase().includes(term))
                        : ((i.date || '').toLowerCase().includes(term) || (i.daily_summary ? `${i.daily_summary.total_orders}` : '').includes(term))
                    )
                    : [...currentViewData];
                reportCurrentPage = 1;
                renderReportTable();
                updateReportPagination();
                renderIngredientAnalysis(ingredientDataCache);
                updateIngredientSummary(ingredientDataCache);
            } else {
                // Fallback: proceed building datasets from backend even if recipes are unavailable
                const viewSelect = document.getElementById('ingredient-view-select');
                const viewMode = viewSelect ? viewSelect.value : 'daily';
                const globalStartEl = document.getElementById('start_date');
                const globalEndEl = document.getElementById('end_date');
                const startParam = (startEl && startEl.value) ? startEl.value : (globalStartEl && globalStartEl.value ? globalStartEl.value : null);
                const endParam = (endEl && endEl.value) ? endEl.value : (globalEndEl && globalEndEl.value ? globalEndEl.value : null);

                // Daily
                const qsDailyAgg = new URLSearchParams(); if (startParam) qsDailyAgg.append('start_date', startParam); if (endParam) qsDailyAgg.append('end_date', endParam);
                const dailyRes = await fetch(`/inventory/consumption/daily?${qsDailyAgg.toString()}`);
                const dailyJson = await dailyRes.json().catch(() => ({ data: { daily_consumption: [] }}));
                const daily = (dailyJson && dailyJson.data && Array.isArray(dailyJson.data.daily_consumption)) ? dailyJson.data.daily_consumption : [];
                const dailyRowsFinal = daily.map(d => {
                    const dateIso = d.date || (d.date_formatted ? d.date_formatted.split('/').reverse().join('-') : null);
                    const displayDate = d.date_formatted || (dateIso ? `${dateIso.split('-')[2]}/${dateIso.split('-')[1]}/${dateIso.split('-')[0]}` : '-');
                    const totalOrders = Number(d.total_orders || d.summary?.total_orders || 0);
                    const totalConsumption = Number(d.summary?.total_quantity_consumed || d.ingredients_consumed?.reduce((a,x)=>a+(x.total_consumed||0),0) || 0);
                    return { order_id: `Daily ${displayDate}`, date: displayDate, status_text: `${totalOrders} order • ${Number(d.summary?.total_ingredients_types || 0)} menu/bahan`, ingredients_affected: totalConsumption, total_qty: totalConsumption, daily_summary: { total_orders: totalOrders, unique_menus: Number(d.summary?.total_ingredients_types || 0), total_consumption: totalConsumption, order_ids: [] } };
                }).sort((a,b)=>{ const toIso=(s)=>/^\d{2}\/\d{2}\/\d{4}$/.test(s)?`${s.split('/')[2]}-${s.split('/')[1]}-${s.split('/')[0]}`:s; return toIso(b.date).localeCompare(toIso(a.date)); });

                // Logs per-order (grouped by menu only)
                const qsLogs = new URLSearchParams({ limit: '500' }); if (startParam) qsLogs.append('start_date', startParam); if (endParam) qsLogs.append('end_date', endParam);
                const logsRes = await fetch(`/inventory/history?${qsLogs.toString()}`);
                const logsJson = await logsRes.json().catch(() => ({ history: [] }));
                const logs = Array.isArray(logsJson.history) ? logsJson.history : [];
                // Filter only consumed logs and DONE orders
                const filteredLogs = logs.filter(log => {
                    if (!log || log.rolled_back) return false;
                    if (typeof log.consumed === 'boolean' && !log.consumed) return false;
                    const kOrder = Array.isArray(kitchenOrdersCache)
                        ? kitchenOrdersCache.find(o => String(o.order_id) === String(log.order_id))
                        : null;
                    if (!kOrder || String(kOrder.status).toLowerCase() !== 'done') return false;
                    return true;
                });
                const ingredientRows = filteredLogs.map(log => {
                    const iso = getLogIsoDate(log);
                    const displayDate = iso ? `${iso.split('-')[2]}/${iso.split('-')[1]}/${iso.split('-')[0]}` : (log.date || '-');
                    const statusText = 'Selesai';
                    return { order_id: log.order_id, date: displayDate, ingredients_affected: Number(log.ingredients_affected || 0), status_text: statusText };
                });

                ingredientDataCache = { logs: ingredientRows, daily: dailyRowsFinal };
                baseData = ingredientDataCache;
                ingredientMenuFlavorGroups = {};

                const currentViewMode = viewMode; const currentViewData = ingredientDataCache[currentViewMode] || [];
                updateReportTableHeader();
                const tableSearch = document.getElementById('table-search-input'); const term = tableSearch ? tableSearch.value.toLowerCase() : '';
                filteredData = term ? currentViewData.filter(i => (i.order_id||'').toLowerCase().includes(term) || (i.date||'').toLowerCase().includes(term) || (i.status_text||'').toLowerCase().includes(term)) : [...currentViewData];
                reportCurrentPage = 1; renderReportTable(); updateReportPagination(); renderIngredientAnalysis(ingredientDataCache); updateIngredientSummary(ingredientDataCache);
            }
        } else {
            // Fallback when there are no completed kitchen orders: build from inventory daily & logs directly
            const viewSelect = document.getElementById('ingredient-view-select');
            const viewMode = viewSelect ? viewSelect.value : 'daily';
            const globalStartEl = document.getElementById('start_date');
            const globalEndEl = document.getElementById('end_date');
            const startParam = (startEl && startEl.value) ? startEl.value : (globalStartEl && globalStartEl.value ? globalStartEl.value : null);
            const endParam = (endEl && endEl.value) ? endEl.value : (globalEndEl && globalEndEl.value ? globalEndEl.value : null);

            const qsDailyAgg = new URLSearchParams(); if (startParam) qsDailyAgg.append('start_date', startParam); if (endParam) qsDailyAgg.append('end_date', endParam);
            const dailyRes = await fetch(`/inventory/consumption/daily?${qsDailyAgg.toString()}`);
            const dailyJson = await dailyRes.json().catch(() => ({ data: { daily_consumption: [] }}));
            const daily = (dailyJson && dailyJson.data && Array.isArray(dailyJson.data.daily_consumption)) ? dailyJson.data.daily_consumption : [];
            const dailyRowsFinal = daily.map(d => {
                // Use the actual date from response (YYYY-MM-DD), not range
                const dateIso = d.date || (d.date_formatted ? d.date_formatted.split('/').reverse().join('-') : null);
                const displayDate = d.date_formatted || (dateIso ? `${dateIso.split('-')[2]}/${dateIso.split('-')[1]}/${dateIso.split('-')[0]}` : '-');
                const totalOrders = Number(d.total_orders || d.summary?.total_orders || 0);
                const totalConsumption = Number(d.summary?.total_quantity_consumed || d.ingredients_consumed?.reduce((a,x)=>a+(x.total_consumed||0),0) || 0);
                return { 
                    order_id: `Daily ${displayDate}`, 
                    date: displayDate, // This should be single date like "03/10/2025", NOT range
                    date_iso: dateIso, // Store ISO format for API calls
                    status_text: `${totalOrders} order • ${Number(d.summary?.total_ingredients_types || 0)} menu/bahan`, 
                    ingredients_affected: totalConsumption, 
                    total_qty: totalConsumption, 
                    daily_summary: { 
                        total_orders: totalOrders, 
                        unique_menus: Number(d.summary?.total_ingredients_types || 0), 
                        total_consumption: totalConsumption, 
                        order_ids: [] 
                    } 
                };
            }).sort((a,b)=>{ const toIso=(s)=>/^\d{2}\/\d{2}\/\d{4}$/.test(s)?`${s.split('/')[2]}-${s.split('/')[1]}-${s.split('/')[0]}`:s; return toIso(b.date).localeCompare(toIso(a.date)); });

            const qsLogs = new URLSearchParams({ limit: '500' }); if (startParam) qsLogs.append('start_date', startParam); if (endParam) qsLogs.append('end_date', endParam);
            const logsRes = await fetch(`/inventory/history?${qsLogs.toString()}`);
            const logsJson = await logsRes.json().catch(() => ({ history: [] }));
            const logs = Array.isArray(logsJson.history) ? logsJson.history : [];
                const rows = [];
            for (const log of logs) {
                const orderId = log.order_id; const ingAffected = Number(log.ingredients_affected || 0);
                // Exclude rolled back or not-yet-consumed logs
                if (!log || log.rolled_back) continue;
                if (typeof log.consumed === 'boolean' && !log.consumed) continue;
                // Only include logs for orders that are confirmed 'done' in kitchen cache
                const kOrder = Array.isArray(kitchenOrdersCache)
                  ? kitchenOrdersCache.find(o => String(o.order_id) === String(orderId))
                  : null;
                if (!kOrder || String(kOrder.status).toLowerCase() !== 'done') {
                    continue;
                }
                const iso = getLogIsoDate(log);
                const displayDate = iso ? `${iso.split('-')[2]}/${iso.split('-')[1]}/${iso.split('-')[0]}` : (log.date || '-');
                let payload = log.per_menu_payload; if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
                if (Array.isArray(payload) && payload.length) {
                    const totalQty = payload.reduce((a, p) => a + (Number(p.quantity)||0), 0) || 1;
                    for (const p of payload) {
                        const menuName = p.name || p.menu_name || 'Unknown Menu'; const qty = Number(p.quantity || 0) || 0; const share = Math.round((ingAffected * qty) / totalQty);
                        rows.push({ menu_name: menuName, flavor: '-', date: displayDate, status_text: 'Selesai', order_count: qty, ingredients_affected: share, total_qty: share, order_ids: [orderId], order_id: orderId });
                    }
                } else {
                    rows.push({ menu_name: '-', flavor: '-', date: displayDate, status_text: 'Selesai', order_count: 1, ingredients_affected: ingAffected, total_qty: ingAffected, order_ids: [orderId], order_id: orderId });
                }
            }
                // Merge by menu only across the selected date range
                const menuAgg = {};
                for (const r of rows) {
                    const key = `${r.menu_name}`;
                    if (!menuAgg[key]) {
                        // For logs view, date can be range since it aggregates across period
                        const dateRange = `${startParam ? `${startParam.split('-').reverse().join('/')}` : '-'}${endParam ? ` - ${endParam.split('-').reverse().join('/')}` : ''}`.trim();
                        menuAgg[key] = { 
                            menu_name: r.menu_name, 
                            date: dateRange, // Range for logs view
                            status_text: 'Selesai', 
                            order_count: 0, 
                            ingredients_affected: 0, 
                            total_qty: 0, 
                            order_ids: new Set() 
                        };
                    }
                    menuAgg[key].order_count += Number(r.order_count || 0);
                    menuAgg[key].ingredients_affected += Number(r.ingredients_affected || 0);
                    menuAgg[key].total_qty += Number(r.total_qty || 0);
                    (r.order_ids || []).forEach(id => menuAgg[key].order_ids.add(id));
                }
                const logsRowsFinal = Object.values(menuAgg).map(g => ({ menu_name: g.menu_name, date: g.date, status_text: `${g.order_count} order`, order_count: g.order_count, ingredients_affected: g.ingredients_affected, total_qty: g.total_qty, order_ids: Array.from(g.order_ids), order_id: Array.from(g.order_ids)[0] || '' }));

                const menuFlavorGroups = {}; for (const r of logsRowsFinal) { const key = `${r.menu_name}`; if (!menuFlavorGroups[key]) { menuFlavorGroups[key] = { menu_name: r.menu_name, flavor: '-', total_orders: 0, total_ingredients: 0, order_ids: new Set(), date: r.date, status_text: r.status_text }; } menuFlavorGroups[key].total_orders += Number(r.order_count||0); menuFlavorGroups[key].total_ingredients += Number(r.ingredients_affected||0); (r.order_ids||[]).forEach(id => menuFlavorGroups[key].order_ids.add(id)); }

            ingredientDataCache = { logs: logsRowsFinal, daily: dailyRowsFinal };
            baseData = ingredientDataCache; ingredientMenuFlavorGroups = menuFlavorGroups;
            const currentViewMode = viewMode; const currentViewData = ingredientDataCache[currentViewMode] || [];
            updateReportTableHeader();
            const tableSearch = document.getElementById('table-search-input'); const term = tableSearch ? tableSearch.value.toLowerCase() : '';
            filteredData = term ? currentViewData.filter(i => (i.menu_name||'').toLowerCase().includes(term) || (i.order_id||'').toLowerCase().includes(term) || (i.date||'').toLowerCase().includes(term) || (i.status_text||'').toLowerCase().includes(term)) : [...currentViewData];
            reportCurrentPage = 1; renderReportTable(); updateReportPagination(); renderIngredientAnalysis(ingredientDataCache); updateIngredientSummary(ingredientDataCache);
        }
        
        hideLoading();
    } catch (error) {
        console.error('Error loading ingredient analysis data:', error);
        hideLoading();
        alert('Failed to load material analysis data.');
        
        handleEmptyOrError('Error occurred during data loading.', { preserveCache: true });
    }
}

function renderIngredientAnalysis(dataset = null) {
    renderIngredientConsumptionChart(dataset);
    renderIngredientConsumptionDetails();
    renderIngredientConsumptionTable();
}

function renderIngredientConsumptionChart(dataset = null) {
    const ctx = document.getElementById('ingredientChart');
    if (!ctx) return;
    if (ingredientChart) ingredientChart.destroy();
    const source = dataset ?? ingredientDataCache ?? baseData;
    let rows = [];
    if (Array.isArray(source)) {
        rows = source;
    } else if (source && typeof source === 'object') {
        rows = source.daily || [];
    }
    const labels = rows.map(r => r.date || r.order_id || '-');
    const totals = rows.map(r => Number(r.total_qty || r.ingredients_affected || 0));
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
    // Build per-item entries from DONE kitchen orders within the selected ingredient/global date range
    const startVal = document.getElementById('ingredient-start-date')?.value || document.getElementById('start_date')?.value || '';
    const endVal = document.getElementById('ingredient-end-date')?.value || document.getElementById('end_date')?.value || '';
    const startTs = startVal ? new Date(startVal + 'T00:00:00') : null;
    const endTs = endVal ? new Date(endVal + 'T23:59:59') : null;

    const orders = Array.isArray(kitchenOrdersCache) ? kitchenOrdersCache : [];
    const rows = [];
    for (const o of orders) {
        if (!o || String(o.status).toLowerCase() !== 'done') continue;
        const tsRaw = o.time_done || o.time_done_at || o.time || o.created_at || o.updated_at || '';
        if (!tsRaw) continue;
        const dt = new Date(tsRaw);
        if (startTs && dt < startTs) continue;
        if (endTs && dt > endTs) continue;
        const dateDisp = (() => { try { return dt.toLocaleString('id-ID'); } catch { return tsRaw; } })();
        const orderId = o.order_id || o.id || '';
        const arr = Array.isArray(o.items) ? o.items : [];
        for (const it of arr) {
            rows.push({
                date: dateDisp,
                order_id: String(orderId),
                menu: it?.menu_name || '-',
                flavor: normalizeFlavorForKey(getItemFlavorRaw(it)) || '-',
                qty: Number(it?.quantity || 0) || 0,
            });
        }
    }

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#6B7280; padding: 1rem;">Tidak ada item pada rentang tanggal ini.</td></tr>';
        return;
    }

    // Sort by date desc, then order id, then menu
    rows.sort((a,b) => String(b.date).localeCompare(String(a.date))
        || String(a.order_id).localeCompare(String(b.order_id))
        || String(a.menu).localeCompare(String(b.menu)));

    tbody.innerHTML = rows.map((r, idx) => `
        <tr style="border-bottom: 1px solid #F3F4F6;">
            <td>${idx + 1}</td>
            <td style="white-space: nowrap;">${r.date}</td>
            <td style="font-family: 'Courier New', monospace;">${r.order_id}</td>
            <td>${r.menu}</td>
            <td>${r.flavor}</td>
            <td style="text-align:right;">${r.qty.toLocaleString('id-ID')}</td>
        </tr>
    `).join('');
}

function updateIngredientSummary(dataset = null) {
    const source = dataset ?? ingredientDataCache ?? baseData;
    const currentViewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
    const summaryPeriod = document.getElementById('summary-period');
    const summaryIncome = document.getElementById('summary-income');
    const summaryOrders = document.getElementById('summary-orders');

    const dailyRows = Array.isArray(source)
        ? source
        : (source && typeof source === 'object' ? (source.daily || []) : []);
    const logsRows = Array.isArray(source)
        ? source
        : (source && typeof source === 'object' ? (source.logs || []) : []);

    let totalOrders = 0;
    let totalIngredients = 0;
    const uniqueMenus = new Set();

    if (dailyRows.length) {
        dailyRows.forEach(item => {
            const summary = item.daily_summary || {};
            totalOrders += summary.total_orders || 0;
            totalIngredients += summary.total_consumption || 0;
        });
    } else {
        logsRows.forEach(item => {
            const orderCount = Number(item.order_count || (Array.isArray(item.order_ids) ? item.order_ids.length : 0));
            totalOrders += orderCount;
            totalIngredients += Number(item.ingredients_affected || item.total_qty || 0);
        });
    }

    logsRows.forEach(item => {
        if (item.menu_name) uniqueMenus.add(item.menu_name);
    });

    const ingredientStart = document.getElementById('ingredient-start-date')?.value;
    const ingredientEnd = document.getElementById('ingredient-end-date')?.value;
    const globalStart = document.getElementById('start_date')?.value;
    const globalEnd = document.getElementById('end_date')?.value;

    if (summaryPeriod) {
        const startLabel = ingredientStart || globalStart || 'N/A';
        const endLabel = ingredientEnd || globalEnd || 'N/A';
        summaryPeriod.textContent = `${startLabel} - ${endLabel}`;
    }

    if (summaryIncome) {
        summaryIncome.textContent = `${totalIngredients.toLocaleString('id-ID')} bahan`;
    }

    if (summaryOrders) {
        summaryOrders.textContent = `${totalOrders.toLocaleString('id-ID')} pesanan`;
    }

    let uniqueMenuCount = uniqueMenus.size;
    if (!uniqueMenuCount && dailyRows.length) {
        uniqueMenuCount = dailyRows.reduce((acc, item) => acc + (item.daily_summary?.unique_menus || 0), 0);
    }

    const totalMenuEl = document.getElementById('ingredient-total-menu');
    if (totalMenuEl) totalMenuEl.textContent = uniqueMenuCount ? uniqueMenuCount : '-';

    const totalIngredientsEl = document.getElementById('ingredient-total-ingredients');
    if (totalIngredientsEl) totalIngredientsEl.textContent = totalIngredients.toLocaleString('id-ID');

    const mostIngredientsEl = document.getElementById('ingredient-most-ingredients');
    if (mostIngredientsEl) {
        const topMenu = logsRows.reduce((acc, item) => {
            const qty = Number(item.ingredients_affected || item.total_qty || 0);
            if (!acc || qty > acc.qty) {
                return { name: item.menu_name || '-', qty };
            }
            return acc;
        }, null);
        mostIngredientsEl.textContent = topMenu && topMenu.name ? `${topMenu.name} (${topMenu.qty.toLocaleString('id-ID')} bahan)` : '-';
    }

    const mostUsedEl = document.getElementById('ingredient-most-used');
    if (mostUsedEl) {
        mostUsedEl.textContent = currentViewMode === 'logs' ? 'Lihat detail per order 👀' : '-';
    }
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
         // Clean up any previously injected per-item breakdown container
         const prevBreakdown = document.getElementById('order-item-breakdown');
         if (prevBreakdown && prevBreakdown.parentElement) {
             prevBreakdown.parentElement.removeChild(prevBreakdown);
         }
         if (panel) panel.classList.remove('hidden');
         
         if (isAggregated) {
            // Switch header to menu breakdown for daily view (6 columns)
            if (headRow) {
                headRow.innerHTML = `
                    <th>No</th>
                    <th>Menu</th>
                    <th>Total Pesanan</th>
                    <th>Total Bahan</th>
                    <th>Action</th>`;
            }
            // For daily view, try to find the item in filteredData to get date_iso
            let dateParam = dateStr;
            const dailyItem = filteredData.find(item => item.date === dateStr && item.daily_summary);
            if (dailyItem && dailyItem.date_iso) {
                // Use the ISO date if available
                dateParam = dailyItem.date_iso;
            } else {
                // Fallback: sanitize and convert to ISO
                let displayDate = dateStr || '';
                if (displayDate.includes(' - ')) {
                    displayDate = displayDate.split(' - ')[0].trim();
                }
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(displayDate)) {
                    const [dd, mm, yyyy] = displayDate.split('/');
                    dateParam = `${yyyy}-${mm}-${dd}`;
                } else if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) {
                    dateParam = displayDate;
                }
            }
            // Determine if the user clicked a single-day row or a synthetic aggregated range row.
            // If original dateStr contains a range pattern (DD/MM/YYYY - DD/MM/YYYY), DO NOT force single date.
            const isRangePattern = typeof dateStr === 'string' && dateStr.includes(' - ');
            const forceSingle = !isRangePattern; // only force single when not a range
            await showDailyAggregatedConsumption(dateStr, statusText, dateParam, forceSingle);
             return;
        } else {
            // In non-aggregated (per-order) view, switch columns depending on current mode
            const currentViewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
            if (headRow) {
                if (currentViewMode === 'logs') {
                    // Logs mode: show per item menu rows (without Item ID column)
                    headRow.innerHTML = `
                        <th>No</th>
                        <th>Menu</th>
                        <th>Flavor</th>
                        <th>Qty</th>
                        <th>Action</th>`;
                } else {
                    // Other modes (safety): keep ingredient detail columns
                    headRow.innerHTML = `
                        <th>No</th>
                        <th>Ingredient Name</th>
                        <th>Qty Terpakai</th>
                        <th>Unit</th>
                        <th>Stok Sebelum</th>
                        <th>Stok Sesudah</th>`;
                }
            }
        }

    // For per-order logs view, prefer direct inventory proxy
    const res = await fetch(`/order/${encodeURIComponent(orderId)}/ingredients`, { cache: 'no-store' });
        
        // Check if response is ok
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        
    const json = await res.json();
        
    // Handle different possible response structures
        let details = json?.ingredients_breakdown?.details ||
                        json?.data?.ingredients_breakdown?.details ||
                       json?.details || 
                       [];
    // Extract per-order item breakdown when available
        let perItem = json?.data?.menu_breakdown || json?.menu_breakdown || [];
        // Save breakdown for later per-item ingredient lookups
        const ib = json?.ingredients_breakdown || json?.data?.ingredients_breakdown || {};
        currentPerOrderBreakdown = {
            orderId: String(orderId),
            menu_breakdown: Array.isArray(perItem) ? perItem : [],
            details: Array.isArray(ib?.details) ? ib.details : (Array.isArray(json?.details) ? json.details : [])
        };

        // Fallback: If order is not 'done' status, try fetching from inventory consumption log
        if ((!Array.isArray(details) || details.length === 0) && json?.message?.includes("tidak berstatus 'done'")) {
            console.warn('[Fallback] Order not done, fetching from inventory consumption log:', orderId);
            try {
                const invResp = await fetch(`/inventory/consumption_log/${encodeURIComponent(orderId)}`);
                if (invResp.ok) {
                    const invJson = await invResp.json();
                    if (invJson.status === 'success' && invJson.data) {
                        const invData = invJson.data;
                        // Map consumption log structure to expected details format
                        details = (invData.ingredient_details || []).map(ing => ({
                            ingredient_name: ing.ingredient_name,
                            consumed_quantity: ing.quantity_consumed,
                            unit: ing.unit,
                            stock_before_consumption: ing.stock_before,
                            stock_after_consumption: ing.stock_after
                        }));
                        // Try to build per-item breakdown from menu_items if available
                        if (invData.menu_items && Array.isArray(invData.menu_items)) {
                            perItem = invData.menu_items.map(item => ({
                                menu_name: item.menu_name,
                                preference: item.preference || '',
                                quantity: item.quantity || 1,
                                ingredients: [] // Inventory log doesn't provide per-menu ingredient breakdown
                            }));
                        }
                        console.log('[Fallback] Successfully loaded from inventory consumption log:', details.length, 'ingredients');
                    }
                } else {
                    console.warn('[Fallback] Inventory consumption log fetch failed:', invResp.status);
                }
            } catch (invErr) {
                console.error('[Fallback] Error fetching inventory consumption log:', invErr);
            }
        }

        // Render table content depending on current mode
        const currentViewModeAfterFetch = document.getElementById('ingredient-view-select')?.value || 'daily';
        if (currentViewModeAfterFetch === 'logs') {
            // Build per-item rows as the main details content
            let perItemArr = Array.isArray(perItem) ? perItem : [];
            if (!perItemArr.length) {
                const kOrder = Array.isArray(kitchenOrdersCache)
                    ? kitchenOrdersCache.find(o => String(o.order_id) === String(orderId) || String(o.id) === String(orderId))
                    : null;
                if (kOrder && Array.isArray(kOrder.items)) {
                    perItemArr = kOrder.items.map((it, idx) => ({
                        item_id: it?.id ?? it?.item_id ?? it?._id ?? `${orderId}-${idx}-${(it?.menu_name || 'item')}`,
                        menu_name: it?.menu_name || '-',
                        flavor: normalizeFlavorForKey(getItemFlavorRaw(it)) || '-',
                        quantity: Number(it?.quantity || it?.qty || 0) || 0,
                    }));
                }
            }

            const normalized = (perItemArr || []).map(pi => {
                const rawFlavor = (getItemFlavorRaw(pi) || pi?.flavor_name || pi?.flavor || pi?.preference || '').toString();
                const normFlavor = normalizeFlavorForKey(rawFlavor || '-');
                return {
                    item_id: (pi?.item_id ?? pi?.id ?? pi?.order_item_id ?? pi?._id ?? '').toString(),
                    menu_name: pi?.menu_name || pi?.name || '-',
                    flavor: normFlavor,
                    flavor_display: rawFlavor || (normFlavor || '-'),
                    quantity: Number(pi?.quantity ?? pi?.qty ?? pi?.order_quantity ?? 0) || 0,
                };
            }).filter(x => x.item_id || x.menu_name || x.quantity);

            // Deduplicate by item_id
            const unique = [];
            const seen = new Set();
            for (const it of normalized) {
                const key = it.item_id || `${it.menu_name}-${it.flavor}-${it.quantity}`;
                if (seen.has(key)) continue;
                seen.add(key);
                unique.push(it);
            }

            // Keep on hand for action handler lookups by item_id
            currentPerOrderItems = { orderId: String(orderId), items: unique };

            // Set header for per-item view (Logs mode)
            const headRow = document.querySelector('#ingredient-details-table thead tr');
            if (headRow) {
                headRow.innerHTML = `
                    <th>No</th>
                    <th>Menu</th>
                    <th>Flavor</th>
                    <th>Qty</th>
                    <th>Action</th>`;
            }

            if (!unique.length) {
                body.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#6B7280; padding: 1rem;">Tidak ada item untuk pesanan ini.</td></tr>';
                return;
            }

            body.innerHTML = unique.map((it, idx) => {
                const safeRowId = `per-item-row-${(it.item_id || `${orderId}-${idx}`).replace(/[^a-zA-Z0-9_-]/g, '')}`;
                // Resolve display flavor: use normalized value, fallback to nearest key in globalFlavorMap by basic comparison
                let flavorNorm = normalizeFlavorForKey(it.flavor || '');
                if (!flavorNorm && globalFlavorMap && Object.keys(globalFlavorMap).length) {
                    const keys = Object.keys(globalFlavorMap);
                    // try exact ignoring spaces
                    const noSpace = flavorNorm.replace(/\s+/g,'');
                    const found = keys.find(k => k.replace(/\s+/g,'') === noSpace) || '';
                    flavorNorm = found || flavorNorm;
                }
                const flavorDisplay = (it.flavor_display || '').toString() || (flavorNorm || '-');
                const dataAttrs = `data-order-id="${String(orderId).replace(/"/g, '&quot;')}" data-item-id="${(it.item_id||'').toString().replace(/"/g, '&quot;')}" data-menu="${(it.menu_name||'').toString().replace(/"/g, '&quot;')}" data-flavor="${normalizeFlavorForKey((flavorNorm||'').toString()).replace(/"/g, '&quot;')}" data-flavor-display="${flavorDisplay.replace(/"/g, '&quot;')}" data-qty="${Number(it.quantity||0)}"`;
                return `
                <tr id="${safeRowId}" style="border-bottom: 1px solid #F3F4F6; transition: background-color 0.2s ease;" onmouseover="this.style.backgroundColor='#F9FAFB'" onmouseout="this.style.backgroundColor='transparent'">
                    <td style="padding: 0.875rem 1rem; text-align: center; color: #6B7280; font-weight: 500;">${idx + 1}</td>
                    <td style="padding: 0.875rem 1rem; font-weight: 600; color: #1F2937;">${it.menu_name || '-'}</td>
                    <td style="padding: 0.875rem 1rem; color: #059669; font-weight: 500;">${flavorDisplay || '-'}</td>
                    <td style="padding: 0.875rem 1rem; text-align: center; font-weight: 600; color: #6B7280;">${(it.quantity || 0).toLocaleString('id-ID')}</td>
                    <td style="padding: 0.875rem 1rem; text-align: center;">
                        <button class="action-btn-blue" ${dataAttrs} onclick="showItemIngredientDetailsFromEvent(this)" style="padding: 0.5rem 1rem; font-size: 0.85rem; border-radius: 8px; border: none; background: linear-gradient(135deg, #2563EB 0%, #1d4ed8 100%); color: white; cursor: pointer; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 8px rgba(37, 99, 235, 0.3)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(37, 99, 235, 0.2)'">
                            <i class="fas fa-flask" style="margin-right: 0.5rem;"></i>Lihat Bahan
                        </button>
                    </td>
                </tr>`;
            }).join('');
            return;
        }

        // Non-logs: render ingredient details as before
        if (!Array.isArray(details)) {
            console.warn('Expected array of details but got:', details);
            body.innerHTML = '<tr><td colspan="6">No ingredient details available</td></tr>';
            return;
        }
        body.innerHTML = details.map((d, idx) => {
            const ingredientName = d?.ingredient_name || '-';
            const quantityConsumed = d?.consumed_quantity || 0;
            const unit = d?.unit || '-';
            const stockBefore = d?.stock_before_consumption || 0;
            const stockAfter = d?.stock_after_consumption || 0;
            return `
                <tr style="border-bottom: 1px solid #F3F4F6;">
                    <td>${idx + 1}</td>
                    <td>${ingredientName}</td>
                    <td>${Number(quantityConsumed).toLocaleString('id-ID')}</td>
                    <td>${unit}</td>
                    <td>${Number(stockBefore).toLocaleString('id-ID')}</td>
                    <td>${Number(stockAfter).toLocaleString('id-ID')}</td>
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
 
 async function showDailyAggregatedConsumption(dateStr, statusText, dateIsoOverride, forceSingleDate = false) {
     try {
         const body = document.getElementById('ingredient-details-body');
         
         // Show loading state
         body.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1.5rem;"><i class="fas fa-spinner fa-spin"></i> Memuat data...</td></tr>';
         
         // Use override if provided, otherwise convert display date to ISO format
         let dateParam;
         
         if (dateIsoOverride) {
             // Sanitize override: support range and DD/MM/YYYY
             let override = dateIsoOverride;
             if (override && typeof override === 'string' && override.includes(' - ')) {
                 // Extract first date from range
                 override = override.split(' - ')[0].trim();
             }
             // Convert DD/MM/YYYY to YYYY-MM-DD if needed
             if (override && /^\d{2}\/\d{2}\/\d{4}$/.test(override)) {
                 const parts = override.split('/');
                 dateParam = `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
             } else {
                 // Assume already ISO or acceptable
                 dateParam = override;
             }
         } else {
             // Convert display date to ISO format (YYYY-MM-DD) for API call
             dateParam = dateStr;
             
             // Handle date range format "DD/MM/YYYY - DD/MM/YYYY" - extract first date
             if (dateStr && dateStr.includes(' - ')) {
                 const dateParts = dateStr.split(' - ');
                 dateStr = dateParts[0].trim(); // Use first date from range
             }
             
             // Convert DD/MM/YYYY to YYYY-MM-DD
             if (dateStr && /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
                 const parts = dateStr.split('/');
                 dateParam = `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
             } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                 // Already in YYYY-MM-DD format
                 dateParam = dateStr;
             }
         }
         
        // Final guard: ensure ISO format YYYY-MM-DD
        if (typeof dateParam === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
            // Try to extract first DD/MM/YYYY in the string
            const m = dateParam.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (m && m[1]) {
                const [dd, mm, yyyy] = m[1].split('/');
                dateParam = `${yyyy}-${mm}-${dd}`;
            }
        }
        console.log('Original dateStr:', dateStr);
        console.log('Date ISO override:', dateIsoOverride);
        console.log('Force single date mode:', forceSingleDate);
        console.log('Fetching daily consumption; computed dateParam:', dateParam);

        // Global range inputs (for correct backend query)
    // Prefer ingredient date inputs; fallback to global inputs
    const globalStartInput = document.getElementById('ingredient-start-date')?.value || document.getElementById('start_date')?.value;
    const globalEndInput = document.getElementById('ingredient-end-date')?.value || document.getElementById('end_date')?.value;
        // Override range detection when forceSingleDate is true
        const rangeSelected = !forceSingleDate && globalStartInput && globalEndInput && globalStartInput !== globalEndInput;

        let json;
        let dailyData; // for single-date path

        // Helper to render multi-day payload - one row per date
        const aggregateRangeDays = (allDays, startVal, endVal) => {
            if (!allDays.length) {
                body.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.25rem; color:#6B7280;">Tidak ada data konsumsi pada rentang ini</td></tr>';
                return;
            }
            
            const panelTitle = document.querySelector('#ingredient-details-panel .summary-name');
            if (panelTitle) panelTitle.textContent = `🥤 Ingredient Consumption (Range ${startVal} s/d ${endVal})`;
            
            // Calculate overall summary across all days
            let totalOrdersAllDays = 0;
            let totalIngredientsAllDays = new Set();
            let totalUniqueMenusAllDays = new Set();
            
            allDays.forEach(dailyData => {
                totalOrdersAllDays += Number(dailyData.total_orders || 0);
                const orders = dailyData.orders || [];
                
                orders.forEach(order => {
                    const menuSummary = order.menu_summary || '';
                    const menuItems = menuSummary.split(',').map(item => item.trim());
                    
                    menuItems.forEach(menuItem => {
                        const cleaned = (menuItem || '').trim();
                        const withoutPrefixQty = cleaned.replace(/^\s*\d+\s*x?\s*/i, '');
                        const menuName = (withoutPrefixQty.replace(/\s*x\s*\d+\s*$/i, '').trim()) || 'Unknown Menu';
                        totalUniqueMenusAllDays.add(menuName);
                    });
                    
                    // Use per-item breakdown if available, otherwise fallback to order total
                    if (order.menu_breakdown && Array.isArray(order.menu_breakdown)) {
                        order.menu_breakdown.forEach(item => {
                            const itemIngredients = item.ingredients || [];
                            itemIngredients.forEach(ing => {
                                totalIngredientsAllDays.add(ing.ingredient_name || ing.name);
                            });
                        });
                    } else {
                        const orderIngsUsed = order.ingredients_used || [];
                        orderIngsUsed.forEach(ing => {
                            totalIngredientsAllDays.add(ing.ingredient_name);
                        });
                    }
                });
            });
            
            // Render summary header showing range overview
            const summaryRow = `
                <tr style="background-color: #F9FAFB; border-bottom: 2px solid #E5E7EB;">
                    <td colspan="5" style="padding: 1rem; text-align: center;">
                        <div style="font-size: 1.1rem; font-weight: 700; color: #1F2937; margin-bottom: 0.5rem;">
                            📅 Ringkasan Konsumsi Harian - ${startVal} s/d ${endVal}
                        </div>
                        <div style="display: flex; justify-content: center; gap: 2rem; flex-wrap: wrap;">
                            <div style="text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: 700; color: #059669;">${totalOrdersAllDays}</div>
                                <div style="font-size: 0.9rem; color: #6B7280;">Total Pesanan</div>
                            </div>
                            <div style="text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: 700; color: #3B82F6;">${allDays.length}</div>
                                <div style="font-size: 0.9rem; color: #6B7280;">Hari</div>
                            </div>
                        </div>
                        <div style="margin-top: 1rem;">
                            <button class="btn-primary" onclick="showDailyIngredientAccumulationRange('${startVal}', '${endVal}')" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 0.6rem 1.5rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 500; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.3s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)';">
                                <i class="fas fa-layer-group"></i> Lihat Akumulasi Semua Bahan
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            
            // Render each day as separate row(s)
            let allRows = summaryRow;
            
            allDays.forEach((dailyData, dayIndex) => {
                const dateStr = dailyData.date || `Day ${dayIndex + 1}`;
                const totalOrders = Number(dailyData.total_orders || 0);
                const orders = dailyData.orders || [];
                
                // Aggregate menu data for this specific day
                const menuAggregation = {};
                const dayIngredients = new Set();
                
                orders.forEach(order => {
                    const menuSummary = order.menu_summary || '';
                    const orderIngsUsed = order.ingredients_used || [];
                    const menuItems = menuSummary.split(',').map(item => item.trim());
                    const perItemIngredients = order.menu_breakdown || null;
                    
                    menuItems.forEach((menuItem, itemIndex) => {
                        const cleaned = (menuItem || '').trim();
                        const withoutPrefixQty = cleaned.replace(/^\s*\d+\s*x?\s*/i, '');
                        const menuName = (withoutPrefixQty.replace(/\s*x\s*\d+\s*$/i, '').trim()) || 'Unknown Menu';
                        
                        if (!menuAggregation[menuName]) {
                            menuAggregation[menuName] = {
                                menu_name: menuName,
                                total_orders: 0,
                                ingredients_map: {},
                                order_ids: []
                            };
                        }
                        
                        let qty = 1;
                        let qtyMatch = cleaned.match(/x\s*(\d+)\s*$/i) || cleaned.match(/^\s*(\d+)\s*x/i);
                        if (qtyMatch) qty = parseInt(qtyMatch[1]);
                        
                        menuAggregation[menuName].total_orders += qty;
                        menuAggregation[menuName].order_ids.push(order.order_id);
                        
                        // Use per-item breakdown if available
                        if (perItemIngredients && perItemIngredients[itemIndex]) {
                            const itemData = perItemIngredients[itemIndex];
                            const itemIngredients = itemData.ingredients || [];
                            
                            itemIngredients.forEach(ing => {
                                dayIngredients.add(ing.ingredient_name || ing.name);
                                const ingKey = ing.ingredient_name || ing.name;
                                if (!menuAggregation[menuName].ingredients_map[ingKey]) {
                                    menuAggregation[menuName].ingredients_map[ingKey] = {
                                        ingredient_name: ingKey,
                                        total_consumed: 0,
                                        unit: ing.unit || ing.unit_name || '-'
                                    };
                                }
                                const consumed = Number(ing.consumed_quantity || ing.quantity || 0);
                                menuAggregation[menuName].ingredients_map[ingKey].total_consumed += consumed;
                            });
                        } else {
                            // Fallback to proportional distribution
                            const totalQtyInOrder = menuItems.reduce((sum, item) => {
                                const it = (item || '').trim();
                                let q = 1;
                                let m = it.match(/x\s*(\d+)\s*$/i) || it.match(/^\s*(\d+)\s*x/i);
                                if (m) q = parseInt(m[1]);
                                return sum + q;
                            }, 0);
                            const proportion = qty / (totalQtyInOrder || 1);
                            
                            orderIngsUsed.forEach(ing => {
                                dayIngredients.add(ing.ingredient_name);
                                const ingKey = ing.ingredient_name;
                                if (!menuAggregation[menuName].ingredients_map[ingKey]) {
                                    menuAggregation[menuName].ingredients_map[ingKey] = {
                                        ingredient_name: ing.ingredient_name,
                                        total_consumed: 0,
                                        unit: ing.unit
                                    };
                                }
                                menuAggregation[menuName].ingredients_map[ingKey].total_consumed += 
                                    (ing.total_consumed || 0) * proportion;
                            });
                        }
                    });
                });
                
                // Calculate stats for this day
                Object.values(menuAggregation).forEach(menu => {
                    menu.total_ingredients_used = Object.keys(menu.ingredients_map).length;
                    menu.ingredients_list = Object.values(menu.ingredients_map);
                });
                
                const uniqueMenus = Object.keys(menuAggregation).length;
                
                // Convert dateStr (YYYY-MM-DD) to DD/MM/YYYY for display
                let displayDate = dateStr;
                if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    const [y, m, d] = dateStr.split('-');
                    displayDate = `${d}/${m}/${y}`;
                }
                
                // Date header row for this day
                const dateHeaderRow = `
                    <tr style="background-color: #EFF6FF; border-top: 2px solid #BFDBFE; border-bottom: 1px solid #BFDBFE;">
                        <td colspan="5" style="padding: 0.75rem 1rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="font-size: 1rem; font-weight: 600; color: #1E40AF;">
                                    📆 ${displayDate}
                                </div>
                                <div style="display: flex; gap: 1.5rem; font-size: 0.85rem; color: #4B5563;">
                                    <span><strong>${totalOrders}</strong> Pesanan</span>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
                
                allRows += dateHeaderRow;
                
                // If no orders for this day
                if (uniqueMenus === 0) {
                    allRows += `
                        <tr style="border-bottom: 1px solid #F3F4F6;">
                            <td colspan="5" style="text-align: center; color: #9CA3AF; padding: 1rem; font-style: italic;">
                                Tidak ada pesanan pada tanggal ini
                            </td>
                        </tr>
                    `;
                } else {
                    // Sort menus by total_orders descending
                    const sortedMenus = Object.values(menuAggregation).sort((a, b) => b.total_orders - a.total_orders);
                    
                    // Render menu rows for this day
                    sortedMenus.forEach((menu, idx) => {
                        const ingredientsList = menu.ingredients_list || [];
                        const menuDataJson = JSON.stringify(menu).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                        
                        const menuRow = `
                            <tr style="border-bottom: 1px solid #F3F4F6;">
                                <td style="padding-left: 2rem; color: #6B7280;">${idx + 1}</td>
                                <td style="font-weight: 600; color: #1F2937;">${menu.menu_name}</td>
                                <td style="text-align: center; font-weight: 600; color: #059669;">${menu.total_orders}</td>
                                <td style="text-align: center; font-weight: 600; color: #DC2626;">${menu.total_ingredients_used}</td>
                                <td style="text-align: center;">
                                    <button class="table-action-btn" onclick="event.stopPropagation(); showMenuIngredientDetails('${menu.menu_name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', '${displayDate}', ${menuDataJson});" title="Lihat Detail Bahan Menu">
                                        <i class="fas fa-eye"></i> Detail
                                    </button>
                                </td>
                            </tr>
                        `;
                        allRows += menuRow;
                    });
                }
            });
            
            body.innerHTML = allRows;
        };

        if (rangeSelected) {
            // Query backend with start_date & end_date so backend mode = date_range (bukan single_date)
            const url = `/inventory/consumption/daily?start_date=${encodeURIComponent(globalStartInput)}&end_date=${encodeURIComponent(globalEndInput)}`;
            console.log('[Range] Fetch URL:', url);
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            json = await resp.json();
            console.log('[Range] Daily consumption response:', json);
            const allDays = Array.isArray(json?.data?.daily_consumption) ? json.data.daily_consumption : [];
            // Aggregate immediately and stop (do not proceed to single-date logic)
            aggregateRangeDays(allDays, globalStartInput, globalEndInput);
            return; // Done for range mode
        } else {
            // Single date fetch
            const response = await fetch(`/inventory/consumption/daily?date=${dateParam}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            json = await response.json();
            console.log('Daily consumption response:', json);
            dailyData = json?.data?.daily_consumption?.[0];
        }
        if (!dailyData) {
            body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #615a5a; padding: 1.5rem; font-weight: 500;">Tidak ada data detail untuk tanggal ini</td></tr>';
            return;
        }
         
         const summary = dailyData.summary || {};
         const orders = dailyData.orders || [];
         
        // Aggregate orders by menu name with proper per-item ingredient tracking
         const menuAggregation = {};
         
         // Process each order and match ingredients to specific menu items
         for (const order of orders) {
             const menuSummary = order.menu_summary || '';
             const orderIngsUsed = order.ingredients_used || [];
             const menuItems = menuSummary.split(',').map(item => item.trim());
             
             // Try to get per-item breakdown from backend
             const orderId = order.order_id;
             let perItemIngredients = null;
             
             // If we have menu_breakdown from backend response, use it for accurate per-item tracking
             if (order.menu_breakdown && Array.isArray(order.menu_breakdown)) {
                 perItemIngredients = order.menu_breakdown;
             }
             
             menuItems.forEach((menuItem, itemIndex) => {
                 const cleaned = (menuItem || '').trim();
                 const withoutPrefixQty = cleaned.replace(/^\s*\d+\s*x?\s*/i, '');
                 const menuName = (withoutPrefixQty.replace(/\s*x\s*\d+\s*$/i, '').trim()) || 'Unknown Menu';
                 
                 if (!menuAggregation[menuName]) {
                     menuAggregation[menuName] = {
                         menu_name: menuName,
                         total_orders: 0,
                         total_ingredients_used: 0,
                         ingredients_map: {},
                         order_ids: []
                     };
                 }
                 
                 // Extract quantity
                 let qty = 1;
                 let qtyMatch = cleaned.match(/x\s*(\d+)\s*$/i) || cleaned.match(/^\s*(\d+)\s*x/i);
                 if (qtyMatch) qty = parseInt(qtyMatch[1]);
                 
                 menuAggregation[menuName].total_orders += qty;
                 menuAggregation[menuName].order_ids.push(orderId);
                 
                 // Match ingredients to this specific item
                 if (perItemIngredients && perItemIngredients[itemIndex]) {
                     // Use per-item breakdown from backend
                     const itemData = perItemIngredients[itemIndex];
                     const itemIngredients = itemData.ingredients || [];
                     
                     itemIngredients.forEach(ing => {
                         const ingKey = ing.ingredient_name || ing.name;
                         if (!menuAggregation[menuName].ingredients_map[ingKey]) {
                             menuAggregation[menuName].ingredients_map[ingKey] = {
                                 ingredient_name: ingKey,
                                 total_consumed: 0,
                                 unit: ing.unit || ing.unit_name || '-'
                             };
                         }
                         // Use consumed_quantity directly from per-item data
                         const consumed = Number(ing.consumed_quantity || ing.quantity || 0);
                         menuAggregation[menuName].ingredients_map[ingKey].total_consumed += consumed;
                     });
                 } else {
                     // Fallback: distribute total order ingredients proportionally
                     const totalQtyInOrder = menuItems.reduce((sum, item) => {
                         const it = (item || '').trim();
                         let q = 1;
                         let m = it.match(/x\s*(\d+)\s*$/i) || it.match(/^\s*(\d+)\s*x/i);
                         if (m) q = parseInt(m[1]);
                         return sum + q;
                     }, 0);
                     
                     const proportion = qty / (totalQtyInOrder || 1);
                     
                     orderIngsUsed.forEach(ing => {
                         const ingKey = ing.ingredient_name;
                         if (!menuAggregation[menuName].ingredients_map[ingKey]) {
                             menuAggregation[menuName].ingredients_map[ingKey] = {
                                 ingredient_name: ing.ingredient_name,
                                 total_consumed: 0,
                                 unit: ing.unit
                             };
                         }
                         menuAggregation[menuName].ingredients_map[ingKey].total_consumed += 
                             (ing.total_consumed || 0) * proportion;
                     });
                 }
             });
         }
         
         // Calculate total ingredients used per menu
         Object.values(menuAggregation).forEach(menu => {
             menu.total_ingredients_used = Object.keys(menu.ingredients_map).length;
             menu.ingredients_list = Object.values(menu.ingredients_map);
         });
         
         // Create a summary header row
         const totalUniqueMenus = Object.keys(menuAggregation).length;
         const summaryRow = `
             <tr style="background-color: #F9FAFB; border-bottom: 2px solid #E5E7EB;">
                 <td colspan="5" style="padding: 1rem; text-align: center;">
                     <div style="font-size: 1.1rem; font-weight: 700; color: #1F2937; margin-bottom: 0.5rem;">
                         📅 Ringkasan Konsumsi Harian - ${dailyData.date_formatted || dateStr}
                     </div>
                     <div style="display: flex; justify-content: center; gap: 2rem; flex-wrap: wrap;">
                         <div style="text-align: center;">
                             <div style="font-size: 1.5rem; font-weight: 700; color: #059669;">${dailyData.total_orders || 0}</div>
                             <div style="font-size: 0.9rem; color: #6B7280;">Total Pesanan</div>
                         </div>
                     </div>
                     <div style="margin-top: 1rem;">
                         <button class="btn-primary" onclick="showDailyIngredientAccumulation('${dateParam}', '${dailyData.date_formatted || dateStr}')" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 0.6rem 1.5rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 500; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.3s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)';">
                             <i class="fas fa-layer-group"></i> Lihat Akumulasi Semua Bahan
                         </button>
                     </div>
                 </td>
             </tr>
         `;
         
         // Generate table rows for menu aggregation
         if (Object.keys(menuAggregation).length === 0) {
             body.innerHTML = summaryRow + `
                 <tr>
                     <td colspan="5" style="text-align: center; color: #6B7280; padding: 1.5rem; font-weight: 500;">
                         Tidak ada detail menu untuk tanggal ini
                     </td>
                 </tr>
             `;
             return;
         }
         
         // Sort menus by total_orders descending
         const sortedMenus = Object.values(menuAggregation).sort((a, b) => b.total_orders - a.total_orders);
         
         const menuRows = sortedMenus.map((menu, idx) => {
             const ingredientsList = menu.ingredients_list || [];
             const ingredientSummary = ingredientsList.slice(0, 3).map(ing => 
                 `${ing.ingredient_name}: ${Number(ing.total_consumed || 0).toFixed(1)} ${ing.unit || ''}`
             ).join(', ');
             const moreCount = ingredientsList.length > 3 ? ` (+${ingredientsList.length - 3} lainnya)` : '';
             
             // Store menu data globally for the detail view
             const menuDataJson = JSON.stringify(menu).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
             
             return `
                 <tr style="border-bottom: 1px solid #F3F4F6;">
                     <td>${idx + 1}</td>
                     <td style="font-weight: 600; color: #1F2937;">${menu.menu_name}</td>
                     <td style="text-align: center; font-weight: 600; color: #059669;">${menu.total_orders}</td>
                     <td style="text-align: center; font-weight: 600; color: #DC2626;">${menu.total_ingredients_used}</td>
                     <td style="text-align: center;">
                         <button class="table-action-btn" onclick="event.stopPropagation(); showMenuIngredientDetails('${menu.menu_name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', '${dailyData.date_formatted || dateStr}', ${menuDataJson});" title="Lihat Detail Bahan Menu">
                             <i class="fas fa-eye"></i> Detail
                         </button>
                     </td>
                 </tr>
             `;
         }).join('');
         
         body.innerHTML = summaryRow + menuRows;
         
     } catch (e) {
         console.error('Failed to load daily aggregated consumption:', e);
         const body = document.getElementById('ingredient-details-body');
         if (body) {
             body.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 1.5rem; font-weight: 500;">Gagal memuat data konsumsi harian: ' + e.message + '</td></tr>';
         }
     }
 }

// ========== HELPER FUNCTIONS FOR DAILY INGREDIENT DETAILS ==========
function showMenuIngredientDetails(menuName, dateStr, menuData) {
    try {
        const panel = document.getElementById('ingredient-details-panel');
        const body = document.getElementById('ingredient-details-body');
        const headRow = document.querySelector('#ingredient-details-table thead tr');
        
        // Update panel header - show menu name only
        document.getElementById('detail-order-id').textContent = menuName;
        document.getElementById('detail-order-date').textContent = dateStr;
        document.getElementById('detail-order-status').textContent = `${menuData.total_orders} pesanan`;
        
        // Update table header for per-item breakdown (6 columns - with QTY Terpakai)
        if (headRow) {
            headRow.innerHTML = `
                <th>No</th>
                <th>Nama Bahan</th>
                <th>QTY Terpakai</th>
                <th>Unit</th>
                <th>Stok Sebelum</th>
                <th>Stok Akhir</th>`;
        }
        
        // Get order IDs for this menu to fetch per-item details
        const orderIds = menuData.order_ids || [];
        
        if (orderIds.length === 0) {
            body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #6B7280; padding: 1.5rem;">Tidak ada data order untuk menu ini</td></tr>';
            if (panel) panel.classList.remove('hidden');
            setTimeout(() => {
                panel.scrollIntoView({behavior: 'smooth', block: 'start'});
            }, 150);
            return;
        }
        
        // Show loading state
        body.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 1.5rem;"><i class="fas fa-spinner fa-spin"></i> Memuat detail per item...</td></tr>';
        if (panel) panel.classList.remove('hidden');
        
        // Convert dateStr to ISO format for API call
        let dateParam = dateStr;
        if (dateStr && /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
            const [dd, mm, yyyy] = dateStr.split('/');
            dateParam = `${yyyy}-${mm}-${dd}`;
        }
        
        // Fetch once without order_id filter - backend will return all orders for the date
        // Then we filter on frontend for the specific orders we need
        fetch(`/inventory/consumption/daily?date=${encodeURIComponent(dateParam)}`, { cache: 'no-store' })
            .then(res => res.ok ? res.json() : null)
            .then(json => {
            const perItemRows = [];
            let rowNum = 0;
            
            // Debug: Log the full response structure
            console.log('[DEBUG] Full response from /inventory/consumption/daily:', json);
            
            if (!json) {
                body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 1.5rem;">Gagal memuat data</td></tr>';
                return;
            }
            
            // Handle response from /inventory/consumption/daily endpoint
            const dailyConsumption = json?.data?.daily_consumption || [];
            const dailyData = dailyConsumption[0]; // Get first (and should be only) day data
            
            console.log('[DEBUG] Daily data:', dailyData);
            
            if (!dailyData) {
                body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #6B7280; padding: 1.5rem;">Tidak ada data untuk tanggal ini</td></tr>';
                return;
            }
            
            const allOrders = dailyData.orders || [];
            
            console.log('[DEBUG] All orders:', allOrders);
            console.log('[DEBUG] Filter by order IDs:', orderIds);
            
            // Filter only the orders that are in our orderIds list
            const relevantOrders = allOrders.filter(o => 
                orderIds.includes(String(o.order_id))
            );
            
            console.log('[DEBUG] Relevant orders after filter:', relevantOrders);
            
            // Accumulate ingredients from all relevant orders
            const ingredientAccumulation = {};
            let totalQuantityOrdered = 0;
            
            // Process each relevant order and accumulate ingredients
            relevantOrders.forEach((orderData) => {
                const orderId = orderData.order_id;
                
                console.log('[DEBUG] Processing order:', orderId, orderData);
                
                const menuBreakdown = orderData.menu_breakdown || [];
                
                console.log('[DEBUG] Menu breakdown for', orderId, ':', menuBreakdown);
                
                // Filter items that match the current menu name
                menuBreakdown.forEach((item, itemIndex) => {
                    const itemMenuName = (item.menu_name || item.name || '').trim();
                    
                    console.log('[DEBUG] Processing item:', item);
                    
                    // Match menu name (case-insensitive, ignore extra spaces)
                    if (itemMenuName.toLowerCase().replace(/\s+/g, ' ') !== menuName.toLowerCase().replace(/\s+/g, ' ')) {
                        return; // Skip items that don't match this menu
                    }
                    
                    const itemQty = Number(item.quantity || item.qty || 1);
                    totalQuantityOrdered += itemQty;
                    
                    const ingredients = item.ingredients || [];
                    
                    console.log('[DEBUG] Matched item for menu', menuName, ':', item);
                    console.log('[DEBUG] Ingredients array:', ingredients);
                    
                    // Accumulate each ingredient
                    ingredients.forEach((ing) => {
                        const ingId = ing.ingredient_id || ing.id;
                        const ingName = ing.ingredient_name || ing.name || '-';
                        const unit = ing.unit || ing.unit_name || '-';
                        
                        // Use required_quantity directly from backend
                        const qtyUsed = Number(
                            ing.required_quantity ||
                            ing.consumed_quantity || 
                            ing.quantity_consumed || 
                            ing.total_consumed ||
                            ing.quantity ||
                            ing.qty ||
                            0
                        );
                        
                        // Extract stock values
                        const stockBefore = ing.stock_before_consumption ?? ing.stock_before ?? null;
                        const stockAfter = ing.stock_after_consumption ?? ing.stock_after ?? null;
                        
                        // Create unique key for each ingredient
                        const key = `${ingId}-${ingName}`;
                        
                        if (!ingredientAccumulation[key]) {
                            // First occurrence: initialize with this order's data
                            ingredientAccumulation[key] = {
                                ingredient_id: ingId,
                                ingredient_name: ingName,
                                unit: unit,
                                total_quantity: 0,
                                // Stock before from FIRST order (will be updated to highest)
                                stock_before: stockBefore,
                                // Stock after will be updated to LAST order (lowest)
                                stock_after: stockAfter
                            };
                        }
                        
                        // Accumulate quantity
                        ingredientAccumulation[key].total_quantity += qtyUsed;
                        
                        // Update stock_before to the HIGHEST value (earliest order, before any consumption)
                        if (stockBefore !== null && stockBefore !== undefined) {
                            if (ingredientAccumulation[key].stock_before === null) {
                                ingredientAccumulation[key].stock_before = stockBefore;
                            } else {
                                ingredientAccumulation[key].stock_before = Math.max(
                                    ingredientAccumulation[key].stock_before, 
                                    stockBefore
                                );
                            }
                        }
                        
                        // Update stock_after to the LOWEST value (latest order, after all consumption)
                        if (stockAfter !== null && stockAfter !== undefined) {
                            if (ingredientAccumulation[key].stock_after === null) {
                                ingredientAccumulation[key].stock_after = stockAfter;
                            } else {
                                ingredientAccumulation[key].stock_after = Math.min(
                                    ingredientAccumulation[key].stock_after, 
                                    stockAfter
                                );
                            }
                        }
                        
                        console.log('[DEBUG] Ingredient accumulation for', ingName, ':', {
                            key: key,
                            qtyUsed: qtyUsed,
                            stockBefore: stockBefore,
                            stockAfter: stockAfter,
                            accumulated: ingredientAccumulation[key]
                        });
                    });
                });
            });
            
            console.log('[DEBUG] Ingredient accumulation:', ingredientAccumulation);
            console.log('[DEBUG] Total quantity ordered:', totalQuantityOrdered);
            
            // Convert accumulation to array and render
            const accumulatedIngredients = Object.values(ingredientAccumulation);
            
            if (accumulatedIngredients.length === 0) {
                body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #6B7280; padding: 1.5rem;">Tidak ada detail ingredient per item untuk menu ini</td></tr>';
            } else {
                // Render accumulated ingredients
                accumulatedIngredients.forEach((ing, idx) => {
                    const qtyUsedDisplay = ing.total_quantity > 0
                        ? ing.total_quantity.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) 
                        : '-';
                    
                    const stockBeforeDisplay = (ing.stock_before !== null && ing.stock_before !== undefined) 
                        ? Number(ing.stock_before).toLocaleString('id-ID') : '-';
                    const stockAfterDisplay = (ing.stock_after !== null && ing.stock_after !== undefined) 
                        ? Number(ing.stock_after).toLocaleString('id-ID') : '-';
                    
                    perItemRows.push(`
                        <tr style="border-bottom: 1px solid #F3F4F6; transition: background-color 0.2s ease;" 
                            onmouseover="this.style.backgroundColor='#F9FAFB'" 
                            onmouseout="this.style.backgroundColor='transparent'">
                            <td style="padding: 0.75rem 1rem; text-align: center; color: #6B7280;">${idx + 1}</td>
                            <td style="padding: 0.75rem 1rem; font-weight: 500; color: #1F2937;">${ing.ingredient_name}</td>
                            <td style="padding: 0.75rem 1rem; text-align: center; color: #059669; font-weight: 600;">${qtyUsedDisplay}</td>
                            <td style="padding: 0.75rem 1rem; text-align: center; color: #6B7280;">${ing.unit}</td>
                            <td style="padding: 0.75rem 1rem; text-align: center; color: #6B7280;">${stockBeforeDisplay}</td>
                            <td style="padding: 0.75rem 1rem; text-align: center;">
                                <span style="font-weight: 600; color: #DC2626;">${stockAfterDisplay}</span>
                            </td>
                        </tr>
                    `);
                });
            
                // Add summary row at top (use accumulated totalQuantityOrdered)
                const summaryRow = `
                    <tr style="background: linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%); border-bottom: 2px solid #E5E7EB; font-weight: 600;">
                        <td colspan="6" style="padding: 1rem; text-align: center;">
                            <div style="display: flex; justify-content: center; gap: 2rem; flex-wrap: wrap;">
                                <div>
                                    <span style="color: #6B7280; font-size: 0.9rem;">Total Items:</span>
                                    <span style="color: #059669; font-size: 1.1rem; margin-left: 0.5rem; font-weight: 700;">${totalQuantityOrdered || 0}</span>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
                
                body.innerHTML = summaryRow + perItemRows.join('');
            }
            
            // Scroll to panel after data loaded
            setTimeout(() => {
                panel.scrollIntoView({behavior: 'smooth', block: 'start'});
            }, 150);
        }).catch(e => {
            console.error('Failed to fetch per-item details:', e);
            body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 1.5rem;">Gagal memuat detail per item</td></tr>';
        });
        
    } catch (e) {
        console.error('Failed to show menu ingredient details:', e);
        alert('Gagal menampilkan detail bahan menu');
    }
}

// ========== PER-ITEM INGREDIENT ESTIMATE (LOGS MODE) ==========
function showItemIngredientDetailsFromEvent(buttonEl) {
    try {
        if (!buttonEl) return;
        const orderId = buttonEl.getAttribute('data-order-id') || '';
        const itemId = buttonEl.getAttribute('data-item-id') || '';
        let menuName = buttonEl.getAttribute('data-menu') || '-';
        // Prefer display flavor; keep normalized for mapping
        let flavorDisplay = buttonEl.getAttribute('data-flavor-display') || '';
        let flavorNorm = buttonEl.getAttribute('data-flavor') || '';
        const qty = Number(buttonEl.getAttribute('data-qty') || 0) || 0;

        // Fallback: if flavor not provided, try lookup from cached per-order items by item_id
        if ((!flavorDisplay || flavorDisplay === '-') && currentPerOrderItems && currentPerOrderItems.orderId === String(orderId)) {
            const found = (currentPerOrderItems.items || []).find(x => String(x.item_id || x.id || x.order_item_id || '') === String(itemId));
            if (found) {
                menuName = found.menu_name || menuName;
                const raw = found.flavor_display || getItemFlavorRaw(found) || '';
                flavorDisplay = raw || flavorDisplay;
                flavorNorm = normalizeFlavorForKey(found.flavor || raw || '') || flavorNorm;
            }
        }

        // Pass both: display for UI, normalized for mapping lookup inside details
        showItemIngredientDetails(orderId, itemId, menuName, flavorDisplay || flavorNorm, qty);
    } catch (err) {
        console.warn('Failed handling per-item click:', err);
    }
}

function showItemIngredientDetails(orderId, itemId, menuName, flavorName, qty) {
    try {
        const tbody = document.getElementById('ingredient-details-body');
        if (!tbody) return;
        const safeRowId = `per-item-row-${(itemId || `${orderId}`).replace(/[^a-zA-Z0-9_-]/g, '')}`;
        const row = document.getElementById(safeRowId);
        if (!row) return;

        // Toggle existing details row
        const existing = document.getElementById(`${safeRowId}-details`);
        if (existing) {
            existing.parentElement.removeChild(existing);
            return;
        }

        // Prefer backend per-item breakdown
        let list = [];
        let usedSource = 'mapping';
        if (currentPerOrderBreakdown && currentPerOrderBreakdown.orderId === String(orderId) && Array.isArray(currentPerOrderBreakdown.menu_breakdown)) {
            const foundItem = currentPerOrderBreakdown.menu_breakdown.find(it => String(it.item_id || it.id || it.order_item_id || '') === String(itemId));
            if (foundItem && Array.isArray(foundItem.ingredients) && foundItem.ingredients.length) {
                // Preserve raw fields; compute display values later
                list = foundItem.ingredients.map(x => ({
                    ingredient_id: x.ingredient_id || x.id,
                    ingredient_name: x.ingredient_name || x.name,
                    unit: x.unit || x.unit_name || '-',
                    required_quantity: Number(x.required_quantity ?? 0) || 0,
                    consumed_quantity: Number(x.consumed_quantity ?? 0) || 0,
                    quantity: Number(x.quantity ?? 0) || 0,
                    stock_before: (x.stock_before_consumption ?? x.stock_before ?? null),
                    stock_after: (x.stock_after_consumption ?? x.stock_after ?? null)
                }));
                usedSource = 'backend:item';
            }
        }

        // Fallback to flavor mapping
        let flavorKey = '';
        if (!Array.isArray(list) || !list.length) {
            const raw = (flavorName || '-').toString();
            flavorKey = normalizeFlavorForKey(raw);
            const tryKeys = [flavorKey];
            const alt = flavorKey.replace(/\s+/g, ' ').trim();
            if (!tryKeys.includes(alt)) tryKeys.push(alt);
            const noSpaces = flavorKey.replace(/\s+/g, '');
            if (!tryKeys.includes(noSpaces)) tryKeys.push(noSpaces);
            for (const k of tryKeys) {
                if (globalFlavorMap && globalFlavorMap[k]) { list = globalFlavorMap[k]; break; }
            }
        }

        let content = '';
        if (Array.isArray(list) && list.length) {
            const q = Number(qty || 0) || 0;
            const rows = list.map((m, idx) => {
                const ingName = m?.ingredient_name || m?.name || m?.ingredient_id || '-';
                const unit = m?.unit || '-';
                
                // Use data directly from backend without calculation
                // Priority: required_quantity from backend API
                let qtyUsed = 0;
                let stockBefore = '-';
                let stockAfter = '-';
                
                if (usedSource === 'backend:item') {
                    // Use required_quantity directly from backend (same as ingredient analysis daily)
                    qtyUsed = Number(m.required_quantity || m.consumed_quantity || m.quantity || 0);
                    
                    // Use stock data from backend
                    if (m.stock_before_consumption !== null && m.stock_before_consumption !== undefined) {
                        stockBefore = Number(m.stock_before_consumption).toLocaleString('id-ID');
                    } else if (m.stock_before !== null && m.stock_before !== undefined) {
                        stockBefore = Number(m.stock_before).toLocaleString('id-ID');
                    }
                    
                    if (m.stock_after_consumption !== null && m.stock_after_consumption !== undefined) {
                        stockAfter = Number(m.stock_after_consumption).toLocaleString('id-ID');
                    } else if (m.stock_after !== null && m.stock_after !== undefined) {
                        stockAfter = Number(m.stock_after).toLocaleString('id-ID');
                    }
                } else {
                    // Fallback for non-backend source
                    const perServing = Number(m?.quantity_per_serving || m?.qty_per_serving || m?.quantity || 0) || 0;
                    qtyUsed = perServing * q;
                    stockBefore = '-';
                    stockAfter = '-';
                }
                
                return `
                    <tr style="border-bottom: 1px solid #E5E7EB; transition: background-color 0.2s ease;" 
                        onmouseover="this.style.backgroundColor='#F9FAFB'" 
                        onmouseout="this.style.backgroundColor='transparent'">
                        <td style="padding: 1rem 1rem; text-align: center; color: #6B7280; font-weight: 500;">${idx + 1}</td>
                        <td style="padding: 1rem 1rem; font-weight: 600; color: #1F2937;">${ingName}</td>
                        <td style="padding: 1rem 1rem; text-align: center; color: #059669; font-weight: 600;">${qtyUsed.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td style="padding: 1rem 1rem; text-align: center; color: #6B7280;">${unit}</td>
                        <td style="padding: 1rem 1rem; text-align: center; color: #6B7280; font-weight: 500;">${stockBefore}</td>
                        <td style="padding: 1rem 1rem; text-align: center; font-weight: 700; color: #DC2626;">${stockAfter}</td>
                    </tr>`;
            }).join('');
            content = `
                <div style="background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; padding: 1.25rem; margin: 0.75rem 0; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 2px solid #E5E7EB;">
                        <div>
                            <div style="font-weight: 700; font-size: 1.05rem; color: #111827; margin-bottom: 0.25rem;">
                                <i class="fas fa-flask" style="color: #2563EB; margin-right: 0.5rem;"></i>Detail Bahan
                            </div>
                            <div style="font-size: 0.9rem; color: #6B7280; margin-left: 1.75rem;">
                                ${menuName || '-'} • <span style="color: #059669; font-weight: 600;">${flavorName || '-'}</span> • Qty: <span style="font-weight: 600;">${qty}</span>
                            </div>
                        </div>
                    </div>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: separate; border-spacing: 0 0.5rem;">
                            <thead>
                                <tr style="background: linear-gradient(135deg, #667EEA 0%, #764BA2 100%); color: white;">
                                    <th style="text-align: center; padding: 0.875rem 1rem; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; border-top-left-radius: 8px;">No</th>
                                    <th style="text-align: left; padding: 0.875rem 1rem; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Nama Bahan</th>
                                    <th style="text-align: center; padding: 0.875rem 1rem; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Qty Terpakai</th>
                                    <th style="text-align: center; padding: 0.875rem 1rem; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Unit</th>
                                    <th style="text-align: center; padding: 0.875rem 1rem; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Stok Sebelum</th>
                                    <th style="text-align: center; padding: 0.875rem 1rem; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; border-top-right-radius: 8px;">Stok Sesudah</th>
                                </tr>
                            </thead>
                            <tbody style="background: #FFFFFF;">
                                ${rows}
                            </tbody>
                        </table>
                    </div>
                    <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #E5E7EB; font-size: 0.8rem; color: #6B7280; display: flex; justify-content: space-between; align-items: center;">
                        <span>
                            <i class="fas fa-info-circle" style="color: #3B82F6; margin-right: 0.25rem;"></i>
                            Total bahan yang digunakan untuk item ini
                        </span>
                        <span style="font-weight: 600; color: #1F2937;">
                            ${list.length} bahan
                        </span>
                    </div>
                </div>`;
        } else {
            content = `
                <div style="background: linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%); border: 2px solid #FECACA; border-radius: 12px; padding: 1.5rem; margin: 0.75rem 0; box-shadow: 0 2px 4px rgba(220, 38, 38, 0.1);">
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                        <div style="flex-shrink: 0; width: 48px; height: 48px; background: #FEE2E2; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid #FCA5A5;">
                            <i class="fas fa-exclamation-triangle" style="color: #DC2626; font-size: 1.25rem;"></i>
                        </div>
                        <div style="flex: 1;">
                            <div style="font-weight: 700; font-size: 1rem; color: #991B1B; margin-bottom: 0.25rem;">
                                Data Mapping Tidak Ditemukan
                            </div>
                            <div style="font-size: 0.875rem; color: #B91C1C;">
                                Mapping untuk flavor "<span style="font-weight: 600; background: #FEE2E2; padding: 0.125rem 0.5rem; border-radius: 4px;">${flavorKey || (flavorName||'-')}</span>" tidak tersedia
                            </div>
                        </div>
                    </div>
                    <div style="background: #FFFFFF; border: 1px solid #FECACA; border-radius: 8px; padding: 1rem; margin-top: 1rem;">
                        <div style="font-size: 0.8rem; color: #6B7280; margin-bottom: 0.5rem; font-weight: 600;">
                            <i class="fas fa-list-ul" style="color: #3B82F6; margin-right: 0.5rem;"></i>Flavor yang Tersedia:
                        </div>
                        <div style="font-size: 0.8rem; color: #374151; line-height: 1.6; max-height: 120px; overflow-y: auto; padding: 0.5rem; background: #F9FAFB; border-radius: 6px;">
                            ${Object.keys(globalFlavorMap || {}).length > 0 
                                ? Object.keys(globalFlavorMap).map(k => `<span style="display: inline-block; background: #EEF2FF; color: #4F46E5; padding: 0.25rem 0.75rem; border-radius: 12px; margin: 0.25rem; font-weight: 500; border: 1px solid #C7D2FE;">${k}</span>`).join('')
                                : '<span style="color: #9CA3AF; font-style: italic;">Tidak ada flavor mapping yang tersedia</span>'
                            }
                        </div>
                    </div>
                </div>`;
        }

        const detailsRow = document.createElement('tr');
        detailsRow.id = `${safeRowId}-details`;
        const colSpan = 5; // match header columns in logs mode (No, Menu, Flavor, Qty, Action)
        detailsRow.innerHTML = `<td colspan="${colSpan}" style="padding: 0; background: transparent;">${content}</td>`;
        // Insert after the clicked row
        if (row.nextSibling) {
            row.parentNode.insertBefore(detailsRow, row.nextSibling);
        } else {
            row.parentNode.appendChild(detailsRow);
        }
    } catch (e) {
        console.warn('Failed rendering per-item ingredient details:', e);
    }
}
async function showDailyIngredientAccumulation(dateParam, dateFormatted) {
    try {
        const panel = document.getElementById('ingredient-details-panel');
        const body = document.getElementById('ingredient-details-body');
        const headRow = document.querySelector('#ingredient-details-table thead tr');
        // Helper: map backend enum category to friendly label used in stock management UI
        const mapStockCategoryLabel = (cat) => {
            const key = String(cat || '').toLowerCase();
            const map = {
                'packaging': 'Kemasan',
                'ingredients': 'Bahan',
                'coffee_flavors': 'Perisa Kopi',
                'squash_flavors': 'Perisa Squash',
                'milk_shake_flavors': 'Perisa Milk Shake'
            };
            return map[key] || (key ? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Umum');
        };
        
        // Update panel header
        document.getElementById('detail-order-id').textContent = `Akumulasi Bahan Harian`;
        document.getElementById('detail-order-date').textContent = dateFormatted;
        document.getElementById('detail-order-status').textContent = 'Semua Menu';
        
        // Show loading
        body.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 1.5rem;"><i class="fas fa-spinner fa-spin"></i> Memuat akumulasi bahan...</td></tr>';
        
        // Show panel immediately
        if (panel) panel.classList.remove('hidden');
        
        // Ensure dateParam is a single YYYY-MM-DD
        let dateArg = dateParam;
        if (typeof dateArg === 'string') {
            if (dateArg.includes(' - ')) {
                dateArg = dateArg.split(' - ')[0].trim();
            }
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateArg)) {
                const [dd, mm, yyyy] = dateArg.split('/');
                dateArg = `${yyyy}-${mm}-${dd}`;
            } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
                // Try to extract first DD/MM/YYYY in the string
                const m = dateArg.match(/(\d{2}\/\d{2}\/\d{4})/);
                if (m && m[1]) {
                    const [dd, mm, yyyy] = m[1].split('/');
                    dateArg = `${yyyy}-${mm}-${dd}`;
                }
            }
        }
        // Fetch daily data
        const response = await fetch(`/inventory/consumption/daily?date=${encodeURIComponent(dateArg)}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const json = await response.json();
        const dailyData = json?.data?.daily_consumption?.[0];
        
        if (!dailyData) {
            body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #615a5a; padding: 1.5rem;">Tidak ada data bahan untuk tanggal ini</td></tr>';
            return;
        }
        
        // Update table header for accumulated ingredients (6 columns)
        if (headRow) {
            headRow.innerHTML = `
                <th>No</th>
                <th>Nama Bahan</th>
                <th>Total Konsumsi</th>
                <th>Unit</th>
                <th>Kategori</th>
                <th>Frekuensi</th>`;
        }
        
        const ingredientsConsumed = dailyData.ingredients_consumed || [];
        
        if (ingredientsConsumed.length === 0) {
            body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #6B7280; padding: 1.5rem;">Tidak ada data konsumsi bahan</td></tr>';
            return;
        }
        
        // Sort by total_consumed descending
        const sortedIngredients = ingredientsConsumed.sort((a, b) => 
            (b.total_consumed || 0) - (a.total_consumed || 0)
        );
        
        const totalConsumption = sortedIngredients.reduce((sum, ing) => sum + (ing.total_consumed || 0), 0);
        
        const rows = sortedIngredients.map((ing, idx) => {
            const contribution = totalConsumption > 0 ? 
                ((ing.total_consumed / totalConsumption) * 100).toFixed(1) : 0;
            const frequency = ing.consumption_count || 1;
            const categoryLabel = mapStockCategoryLabel(ing.category);
            
            // Color based on contribution
            let barColor = '#10B981'; // green
            if (contribution > 50) barColor = '#DC2626'; // red
            else if (contribution > 20) barColor = '#F59E0B'; // orange
            
            return `
                <tr style="border-bottom: 1px solid #F3F4F6;">
                    <td>${idx + 1}</td>
                    <td style="font-weight: 500; color: #1F2937;">${ing.ingredient_name}</td>
                    <td style="text-align: center; font-weight: 600;">
                        <span style="color: ${barColor};">${Number(ing.total_consumed || 0).toFixed(2)}</span>
                    </td>
                    <td style="text-align: center; color: #6B7280;">${ing.unit || '-'}</td>
                    <td style="text-align: center;">
                        <span style="background: #F3F4F6; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.85rem; color: #6B7280;">
                            ${categoryLabel}
                        </span>
                    </td>
                    <td style="text-align: center;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; justify-content: center;">
                            <span style="background: #DBEAFE; color: #1E40AF; padding: 0.2rem 0.5rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">
                                ${frequency}x
                            </span>
                            <div style="width: 50px; height: 6px; background: #E5E7EB; border-radius: 3px; overflow: hidden;">
                                <div style="width: ${contribution}%; height: 100%; background: ${barColor}; transition: width 0.3s;"></div>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Add summary row at top
        const summaryRow = `
            <tr style="background: linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%); border-bottom: 2px solid #E5E7EB; font-weight: 600;">
                <td colspan="6" style="padding: 1rem; text-align: center;">
                    <div style="display: flex; justify-content: center; gap: 2rem; flex-wrap: wrap;">
                        <div>
                            <span style="color: #6B7280; font-size: 0.9rem;">Total Jenis Bahan:</span>
                            <span style="color: #1F2937; font-size: 1.1rem; margin-left: 0.5rem;">${sortedIngredients.length}</span>
                        </div>
                    </div>
                </td>
            </tr>
        `;
        
        body.innerHTML = summaryRow + rows;
        
        // Scroll to panel
        setTimeout(() => {
            panel.scrollIntoView({behavior: 'smooth', block: 'start'});
        }, 150);
        
    } catch (e) {
        console.error('Failed to show daily ingredient accumulation:', e);
        const body = document.getElementById('ingredient-details-body');
        if (body) {
            body.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 1.5rem;">Gagal memuat akumulasi bahan: ${e.message}</td></tr>`;
        }
    }
}

async function showDailyIngredientAccumulationRange(startDate, endDate) {
    try {
        const panel = document.getElementById('ingredient-details-panel');
        const body = document.getElementById('ingredient-details-body');
        const headRow = document.querySelector('#ingredient-details-table thead tr');
        
        // Helper: map backend enum category to friendly label
        const mapStockCategoryLabel = (cat) => {
            const key = String(cat || '').toLowerCase();
            const map = {
                'packaging': 'Kemasan',
                'ingredients': 'Bahan',
                'coffee_flavors': 'Perisa Kopi',
                'squash_flavors': 'Perisa Squash',
                'milk_shake_flavors': 'Perisa Milk Shake'
            };
            return map[key] || (key ? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Umum');
        };
        
        // Update panel header
        document.getElementById('detail-order-id').textContent = `Akumulasi Bahan Range`;
        document.getElementById('detail-order-date').textContent = `${startDate} s/d ${endDate}`;
        document.getElementById('detail-order-status').textContent = 'Semua Menu';
        
        // Show loading
        body.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 1.5rem;"><i class="fas fa-spinner fa-spin"></i> Memuat akumulasi bahan...</td></tr>';
        
        // Update table header for accumulation view
        if (headRow) {
            headRow.innerHTML = `
                <th>No</th>
                <th>Nama Bahan</th>
                <th>Total Konsumsi</th>
                <th>Unit</th>
                <th>Kategori</th>
                <th>Frekuensi</th>`;
        }
        
        // Show panel immediately
        if (panel) panel.classList.remove('hidden');
        
        // Fetch range data
        const response = await fetch(`/inventory/consumption/daily?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`);
        const json = await response.json();
        const allDays = Array.isArray(json?.data?.daily_consumption) ? json.data.daily_consumption : [];
        
        if (!allDays.length) {
            body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #6B7280; padding: 1.5rem;">Tidak ada data konsumsi untuk rentang ini</td></tr>';
            return;
        }
        
        // Aggregate all ingredients across all days
        const ingredientMap = {};
        allDays.forEach(dayData => {
            (dayData.ingredients_consumed || []).forEach(ing => {
                const key = ing.ingredient_name;
                if (!ingredientMap[key]) {
                    ingredientMap[key] = {
                        ingredient_name: ing.ingredient_name,
                        total_consumed: 0,
                        unit: ing.unit || '-',
                        category: ing.category || null,
                        frequency: 0
                    };
                }
                ingredientMap[key].total_consumed += Number(ing.total_consumed || 0);
                ingredientMap[key].frequency += Number(ing.consumption_count || 1);
            });
        });
        
        const sortedIngredients = Object.values(ingredientMap).sort((a, b) => b.total_consumed - a.total_consumed);
        const totalConsumption = sortedIngredients.reduce((sum, ing) => sum + ing.total_consumed, 0);
        
        const rows = sortedIngredients.map((ing, idx) => {
            const contribution = totalConsumption > 0 ? ((ing.total_consumed / totalConsumption) * 100).toFixed(1) : 0;
            const categoryLabel = mapStockCategoryLabel(ing.category);
            const frequency = ing.frequency || 0;
            
            // Color based on contribution
            let barColor = '#10B981';
            if (contribution >= 20) barColor = '#DC2626';
            else if (contribution >= 10) barColor = '#F59E0B';
            
            return `
                <tr style="border-bottom: 1px solid #F3F4F6;">
                    <td>${idx + 1}</td>
                    <td style="font-weight: 500; color: #1F2937;">${ing.ingredient_name}</td>
                    <td style="text-align: center; font-weight: 600;">
                        <span style="color: ${barColor};">${Number(ing.total_consumed || 0).toFixed(2)}</span>
                    </td>
                    <td style="text-align: center; color: #6B7280;">${ing.unit || '-'}</td>
                    <td style="text-align: center;">
                        <span style="background: #F3F4F6; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.85rem; color: #6B7280;">
                            ${categoryLabel}
                        </span>
                    </td>
                    <td style="text-align: center;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; justify-content: center;">
                            <span style="background: #DBEAFE; color: #1E40AF; padding: 0.2rem 0.5rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">
                                ${frequency}x
                            </span>
                            <div style="width: 50px; height: 6px; background: #E5E7EB; border-radius: 3px; overflow: hidden;">
                                <div style="width: ${contribution}%; height: 100%; background: ${barColor}; transition: width 0.3s;"></div>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Add summary row at top
        const summaryRow = `
            <tr style="background: linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%); border-bottom: 2px solid #E5E7EB; font-weight: 600;">
                <td colspan="6" style="padding: 1rem; text-align: center;">
                    <div style="display: flex; justify-content: center; gap: 2rem; flex-wrap: wrap;">
                        <div>
                            <span style="color: #6B7280; font-size: 0.9rem;">Total Jenis Bahan:</span>
                            <span style="color: #1F2937; font-size: 1.1rem; margin-left: 0.5rem;">${sortedIngredients.length}</span>
                        </div>
                        <div>
                            <span style="color: #6B7280; font-size: 0.9rem;">Rentang:</span>
                            <span style="color: #7C3AED; font-size: 1.1rem; margin-left: 0.5rem; font-weight: 700;">${allDays.length} hari</span>
                        </div>
                    </div>
                </td>
            </tr>
        `;
        
        body.innerHTML = summaryRow + rows;
        
        // Scroll to panel
        setTimeout(() => {
            panel.scrollIntoView({behavior: 'smooth', block: 'start'});
        }, 150);
        
    } catch (e) {
        console.error('Failed to show range ingredient accumulation:', e);
        const body = document.getElementById('ingredient-details-body');
        if (body) {
            body.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 1.5rem;">Gagal memuat akumulasi bahan: ${e.message}</td></tr>`;
        }
    }
}

// ========== INGREDIENT ANALYSIS EXPORT FUNCTIONS ==========
async function exportIngredientExcel() {
    const cleanMenuName = (name) => {
        const cleaned = String(name || '').trim();
        const noPrefix = cleaned.replace(/^\s*\d+\s*x?\s*/i, '');
        return noPrefix.replace(/\s*x\s*\d+\s*$/i, '').trim();
    };
    // Export for Ingredient Analysis using inventory truth per-order breakdown
    const viewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
    const { start, end } = (function () {
        const s1 = document.getElementById('ingredient-start-date')?.value?.trim();
        const e1 = document.getElementById('ingredient-end-date')?.value?.trim();
        const s2 = document.getElementById('start_date')?.value?.trim();
        const e2 = document.getElementById('end_date')?.value?.trim();
        return { start: s1 || s2 || '', end: e1 || e2 || '' };
    })();

    const toIso = (s) => parseAnyDateToIso(String(s)) || null;
    const fmtDisplay = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ? `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}` : (iso || '-');

    // 1) Collect target order IDs from inventory history within range (source of truth), plus kitchen cache fallback
    const orderIdSet = new Set();
    try {
        const qp = new URLSearchParams();
        if (start) qp.append('start_date', start);
        if (end) qp.append('end_date', end);
        qp.append('limit', '2000');
        const logsRes = await fetch(`/inventory/history?${qp.toString()}`);
        const logsJson = await logsRes.json().catch(() => ({}));
        const logs = Array.isArray(logsJson.history) ? logsJson.history : [];
        for (const row of logs) {
            if (!row || !row.order_id) continue;
            if (row.rolled_back) continue;
            // prefer consumed-only when available
            if (typeof row.consumed === 'boolean' && !row.consumed) continue;
            orderIdSet.add(String(row.order_id));
        }
    } catch (e) {
        console.warn('Failed to load inventory history for export; falling back to kitchen cache only', e);
    }
    if (Array.isArray(kitchenOrdersCache)) {
        for (const o of kitchenOrdersCache) {
            if (!o || o.status !== 'done') continue;
            const iso = toIso(o.time_done || o.time || o.time_done_at);
            if (!iso) continue;
            if (start && iso < start) continue;
            if (end && iso > end) continue;
            if (o.order_id) orderIdSet.add(String(o.order_id));
        }
    }
    const targetOrderIds = Array.from(orderIdSet);

    // 2) Fetch per-order ingredient breakdowns (menu_breakdown preferred)
    async function fetchBreakdown(orderId) {
        try {
            // Use inventory proxy endpoint for per-order ingredient breakdown in logs view
            const res = await fetch(`/order/${encodeURIComponent(orderId)}/ingredients`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const data = json?.data || json || {};
            const mb = data.menu_breakdown || json.menu_breakdown || [];
            const ib = (data.ingredients_breakdown || json.ingredients_breakdown || {});
            const details = Array.isArray(ib.details) ? ib.details : (Array.isArray(json?.details) ? json.details : []);
            const orderDate = data.order_date || data.date || json.order_date || json.date || '';
            return { order_id: orderId, order_date: orderDate, menu_breakdown: Array.isArray(mb) ? mb : [], details };
        } catch (e) {
            console.warn('Failed fetching breakdown for order', orderId, e);
            return { order_id: orderId, order_date: '', menu_breakdown: [], details: [] };
        }
    }

    // Limit concurrency to avoid flooding backend
    async function fetchAllBreakdowns(ids, concurrency = 5) {
        const results = [];
        let index = 0;
        async function worker() {
            while (index < ids.length) {
                const id = ids[index++];
                const r = await fetchBreakdown(id);
                results.push(r);
            }
        }
        const workers = Array.from({ length: Math.min(concurrency, ids.length || 0) }, () => worker());
        await Promise.all(workers);
        return results;
    }

    const breakdowns = await fetchAllBreakdowns(targetOrderIds);

    // 3) Build per-item detail rows, preferring menu_breakdown; fallback to recipe-based if needed
    const detailRows = [];
    for (const b of breakdowns) {
        const iso = toIso(b.order_date);
        // fallback: try kitchen cache to resolve date
        const kitchenOrder = kitchenOrdersCache.find(o => String(o.order_id) === String(b.order_id));
        const dateIso = iso || (kitchenOrder ? toIso(kitchenOrder.time_done || kitchenOrder.time_done_at || kitchenOrder.time) : null);
        const dateDisp = fmtDisplay(dateIso);
        let perItemIngredientIds = new Set();
        let itemListForDistribution = [];

        if (Array.isArray(b.menu_breakdown) && b.menu_breakdown.length) {
            for (const it of b.menu_breakdown) {
                const menuName = cleanMenuName(it?.menu_name || 'Unknown Menu');
                const itemQty = Number(it?.quantity || 0) || 0;
                itemListForDistribution.push({ menu: menuName, qty: itemQty });
                const ings = Array.isArray(it?.ingredients) ? it.ingredients : [];
                for (const ing of ings) {
                    const name = ing?.ingredient_name || '-';
                    const id = ing?.ingredient_id || name;
                    const qty = Number(ing?.required_quantity ?? ing?.quantity ?? ing?.consumed_quantity ?? 0) || 0;
                    const unit = ing?.unit || '';
                    if (!qty) continue;
                    detailRows.push({ date: dateDisp, order_id: b.order_id, menu: menuName, ingredient_id: id, ingredient: name, qty, unit });
                    perItemIngredientIds.add(String(id));
                }
            }
            // Distribute any leftover ingredients from overall details that aren't listed per-item
            if (Array.isArray(b.details) && b.details.length && itemListForDistribution.length) {
                const totalItemQty = itemListForDistribution.reduce((a, x) => a + (Number(x.qty) || 0), 0) || 0;
                if (totalItemQty > 0) {
                    for (const d of b.details) {
                        const did = d?.ingredient_id || d?.ingredient_name;
                        if (!did) continue;
                        if (perItemIngredientIds.has(String(did))) continue; // already covered by per-item
                        const totalQty = Number(d?.consumed_quantity || d?.quantity || 0) || 0;
                        const unit = d?.unit || '';
                        if (!totalQty) continue;
                        for (const it of itemListForDistribution) {
                            const share = (Number(it.qty) || 0) / totalItemQty;
                            const alloc = totalQty * share;
                            if (!alloc) continue;
                            detailRows.push({ date: dateDisp, order_id: b.order_id, menu: it.menu, ingredient_id: did, ingredient: d?.ingredient_name || String(did), qty: alloc, unit });
                        }
                    }
                }
            }
            continue;
        }

        // Fallback: if no per-item breakdown, try recipe-based from kitchen order + globalFlavorMap (legacy behavior)
        if (kitchenOrder && Array.isArray(kitchenOrder.items)) {
            for (const it of kitchenOrder.items) {
                const menuName = cleanMenuName(it.menu_name || 'Unknown Menu');
                const qty = Number(it.quantity || 0) || 0; if (!qty) continue;
                itemListForDistribution.push({ menu: menuName, qty });
                const flavorRaw = (it.preference || it.flavor || '-');
                const flavorKey = String(flavorRaw || '-').toLowerCase();
                const recipes = menuRecipes && menuRecipes[menuName] ? menuRecipes[menuName] : [];
                for (const r of recipes) {
                    const ingId = r.ingredient_id; const perServing = Number(r.quantity || 0) || 0; const used = perServing * qty; if (!ingId || !used) continue;
                    detailRows.push({ date: dateDisp, order_id: b.order_id, menu: menuName, ingredient_id: ingId, ingredient: (ingredientData?.[ingId]?.name || r.ingredient_name || String(ingId)), qty: used, unit: r.unit || (ingredientData?.[ingId]?.unit) || '' });
                    perItemIngredientIds.add(String(ingId));
                }
                const mappings = globalFlavorMap && globalFlavorMap[flavorKey] ? globalFlavorMap[flavorKey] : [];
                for (const fm of mappings) {
                    const ingId = fm.ingredient_id; const perServing = Number(fm.quantity_per_serving || fm.quantity || 0) || 0; const used = perServing * qty; if (!ingId || !used) continue;
                    detailRows.push({ date: dateDisp, order_id: b.order_id, menu: menuName, ingredient_id: ingId, ingredient: (ingredientData?.[ingId]?.name || String(ingId)), qty: used, unit: fm.unit || (ingredientData?.[ingId]?.unit) || '' });
                    perItemIngredientIds.add(String(ingId));
                }
            }
            // Distribute remaining ingredients from overall details
            if (Array.isArray(b.details) && b.details.length && itemListForDistribution.length) {
                const totalItemQty = itemListForDistribution.reduce((a, x) => a + (Number(x.qty) || 0), 0) || 0;
                if (totalItemQty > 0) {
                    for (const d of b.details) {
                        const did = d?.ingredient_id || d?.ingredient_name;
                        if (!did) continue;
                        if (perItemIngredientIds.has(String(did))) continue;
                        const totalQty = Number(d?.consumed_quantity || d?.quantity || 0) || 0;
                        const unit = d?.unit || '';
                        if (!totalQty) continue;
                        for (const it of itemListForDistribution) {
                            const share = (Number(it.qty) || 0) / totalItemQty;
                            const alloc = totalQty * share;
                            if (!alloc) continue;
                            detailRows.push({ date: dateDisp, order_id: b.order_id, menu: it.menu, ingredient_id: did, ingredient: d?.ingredient_name || String(did), qty: alloc, unit });
                        }
                    }
                }
            }
        } else if (Array.isArray(b.details) && b.details.length) {
            // Last resort: include overall order ingredient details without per-item menu association
            for (const d of b.details) {
                const name = d?.ingredient_name || '-';
                const id = d?.ingredient_id || name;
                const qty = Number(d?.consumed_quantity || d?.quantity || 0) || 0;
                const unit = d?.unit || '';
                if (!qty) continue;
                detailRows.push({ date: dateDisp, order_id: b.order_id, menu: '-', ingredient_id: id, ingredient: name, qty, unit });
            }
        }
    }

    // Sort detailRows by date (earliest first)
    detailRows.sort((a, b) => {
        // Convert DD/MM/YYYY to YYYY-MM-DD for proper comparison
        const parseDate = (dateStr) => {
            if (!dateStr || dateStr === '-') return '0000-00-00';
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                // DD/MM/YYYY -> YYYY-MM-DD
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            return dateStr;
        };
        
        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);
        
        // Sort by date, then by order_id, then by menu
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        if (a.order_id !== b.order_id) return String(a.order_id || '').localeCompare(String(b.order_id || ''));
        return String(a.menu || '').localeCompare(String(b.menu || ''));
    });

    // 4) Aggregate cumulative totals per ingredient
    const totalsMap = {};
    for (const r of detailRows) {
        const key = r.ingredient_id || r.ingredient;
        if (!totalsMap[key]) totalsMap[key] = { ingredient: r.ingredient, total_qty: 0, unit: r.unit || '' };
        totalsMap[key].total_qty += Number(r.qty || 0);
        if (!totalsMap[key].unit && r.unit) totalsMap[key].unit = r.unit;
    }
    const cumulativeRows = Object.values(totalsMap).sort((a,b)=> String(a.ingredient).localeCompare(String(b.ingredient)));

    // 5) Build Excel workbook with modern styling
    const wb = XLSX.utils.book_new();
    
    // Helper function to apply modern styling
    const applyModernStyle = (ws, headerRow, dataStartRow, dataEndRow, colCount) => {
        const range = XLSX.utils.decode_range(ws['!ref']);
        
        // Style header row - Modern gradient blue
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const address = XLSX.utils.encode_col(C) + headerRow;
            if (!ws[address]) continue;
            ws[address].s = {
                fill: { fgColor: { rgb: "2563EB" } }, // Blue-600
                font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11, name: "Segoe UI" },
                alignment: { horizontal: "center", vertical: "center", wrapText: true },
                border: {
                    top: { style: "thin", color: { rgb: "1E40AF" } },
                    bottom: { style: "thin", color: { rgb: "1E40AF" } },
                    left: { style: "thin", color: { rgb: "1E40AF" } },
                    right: { style: "thin", color: { rgb: "1E40AF" } }
                }
            };
        }
        
        // Style data rows - Alternating colors for better readability
        for (let R = dataStartRow; R <= dataEndRow; ++R) {
            const isEven = (R - dataStartRow) % 2 === 0;
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const address = XLSX.utils.encode_col(C) + R;
                if (!ws[address]) continue;
                
                // Check if it's a number column (Qty)
                const isNumberCol = (C === 5 && colCount === 7) || (C === 2 && colCount === 4); // Qty columns
                
                ws[address].s = {
                    fill: { fgColor: { rgb: isEven ? "F8FAFC" : "FFFFFF" } }, // Slate-50 / White
                    font: { sz: 10, name: "Segoe UI", color: { rgb: "1E293B" } },
                    alignment: { 
                        horizontal: isNumberCol ? "right" : (C === 0 ? "center" : "left"), 
                        vertical: "center" 
                    },
                    border: {
                        top: { style: "thin", color: { rgb: "E2E8F0" } },
                        bottom: { style: "thin", color: { rgb: "E2E8F0" } },
                        left: { style: "thin", color: { rgb: "E2E8F0" } },
                        right: { style: "thin", color: { rgb: "E2E8F0" } }
                    },
                    numFmt: isNumberCol ? "#,##0.00" : undefined
                };
            }
        }
        
        // Set row height for header
        if (!ws['!rows']) ws['!rows'] = [];
        ws['!rows'][headerRow - 1] = { hpt: 25 };
    };
    
    // Sheet 1: Per Hari - Item (Detail)
    const headersDetail = ['No', 'Tanggal', 'Order ID', 'Menu', 'Bahan', 'Qty', 'Unit'];
    const detailAoA = [headersDetail, ...detailRows.map((r, i) => [
        i + 1, 
        r.date, 
        r.order_id || '-', 
        r.menu || '-', 
        r.ingredient || '-', 
        Number(r.qty || 0), 
        r.unit || ''
    ])];
    const wsDetail = XLSX.utils.aoa_to_sheet(detailAoA);
    wsDetail['!cols'] = [
        { wch: 6 },   // No
        { wch: 14 },  // Tanggal
        { wch: 18 },  // Order ID
        { wch: 30 },  // Menu
        { wch: 30 },  // Bahan
        { wch: 14 },  // Qty
        { wch: 12 }   // Unit
    ];
    applyModernStyle(wsDetail, 1, 2, detailRows.length + 1, 7);
    XLSX.utils.book_append_sheet(wb, wsDetail, viewMode === 'logs' ? 'Per Order - Item' : 'Per Hari - Item');

    // Sheet 2: Akumulasi per Bahan
    const headersCum = ['No', 'Bahan', 'Total Qty', 'Unit'];
    const cumAoA = [headersCum, ...cumulativeRows.map((r, i) => [
        i + 1, 
        r.ingredient || '-', 
        Number(r.total_qty || 0), 
        r.unit || ''
    ])];
    const wsCum = XLSX.utils.aoa_to_sheet(cumAoA);
    wsCum['!cols'] = [
        { wch: 6 },   // No
        { wch: 38 },  // Bahan
        { wch: 16 },  // Total Qty
        { wch: 12 }   // Unit
    ];
    applyModernStyle(wsCum, 1, 2, cumulativeRows.length + 1, 4);
    XLSX.utils.book_append_sheet(wb, wsCum, 'Akumulasi per Bahan');

    // Sheet 3: Ringkasan (Summary with premium look)
    const summaryData = [
        ['ANALISIS KONSUMSI BAHAN'],
        [],
        ['Informasi Periode'],
        ['Tanggal Mulai', start || '-'],
        ['Tanggal Akhir', end || '-'],
        [],
        ['Statistik Data'],
        ['Total Baris Detail', detailRows.length],
        ['Total Jenis Bahan', cumulativeRows.length],
        ['Total Order', new Set(detailRows.map(r => r.order_id)).size],
        [],
        ['Informasi Export'],
        ['Tanggal Export', new Date().toLocaleDateString('id-ID')],
        ['Waktu Export', new Date().toLocaleTimeString('id-ID')],
        ['Dibuat Oleh', 'Infinity Cafe - Report System']
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 22 }, { wch: 35 }];
    
    // Custom styling for summary sheet
    const summaryRange = XLSX.utils.decode_range(wsSummary['!ref']);
    
    // Title row (A1)
    if (wsSummary['A1']) {
        wsSummary['A1'].s = {
            fill: { fgColor: { rgb: "1E40AF" } }, // Blue-800
            font: { bold: true, sz: 16, color: { rgb: "FFFFFF" }, name: "Segoe UI" },
            alignment: { horizontal: "center", vertical: "center" }
        };
        wsSummary['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    }
    
    // Section headers (rows 3, 7, 12)
    [2, 6, 11].forEach(rowIdx => {
        const cell = wsSummary[XLSX.utils.encode_cell({ r: rowIdx, c: 0 })];
        if (cell) {
            cell.s = {
                fill: { fgColor: { rgb: "3B82F6" } }, // Blue-500
                font: { bold: true, sz: 11, color: { rgb: "FFFFFF" }, name: "Segoe UI" },
                alignment: { horizontal: "left", vertical: "center" }
            };
        }
    });
    
    // Data rows styling
    for (let R = 0; R <= summaryRange.e.r; ++R) {
        if ([2, 6, 11].includes(R)) continue; // Skip section headers
        for (let C = 0; C <= 1; ++C) {
            const address = XLSX.utils.encode_cell({ r: R, c: C });
            if (!wsSummary[address]) continue;
            
            const isLabel = C === 0 && R > 0 && ![1, 5, 10].includes(R);
            const isValue = C === 1 && R > 0;
            
            if (isLabel) {
                wsSummary[address].s = {
                    font: { bold: true, sz: 10, color: { rgb: "475569" }, name: "Segoe UI" },
                    alignment: { horizontal: "left", vertical: "center" },
                    fill: { fgColor: { rgb: "F1F5F9" } }
                };
            } else if (isValue) {
                wsSummary[address].s = {
                    font: { sz: 10, color: { rgb: "1E293B" }, name: "Segoe UI" },
                    alignment: { horizontal: "left", vertical: "center" }
                };
            }
        }
    }
    
    // Set row heights for summary
    wsSummary['!rows'] = [];
    wsSummary['!rows'][0] = { hpt: 30 }; // Title row
    [2, 6, 11].forEach(idx => { wsSummary['!rows'][idx] = { hpt: 22 }; }); // Section headers
    
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

    const fileName = `InfinityCafe_Ingredient_Analysis_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
}
 
 function exportIngredientCSV() {
    const viewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
    const dataset = ingredientDataCache && ingredientDataCache[viewMode] ? ingredientDataCache[viewMode] : (Array.isArray(baseData) ? baseData : []);
    let headers = [];
    let exportData = [];

    if (viewMode === 'daily') {
        headers = ['No', 'Tanggal', 'Ringkasan', 'Total Pesanan', 'Total Konsumsi'];
        exportData = dataset.map((r, index) => [
            index + 1,
            r.date || '-',
            r.daily_summary ? `${r.daily_summary.total_orders || 0} pesanan, ${r.daily_summary.unique_menus || 0} menu unik` : '-',
            r.daily_summary?.total_orders || 0,
            r.daily_summary?.total_consumption || 0
        ]);
    } else {
    headers = ['No', 'Menu', 'Date Range', 'Total Orders', 'Ingredients Used'];
        exportData = dataset.map((r, index) => [
            index + 1,
            r.menu_name || '-',
            // no flavor column in logs export
            r.date || '-',
            (r.order_count ?? ((r.order_ids || []).length) ?? 0),
            (r.ingredients_affected ?? r.total_qty ?? 0)
        ]);
    }

    const csvContent = [headers, ...exportData].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ingredient_analysis_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

async function exportIngredientPDF() {
    // Export PDF for Ingredient Analysis: branch by view mode
    const viewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
    const startDate = (document.getElementById('ingredient-start-date')?.value?.trim()) || (document.getElementById('start_date')?.value?.trim()) || '-';
    const endDate = (document.getElementById('ingredient-end-date')?.value?.trim()) || (document.getElementById('end_date')?.value?.trim()) || '-';

    if (viewMode === 'logs') {
        // For logs mode, generate the same two sections: cumulative and per-item detail across date range
        // Fall through to the daily-mode implementation below (same data shape)
    }

    // Build datasets similar to Excel export but using per-order breakdown
    const toIso = (s) => parseAnyDateToIso(String(s)) || null;
    const fmtDisplay = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ? `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}` : (iso || '-');

    // Collect order IDs from inventory history
    const orderIdSet = new Set();
    try {
        const qp = new URLSearchParams();
        if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) qp.append('start_date', startDate);
        if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) qp.append('end_date', endDate);
        qp.append('limit', '2000');
        const logsRes = await fetch(`/inventory/history?${qp.toString()}`);
        const logsJson = await logsRes.json().catch(() => ({}));
        const logs = Array.isArray(logsJson.history) ? logsJson.history : [];
        for (const row of logs) {
            if (!row || !row.order_id) continue;
            if (row.rolled_back) continue;
            if (typeof row.consumed === 'boolean' && !row.consumed) continue;
            orderIdSet.add(String(row.order_id));
        }
    } catch (e) {
        console.warn('Failed to load inventory history for PDF export', e);
    }
    if (Array.isArray(kitchenOrdersCache)) {
        for (const o of kitchenOrdersCache) {
            if (!o || o.status !== 'done') continue;
            const iso = toIso(o.time_done || o.time || o.time_done_at);
            const s = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : null;
            const e = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : null;
            if (s && iso && iso < s) continue;
            if (e && iso && iso > e) continue;
            if (o.order_id) orderIdSet.add(String(o.order_id));
        }
    }
    const targetOrderIds = Array.from(orderIdSet);

    async function fetchBreakdown(orderId) {
        try {
            // Use inventory proxy endpoint for per-order ingredient breakdown in export as well
            const res = await fetch(`/order/${encodeURIComponent(orderId)}/ingredients`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const data = json?.data || json || {};
            const mb = data.menu_breakdown || json.menu_breakdown || [];
            const ib = (data.ingredients_breakdown || json.ingredients_breakdown || {});
            const details = Array.isArray(ib.details) ? ib.details : (Array.isArray(json?.details) ? json.details : []);
            const orderDate = data.order_date || data.date || json.order_date || json.date || '';
            return { order_id: orderId, order_date: orderDate, menu_breakdown: Array.isArray(mb) ? mb : [], details };
        } catch (e) {
            console.warn('Failed fetching breakdown for order', orderId, e);
            return { order_id: orderId, order_date: '', menu_breakdown: [], details: [] };
        }
    }

    async function fetchAllBreakdowns(ids, concurrency = 5) {
        const results = [];
        let index = 0;
        async function worker() {
            while (index < ids.length) {
                const id = ids[index++];
                const r = await fetchBreakdown(id);
                results.push(r);
            }
        }
        const workers = Array.from({ length: Math.min(concurrency, ids.length || 0) }, () => worker());
        await Promise.all(workers);
        return results;
    }

    const breakdowns = await fetchAllBreakdowns(targetOrderIds);
    const cleanMenuName = (name) => {
        const cleaned = String(name || '').trim();
        const noPrefix = cleaned.replace(/^\s*\d+\s*x?\s*/i, '');
        return noPrefix.replace(/\s*x\s*\d+\s*$/i, '').trim();
    };
    const detailRows = [];
    for (const b of breakdowns) {
        const iso = toIso(b.order_date);
        const kitchenOrder = kitchenOrdersCache.find(o => String(o.order_id) === String(b.order_id));
        const dateIso = iso || (kitchenOrder ? toIso(kitchenOrder.time_done || kitchenOrder.time_done_at || kitchenOrder.time) : null);
        const dateDisp = fmtDisplay(dateIso);
        let perItemIngredientIds = new Set();
        let itemListForDistribution = [];

        if (Array.isArray(b.menu_breakdown) && b.menu_breakdown.length) {
            for (const it of b.menu_breakdown) {
                const menuName = cleanMenuName(it?.menu_name || 'Unknown Menu');
                const itemQty = Number(it?.quantity || 0) || 0;
                itemListForDistribution.push({ menu: menuName, qty: itemQty });
                const ings = Array.isArray(it?.ingredients) ? it.ingredients : [];
                for (const ing of ings) {
                    const name = ing?.ingredient_name || '-';
                    const id = ing?.ingredient_id || name;
                    const qty = Number(ing?.required_quantity ?? ing?.quantity ?? ing?.consumed_quantity ?? 0) || 0;
                    const unit = ing?.unit || '';
                    if (!qty) continue;
                    detailRows.push({ date: dateDisp, order_id: b.order_id, menu: menuName, ingredient_id: id, ingredient: name, qty, unit });
                    perItemIngredientIds.add(String(id));
                }
            }
            if (Array.isArray(b.details) && b.details.length && itemListForDistribution.length) {
                const totalItemQty = itemListForDistribution.reduce((a, x) => a + (Number(x.qty) || 0), 0) || 0;
                if (totalItemQty > 0) {
                    for (const d of b.details) {
                        const did = d?.ingredient_id || d?.ingredient_name;
                        if (!did) continue;
                        if (perItemIngredientIds.has(String(did))) continue;
                        const totalQty = Number(d?.consumed_quantity || d?.quantity || 0) || 0;
                        const unit = d?.unit || '';
                        if (!totalQty) continue;
                        for (const it of itemListForDistribution) {
                            const share = (Number(it.qty) || 0) / totalItemQty;
                            const alloc = totalQty * share;
                            if (!alloc) continue;
                            detailRows.push({ date: dateDisp, order_id: b.order_id, menu: it.menu, ingredient_id: did, ingredient: d?.ingredient_name || String(did), qty: alloc, unit });
                        }
                    }
                }
            }
            continue;
        }

        if (kitchenOrder && Array.isArray(kitchenOrder.items)) {
            for (const it of kitchenOrder.items) {
                const menuName = cleanMenuName(it.menu_name || 'Unknown Menu');
                const qty = Number(it.quantity || 0) || 0; if (!qty) continue;
                itemListForDistribution.push({ menu: menuName, qty });
                const flavorRaw = (it.preference || it.flavor || '-');
                const flavorKey = String(flavorRaw || '-').toLowerCase();
                const recipes = menuRecipes && menuRecipes[menuName] ? menuRecipes[menuName] : [];
                for (const r of recipes) {
                    const ingId = r.ingredient_id; const perServing = Number(r.quantity || 0) || 0; const used = perServing * qty; if (!ingId || !used) continue;
                    detailRows.push({ date: dateDisp, order_id: b.order_id, menu: menuName, ingredient_id: ingId, ingredient: (ingredientData?.[ingId]?.name || r.ingredient_name || String(ingId)), qty: used, unit: r.unit || (ingredientData?.[ingId]?.unit) || '' });
                    perItemIngredientIds.add(String(ingId));
                }
                const mappings = globalFlavorMap && globalFlavorMap[flavorKey] ? globalFlavorMap[flavorKey] : [];
                for (const fm of mappings) {
                    const ingId = fm.ingredient_id; const perServing = Number(fm.quantity_per_serving || fm.quantity || 0) || 0; const used = perServing * qty; if (!ingId || !used) continue;
                    detailRows.push({ date: dateDisp, order_id: b.order_id, menu: menuName, ingredient_id: ingId, ingredient: (ingredientData?.[ingId]?.name || String(ingId)), qty: used, unit: fm.unit || (ingredientData?.[ingId]?.unit) || '' });
                    perItemIngredientIds.add(String(ingId));
                }
            }
            if (Array.isArray(b.details) && b.details.length && itemListForDistribution.length) {
                const totalItemQty = itemListForDistribution.reduce((a, x) => a + (Number(x.qty) || 0), 0) || 0;
                if (totalItemQty > 0) {
                    for (const d of b.details) {
                        const did = d?.ingredient_id || d?.ingredient_name;
                        if (!did) continue;
                        if (perItemIngredientIds.has(String(did))) continue;
                        const totalQty = Number(d?.consumed_quantity || d?.quantity || 0) || 0;
                        const unit = d?.unit || '';
                        if (!totalQty) continue;
                        for (const it of itemListForDistribution) {
                            const share = (Number(it.qty) || 0) / totalItemQty;
                            const alloc = totalQty * share;
                            if (!alloc) continue;
                            detailRows.push({ date: dateDisp, order_id: b.order_id, menu: it.menu, ingredient_id: did, ingredient: d?.ingredient_name || String(did), qty: alloc, unit });
                        }
                    }
                }
            }
        } else if (Array.isArray(b.details) && b.details.length) {
            for (const d of b.details) {
                const name = d?.ingredient_name || '-';
                const id = d?.ingredient_id || name;
                const qty = Number(d?.consumed_quantity || d?.quantity || 0) || 0;
                const unit = d?.unit || '';
                if (!qty) continue;
                detailRows.push({ date: dateDisp, order_id: b.order_id, menu: '-', ingredient_id: id, ingredient: name, qty, unit });
            }
        }
    }
    const totalsMap = {}; for (const r of detailRows) { const key = r.ingredient_id || r.ingredient; if (!totalsMap[key]) totalsMap[key] = { ingredient: r.ingredient, total_qty: 0, unit: r.unit || '' }; totalsMap[key].total_qty += Number(r.qty||0); if (!totalsMap[key].unit && r.unit) totalsMap[key].unit = r.unit; }
    const cumulativeRows = Object.values(totalsMap).sort((a,b)=> String(a.ingredient).localeCompare(String(b.ingredient)));

    const jsPdfNs = (window.jspdf || window.jsPDF || null);
    const JSPDF_CTOR = jsPdfNs ? (jsPdfNs.jsPDF || jsPdfNs) : null;
    if (!JSPDF_CTOR) { alert('jsPDF tidak tersedia.'); return; }
    const doc = new JSPDF_CTOR('p','mm','a4');

    const colorPrimary = [68,45,45], colorAccent = [220,208,168], colorBg = [245,239,230];
    doc.setFillColor(colorBg[0], colorBg[1], colorBg[2]); doc.rect(10, 10, 190, 18, 'F');
    doc.setFont('helvetica','bold'); doc.setTextColor(colorPrimary[0], colorPrimary[1], colorPrimary[2]); doc.setFontSize(14);
    doc.text('Ingredient Analysis - Infinity Cafe', 14, 20);
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    doc.text(`Periode: ${startDate} s/d ${endDate}`, 14, 30);

    if (!doc.autoTable) { alert('AutoTable tidak tersedia.'); return; }

    // Section 1: Cumulative totals per ingredient
    let y = 36;
    doc.setFont('helvetica','bold'); doc.text('Akumulasi Bahan (Periode)', 14, y);
    y += 4;
    doc.autoTable({
        startY: y,
        head: [[ 'No','Bahan','Total Qty','Unit' ]],
        body: cumulativeRows.map((r,i)=>[ i+1, r.ingredient || '-', Number(r.total_qty||0), r.unit || '' ]),
        theme: 'grid', styles: { font: 'helvetica', fontSize: 9, textColor: [68,45,45] }, headStyles: { fillColor: colorAccent, textColor: [68,45,45], halign: 'left' }, alternateRowStyles: { fillColor: [250,247,240] }, tableLineColor: colorAccent, tableLineWidth: 0.2, margin: { left: 10, right: 10 }
    });

    // Section 2: Per-day per-item breakdown
    doc.addPage();
    doc.setFont('helvetica','bold'); doc.text('Detail Harian per Item', 14, 14);
    doc.autoTable({
        startY: 18,
    head: [[ 'No','Tanggal','Order ID','Menu','Bahan','Qty','Unit' ]],
    body: detailRows.map((r,i)=>[ i+1, r.date, r.order_id || '-', r.menu || '-', r.ingredient || '-', Number(r.qty||0), r.unit || '' ]),
        theme: 'grid', styles: { font: 'helvetica', fontSize: 8.5, textColor: [68,45,45] }, headStyles: { fillColor: colorAccent, textColor: [68,45,45], halign: 'left' }, alternateRowStyles: { fillColor: [250,247,240] }, tableLineColor: colorAccent, tableLineWidth: 0.2, margin: { left: 10, right: 10 }
    });

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) { doc.setPage(i); doc.setFontSize(9); doc.setTextColor(120); doc.text(`Generated: ${new Date().toLocaleString('id-ID')}  |  Page ${i}/${pageCount}`, 10, 290); }
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
            summaryIncome.textContent = `Rp ${(summary.total_profit || 0).toLocaleString('id-ID')}`;
        } else {
            summaryIncome.textContent = 'Rp 0';
        }
    }
    
    if (summaryOrders) {
        const summary = data.summary;
        if (summary) {
            // Show number of completed (done) orders, not line-item transactions
            summaryOrders.textContent = `${summary.processed_orders || 0}`;
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
    // Ingredient tables: daily has 6 columns, logs now has 6 columns as well
    colspan = 6;
    } else if (currentDataType === 'best') {
      colspan = 5;
    } else if (currentDataType === 'sales') {
      colspan = 8; // Updated untuk 7 kolom (termasuk Total Modal)
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
            summaryIncome.textContent = `Rp ${(data.total_income || 0).toLocaleString('id-ID')}`;
        } else if (type === 'best') {
            const totalRevenue = data.best_sellers ? 
                data.best_sellers.reduce((sum, item) => sum + (item.profit || 0), 0) : 0;
            summaryIncome.textContent = `Rp ${totalRevenue.toLocaleString('id-ID')}`;
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
    const menuAggregation = {};

    details.forEach(d => {
        const menuName = d.menu_name || 'Unknown';

        if (!menuAggregation[menuName]) {
            menuAggregation[menuName] = {
                menu_name: menuName,
                quantity: 0,
                total_revenue: 0
            };
        }

        menuAggregation[menuName].quantity += d.quantity || 0;
        menuAggregation[menuName].total_revenue += d.total_revenue || 0;
    });

    const aggregatedData = Object.values(menuAggregation)
        .sort((a, b) => b.quantity - a.quantity);

    const labels = aggregatedData.map(d => d.menu_name);
    const quantities = aggregatedData.map(d => d.quantity);

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
                },
                title: {
                    display: true,
                    text: 'Sales by Menu',
                    color: '#312929',
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#312929'
                    },
                    title: {
                        display: true,
                        text: 'Quantity Sold',
                        color: '#312929'
                    }
                },
                x: {
                    ticks: {
                        color: '#312929',
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
                    '#503A3A', '#CAB99D', '#685454', '#60B7A6', '#F5EFE6',
                    '#9B59B6', '#3498DB', '#E74C3C', '#F39C12', '#2ECC71'
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
                title: {
                    display: true,
                    text: 'Menu Distribution',
                    color: '#312929'
                },
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
                        },
                        generateLabels: function(chart) {
                            const data = chart.data;
                            if (data.labels.length && data.datasets.length) {
                                return data.labels.map((label, i) => {
                                    const meta = chart.getDatasetMeta(0);
                                    const style = meta.controller.getStyle(i);

                                    let displayLabel = label;
                                    if (label.length > 25) {
                                        displayLabel = label.substring(0, 25) + '...';
                                    }

                                    return {
                                        text: displayLabel,
                                        fillStyle: style.backgroundColor,
                                        strokeStyle: style.borderColor,
                                        lineWidth: style.borderWidth,
                                        hidden: isNaN(data.datasets[0].data[i]) || meta.data[i].hidden,
                                        index: i
                                    };
                                });
                            }
                            return [];
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

    const rangkuman = `📅 Periode ${data.start_date || 'N/A'} s/d ${data.end_date || 'N/A'} terjadi <strong>${data.total_order || 0}</strong> transaksi dengan total pendapatan <strong>Rp ${(data.total_income || 0).toLocaleString('id-ID')}</strong>.`;
    const menuTerlaris = topMenu ? `📌 Menu paling laris: <strong>${topMenu.menu_name || 'N/A'}</strong> (${topMenu.quantity || 0} terjual), menyumbang ${percent}% pendapatan.` : "📌 Tidak ada data menu terlaris.";
    const loyal = loyalCustomer ? `🏆 Pelanggan loyal: <strong>${loyalCustomer.customer_name || 'N/A'}</strong>, ${loyalCustomer.total_orders || 0}x order, Rp ${(loyalCustomer.total_spent || 0).toLocaleString('id-ID')}.` : "";
    
    content.innerHTML = [rangkuman, menuTerlaris, loyal].filter(Boolean).join('<br><br>');
    box.classList.remove("hidden");
}

// Hash helpers to detect changes without re-rendering
function computeDataHash(arr) {
    try {
        if (!Array.isArray(arr)) return '0';
        // lightweight hash: join key fields to avoid heavy stringify
        const key = arr.map(i => `${i.menu_name}|${i.quantity ?? i.total_quantity ?? 0}|${i.total ?? i.profit ?? 0}`).join('#');
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

async function loadReport(rangeOverride = null, maybeEnd = null) {
    if (typeof rangeOverride === 'string' && typeof maybeEnd === 'string') {
        const { startEl, endEl } = getGlobalDateElements();
        if (startEl) startEl.value = rangeOverride;
        if (endEl) endEl.value = maybeEnd;
    } else if (rangeOverride && typeof rangeOverride === 'object') {
        const { start, end } = rangeOverride;
        const { startEl, endEl } = getGlobalDateElements();
        if (startEl && start) startEl.value = start;
        if (endEl && end) endEl.value = end;
    }

    const validation = validateGlobalDateRange({ requireBoth: true });
    if (!validation.valid) return;
    const { start, end } = validation;
    const menuFilterInput = document.getElementById("menu-filter");
    const menuFilter = menuFilterInput ? menuFilterInput.value.trim() : '';

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
            const rawTransactions = Array.isArray(data.transactions) ? data.transactions : [];
        console.log('Report transactions:', rawTransactions);
        console.log('Data structure:', data);
        console.log('Transactions length:', rawTransactions.length);

            // Aggregate sales data by menu + flavor combination
            const details = aggregateSalesData(rawTransactions);
            console.log('Aggregated sales data:', details);

            details.sort((a, b) => (a.menu_name || '').localeCompare(b.menu_name || ''));
        
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
    const chartData = aggregateChartDataByMenu(details);
        renderCharts(chartData);
        // .map(item => ({
        //     menu_name: item.menu_name || 'N/A',
        //     flavor: item.flavor || 'Default',
        //     quantity: item.quantity || 0,
        //     unit_price: item.unit_price || 0,
        //     total: item.total_revenue || 0
        // }));
        // renderCharts(chartData);

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

function aggregateChartDataByMenu(salesData) {
    const menuAggregation = {};

    salesData.forEach(item => {
        const menuName = item.menu_name || 'Unknown';

        if (!menuAggregation[menuName]) {
            menuAggregation[menuName] = {
                menu_name: menuName,
                quantity: 0,
                total_revenue: 0,
                unit_price: item.unit_price || 0
            };
        }

        menuAggregation[menuName].quantity += item.quantity || 0;
        menuAggregation[menuName].total_revenue += item.total_revenue || 0;
    });

    return Object.values(menuAggregation)
        .sort((a, b) => b.quantity - a.quantity);
}

async function loadBestSellerData(rangeOverride = null, maybeEnd = null) {
    if (typeof rangeOverride === 'string' && typeof maybeEnd === 'string') {
        const { startEl, endEl } = getGlobalDateElements();
        if (startEl) startEl.value = rangeOverride;
        if (endEl) endEl.value = maybeEnd;
    } else if (rangeOverride && typeof rangeOverride === 'object') {
        const { start, end } = rangeOverride;
        const { startEl, endEl } = getGlobalDateElements();
        if (startEl && start) startEl.value = start;
        if (endEl && end) endEl.value = end;
    }

    const validation = validateGlobalDateRange({ requireBoth: true });
    if (!validation.valid) return;
    const { start, end } = validation;

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
            best.sort((a, b) => (b.total_quantity || 0) - (a.total_quantity || 0));
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
                        <strong>${cust.customer_name || 'N/A'}</strong> — ${cust.total_orders || 0}x | Rp ${(cust.total_spent || 0).toLocaleString('id-ID')}
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
                const date = new Date(item.last_suggested || new Date()).toLocaleString('id-ID');
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
    // Dispatch based on current data type instead of hidden sections
    const kitchenVisible = !document.getElementById('kitchen-report-section')?.classList.contains('hidden');
    if (currentDataType === 'ingredient') { return exportIngredientCSV(); }
    if (kitchenVisible) { return exportKitchenCSV(); }
    return exportSalesCSVEnhanced();
}

async function exportPDF() {
    // Dispatch based on current data type instead of hidden sections
    const kitchenVisible = !document.getElementById('kitchen-report-section')?.classList.contains('hidden');
    if (currentDataType === 'ingredient') { return exportIngredientPDF(); }
    if (kitchenVisible) { return exportKitchenPDF(); }
    return exportSalesPDFEnhanced();
}

// ========== GLOBAL EXCEL EXPORT DISPATCHER ==========
function exportExcel() {
    // Dispatch based on current data type instead of hidden sections
    const kitchenVisible = !document.getElementById('kitchen-report-section')?.classList.contains('hidden');
    if (currentDataType === 'ingredient') { return exportIngredientExcel(); }
    if (kitchenVisible) { return exportKitchenExcel(); }
    return exportSalesExcelEnhanced();
}

// ========== SALES EXPORT (AGGREGATED) ==========
function exportSalesExcelEnhanced() {
    const data = Array.isArray(baseData) ? baseData : [];
    const wb = XLSX.utils.book_new();
    
    // Determine data type and structure
    const dataType = currentDataType || 'sales';
    let totalQty = 0, totalRevenue = 0, totalModal = 0, totalProfit = 0;
    const itemMap = {};
    
    // Process data based on current data type
    data.forEach(r => {
        let qty, price, revenue, modal, profit, menu, flavor;
        
        if (dataType === 'sales') {
            // Sales data structure (aggregated by menu + flavor)
            qty = Number(r.quantity || 0);
            price = Number(r.unit_price || 0);
            revenue = Number(r.total_revenue || r.profit || (qty * price) || 0);
            modal = Number(r.total_ingredient_cost || 0);
            profit = Number(r.profit || 0);
            menu = r.menu_name || 'Unknown';
            flavor = r.flavor || '-';
        } else if (dataType === 'best') {
            // Best seller data structure
            qty = Number(r.total_quantity || r.quantity || 0);
            price = Number(r.unit_price || 0);
            revenue = Number(r.total_revenue || r.total || 0);
            modal = 0; // Best seller doesn't have modal data
            profit = 0; // Best seller doesn't have profit data
            menu = r.menu_name || 'Unknown';
            flavor = '-'; // Best seller doesn't have flavor
        } else {
            // Fallback for other data types
            qty = Number(r.qty || r.quantity || r.amount || 0);
            price = Number(r.price || r.price_per_unit || r.unit_price || 0);
            revenue = Number(r.total_revenue || r.total || (qty * price));
            modal = Number(r.total_ingredient_cost || 0);
            profit = Number(r.profit || 0);
            menu = r.menu_name || r.name || r.menu || 'Unknown';
            flavor = r.flavor || '-';
        }
        
        totalQty += qty; 
        totalRevenue += revenue;
        totalModal += modal;
        totalProfit += profit;
        
        // Create unique key for aggregation (include flavor for sales)
        const key = dataType === 'sales' ? `${menu}|${flavor}` : menu;
        if (!itemMap[key]) itemMap[key] = { qty: 0, revenue: 0, modal: 0, profit: 0, menu, flavor };
        itemMap[key].qty += qty;
        itemMap[key].revenue += revenue;
        itemMap[key].modal += modal;
        itemMap[key].profit += profit;
    });
    
    const topItems = Object.entries(itemMap)
        .map(([key, v]) => ({ name: v.menu, flavor: v.flavor, qty: v.qty, revenue: v.revenue, modal: v.modal, profit: v.profit }))
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
        ['Total Modal', totalModal],
        ['Total Profit', totalProfit],
        [''],
        ['Top 10 Items (by Qty)'],
        dataType === 'sales' ? ['No', 'Menu', 'Flavor', 'Qty', 'Unit Price', 'Total Modal', 'Total Revenue', 'Total Profit'] : ['No', 'Menu', 'Qty', 'Revenue'],
        ...topItems.map((i,idx) => dataType === 'sales' ? [idx+1, i.name, i.flavor, i.qty, 0, i.modal, i.revenue, i.profit] : [idx+1, i.name, i.qty, i.revenue]),
        [''],
        ['All Items Summary'],
        dataType === 'sales' ? ['Item','Flavor','Qty','Revenue'] : ['Item','Qty','Revenue'],
        ...allItems.map(i => dataType === 'sales' ? [i.name, i.flavor, i.qty, i.revenue] : [i.name, i.qty, i.revenue])
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoA);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    
    // Data Summary (raw rows)
    const dataAoA = dataType === 'sales' ? 
        [['No','Item','Flavor','Qty','Unit Price','Total Modal', 'Total Revenue', 'Total Profit']] : 
        [['No','Item','Qty','Price','TotalRevenue']];
    
    data.forEach((r, i) => {
        let name, flavor, qty, price, totalRevenue, totalModal, totalProfit;
        
        if (dataType === 'sales') {
            name = r.menu_name || '-';
            flavor = r.flavor || '-';
            qty = Number(r.quantity || 0);
            price = Number(r.unit_price || 0);
            totalModal = Number(r.total_ingredient_cost || 0);
            totalRevenue = Number(r.total_revenue || r.total || 0);
            totalProfit = Number(r.profit || 0);
            dataAoA.push([i+1, name, flavor, qty, price, totalModal, totalRevenue, totalProfit]);
        } else if (dataType === 'best') {
            name = r.menu_name || '-';
            qty = Number(r.total_quantity || r.quantity || 0);
            price = Number(r.unit_price || 0);
            totalRevenue = Number(r.total_revenue || r.total || 0);
            dataAoA.push([i+1, name, qty, price, totalRevenue]);
        } else {
            name = r.menu_name || r.name || r.menu || '-';
            flavor = r.flavor || '-';
            qty = Number(r.qty || r.quantity || r.amount || 0);
            price = Number(r.price || r.price_per_unit || r.unit_price || 0);
            totalRevenue = Number(r.total || r.revenue || (qty * price));
            dataAoA.push([i+1, name, flavor, qty, price, totalRevenue]);
        }
    });
    
    const wsData = XLSX.utils.aoa_to_sheet(dataAoA);
    wsData['!cols'] = dataType === 'sales' ? 
        [{wch:6},{wch:30},{wch:18},{wch:10},{wch:12},{wch:14}, {wch:14}] :
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
            total = Number(r.profit || 0);
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
    let totalQty = 0, totalRevenue = 0, totalModal = 0, totalProfit = 0;
    const itemMap = {};
    
    data.forEach(r => {
        let qty, price, revenue, modal, profit, menu, flavor;
        
        if (dataType === 'sales') {
            qty = Number(r.quantity || 0);
            price = Number(r.unit_price || 0);
            revenue = Number(r.total_revenue || 0);
            modal = Number(r.total_ingredient_cost || 0);
            profit = Number(r.profit || 0);
            menu = r.menu_name || 'Unknown';
            flavor = r.flavor || '-';
        } else if (dataType === 'best') {
            qty = Number(r.total_quantity || r.quantity || 0);
            price = Number(r.unit_price || 0);
            revenue = Number(r.total_revenue || r.total || 0);
            modal = 0;
            profit = 0;
            menu = r.menu_name || 'Unknown';
            flavor = '-';
        } else {
            qty = Number(r.qty || r.quantity || 0);
            price = Number(r.price || 0);
            revenue = Number(r.total_revenue || (qty * price));
            modal = Number(r.total_ingredient_cost || 0);
            profit = Number(r.profit || 0);
            menu = r.menu_name || r.name || 'Unknown';
            flavor = r.flavor || '-';
        }
        
        totalQty += qty; 
        totalRevenue += revenue;
        totalModal += modal;
        totalProfit += profit;

        const key = dataType === 'sales' ? `${menu}|${flavor}` : menu;
        if (!itemMap[key]) itemMap[key] = { qty: 0, revenue: 0, modal: 0, profit: 0, menu, flavor };
        itemMap[key].qty += qty; 
        itemMap[key].revenue += revenue;
        itemMap[key].modal += modal;
        itemMap[key].profit += profit;
    });
    
    const topItems = Object.entries(itemMap)
        .map(([key, v]) => ({ name: v.menu, flavor: v.flavor, qty: v.qty, revenue: v.revenue, modal: v.modal, profit: v.profit }))
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
    doc.text(`Total Revenue: Rp ${totalRevenue.toLocaleString('id-ID')}`, 120, y+14);
    doc.text(`Total Modal: Rp ${totalModal.toLocaleString('id-ID')}`, 60, y+21);
    doc.text(`Total Profit: Rp ${totalProfit.toLocaleString('id-ID')}`, 120, y+21);
    y += 26;

    doc.setFont('helvetica','bold'); doc.text('Top 10 Items (by Qty):', 14, y); y+=6; doc.setFont('helvetica','normal');
    topItems.forEach((it, idx) => { 
        if (y>270){doc.addPage(); y=20;} 
        const itemText = dataType === 'sales' ? 
            `${idx+1}. ${it.name} (${it.flavor}) - Qty: ${it.qty} | Total: ${it.revenue}` :
            `${idx+1}. ${it.name} - Qty: ${it.qty} | Total: ${it.revenue}`;
        doc.text(itemText, 14, y); y+=6; 
    });

    y+=6; if (y>270){doc.addPage(); y=20;}
    const summaryTitle = dataType === 'sales' ? 'Sales Summary :' : dataType === 'best' ? 'Best Seller Summary :' : 'Data Summary :';
    doc.setFont('helvetica','bold'); doc.text(summaryTitle, 14, y); y+=4; doc.setFont('helvetica','normal');

    // Build table data (content unchanged)
    const tableHead = dataType === 'sales' ? ['No', 'Menu', 'Flavor', 'Qty', 'Price', 'Modal', 'Revenue', 'Profit'] : ['No', 'Menu', 'Qty', 'Price', 'Total'];
    const tableBody = data.map((r, i) => {
        if (dataType === 'sales') {
            const name = r.menu_name || '-';
            const flavor = r.flavor || '-';
            const qty = Number(r.quantity || 0);
            const price = Number(r.unit_price || 0);
            const modal = Number(r.total_ingredient_cost || 0);
            const revenue = Number(r.total_revenue || 0);
            const profit = Number(r.profit || 0);
            return [i+1, name, flavor, qty, price, modal, revenue, profit];
        } else if (dataType === 'best') {
            const name = r.menu_name || '-';
            const qty = Number(r.total_quantity || r.quantity || 0);
            const price = Number(r.unit_price || 0);
            const revenue = Number(r.total_revenue || r.total || 0);
            return [i+1, name, qty, price, revenue];
        } else {
            const name = r.menu_name || r.name || '-';
            const flavor = r.flavor || '-';
            const qty = Number(r.qty || r.quantity || 0);
            const price = Number(r.price || 0);
            const revenue = Number(r.total_revenue || r.total || (qty * price));
            return [i+1, name, flavor, qty, price, revenue];
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
                unit_price: transaction.base_price || 0,
                total_ingredient_cost: 0,
                total_revenue: 0,
                profit: 0,
                transaction_count: 0
            };
        }
        
        // Aggregate quantities and totals
        groupedData[key].quantity += (transaction.quantity || 0);
        groupedData[key].total_ingredient_cost += (transaction.total_ingredient_cost || 0);
        groupedData[key].total_revenue += (transaction.total_price || 0);
        groupedData[key].profit += (transaction.profit || 0);
        groupedData[key].transaction_count += 1;
    });
    
    // Convert grouped data to array and sort by total_price descending
    return Object.values(groupedData).sort((a, b) => b.profit - a.profit);
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
                if (ingredientTable) ingredientTable.classList.remove('hidden');
            } else {
                if (ingredientLogsTable) ingredientLogsTable.classList.remove('hidden');
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
                const viewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
                if (viewMode === 'logs') {
                    // Aggregated per menu + flavor across the selected range
                    const used = (item.ingredients_affected ?? item.total_qty ?? 0);
                    const orderIdsCsv = (item.order_ids || []).join(',');
                    tbody.innerHTML += `
                        <tr onclick="openGroupedConsumptionModal('${orderIdsCsv}', '${item.date || ''}', '${item.status_text || ''}', '${item.menu_name || ''}', '')" style="cursor: pointer;">
                            <td>${actualIndex + 1}</td>
                            <td>${item.menu_name || '-'}</td>
                            <td>${item.date || '-'}</td>
                            <td>${Number((item.order_count ?? (((item.order_ids || []).length) || 0))).toLocaleString('id-ID')}</td>
                            <td>${Number(used).toLocaleString('id-ID')}</td>
                            <td>
                                <button class="table-action-btn" onclick="event.stopPropagation(); openGroupedConsumptionModal('${orderIdsCsv}', '${item.date || ''}', '${item.status_text || ''}', '${item.menu_name || ''}', '')" title="Lihat Pesanan">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </td>
                        </tr>`;
                } else {
                    // Daily view row
                    const dailySummary = item.daily_summary || {};
                    const totalOrders = dailySummary.total_orders || 0;
                    const uniqueMenus = dailySummary.unique_menus || 0;
                    const totalConsumption = dailySummary.total_consumption || 0;
                    
                    tbody.innerHTML += `
                        <tr onclick="viewConsumptionDetails('Daily-${item.date || ''}', '${item.date || ''}', '${item.status_text || ''}'); setTimeout(()=>{ const p=document.getElementById('ingredient-details-panel'); if(p && !p.classList.contains('hidden')) p.scrollIntoView({behavior:'smooth', block:'start', inline:'nearest'}); }, 150);" style="cursor: pointer;">
                            <td>${actualIndex + 1}</td>
                            <td style="font-weight: 600; color: #1F2937;">${item.date || '-'}</td>
                            <td style="color: #6B7280; line-height: 1.4;">
                               <div style="display:flex; gap:.5rem; flex-wrap:wrap; align-items:center;">
                                   <span style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; padding:.2rem .5rem; border-radius:9999px; font-weight:600;">${totalOrders} total orders</span>
                                   <span style="background:#F5F3FF; color:#4C1D95; border:1px solid #DDD6FE; padding:.2rem .5rem; border-radius:9999px; font-weight:600;">${uniqueMenus} unique menus</span>
                                </div>
                            </td>
                            <td style="text-align: center; font-weight: 600; color: #059669;">${totalOrders.toLocaleString('id-ID')}</td>
                            <td style="text-align: center; font-weight: 600; color: #DC2626;">${totalConsumption.toLocaleString('id-ID')}</td>
                            <td>
                                          <button class="table-action-btn" onclick="event.stopPropagation(); viewConsumptionDetails('Daily-${item.date || ''}', '${item.date || ''}', '${item.status_text || ''}'); setTimeout(()=>{ const p=document.getElementById('ingredient-details-panel'); if(p && !p.classList.contains('hidden')) p.scrollIntoView({behavior:'smooth', block:'start', inline:'nearest'}); }, 150);" style="white-space: nowrap; min-width: 80px;">
                                   <i class="fas fa-eye"></i>
                                </button>
                            </td>
                        </tr>`;
                }
            } else if (currentDataType === 'sales') {
                // Sales data - show aggregated flavor information
                console.log('Rendering sales item:', item);
                const menuName = item.menu_name || 'N/A';
                const flavor = item.flavor || '-';
                const quantity = item.quantity || 0;
                const unitPrice = item.unit_price || 0;
                const totalIngredientCost = item.total_ingredient_cost || 0;
                const totalRevenue = item.total_revenue || 0;
                const profit = item.profit || 0;
                // const transactionCount = item.transaction_count || 1;
                
                tbody.innerHTML += `
                    <tr>
                        <td>${actualIndex + 1}</td>
                        <td>${menuName}</td>
                        <td>${flavor}</td>
                        <td>${quantity.toLocaleString('id-ID')}</td>
                        <td>Rp ${unitPrice.toLocaleString('id-ID')}</td>
                        <td>Rp ${totalIngredientCost.toLocaleString('id-ID')}</td>
                        <td>Rp ${totalRevenue.toLocaleString('id-ID')}</td>
                        <td>Rp ${profit.toLocaleString('id-ID')}</td>
                    </tr>`;
            } else {
                // Best Seller data - aggregated view
                console.log('Rendering best seller item:', item);
            tbody.innerHTML += `
                <tr>
                    <td>${actualIndex + 1}</td>
                    <td>${item.menu_name || 'N/A'}</td>
                    <td>${item.quantity || item.total_quantity || 0}</td>
                    <td>Rp ${(item.unit_price || 0).toLocaleString('id-ID')}</td>
                    <td>Rp ${(item.total || item.total_revenue || 0).toLocaleString('id-ID')}</td>
                </tr>`;
            }
        });
        // Totals row for daily view (UX clarity)
        if (currentDataType === 'ingredient') {
            const viewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
            if (viewMode === 'daily' && currentPageData[0] && !currentPageData[0].menu_name) {
            const totals = currentPageData.reduce((acc, it) => {
                const s = it.daily_summary || {};
                acc.orders += (s.total_orders || 0);
                acc.ingredients += (s.total_consumption || 0);
                return acc;
            }, { orders: 0, ingredients: 0 });
            tbody.innerHTML += `
                <tr style="background:#F9FAFB; font-weight:600;">
                    <td colspan="3" style="text-align:right; padding-right:8px;">Daily Total</td>
                    <td style="text-align:center; color:#059669;">${totals.orders.toLocaleString('id-ID')}</td>
                    <td style="text-align:center; color:#DC2626; border-top-right-radius: 0.5rem; border-bottom-right-radius: 0.5rem;">${totals.ingredients.toLocaleString('id-ID')}</td>
                    <td></td>
             </tr>`;
            }
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
    // Unified, mode-aware search across the currently visible table
    const term = (searchTerm || '').toLowerCase().trim();

    // Helper to convert any value to a comparable string
    const S = (v) => (v === null || v === undefined) ? '' : String(v).toLowerCase();

    let source = [];

    if (currentDataType === 'ingredient') {
        // Determine current ingredient view and pick the right dataset
        const viewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
        if (Array.isArray(baseData)) {
            // In some flows, baseData may already be the active array for the active view
            source = baseData;
        } else if (baseData && typeof baseData === 'object') {
            source = baseData[viewMode] || [];
        } else if (ingredientDataCache && typeof ingredientDataCache === 'object') {
            source = ingredientDataCache[viewMode] || [];
        } else {
            source = [];
        }

        if (!term) {
            filteredData = [...source];
        } else if (viewMode === 'daily') {
            // Daily view visible columns: Date, Daily Summary (orders, unique menus), Total Orders, Total Ingredients
            filteredData = source.filter(item => {
                const summary = item.daily_summary || {};
                const fields = [
                    item.date,
                    item.status_text,
                    summary.total_orders,
                    summary.unique_menus,
                    summary.total_consumption
                ];
                return fields.some(f => S(f).includes(term));
            });
        } else {
            // Logs view visible columns: Menu, Flavor, Date, Total Orders, Total Ingredients, Status
            filteredData = source.filter(item => {
                const fields = [
                    item.menu_name,
                    item.flavor,
                    item.date,
                    item.status_text,
                    item.order_count,
                    item.ingredients_affected,
                    Array.isArray(item.order_ids) ? item.order_ids.join(',') : item.order_id
                ];
                return fields.some(f => S(f).includes(term));
            });
        }
    } else {
        // Sales or Best Seller
        source = Array.isArray(baseData) ? baseData : [];
        if (!term) {
            filteredData = [...source];
        } else if (currentDataType === 'sales') {
            // Visible columns: Menu, Flavor, Qty, Price, Total
            filteredData = source.filter(item => {
                const fields = [
                    item.menu_name,
                    item.flavor,
                    item.quantity,
                    item.unit_price,
                    item.total_ingredient_cost,
                    item.profit
                ];
                return fields.some(f => S(f).includes(term));
            });
        } else {
            // Best seller visible columns: Menu, Qty, Price, Total
            filteredData = source.filter(item => {
                const fields = [
                    item.menu_name,
                    (item.total_quantity ?? item.quantity),
                    item.unit_price,
                    (item.total_revenue ?? item.total)
                ];
                return fields.some(f => S(f).includes(term));
            });
        }
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
        } 
        
        const range = getValidatedGlobalRange(true, true);
        if (!range) return;
        resetToNormalMode();

        if (dataType === 'best') {
            await loadBestSellerData(range);
            if (sortSelect) {
                sortSelect.value = 'qty';
            }
            // Load best seller data
            // resetToNormalMode();
            // const range = getValidatedGlobalRange(true, true);
            // if (!range) return;
            // Ensure header is updated after best seller data load
            updateReportTableHeader();
        } else {
            await loadReport(range);
            if (sortSelect) {
                sortSelect.value = 'name';
            }
            // Load sales data
            // resetToNormalMode();
            // const range = getValidatedGlobalRange(true, true);
            // if (!range) return;
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
                    const ta = a.total ?? a.profit ?? 0;
                    const tb = b.total ?? b.profit ?? 0;
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
    const menuFilterInput = document.getElementById('menu-filter');
    if (menuFilterInput) menuFilterInput.value = '';
    const tableSearch = document.getElementById('table-search-input');
    if (tableSearch) tableSearch.value = '';
    
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
    resetToNormalMode();
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) periodSelect.value = 'today';
    applyPeriodPreset('today', { triggerReload: true, updateSelect: true });
    applyModeLayout('sales');
    // Ensure header is updated after clearing filter
    updateReportTableHeader();
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

    // Update summary with ingredient analysis insights and ensure filtered rows match current view
    const currentViewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
    const dataset = (ingredientDataCache && ingredientDataCache[currentViewMode]) ? ingredientDataCache[currentViewMode] : [];
    const term = document.getElementById('table-search-input')?.value.toLowerCase() || '';
    filteredData = term ? dataset.filter(i =>
        (i.menu_name || '').toLowerCase().includes(term) ||
        (i.flavor || '').toLowerCase().includes(term) ||
        (i.order_id || '').toLowerCase().includes(term) ||
        (i.date || '').toLowerCase().includes(term) ||
        (i.status_text || '').toLowerCase().includes(term)
    ) : [...dataset];
    reportCurrentPage = 1;
    renderReportTable();
    updateReportPagination();
    renderIngredientAnalysis(ingredientDataCache);
    updateIngredientSummary(ingredientDataCache);
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
    const pieTitle = document.querySelector('#chart-pie-card .column-title');

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
            <th>Unit Price</th>
            <th>Total Modal</th>
            <th>Total Revenue</th>
            <th>Total Profit</th>
            `;
        } else if (isBest) {
            // Best Seller mode: no flavor column
            tableHeader.innerHTML = `
            <th>No</th>
            <th>Menu</th>
            <th>Qty</th>
            <th>Unit Price</th>
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

    if (pieTitle) {
        pieTitle.textContent = isBest ? '🥧 Menu Distribution' : '🥧 Sales Composition';
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
        const viewContainer = document.getElementById('ingredient-view-container');
        if (viewContainer) viewContainer.style.display = 'flex';

        if (ingredientDataCache) {
            const statusEl = document.getElementById('summary-status-badge');
            const currentViewMode = document.getElementById('ingredient-view-select')?.value || 'daily';
            if (statusEl) {
                statusEl.textContent = currentViewMode === 'daily' ? 'Analisis Bahan — Harian' : 'Analisis Bahan — Per-Order (Logs)';
                statusEl.className = 'status-badge status-making';
            }
            const dataSet = ingredientDataCache[currentViewMode] || [];
            const tableSearch = document.getElementById('table-search-input');
            const term = tableSearch ? tableSearch.value.toLowerCase() : '';
            filteredData = term
                ? dataSet.filter(i => 
                    (i.menu_name || '').toLowerCase().includes(term) ||
                    (i.flavor || '').toLowerCase().includes(term) ||
                    (i.order_id || '').toLowerCase().includes(term) ||
                    (i.date || '').toLowerCase().includes(term) ||
                    (i.status_text || '').toLowerCase().includes(term)
                )
                : [...dataSet];
            reportCurrentPage = 1;
            renderReportTable();
            updateReportPagination();
            renderIngredientAnalysis(ingredientDataCache);
            updateIngredientSummary(ingredientDataCache);
        } else {
            // Fallback to fetch if cache missing
            loadIngredientAnalysisData();
        }
    }
}
    
// Real-time auto refresh (~5s) with visibility + in-flight guard
let autoRefreshTimer = null;
function performRefresh() {
    if (isRefreshing || document.hidden) return;
    const dataType = document.getElementById('data-type-select')?.value || 'sales';
    const requireGlobalRange = dataType !== 'ingredient';
    const range = requireGlobalRange ? getValidatedGlobalRange(true, false) : null;
    if (requireGlobalRange && !range) {
        return;
    }
    isRefreshing = true;
    const done = () => { isRefreshing = false; };
    if (dataType === 'best') {
        loadBestSellerData(range).finally(done);
    } else if (dataType === 'ingredient') {
        loadIngredientAnalysisData().finally(done);
    } else {
        loadReport(range).finally(done);
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
                    // Use unified filter that understands the current data type and view mode
                    filterTableData(this.value);
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

        const periodSelect = document.getElementById('period-select');
        if (periodSelect) {
            periodSelect.addEventListener('change', function() {
                if (this.value === 'custom') {
                    suppressPeriodSync = false;
                    return;
                }
                applyPeriodPreset(this.value, { triggerReload: true, updateSelect: true });
            });
        }

        // Auto refresh start
        startAutoRefresh();
        
        // Initialize default range (defaults to today)
        initializeDefaultDateRange(true);

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
                // Mirror into global start_date to keep one source of truth
                const gStart = document.getElementById('start_date');
                if (gStart) gStart.value = this.value || '';
                const periodEl = document.getElementById('period-select');
                if (periodEl) periodEl.value = 'custom';
                loadIngredientAnalysisData();
            });
        }
        if (ingredientEndDate) {
            ingredientEndDate.addEventListener('change', function() {
                const gEnd = document.getElementById('end_date');
                if (gEnd) gEnd.value = this.value || '';
                const periodEl = document.getElementById('period-select');
                if (periodEl) periodEl.value = 'custom';
                loadIngredientAnalysisData();
            });
        }

        // Refresh on date change
        const startInput = document.getElementById('start_date');
        const endInput = document.getElementById('end_date');
        const onDateChange = () => {
            if (!suppressPeriodSync) {
                const periodEl = document.getElementById('period-select');
                if (periodEl) periodEl.value = 'custom';
            }
            reportCurrentPage = 1;
            reloadCurrentMode();
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

function getItemFlavorRaw(item) {
    if (!item || typeof item !== 'object') return '';
    // Preferred explicit fields
    const direct = item.flavor || (item.flavor_name) || (item.preference) || item.rasa || item.flavour || item.variant || item.variation || item.taste;
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
    try {
        // Lowercase, trim, collapse spaces, remove diacritics
        const base = String(raw || '')
            .normalize('NFD')
            .replace(/\p{Diacritic}+/gu, '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ');
        return base;
    } catch (_) {
        return (raw || '').toString().trim().toLowerCase();
    }
}

async function openGroupedConsumptionModal(orderIdsCsv, dateStr, statusText, menuName, flavorName) {
    try {
        console.log('openGroupedConsumptionModal called with:', { orderIdsCsv, dateStr, statusText, menuName, flavorName });
        const orderIds = String(orderIdsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
        console.log('Parsed order IDs:', orderIds);
        let matches = (kitchenOrdersCache || []).filter(o => orderIds.includes(String(o.order_id)));
        console.log('Initial found matches:', matches.length, matches);
        console.log('kitchenOrdersCache length:', kitchenOrdersCache.length);

        // Parse dateStr that may be range "DD/MM/YYYY - DD/MM/YYYY" or single
        let rangeStart = null, rangeEnd = null;
        if (dateStr && dateStr.includes(' - ')) {
            const parts = dateStr.split(' - ').map(p => p.trim());
            if (parts.length === 2) {
                const [d1, d2] = parts;
                const toIso = (d) => /\d{2}\/\d{2}\/\d{4}/.test(d) ? `${d.split('/')[2]}-${d.split('/')[1]}-${d.split('/')[0]}` : d;
                rangeStart = toIso(d1);
                rangeEnd = toIso(d2);
            }
        } else if (dateStr && /\d{2}\/\d{2}\/\d{4}/.test(dateStr)) {
            const [dd, mm, yyyy] = dateStr.split('/');
            rangeStart = `${yyyy}-${mm}-${dd}`;
            rangeEnd = rangeStart;
        }
        console.log('Parsed rangeStart/end:', { rangeStart, rangeEnd });

        // If not all order IDs matched from cache, optionally fetch /inventory/history to fill
        if (matches.length < orderIds.length) {
            try {
                const qs = new URLSearchParams();
                qs.append('limit', '500');
                if (rangeStart && rangeEnd) { qs.append('start_date', rangeStart); qs.append('end_date', rangeEnd); }
                console.log('[Modal] Fetching inventory history to supplement cache with params:', qs.toString());
                const histResp = await fetch(`/inventory/history?${qs.toString()}`);
                if (histResp.ok) {
                    const histJson = await histResp.json();
                    const history = Array.isArray(histJson.history) ? histJson.history : [];
                    // Merge unique order entries with existing matches
                    const existingIds = new Set(matches.map(m => String(m.order_id)));
                    for (const h of history) {
                        const oid = String(h.order_id);
                        if (orderIds.includes(oid) && !existingIds.has(oid)) {
                            // Attempt to enrich from kitchenOrdersCache for items/time_done
                            const kitchen = (kitchenOrdersCache || []).find(o => String(o.order_id) === oid);
                            
                            // Try to fetch order items from kitchen service if not in cache
                            let items = kitchen?.items || [];
                            if (!items.length && h.per_menu_payload) {
                                // Parse per_menu_payload if available from history
                                try {
                                    const payload = typeof h.per_menu_payload === 'string' ? JSON.parse(h.per_menu_payload) : h.per_menu_payload;
                                    if (Array.isArray(payload)) {
                                        items = payload.map(p => ({
                                            menu_name: p.name || p.menu_name,
                                            quantity: p.quantity || 1,
                                            preference: p.preference || p.flavor || ''
                                        }));
                                    }
                                } catch (parseErr) {
                                    console.warn('[Modal] Failed parsing per_menu_payload for', oid, parseErr);
                                }
                            }
                            
                            matches.push({
                                order_id: oid,
                                time_done: kitchen?.time_done || h.consumed_at || h.created_at,
                                time_receive: kitchen?.time_receive || h.created_at,
                                items: items,
                                status: h.status || h.status_text || (h.consumed ? 'consumed' : '-')
                            });
                            existingIds.add(oid);
                        }
                    }
                    console.log('[Modal] Matches after supplement:', matches.length);
                } else {
                    console.warn('[Modal] Failed fetching history for supplement:', histResp.status);
                }
            } catch (suppErr) {
                console.warn('[Modal] Supplement fetch error:', suppErr);
            }
        }

        // Optional: filter by menuName & flavorName inside items when provided
        // IMPORTANT: Only filter if items array exists and has data (some entries from history may not have items)
        if (menuName) {
            const before = matches.length;
            matches = matches.filter(m => {
                const items = m.items || [];
                // If no items available (e.g., from history supplement), keep it (don't filter out)
                if (!items.length) return true;
                // Otherwise, check if any item matches the menu name (case-insensitive, trimmed)
                return items.some(it => {
                    const itemMenuName = (it.menu_name || '').trim().toLowerCase();
                    const targetMenuName = (menuName || '').trim().toLowerCase();
                    return itemMenuName === targetMenuName || itemMenuName.includes(targetMenuName) || targetMenuName.includes(itemMenuName);
                });
            });
            console.log(`[Modal] Filter by menuName='${menuName}' reduced matches ${before} -> ${matches.length}`);
        }
        if (flavorName) {
            const before = matches.length;
            matches = matches.filter(m => {
                const items = m.items || [];
                if (!items.length) return true; // Keep if no items data
                return items.some(it => {
                    const itemPref = (it.preference || '').trim().toLowerCase();
                    const targetPref = (flavorName || '').trim().toLowerCase();
                    return itemPref === targetPref || itemPref.includes(targetPref) || targetPref.includes(itemPref);
                });
            });
            console.log(`[Modal] Filter by flavorName='${flavorName}' reduced matches ${before} -> ${matches.length}`);
        }

        // Range filter on timestamps if range provided (defensive)
        if (rangeStart && rangeEnd) {
            const startTs = new Date(rangeStart + 'T00:00:00');
            const endTs = new Date(rangeEnd + 'T23:59:59');
            const before = matches.length;
            matches = matches.filter(m => {
                const tsRaw = m.time_done || m.time_receive || m.created_at;
                if (!tsRaw) return false;
                const dt = new Date(tsRaw);
                return dt >= startTs && dt <= endTs;
            });
            console.log(`[Modal] Applied date range filter ${rangeStart}..${rangeEnd}, ${before} -> ${matches.length}`);
        }

        if (!matches.length) {
            console.warn('[Modal] No matches after all filters for IDs:', orderIds);
        }

        const modal = document.getElementById('ingredient-modal');
        const modalBody = document.getElementById('ingredient-modal-body');
        if (!modal || !modalBody) {
            console.error('Modal elements not found:', { modal: !!modal, modalBody: !!modalBody });
            return;
        }

        // Build table rows for orders
        const tableRows = matches.map((o, idx) => {
            const ts = o.time_done || o.time_receive || o.consumed_at || o.created_at || '';
            let displayDate = '-';
            if (ts) {
                try { displayDate = new Date(ts).toLocaleString('id-ID'); } catch { displayDate = ts; }
            }
            const items = (o.items || []).map(it => `${it.menu_name}${it.preference ? ' (' + it.preference + ')' : ''} x${it.quantity}`).join(', ');
            
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
                <span class="summary-detail--order">📅 Date${rangeStart && rangeEnd ? ' Range' : ''}: <strong>${dateStr || '-'}</strong></span>
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

// Handle action click for logs rows: prefer grouped modal when we have many orders, fallback to direct details for single order or missing cache
// (removed custom handler; using grouped modal directly for action clicks)

