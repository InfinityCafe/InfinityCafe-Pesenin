// Kelola Stok Page JavaScript

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('tab-active');
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  const activeButton = document.getElementById(`tab-${tab}`);
  if (activeButton) {
    activeButton.classList.add('tab-active');
  }

  const activePanel = document.getElementById(`tab-${tab}-content`);
  if (activePanel) {
    activePanel.classList.add('active');
  }

  const addItemBtn = document.getElementById('add-item-btn');
    if (addItemBtn) {
      addItemBtn.style.display = (tab === 'inventory') ? '' : 'none';
  }

  if (window.inventoryManager) {
    window.inventoryManager.activeTab = tab;
  }

  if (tab === 'inventory' && window.inventoryManager) {
    window.inventoryManager.loadInventoryData();
  } else if (tab === 'audit-history' && window.inventoryManager) {
    window.inventoryManager.loadAuditHistoryData(true);
  } 
}
class InventoryManager {
  constructor() {
    this.activeTab = 'inventory';
    this.inventory = [];
    this.filteredInventory = [];
    this.currentPage = 1;
    this.itemsPerPage = 10;
    this.totalPages = 1;
    this.editingItem = null;
    this.viewingItemId = null;
    this.pollingInterval = null;
    this.isUserInteracting = false;
    this.currentFilters = { category: '', unit: '', status: '' };
    this.currentSearchTerm = '';
    this.currentSort = '';
    this.auditHistory = [];
    this.filteredAuditHistory =[];
    this.currentAuditPage = 1;
    this.auditItemsPerPage = 10;
    this.totalAuditPages = 1;
    this.currentAuditFilters = { 
      sort: '', 
      actionType: '', 
      dateRange: '', 
      user: '' 
    };
    this.currentAuditSearchTerm = '';
    this.auditLoaded = false;
    this.viewingAuditId = null;

    this.initializeEventListeners();
    this.initialLoad();
    this.startPolling();
  }

