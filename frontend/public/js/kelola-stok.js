// Kelola Stok Page JavaScript

class InventoryManager {
  constructor() {
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

    const searchInput = document.getElementById('table-search');
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
    safeAddEventListener('history-btn', 'click', () => {
      this.openStockHistoryModal();
    });
    safeAddEventListener('close-stock-history-modal', 'click', () => {
      this.closeModal('stock-history-modal');
    });
    safeAddEventListener('refresh-history-btn', 'click', () => {
      this.loadStockHistory();
    });
    safeAddEventListener('history-search', 'input', (e) => {
      this.filterStockHistory(e.target.value);
    });
    const actionFilter = document.getElementById('history-action-filter');
    if (actionFilter) actionFilter.addEventListener('change', () => this.loadStockHistory());
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
        console.log('Summary API failed, loading sample data...');
        this.loadSampleData();
        return;
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
      console.log('Loading sample data as fallback...');
      this.loadSampleData();
    }
  }

  async loadAndRefreshData(forceFullReload = false) {
    try {
      const listResponse = await fetch('/inventory/list');
      const listData = await listResponse.json();

      this.inventory = Array.isArray(listData.data) ? listData.data : [];

      if (forceFullReload) {
        this.filteredInventory = [...this.inventory];
        this.currentFilters = { category: '', unit: '', status: '' };
        this.currentSearchTerm = '';
        this.currentPage = 1;
      } else {
        this.applyCurrentFiltersAndSearch();
      }

      this.renderInventoryTable();
      this.updateOverviewCards();
      if (forceFullReload) {
        this.populateDynamicFilters();
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

  startPolling() {
    console.log("Memulai polling cerdas setiap 3 detik...");
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.pollingInterval = setInterval(() => {
      if (!this.isUserInteracting) {
        console.log("Polling: Mengambil data inventaris terbaru...");
        this.loadAndRefreshData();
      } else {
        console.log("Polling: Dilewati karena pengguna sedang berinteraksi.");
      }
    }, 3000);
  }

  loadSampleData() {
    // Sample data for demonstration when backend is not available
    const sampleInventory = [
      {
        id: 1,
        name: "Coffee Beans",
        category: "ingredient",
        current_quantity: 25.5,
        minimum_quantity: 10.0,
        unit: "gram",
        is_available: true
      },
      {
        id: 2,
        name: "Milk",
        category: "ingredient",
        current_quantity: 8.0,
        minimum_quantity: 15.0,
        unit: "milliliter",
        is_available: true
      },
      {
        id: 3,
        name: "Sugar",
        category: "ingredient",
        current_quantity: 0.0,
        minimum_quantity: 5.0,
        unit: "gram",
        is_available: false
      },
      {
        id: 4,
        name: "Coffee Cups",
        category: "packaging",
        current_quantity: 50,
        minimum_quantity: 100,
        unit: "piece",
        is_available: true
      },
      {
        id: 5,
        name: "Straws",
        category: "packaging",
        current_quantity: 75,
        minimum_quantity: 200,
        unit: "piece",
        is_available: true
      }
    ];

    this.inventory = sampleInventory;
    this.filteredInventory = [...this.inventory];
    this.currentFilters = { category: '', unit: '', status: '' };
    this.currentSearchTerm = '';
    this.currentPage = 1;

    this.populateDynamicFilters();
    
    // Update overview cards with sample data
    this.updateOverviewCards({
      total_items: sampleInventory.length,
      critical_count: sampleInventory.filter(item => item.current_quantity <= 0).length,
      low_stock_count: sampleInventory.filter(item => item.current_quantity > 0 && item.current_quantity <= item.minimum_quantity).length,
    });

    this.renderInventoryTable();
    console.log('Sample data loaded and table rendered');
  }

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
      const tableInfo = document.getElementById('table-info');
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
      const tableInfo = document.getElementById('table-info');
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
    this.currentSearchTerm = '';
    this.isUserInteracting = false;
    this.applyCurrentFiltersAndSearch(true);
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
      this.showError('Item not found');
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
  ;
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
      const response = await fetch(`/inventory/toggle/${this.editingItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_available: isAvailable })
      });

      if (response.ok) {
        this.showSuccess(`Item availability changed to ${isAvailable ? 'Available' : 'Unavailable'}`);
        this.closeModal('change-status-modal');
        this.loadAndRefreshData();
      } else {
        const errorData = await response.json();
        this.showError(errorData.error || 'Failed to change availability');
      }
    } catch (error) {
      console.error('Error changing availability:', error);
      this.handleLocalChangeAvailability(isAvailable);
    }
  }

  handleLocalChangeAvailability(isAvailable) {
    const index = this.inventory.findIndex(item => item.id === this.editingItem.id);
    if (index !== -1) {
      this.inventory[index].is_available = isAvailable;
      this.showSuccess(`Item availability changed to ${isAvailable ? 'Available' : 'Unavailable'} (local demo)`);
      this.closeModal('change-status-modal');
      this.applyCurrentFiltersAndSearch();
      this.updateOverviewCards({
        total_items: this.inventory.length,
        critical_count: this.inventory.filter(item => item.current_quantity <= 0).length,
        low_stock_count: this.inventory.filter(item => item.current_quantity > 0 && item.current_quantity <= item.minimum_quantity).length,
      });
    }
  }

  async handleFormSubmit() {
    const itemForm = document.getElementById('item-form');
    if (!itemForm) {
      console.warn("Item form not found in DOM");
      return;
    }

    const formData = new FormData(itemForm);
    const itemData = {
      name: formData.get('name'),
      category: (formData.get('category') || '').toString().trim().toLowerCase(),
      unit: (formData.get('unit') || '').toString().trim().toLowerCase(),
      current_quantity: parseFloat(formData.get('current_quantity')),
      minimum_quantity: parseFloat(formData.get('minimum_quantity')),
      notes: 'Stock opname update'
    };

    const itemId = itemForm.getAttribute('data-item-id');
    const isEditing = !!itemId;

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
          const err = await createResp.json();
          throw new Error(err.detail || 'Failed to create ingredient');
        }
        const created = await createResp.json();
        const newId = created?.data?.id || created?.id;
        if (newId && itemData.current_quantity > 0) {
          await fetch('/inventory/stock/add', {
            method: 'POST',
            headers,
            body: JSON.stringify({ ingredient_id: newId, quantity: itemData.current_quantity, notes: 'Initial stock (opname) on create' })
          });
        }
        response = new Response(JSON.stringify({ status: 'success' }), { status: 200 });
      }

      if (response.ok) {
        this.showSuccess(isEditing ? 'Item updated successfully' : 'Item added successfully');
        this.closeModal('item-modal');
        this.loadAndRefreshData();
      } else {
        const errorData = await response.json();
        this.showError(errorData.error || 'Failed to save item');
      }
    } catch (error) {
      console.error('Error saving item:', error);
      this.handleLocalFormSubmission(itemData, isEditing, itemId);
    }
  }

  handleLocalFormSubmission(itemData, isEditing, itemId) {
    if (isEditing) {
      const index = this.inventory.findIndex(item => item.id === parseInt(itemId));
      if (index !== -1) {
        this.inventory[index] = { ...this.inventory[index], ...itemData };
        this.showSuccess('Item updated successfully (local demo)');
      }
    } else {
      // Add new item to local data
      const newId = Math.max(...this.inventory.map(item => item.id), 0) + 1;
      const newItem = { ...itemData, id: newId, is_available: true };
      this.inventory.push(newItem);
      this.showSuccess('Item added successfully (local demo)');
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
        this.showSuccess('Item deleted successfully');
        this.closeModal('delete-modal');
        this.loadAndRefreshData();
      } else {
        const errorData = await response.json();
        this.showError(errorData.error || 'Failed to delete item');
      }
    } catch (error) {
      console.error('Error deleting item:', error);
      // Fallback: delete from local data for demonstration
      this.handleLocalDelete();
    }
  }

  handleLocalDelete() {
    const index = this.inventory.findIndex(item => item.id === this.editingItem.id);
    if (index !== -1) {
      this.inventory.splice(index, 1);
      this.showSuccess('Item deleted successfully (local demo)');
      this.closeModal('delete-modal');
      this.applyCurrentFiltersAndSearch();
      this.updateOverviewCards({
        total_items: this.inventory.length,
        critical_count: this.inventory.filter(item => item.current_quantity <= 0).length,
        low_stock_count: this.inventory.filter(item => item.current_quantity > 0 && item.current_quantity <= item.minimum_quantity).length,
        // warning_count: this.inventory.filter(item => item.current_quantity > item.minimum_quantity && item.current_quantity <= item.minimum_quantity * 1.5).length
      });
    }
  }

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

  showSuccess(message) {
    // Simple success notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #379777;
      color: white;
      padding: 1rem;
      border-radius: 5px;
      z-index: 1001;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  showError(message) {
    // Simple error notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #B3261E;
      color: white;
      padding: 1rem;
      border-radius: 5px;
      z-index: 1001;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
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
          { value: 'out-of-stock', text: 'Out of Stock' }
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
      quantity: parseFloat(formData.get('quantity')),
      notes: formData.get('notes') || ''
    };

    try {
      const response = await fetch('/inventory/stock/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stockData)
      });

      if (response.ok) {
        this.showSuccess('Stock added successfully');
        this.closeModal('add-stock-modal');
        this.loadAndRefreshData();
        document.getElementById('add-stock-form').reset();
      } else {
        const errorData = await response.json();
        this.showError(errorData.error || 'Failed to add stock');
      }
    } catch (error) {
      console.error('Error adding stock:', error);
      this.showError('Failed to add stock');
    }
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
        this.showError('Failed to load consumption logs');
        const offlineBanner = document.getElementById('offline-banner');
        if (offlineBanner) offlineBanner.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error loading consumption logs:', error);
      this.showError('Failed to load consumption logs');
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
      this.showError('Failed to load stock history');
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