  initializeEventListeners() {
    // Helper function to safely bind event listeners
    const safeAddEventListener = (id, event, callback) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener(event, callback);
      } else {
        console.warn(`Element with ID '${id}' not found in DOM`);
      }
    };

    // Add item button
    safeAddEventListener('add-item-btn', 'click', () => {
      this.openAddItemModal();
    });

    safeAddEventListener('close-view-modal', 'click', () => {
      this.closeModal('view-item-modal');
    });

    // Modal close buttons
    safeAddEventListener('close-modal', 'click', () => {
      this.closeModal('item-modal');
    });

    safeAddEventListener('close-change-status-modal', 'click', () => {
      this.closeModal('change-status-modal');
    });

    // Form submission
    safeAddEventListener('item-form', 'submit', (e) => {
      e.preventDefault();
      this.handleFormSubmit();
    });

    safeAddEventListener('cancel-change-status-btn', 'click', () => {
      this.closeModal('change-status-modal');
    });

    const searchInput = document.getElementById('inventory-search');
    if (searchInput) {
      searchInput.addEventListener('focus', () => {
        this.isUserInteracting = true;
      });
      searchInput.addEventListener('blur', () => {
        this.isUserInteracting = false;
      });
      searchInput.addEventListener('input', (e) => {
        this.currentSearchTerm = e.target.value.toLowerCase().trim(); // Simpan pencarian
        this.isUserInteracting = !!this.currentSearchTerm;
        this.applyCurrentFiltersAndSearch(true);
      });
    }

    safeAddEventListener('filter-btn', 'click', () => {
      this.isUserInteracting = !document.getElementById('filter-dropdown').classList.contains('show');
      this.toggleFilterStock();
    });

    document.querySelector('.apply-filter-btn')?.addEventListener('click', () => {
      this.isUserInteracting = false;
      this.applyStockFilter();
      this.toggleFilterStock();
    });

    document.querySelector('.clear-filter-btn')?.addEventListener('click', () => {
      this.isUserInteracting = false;
      this.clearStockFilter();
      this.toggleFilterStock();
    });

    // Entries per page
    safeAddEventListener('entries-per-page', 'change', () => {
      this.changeStockPageSize();
    });

    // Pagination buttons
    // safeAddEventListener('prev-btn', 'click', () => {
    //   this.changeStockPage(-1);
    // });

    // safeAddEventListener('next-btn', 'click', () => {
    //   this.changeStockPage(1);
    // });

    // Delete confirmation
    safeAddEventListener('confirm-delete-btn', 'click', () => {
      this.confirmDelete();
    });

    safeAddEventListener('confirm-change-status-btn', 'click', () => {
      this.confirmChangeStatus();
    });

    // Kitchen toggle switch
    const kitchenToggle = document.getElementById('kitchen-toggle');
    if (kitchenToggle) {
      kitchenToggle.addEventListener('change', (e) => {
        this.handleKitchenToggle(e.target.checked);
      });
    } else {
      console.warn("Kitchen toggle not found in DOM");
    }

    // Add stock button
    safeAddEventListener('add-stock-btn', 'click', () => {
      this.openAddStockModal();
    });
    // History button
    // safeAddEventListener('history-btn', 'click', () => {
    //   this.openStockHistoryModal();
    // });
    // safeAddEventListener('close-stock-history-modal', 'click', () => {
    //   this.closeModal('stock-history-modal');
    // });
    // safeAddEventListener('refresh-history-btn', 'click', () => {
    //   this.loadStockHistory();
    // });
    // safeAddEventListener('history-search', 'input', (e) => {
    //   this.filterStockHistory(e.target.value);
    // });
    // const actionFilter = document.getElementById('history-action-filter');
    // if (actionFilter) actionFilter.addEventListener('change', () => this.loadStockHistory());
    // Consumption log button
    safeAddEventListener('consumption-log-btn', 'click', () => {
      this.openConsumptionLogModal();
    });

    safeAddEventListener('add-stock-form', 'submit', (e) => {
      e.preventDefault();
      this.handleAddStockSubmit();
    });
    // Modal close buttons
    safeAddEventListener('close-add-stock-modal', 'click', () => {
      this.closeModal('add-stock-modal');
    });

    safeAddEventListener('close-consumption-log-modal', 'click', () => {
      this.closeModal('consumption-log-modal');
    });
    // Cancel buttons
    safeAddEventListener('cancel-add-stock-btn', 'click', () => {
      this.closeModal('add-stock-modal');
    });
    // Refresh logs button
    safeAddEventListener('refresh-logs-btn', 'click', () => {
      this.loadConsumptionLogs();
    });

    safeAddEventListener('log-search', 'input', (e) => {
      this.filterConsumptionLogs(e.target.value);
    });

    safeAddEventListener('audit-history-search', 'input', (e) => {
      this.currentAuditSearchTerm = e.target.value.toLowerCase().trim();
      this.applyAuditFiltersAndSearch(true);
    });

    safeAddEventListener('audit-history-page-size', 'change', () => {
      this.changeAuditHistoryPageSize();
    });

    safeAddEventListener('audit-history-prev-btn', 'click', () => {
      this.changeAuditHistoryPage(-1);
    });

    safeAddEventListener('audit-history-next-btn', 'click', () => {
      this.changeAuditHistoryPage(1);
    });
  }
  

  async loadInventoryData(forceFullReload = false) {
    try {
      console.log('Attempting to load inventory data...');
      // Load inventory summary
      const summaryResponse = await fetch('/inventory/summary');
      const summaryData = await summaryResponse.json();

      if (summaryResponse.ok) {
        console.log('Summary data loaded:', summaryData);
        this.updateOverviewCards(summaryData);
      } else {
        console.warn('Summary API failed');
      }

      // Load inventory list
      const listResponse = await fetch('/inventory/list');
      const listData = await listResponse.json();
      
      console.log('Inventory data loaded:', listData);
      this.inventory = Array.isArray(listData.data) ? listData.data : Array.isArray(listData) ? listData : [];

      if (forceFullReload) {
        this.filteredInventory = [...this.inventory];
        this.currentFilters = { category: '', unit: '', status: '' };
        this.currentSearchTerm = '';
        this.currentPage = 1;
      } else {
        this.applyCurrentFiltersAndSearch();
      }

      this.populateDynamicFilters();
      // console.log('Current inventory:', this.inventory);
      // this.updateOverviewCards();
      this.renderInventoryTable();
    } catch (error) {
      console.error('Error loading inventory data:', error);
      showErrorModal('Failed to load inventory data');
    }
  }

  async loadAndRefreshData(forceFullReload = false) {
    try {
      const listResponse = await fetch('/inventory/list');
      const listData = await listResponse.json();

      const newInventory = Array.isArray(listData.data) ? listData.data : [];

      const hasChanged = JSON.stringify(newInventory) !== JSON.stringify(this.inventory);

      this.inventory = newInventory;

      if (forceFullReload) {
        this.filteredInventory = [...this.inventory];
        this.currentFilters = { category: '', unit: '', status: '' };
        this.currentSearchTerm = '';
        this.currentPage = 1;
      } else {
        this.applyCurrentFiltersAndSearch();
      }

      if (hasChanged || forceFullReload) {
      this.renderInventoryTable();
      this.updateOverviewCards();
      if (forceFullReload) {
        this.populateDynamicFilters();
        }
      }
    } catch (error) {
      console.error('Gagal memuat dan me-refresh data:', error);
    }
  }

  async initialLoad() {
    await this.loadAndRefreshData(true);
  }

  applyCurrentFiltersAndSearch(resetPage = false) {
    let tempInventory = [...this.inventory];

    if (this.currentFilters.category) {
      tempInventory = tempInventory.filter(i => i.category === this.currentFilters.category);
    }
    if (this.currentFilters.unit) {
      tempInventory = tempInventory.filter(i => i.unit === this.currentFilters.unit);
    }
    if (this.currentFilters.status) {
      tempInventory = tempInventory.filter(i => this.getStockStatus(i).value === this.currentFilters.status);
    }

    if (this.currentSearchTerm) {
      tempInventory = tempInventory.filter(item =>
        item.name.toLowerCase().includes(this.currentSearchTerm) ||
        item.category.toLowerCase().includes(this.currentSearchTerm)
      );
    }

    this.filteredInventory = tempInventory;
    this.applySorting(this.filteredInventory);

    if (resetPage) {
      this.currentPage = 1;
    } else {
      this.totalPages = Math.ceil(this.filteredInventory.length / this.itemsPerPage) || 1;
      if (this.currentPage > this.totalPages) {
        this.currentPage = this.totalPages;
      }
    }

    this.renderInventoryTable();
  }

  applySorting(inventoryArray) {
    if (this.currentSort === 'a-z') {
        inventoryArray.sort((a, b) => a.name.localeCompare(b.name));
    } else if (this.currentSort === 'z-a') {
        inventoryArray.sort((a, b) => b.name.localeCompare(a.name));
    }
  }

  startPolling() {
    console.log("Memulai polling cerdas setiap 3 detik...");
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.pollingInterval = setInterval(async () => {
      if (!this.isUserInteracting) {
        console.log("Polling: Mengambil data terbaru...");
        try {
          if (this.activeTab === 'inventory') {
            await this.loadAndRefreshData();
          } else if (this.activeTab === 'audit-history') {
            await this.loadAuditHistoryData(true);
          }
        } catch (error) {
          console.error('Polling error:', error);
          showErrorModal('Gagal memperbarui data. Coba lagi nanti.');
        }
        // this.loadAndRefreshData();
      } else {
        console.log("Polling: Dilewati karena pengguna sedang berinteraksi.");
      }
    }, 3000);
  }

  // Removed: loadSampleData (local demo)

  updateOverviewCards(data = {}) {
    console.log('Updating overview cards with inventory:', this.inventory);
    
    const totalItems = data.total_items || this.inventory.length;
    const outOfStockCount = data.critical_count || this.inventory.filter(item => item.current_quantity <= 0).length;
    const lowStockCount = data.low_stock_count || this.inventory.filter(
      item => item.current_quantity > 0 && item.current_quantity <= item.minimum_quantity
    ).length;

    const totalItemsElement = document.getElementById('total-items');
    const lowStockElement = document.getElementById('low-stock-items');
    const criticalElement = document.getElementById('critical-items');

    if (totalItemsElement) {
      totalItemsElement.textContent = totalItems;
      console.log('Total items updated:', totalItems);
    } else {
      console.warn("Element 'total-items' not found in DOM");
    }

    if (lowStockElement) {
      lowStockElement.textContent = lowStockCount;
      console.log('Low stock items updated:', lowStockCount);
    } else {
      console.warn("Element 'low-stock-items' not found in DOM");
    }

    if (criticalElement) {
      criticalElement.textContent = outOfStockCount;
      console.log('Critical items updated:', outOfStockCount);
    } else {
      console.warn("Element 'critical-items' not found in DOM");
    }
  }

  handleSearch(searchTerm) {
    this.currentSearchTerm = searchTerm.toLowerCase().trim();
    this.isUserInteracting = !!this.currentSearchTerm;
    this.applyCurrentFiltersAndSearch(true);
  }

  // Normalize string for duplicate checks
  normalizeValue(value) {
    return (value || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  // Check if an item with same name+category+unit already exists
  hasDuplicateItem(name, category, unit, excludeId = null) {
    const n = this.normalizeValue(name);
    const c = this.normalizeValue(category);
    const u = this.normalizeValue(unit);
    return this.inventory.some(item => {
      const sameTriple = this.normalizeValue(item.name) === n
        && this.normalizeValue(item.category) === c
        && this.normalizeValue(item.unit) === u;
      if (!sameTriple) return false;
      if (excludeId != null) return item.id !== excludeId;
      return true;
    });
  }

  // Check if an item name already exists (regardless of category/unit)
  hasDuplicateName(name, excludeId = null) {
    const n = this.normalizeValue(name);
    return this.inventory.some(item => {
      const sameName = this.normalizeValue(item.name) === n;
      if (!sameName) return false;
      if (excludeId != null) return item.id !== excludeId;
      return true;
    });
  }

  // Note: name-similarity validation is handled by backend. Client only checks exact triple.

  renderInventoryTable() {
    const tbody = document.getElementById('inventory-tbody');
    if (!tbody) {
      console.warn("Inventory table body not found in DOM");
      return;
    }

    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const pageData = this.filteredInventory.slice(startIndex, endIndex);

    tbody.innerHTML = '';

    if (!this.filteredInventory.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 1rem;">
            No inventory items found
          </td>
        </tr>
      `;
      const tableInfo = document.getElementById('inventory-table-info');
      if (tableInfo) {
        tableInfo.textContent = 'Showing 0 of 0 entries';
      }
      console.warn("Filtered inventory is empty");
    } else {
      pageData.forEach((item, index) => {
        if (!item || typeof item.current_quantity === 'undefined' || typeof item.minimum_quantity === 'undefined') {
          console.warn(`Invalid item data at index ${startIndex + index + 1}:`, item);
          return;
        }
        const row = this.createTableRow(item, startIndex + index + 1);
        tbody.appendChild(row);
      });
      const tableInfo = document.getElementById('inventory-table-info');
      if (tableInfo) {
        tableInfo.textContent = `Showing ${startIndex + 1} to ${Math.min(endIndex, this.filteredInventory.length)} of ${this.filteredInventory.length} entries`;
      }
    }

    this.updatePagination();
  }

  createTableRow(item, rowNumber) {
    const row = document.createElement('tr');
    const status = this.getStockStatus(item);

    row.innerHTML = `
      <td>${rowNumber}</td>
      <td>${item.name}</td>
      <td>${this.formatCategoryName(item.category)}</td>
      <td>${item.current_quantity.toFixed(2)}</td>
      <td>${this.capitalizeFirst(item.unit)}</td>
      <td>${item.minimum_quantity.toFixed(2)}</td>
      <td>
        <span><span class="${status.class}">${status.text}</span></span>
      </td>
      <td class="action-header">
        <button class="table-action-btn" onclick="inventoryManager.viewItem(${item.id})"><i class="fas fa-eye"></i></button>
        <button class="table-action-btn" onclick="inventoryManager.editItem(${item.id})"><i class="fas fa-edit"></i></button>
        <button class="table-action-btn" onclick="inventoryManager.changeAvailability(${item.id}, '${item.name}', ${item.is_available})"><i class="fa-solid fa-ellipsis"></i></button>
      </td>
    `;
    
    return row;
  }

  getStockStatus(item) {
    if (!item.is_available) {
      return { 
        value: 'unavailable', 
        text: 'Unavailable', 
        class: 'status-badge status-unavailable' 
      };
    }
    if (item.current_quantity <= 0) {
      return { 
        value: 'out-of-stock', 
        text: 'Out of Stock', 
        class: 'status-badge status-out-of-stock' 
      };
    } else if (item.current_quantity <= item.minimum_quantity) {
      return { 
        value: 'low-stock', 
        text: 'Low Stock', 
        class: 'status-badge status-low-stock' 
      };
    } else {
      return { 
        value: 'in-stock', 
        text: 'In Stock', 
        class: 'status-badge status-in-stock' 
      };
    }
  }

  formatCategoryName(categoryStr) {
    if (!categoryStr) return '';
    return categoryStr
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Normalize string for duplicate checks
  normalizeValue(value) {
    return (value || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  // Check if an item with same name+category+unit already exists
  hasDuplicateItem(name, category, unit, excludeId = null) {
    const n = this.normalizeValue(name);
    const c = this.normalizeValue(category);
    const u = this.normalizeValue(unit);
    return this.inventory.some(item => {
      const sameTriple = this.normalizeValue(item.name) === n
        && this.normalizeValue(item.category) === c
        && this.normalizeValue(item.unit) === u;
      if (!sameTriple) return false;
      if (excludeId != null) return item.id !== excludeId;
      return true;
    });
  }

  updatePagination() {
    this.totalPages = Math.ceil(this.filteredInventory.length / this.itemsPerPage);
    if (this.totalPages === 0) this.totalPages = 1;
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
    this.renderPagination();
  }

  renderPagination() {
    const pageNumbers = document.getElementById('page-numbers');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const paginationInfo = document.getElementById('pagination-info');

    // Update pagination info
    if (paginationInfo) {
      paginationInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
    }

    if (prevBtn) prevBtn.disabled = this.currentPage === 1;
    if (nextBtn) nextBtn.disabled = this.currentPage === this.totalPages;

    // Generate page numbers
    if (!pageNumbers) return;
    pageNumbers.innerHTML = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(this.totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `page-number ${i === this.currentPage ? 'active' : ''}`;
      pageBtn.textContent = i;
      pageBtn.onclick = () => {
        this.currentPage = i;
        this.renderInventoryTable();
      };
      pageNumbers.appendChild(pageBtn);
    }
  }

  goToPage(page) {
    this.currentPage = page;
    this.renderInventoryTable();
  }

  toggleFilterStock() {
    const dropdown = document.getElementById('filter-dropdown');
    const filterBtn = document.querySelector('.filter-btn');
    const isShown = dropdown.classList.toggle('show');

    if (isShown) {
      const btnRect = filterBtn.getBoundingClientRect();
      const availableHeight = window.innerHeight - btnRect.bottom - 20;
      dropdown.style.maxHeight = Math.max(200, availableHeight) + 'px';
    } else {
      dropdown.style.maxHeight = 'none';
    }
  }

  applyStockFilter() {
    const categoryFilter = document.getElementById('category-filter');
    const unitFilter = document.getElementById('unit-filter');
    const statusFilter = document.getElementById('status-filter');
    const sortFilter = document.getElementById('sort-filter');

    if (!categoryFilter || !unitFilter || !statusFilter || !sortFilter) {
      console.warn("Filter elements not found in DOM");
      return;
    }

    this.currentFilters = {
      category: categoryFilter.value,
      unit: unitFilter.value,
      status: statusFilter.value
    };
    this.currentSort = sortFilter.value;

    this.applyCurrentFiltersAndSearch(true);

    const sortValue = sortFilter.value;
    if (sortValue === 'a-z') {
      this.filteredInventory.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortValue === 'z-a') {
      this.filteredInventory.sort((a, b) => b.name.localeCompare(a.name));
    }

    // this.currentPage = 1;
    this.renderInventoryTable();
    this.toggleFilterStock();
  }

  clearStockFilter() {
    const categoryFilter = document.getElementById('category-filter');
    const unitFilter = document.getElementById('unit-filter');
    const statusFilter = document.getElementById('status-filter');
    const sortFilter = document.getElementById('sort-filter');

    if (categoryFilter) categoryFilter.value = '';
    if (unitFilter) unitFilter.value = '';
    if (statusFilter) statusFilter.value = '';
    if (sortFilter) sortFilter.value = '';

    this.currentFilters = { category: '', unit: '', status: '' };
    this.currentSort = '';
    this.currentSearchTerm = '';
    
    this.isUserInteracting = false;
    this.applyCurrentFiltersAndSearch(true);
    // this.toggleFilterStock();
  }

  changeStockPage(direction) {
    this.currentPage += direction;
    if (this.currentPage < 1) this.currentPage = 1;
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
    this.renderInventoryTable();
  }

  changeStockPageSize() {
    const entriesPerPage = document.getElementById('entries-per-page');
    if (entriesPerPage) {
      this.itemsPerPage = parseInt(entriesPerPage.value);
      this.currentPage = 1;
      this.renderInventoryTable();
    } else {
      console.warn("Entries per page element not found in DOM");
    }
  }

  viewItem(itemId) {
    const item = this.inventory.find(i => i.id === itemId);
    if (!item) {
      showErrorModal('Item not found');
      return;
    }

    document.getElementById('view-item-name').textContent = item.name;
    document.getElementById('view-item-category').textContent = this.formatCategoryName(item.category);
    document.getElementById('view-item-current').textContent = `${item.current_quantity.toFixed(2)} ${item.unit}`;
    document.getElementById('view-item-unit').textContent = this.capitalizeFirst(item.unit);
    document.getElementById('view-item-minimum').textContent = `${item.minimum_quantity.toFixed(2)} ${item.unit}`;
    document.getElementById('view-item-availability').textContent = item.is_available ? 'Available' : 'Unavailable';

    const status = this.getStockStatus(item);
    const statusElement = document.getElementById('view-item-status');
    statusElement.innerHTML = `<span class="${status.class}">${status.text}</span>`;
    this.showModal('view-item-modal');
  }

  closeViewItemModal() {
    this.closeModal('view-item-modal');
    document.getElementById('view-item-modal').removeAttribute('data-item-id');
  }

  editFromView() {
    const itemId = document.getElementById('view-item-modal').getAttribute('data-item-id');
    if (!itemId) {
      showErrorModal('No item selected for editing');
      return;
    }

    this.closeViewItemModal();

    setTimeout(() => {
      this.editItem(parseInt(itemId));
    }, 50);
  }

  openAddItemModal() {
    this.editingItem = null;
    const modalTitle = document.getElementById('modal-title');
    const itemForm = document.getElementById('item-form');
    if (modalTitle) modalTitle.textContent = 'Add New Item';
    if (itemForm) itemForm.reset();
    this.showModal('item-modal');
  }

  editItem(itemId) {
    const item = this.inventory.find(i => i.id === itemId);
    if (!item) return;

    this.editingItem = item;
    const modalTitle = document.getElementById('modal-title');
    if (modalTitle) modalTitle.textContent = 'Edit Item';

    const fields = {
      'item-name': item.name,
      'item-category': item.category,
      'item-unit': item.unit,
      'item-current': item.current_quantity,
      'item-minimum': item.minimum_quantity
    };

    Object.keys(fields).forEach(id => {
      const element = document.getElementById(id);
      if (element) element.value = fields[id];
    });

    const itemForm = document.getElementById('item-form');
    if (itemForm) {
      itemForm.setAttribute('data-item-id', itemId);
    }

    this.showModal('item-modal');
  }

  editItemFromView() {
    if (this.viewingItemId) {
      this.editItem(this.viewingItemId);
      this.closeModal('view-item-modal');
    }
  }

  changeAvailability(itemId, itemName, isAvailable) {
    this.editingItem = { id: itemId, name: itemName };
    const changeStatusItemName = document.getElementById('change-status-item-name');
    const currentAvailability = document.getElementById('current-availability');
    const isAvailTrue = document.getElementById('is-avail-true');
    const isAvailFalse = document.getElementById('is-avail-false');

    if (changeStatusItemName) changeStatusItemName.textContent = itemName;
    if (currentAvailability) currentAvailability.textContent = isAvailable ? 'Available' : 'Unavailable';
    if (isAvailTrue) isAvailTrue.checked = isAvailable;
    if (isAvailFalse) isAvailFalse.checked = !isAvailable;

    this.showModal('change-status-modal');
  }

  async confirmChangeStatus() {
    if (!this.editingItem) return;

    const isAvailTrue = document.getElementById('is-avail-true');
    if (!isAvailTrue) {
      console.warn("Radio button 'is-avail-true' not found in DOM");
      return;
    }

    const isAvailable = isAvailTrue.checked;

    try {
      const token = localStorage.getItem('access_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(`/inventory/toggle/${this.editingItem.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_available: isAvailable })
      });

      if (response.ok) {
        showSuccessModal(`Item availability changed to ${isAvailable ? 'Available' : 'Unavailable'}`);
        this.closeModal('change-status-modal');
        this.loadAndRefreshData();
      } else {
        const errorData = await response.json();
        showErrorModal(errorData.error || 'Failed to change availability');
      }
    } catch (error) {
      console.error('Error changing availability:', error);
      showErrorModal('Failed to change availability');
    }
  }
  // Removed: handleLocalChangeAvailability (local demo)

  async handleFormSubmit() {
    const itemForm = document.getElementById('item-form');
    if (!itemForm) {
      console.warn("Item form not found in DOM");
      return;
    }

    const formData = new FormData(itemForm);
    const nameRaw = (formData.get('name') || '').toString().trim();
    const categoryRaw = (formData.get('category') || '').toString().trim().toLowerCase();
    const unitRaw = (formData.get('unit') || '').toString().trim().toLowerCase();
    const currentQtyRaw = formData.get('current_quantity');
    const minimumQtyRaw = formData.get('minimum_quantity');

    // Basic required validations
    if (!nameRaw) { showErrorModal('Nama item wajib diisi.'); return; }
    if (!categoryRaw) { showErrorModal('Kategori wajib dipilih.'); return; }
    if (!unitRaw) { showErrorModal('Unit wajib dipilih.'); return; }

    const currentQty = Number(parseFloat(currentQtyRaw));
    const minimumQty = Number(parseFloat(minimumQtyRaw));
    const safeCurrent = isNaN(currentQty) ? 0 : currentQty;
    const safeMinimum = isNaN(minimumQty) ? 0 : minimumQty;

    const itemData = {
      name: nameRaw,
      category: categoryRaw,
      unit: unitRaw,
      current_quantity: safeCurrent,
      minimum_quantity: safeMinimum,
      notes: (formData.get('notes') || 'Stock opname update').toString()
    };

    const itemId = itemForm.getAttribute('data-item-id');
    const isEditing = !!itemId;

    // Prevent duplicates on create and on edit when changing into a duplicate triple
    if (isEditing) {
      const excludeId = parseInt(itemId);
      if (this.hasDuplicateItem(itemData.name, itemData.category, itemData.unit, excludeId)) {
        showErrorModal('Item dengan nama, kategori, dan unit yang sama sudah ada.');
        return;
      }
    } else {
      // Client-side only blocks exact same name+category+unit; backend will enforce name uniqueness/similarity.
      if (this.hasDuplicateItem(itemData.name, itemData.category, itemData.unit)) {
        showErrorModal('Item dengan nama, kategori, dan unit yang sama sudah ada.');
        return;
      }
    }

    try {
      let response;
      const headers = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('access_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;

      if (isEditing) {
        // Update existing item with audit
        itemData.id = parseInt(itemId);
        response = await fetch('/inventory/update', {
          method: 'PUT',
          headers,
          body: JSON.stringify(itemData)
        });
      } else {
        // Create new item, then add initial stock via audited restock to register history
        const createResp = await fetch('/inventory/add', {
          method: 'POST',
          headers, // include Authorization when present
          body: JSON.stringify(itemData)
        });
        if (!createResp.ok) {
          let errMsg = 'Failed to create ingredient';
          try { const err = await createResp.json(); errMsg = err.message || err.detail || errMsg; } catch(_) {}
          // Highlight name field if backend says name already exists
          if (createResp.status === 400 && /nama '\w+' sudah ada|already exists/i.test(errMsg)) {
            const nameInput = document.querySelector('#item-form input[name="name"]');
            if (nameInput) {
              nameInput.focus();
              try { nameInput.setCustomValidity(errMsg); nameInput.reportValidity(); } catch(_) {}
            }
          }
          // If backend returns 500 but item actually created, treat as success after refresh
          if (createResp.status >= 500) {
            await this.loadAndRefreshData(true);
            const exists = this.hasDuplicateName(itemData.name);
            if (exists) {
              showSuccessModal('Item added successfully');
              this.closeModal('item-modal');
              return;
            }
          }
          throw new Error(errMsg);
        }
        const created = await createResp.json();
        const newId = created?.data?.id || created?.id;
        if (newId && itemData.current_quantity > 0) {
          await fetch('/inventory/stock/add', {
            method: 'POST',
            headers,
            body: JSON.stringify({ ingredient_id: newId, add_quantity: itemData.current_quantity, notes: itemData.notes || 'Initial stock (opname) on create' })
          });
        }
        response = new Response(JSON.stringify({ status: 'success' }), { status: 200 });
      }

      if (response.ok) {
        showSuccessModal(isEditing ? 'Item updated successfully' : 'Item added successfully');
        this.closeModal('item-modal');
        this.loadAndRefreshData();
      } else {
        const errorData = await response.json();
        showErrorModal(errorData.error || 'Failed to save item');
      }
    } catch (error) {
      console.error('Error saving item:', error);
      showErrorModal(error?.message || 'Failed to save item');
    }
  }

  handleLocalFormSubmission(itemData, isEditing, itemId) {
    if (isEditing) {
      const index = this.inventory.findIndex(item => item.id === parseInt(itemId));
      if (index !== -1) {
        this.inventory[index] = { ...this.inventory[index], ...itemData };
        showSuccessModal('Item updated successfully (local demo)');
      }
    } else {
      // Add new item to local data
      const newId = Math.max(...this.inventory.map(item => item.id), 0) + 1;
      const newItem = { ...itemData, id: newId, is_available: true };
      this.inventory.push(newItem);
      showSuccessModal('Item added successfully (local demo)');
    }

    this.applyCurrentFiltersAndSearch();
    this.updateOverviewCards({
      total_items: this.inventory.length,
      critical_count: this.inventory.filter(item => item.current_quantity <= 0).length,
      low_stock_count: this.inventory.filter(item => item.current_quantity > 0 && item.current_quantity <= item.minimum_quantity).length,
    });
    this.closeModal('item-modal');
  }

  async confirmDelete() {
    if (!this.editingItem) return;

    try {
      const response = await fetch(`/inventory/delete/${this.editingItem.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showSuccessModal('Item deleted successfully');
        this.closeModal('delete-modal');
        this.loadAndRefreshData();
      } else {
        const errorData = await response.json();
        showErrorModal(errorData.error || 'Failed to delete item');
      }
    } catch (error) {
      console.error('Error deleting item:', error);
      showErrorModal('Failed to delete item');
    }
  }

  // Removed: handleLocalDelete (local demo)

  showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('hidden');
    } else {
      console.warn(`Modal with ID '${modalId}' not found in DOM`);
    }
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
    }
    this.editingItem = null;

    if (modalId === 'item-modal') {
      const itemForm = document.getElementById('item-form');
      if (itemForm) {
        itemForm.removeAttribute('data-item-id');
      }
    }
  }

  

  handleKitchenToggle(isOpen) {
    // Handle kitchen open/close toggle
    console.log('Kitchen status:', isOpen ? 'OPEN' : 'CLOSED');
    // You can add API call here to update kitchen status
  }

  // Add Stock Modal Methods
  openAddStockModal() {
    this.populateIngredientSelect();
    this.showModal('add-stock-modal');
  }

  // Add New Item
    openAddItemModal() {
    this.editingItem = null;
    const modalTitle = document.getElementById('modal-title');
    const itemForm = document.getElementById('item-form');
    if (modalTitle) modalTitle.textContent = 'Add New Item';
    if (itemForm) itemForm.reset();
    this.showModal('item-modal');
  }

  populateIngredientSelect() {
    const select = document.getElementById('stock-ingredient');
    if (!select) {
      console.warn("Stock ingredient select not found in DOM");
      return;
    }
    select.innerHTML = '<option value="">Select Ingredient</option>';
    
    this.inventory.forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.name} (${item.current_quantity.toFixed(2)} ${item.unit})`;
      select.appendChild(option);
    });
  }

  // Dynamic Filters
  populateDynamicFilters() {
    try {
      const categoryFilter = document.getElementById('category-filter');
      const unitFilter = document.getElementById('unit-filter');
      const statusFilter = document.getElementById('status-filter');

      const uniqueCategories = [...new Set(this.inventory.map(item => item.category))];
      const uniqueUnits = [...new Set(this.inventory.map(item => item.unit))];
      const statuses = [
          { value: 'in-stock', text: 'In Stock' },
          { value: 'low-stock', text: 'Low Stock' },
          { value: 'out-of-stock', text: 'Out of Stock' },
          { value: 'unavailable', text: 'Unavailable' }
      ];

      categoryFilter.innerHTML = '<option value="">All Categories</option>';
      unitFilter.innerHTML = '<option value="">All Units</option>';
      statusFilter.innerHTML = '<option value="">All Status</option>';

      uniqueCategories.sort();
      uniqueCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = this.formatCategoryName(category);
        categoryFilter.appendChild(option);
      });

      uniqueUnits.sort();
      uniqueUnits.forEach(unit => {
        const option = document.createElement('option');
        option.value = unit;
        option.textContent = this.capitalizeFirst(unit);
        unitFilter.appendChild(option);
      });
      
      statuses.forEach(status => {
          const option = document.createElement('option');
          option.value = status.value;
          option.textContent = status.text;
          statusFilter.appendChild(option);
      });

      // Terapkan kembali nilai filter yang tersimpan
      categoryFilter.value = this.currentFilters.category || '';
      unitFilter.value = this.currentFilters.unit || '';
      statusFilter.value = this.currentFilters.status || '';
    } catch (error) {
      console.error('Gagal membuat filter dinamis:', error);
    }
  }

  async handleAddStockSubmit() {
    const addStockForm = document.getElementById('add-stock-form');
    if (!addStockForm) {
      console.warn("Add stock form not found in DOM");
      return;
    }

    const formData = new FormData(addStockForm);
    const stockData = {
      ingredient_id: parseInt(formData.get('ingredient_id')),
      add_quantity: parseFloat(formData.get('quantity')),
      notes: formData.get('notes') || ''
    };

    try {
      const token = localStorage.getItem('access_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch('/inventory/stock/add', {
        method: 'POST',
        headers,
        body: JSON.stringify(stockData)
      });

      if (response.ok) {
        showSuccessModal('Stock added successfully');
        this.closeModal('add-stock-modal');
        this.loadAndRefreshData();
        document.getElementById('add-stock-form').reset();
      } else {
        let errorMsg = 'Failed to add stock';
        try { const errorData = await response.json(); errorMsg = errorData.error || errorData.message || errorMsg; } catch (_) {}
        if (response.status === 401) errorMsg = 'Unauthorized: silakan login ulang.';
        showErrorModal(errorMsg);
      }
    } catch (error) {
      console.error('Error adding stock:', error);
      showErrorModal('Failed to add stock');
    }
  }

  async loadAuditHistoryData(forceReload = false) {
    try {
      const response = await fetch('/inventory/stock/history?limit=1000')
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success') {
          const newAuditHistory = data.data.history || [];

          const hasChanged = JSON.stringify(newAuditHistory) !== JSON.stringify(this.auditHistory);

          this.auditHistory = newAuditHistory;
          this.filteredAuditHistory = [...this.auditHistory];

          if (hasChanged || forceReload) {
            this.populateAuditFilters();
            this.applyAuditFiltersAndSearch(true);
          }
        
          this.auditLoaded = true;
        } else {
          showErrorModal(data.message || 'Failed to load audit history');
        }
      } else {
        showErrorModal('Failed to load audit history');
      }
    } catch (error) {
      console.error('Error loading audit history:', error);
      showErrorModal('Failed to load audit history');
    }
  }

  populateAuditFilters() {
    // Populate user filter
    const userFilter = document.getElementById('audit-user-filter');
    if (userFilter) {
      const uniqueUsers = [...new Set(this.auditHistory.map(item => item.performed_by).filter(Boolean))];
      userFilter.innerHTML = '<option value="">All Users</option>';
      uniqueUsers.sort().forEach(user => {
        const option = document.createElement('option');
        option.value = user;
        option.textContent = user;
        userFilter.appendChild(option);
      });
    }
  }

  applyAuditFiltersAndSearch(resetPage = false) {
    let temp = [...this.auditHistory];

    // Search filter
    if (this.currentAuditSearchTerm) {
      temp = temp.filter(item =>
        (item.ingredient_name && item.ingredient_name.toLowerCase().includes(this.currentAuditSearchTerm)) ||
        (item.performed_by && item.performed_by.toLowerCase().includes(this.currentAuditSearchTerm)) ||
        (item.notes && item.notes.toLowerCase().includes(this.currentAuditSearchTerm))
      );
    }

    // Action type filter
    if (this.currentAuditFilters.actionType) {
      temp = temp.filter(item => 
        item.action_type && item.action_type.toLowerCase() === this.currentAuditFilters.actionType.toLowerCase()
      );
    }

    // Date range filter
    if (this.currentAuditFilters.dateRange) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      temp = temp.filter(item => {
        if (!item.created_at) return false;
        const itemDate = this.parseDate(item.created_at);

        // const itemDate = new Date(item.created_at);
        
        switch (this.currentAuditFilters.dateRange) {
          case 'today':
            return itemDate >= today;
          case 'week':
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            return itemDate >= weekAgo;
          case 'month':
            const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            return itemDate >= firstOfMonth;
          case 'quarter':
            const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
            const firstOfQuarter = new Date(today.getFullYear(), quarterStartMonth, 1);
            return itemDate >= firstOfQuarter;
          case 'year':
            const firstOfYear = new Date(today.getFullYear(), 0, 1);
            return itemDate >= firstOfYear;
          default:
            return true;
        }
      });
    }

    // User filter
    if (this.currentAuditFilters.user) {
      temp = temp.filter(item => 
        item.performed_by && item.performed_by.toLowerCase() === this.currentAuditFilters.user.toLowerCase()
      );
    }

    // Sort filter
    const sort = this.currentAuditFilters.sort;
    if (sort === 'a-z') {
      temp.sort((a, b) => (a.ingredient_name || '').localeCompare(b.ingredient_name || ''));
    } else if (sort === 'z-a') {
      temp.sort((a, b) => (b.ingredient_name || '').localeCompare(a.ingredient_name || ''));
    }
    
    this.filteredAuditHistory = temp;
    this.totalAuditPages = Math.ceil(this.filteredAuditHistory.length / this.auditItemsPerPage) || 1;

    if (resetPage) {
      this.currentAuditPage = 1;
    } else if (this.currentAuditPage > this.totalAuditPages) {
      this.currentAuditPage = this.totalAuditPages;
    }

    this.renderAuditHistoryTable();
  }

  parseDate(dateStr) {
    if (!dateStr) return null;
      const parts = dateStr.trim().split(/[\s\/:]+/);
      if (parts.length < 3) return null;

      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) -1;
      const year = parseInt(parts[2], 10);
      let hour = 0, minute = 0, second = 0;
      if (parts.length > 3) {
        hour = parseInt(parts[3], 10) || 0;
        if (parts.length > 4) minute = parseInt(parts[4], 10) || 0;
        if (parts.length > 5) second = parseInt(parts[5], 10) || 0;
      }

      const parsed = new Date(year, month, day, hour, minute, second);
      return isNaN(parsed.getTime()) ? null : parsed;
  }

  renderAuditHistoryTable() {
    const tbody = document.getElementById('audit-history-tbody');
    if (!tbody) {
      console.warn("Audit history table body not found in DOM");
      return;
    }

    tbody.innerHTML = '';

    const startIndex = (this.currentAuditPage -1) * this.auditItemsPerPage;
    const endIndex = startIndex + this.auditItemsPerPage;
    const pageData = this.filteredAuditHistory.slice(startIndex, endIndex);

    if (!this.filteredAuditHistory.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 1rem;">
            No audit history found
          </td>
        </tr>
      `;
    } else {
      pageData.forEach((item, index) => {
        const row = this.createAuditTableRow(item, startIndex + index + 1);
        tbody.appendChild(row); 
      });
    }

    const tableInfo = document.getElementById('audit-history-table-info');
    if (tableInfo) {
      tableInfo.textContent = `Showing ${startIndex + 1} to ${Math.min(endIndex, this.filteredAuditHistory.length)} of ${this.filteredAuditHistory.length} entries`;
    }

    this.renderAuditPagination();
  }

  createAuditTableRow(item, rowNumber) {
    const row = document.createElement('tr');
    
    // Format date
    // const date = item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', {
    //   year: 'numeric',
    //   month: 'short',
    //   day: 'numeric',
    //   hour: '2-digit',
    //   minute: '2-digit'
    // }) : 'N/A';
    
    // Format action type with badge
    const actionType = item.action_type || 'N/A';
    const actionBadge = `<span class="status-badge status-${this.getActionTypeClass(actionType)}">${actionType}</span>`;
    
    row.innerHTML = `
      <td>${rowNumber}</td>
      <td>${item.ingredient_name || 'N/A'}</td>
      <td>${actionBadge}</td>
      <td>${(item.quantity_before != null ? item.quantity_before.toFixed(2) : 'N/A')}</td>
      <td>${(item.quantity_after != null ? item.quantity_after.toFixed(2) : 'N/A')}</td>
      <td>${(item.quantity_changed != null ? item.quantity_changed.toFixed(2) : 'N/A')}</td>
      <td>${item.performed_by || 'N/A'}</td>
      <td class="action-header">
        <button class="table-action-btn" onclick="inventoryManager.viewAuditHistory(${item.id})"><i class="fas fa-eye"></i></button>
      </td>
    `;
    return row;
  }

  getActionTypeClass(actionType) {
    const actionMap = {
      'consume': 'success',
      'edit_stock': 'success',
      'edit_minimum': 'success',
      'rollback': 'warning',
      'restock': 'success',
      'make_available': 'success',
      'make_unavailable': 'danger'
    };
    return actionMap[actionType.toLowerCase()] || 'default';
  }

  renderAuditPagination() {
    const pageNumbers = document.getElementById('audit-history-page-numbers');
    if (!pageNumbers) return;

    const paginationInfo = document.getElementById('audit-history-pagination-info');
    if (paginationInfo) {
      paginationInfo.textContent = `Page ${this.currentAuditPage} of ${this.totalAuditPages}`;
    }

    const prevBtn = document.getElementById('audit-history-prev-btn');
    const nextBtn = document.getElementById('audit-history-next-btn');
    
    // If all data fits on one page, disable navigation and show only "1"
    if (this.totalAuditPages <= 1) {
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      
      pageNumbers.innerHTML = '';
      const pageBtn = document.createElement('button');
      pageBtn.className = 'page-number active';
      pageBtn.textContent = '1';
      pageBtn.disabled = true;
      pageNumbers.appendChild(pageBtn);
      return;
    }

    // Normal pagination for multiple pages
    if (prevBtn) prevBtn.disabled = this.currentAuditPage === 1;
    if (nextBtn) nextBtn.disabled = this.currentAuditPage === this.totalAuditPages;

    pageNumbers.innerHTML = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, this.currentAuditPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(this.totalAuditPages, startPage + maxVisiblePages - 1);
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `page-number ${i === this.currentAuditPage ? 'active' : ''}`;
      pageBtn.textContent = i;
      pageBtn.onclick = () => {
        this.currentAuditPage = i;
        this.renderAuditHistoryTable();
      };
      pageNumbers.appendChild(pageBtn);
    }
  }

  changeAuditHistoryPage(direction) {
    this.currentAuditPage += direction;
    if (this.currentAuditPage < 1) this.currentAuditPage = 1;
    if (this.currentAuditPage > this.totalAuditPages) this.currentAuditPage = this.totalAuditPages;
    this.renderAuditHistoryTable();
  }

  changeAuditHistoryPageSize() {
    const entriesPerPage = document.getElementById('audit-history-page-size');
    if (entriesPerPage) {
      this.auditItemsPerPage = parseInt(entriesPerPage.value);
      this.currentAuditPage = 1;
      this.renderAuditHistoryTable();
    }
  }

  toggleFilterAuditHistory() {
    const dropdown = document.getElementById('audit-history-filter-dropdown');
    const filterBtn = document.querySelector('#tab-audit-history-content .filter-btn');
    if (!dropdown || !filterBtn) return;

    const isShown = dropdown.classList.toggle('show');

    if (isShown) {
      const btnRect = filterBtn.getBoundingClientRect();
      const table = document.getElementById('audit-history-table');
      let maxHeight = 200;

      const availableHeight = window.innerHeight - btnRect.bottom - 20;

      let tableHeight = availableHeight; 
      if (table) {
        const tableRect = table.getBoundingClientRect();
        tableHeight = tableRect.height;
      }

      maxHeight = Math.min(availableHeight, tableHeight, 450);
      maxHeight = Math.max(300, maxHeight); 

      dropdown.style.maxHeight = maxHeight + 'px';
    } else {
      dropdown.style.maxHeight = 'none';
    }

    // if (isShown) {
    //   const btnRect = filterBtn.getBoundingClientRect();
    //   const availableHeight = window.innerHeight - btnRect.bottom - 20;
    //   dropdown.style.maxHeight = Math.max(200, availableHeight) + 'px';
    // } else {
    //   dropdown.style.maxHeight = 'none'
    // }
  }

  applyAuditHistoryFilter() {
    const sortFilter = document.getElementById('audit-sort-filter');
    const actionFilter = document.getElementById('audit-action-filter');
    const dateFilter = document.getElementById('audit-date-filter');
    const userFilter = document.getElementById('audit-user-filter');
    
    if (sortFilter) this.currentAuditFilters.sort = sortFilter.value;
    if (actionFilter) this.currentAuditFilters.actionType = actionFilter.value;
    if (dateFilter) this.currentAuditFilters.dateRange = dateFilter.value;
    if (userFilter) this.currentAuditFilters.user = userFilter.value;
    
    this.applyAuditFiltersAndSearch(true);
    this.toggleFilterAuditHistory();
  }

  clearAuditHistoryFilter() {
    const sortFilter = document.getElementById('audit-sort-filter');
    const actionFilter = document.getElementById('audit-action-filter');
    const dateFilter = document.getElementById('audit-date-filter');
    const userFilter = document.getElementById('audit-user-filter');
    const searchInput = document.getElementById('audit-history-search');
    
    if (sortFilter) sortFilter.value = '';
    if (actionFilter) actionFilter.value = '';
    if (dateFilter) dateFilter.value = '';
    if (userFilter) userFilter.value = '';
    if (searchInput) searchInput.value = '';
    
    this.currentAuditFilters.sort = '';
    this.currentAuditFilters.actionType = '';
    this.currentAuditFilters.dateRange = '';
    this.currentAuditFilters.user = '';
    this.currentAuditSearchTerm = '';
    
    this.applyAuditFiltersAndSearch(true);
    this.toggleFilterAuditHistory();
  }

  viewAuditHistory(id) {
    const item = this.auditHistory.find(h => h.id === id);
    if (!item) {
      showErrorModal('Audit history item not found');
      return;
    }

    let date = 'N/A';
    if (item.created_at) {
      // Asumsikan format input 'DD/MM/YYYY' atau 'DD/MM/YYYY HH:MM:SS'
      const parts = item.created_at.trim().split(/[\s\/:]+/); // Split oleh space, slash, atau colon
      if (parts.length >= 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Bulan di JS mulai dari 0
        const year = parseInt(parts[2], 10);
        let hour = 0, minute = 0, second = 0;
        if (parts.length > 3) {
          hour = parseInt(parts[3], 10) || 0;
          minute = parseInt(parts[4], 10) || 0;
          second = parseInt(parts[5], 10) || 0;
        }
        const parsedDate = new Date(year, month, day, hour, minute, second);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
        } else {
          date = 'Invalid Date';
        }
      }
    }

    // const date = item.created_at ? new Date(item.created_at).toLocaleDateString('en-GB', {
    //   day: 'numeric',
    //   month: 'short',
    //   year: 'numeric',
    //   hour: '2-digit',
    //   minute: '2-digit',
    //   second: '2-digit',
    //   hour12: false
    // }) : 'N/A';

    document.getElementById('view-audit-ingredient-name').textContent = item.ingredient_name || 'N/A';
    document.getElementById('view-audit-action-type').textContent = item.action_type || 'N/A';
    document.getElementById('view-audit-quantity-before').textContent = (item.quantity_before != null ? item.quantity_before.toFixed(2) : 'N/A');
    document.getElementById('view-audit-quantity-after').textContent = (item.quantity_after != null ? item.quantity_after.toFixed(2) : 'N/A');
    document.getElementById('view-audit-quantity-changed').textContent = (item.quantity_changed != null ? item.quantity_changed.toFixed(2) : 'N/A');
    document.getElementById('view-audit-performed-by').textContent = item.performed_by || 'N/A';
    document.getElementById('view-audit-notes').textContent = item.notes || 'N/A';
    document.getElementById('view-audit-created-at').textContent = date || 'N/A';
    document.getElementById('view-audit-order-id').textContent = item.order_id || 'N/A';

    this.showModal('view-audit-modal');
  }

  // Consumption Log Modal Methods
  openConsumptionLogModal() {
    this.showModal('consumption-log-modal');
    this.loadConsumptionLogs();
  }

  async loadConsumptionLogs() {
    try {
      const response = await fetch('/inventory/consumption_log');
      if (response.ok) {
        const logs = await response.json();
        this.renderConsumptionLogs(logs);
      } else {
        showErrorModal('Failed to load consumption logs');
        const offlineBanner = document.getElementById('offline-banner');
        if (offlineBanner) offlineBanner.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error loading consumption logs:', error);
      showErrorModal('Failed to load consumption logs');
      const offlineBanner = document.getElementById('offline-banner');
      if (offlineBanner) offlineBanner.classList.remove('hidden');
    }
  }

  renderConsumptionLogs(logs) {
    const tbody = document.getElementById('consumption-log-tbody');
    if (!tbody) {
      console.warn("Consumption log table body not found in DOM");
      return;
    }
    tbody.innerHTML = '';

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 2rem;">
            No consumption logs found
          </td>
        </tr>
      `;
      return;
    }

    logs.forEach(log => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${log.order_id || 'N/A'}</td>
        <td>${this.formatMenuPayload(log.per_menu_payload)}</td>
        <td>${log.consumed ? 'Yes' : 'No'}</td>
        <td>${log.rolled_back ? 'Yes' : 'No'}</td>
        <td>${new Date(log.created_at).toLocaleString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}</td>
      `;
      tbody.appendChild(row);
    });
  }

  formatMenuPayload(payload) {
    if (!payload) return 'N/A';
    try {
      const data = JSON.parse(payload);
      if (Array.isArray(data)) {
        return data.map(item => `${item.name} x${item.quantity}`).join(', ');
      }
      return 'Custom order';
    } catch (e) {
      return 'Invalid data';
    }
  }

  filterConsumptionLogs(searchTerm) {
    const tbody = document.getElementById('consumption-log-tbody');
    if (!tbody) {
      console.warn("Consumption log table body not found in DOM");
      return;
    }
    const rows = tbody.querySelectorAll('tr');

    rows.forEach(row => {
      const orderId = row.cells[0].textContent.toLowerCase();
      if (orderId.includes(searchTerm.toLowerCase())) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
  }

  openStockHistoryModal() {
    this.showModal('stock-history-modal');
    this.loadStockHistory();
  }

  async loadStockHistory(ingredientId = null) {
    try {
      const actionFilter = document.getElementById('history-action-filter');
      const params = new URLSearchParams();
      if (actionFilter && actionFilter.value) params.append('action_type', actionFilter.value);
      params.append('limit', '100');
      const url = ingredientId ? `/inventory/stock/history/${ingredientId}` : `/inventory/stock/history?${params.toString()}`;
      const resp = await fetch(url);
      const json = await resp.json();
      const rows = ingredientId ? (json?.data?.history || []) : (json?.data?.history || json?.history || []);
      this.renderStockHistory(rows);
    } catch (e) {
      console.error('Failed to load stock history:', e);
      showErrorModal('Failed to load stock history');
    }
  }

  renderStockHistory(histories) {
    const tbody = document.getElementById('stock-history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!histories || histories.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1rem;">No history found</td></tr>`;
      return;
    }

    histories.forEach(h => {
      const before = (h.quantity_before ?? h.stock_before ?? 0).toLocaleString();
      const after = (h.quantity_after ?? h.stock_after ?? 0).toLocaleString();
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Date">${h.created_at || '-'}</td>
        <td data-label="Ingredient">${h.ingredient_name || '-'}</td>
        <td data-label="Action"><span class="status-badge status-deliver">${h.action_type}</span></td>
        <td data-label="Before → After" style="text-align:center;">${before} → ${after}</td>
        <td data-label="By">${h.performed_by || '-'}</td>
        <td data-label="Notes">${h.notes || '-'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  filterStockHistory(term) {
    const tbody = document.getElementById('stock-history-tbody');
    if (!tbody) return;
    const q = (term || '').toLowerCase();
    Array.from(tbody.rows).forEach(row => {
      const match = Array.from(row.cells).some(td => td.textContent.toLowerCase().includes(q));
      row.style.display = match ? '' : 'none';
    });
  }
}

window.closeViewItemModal = function() {
  if (window.inventoryManager) {
    window.inventoryManager.closeViewItemModal();
  }
};

window.editFromView = function() {
  if (window.inventoryManager) {
    window.inventoryManager.editFromView();
  }
};




// Initialize the inventory manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('Initializing InventoryManager...');
  window.inventoryManager = new InventoryManager();
});