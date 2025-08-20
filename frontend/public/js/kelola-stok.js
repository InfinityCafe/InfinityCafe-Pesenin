// Kelola Stok Page JavaScript

class InventoryManager {
  constructor() {
    this.inventory = [];
    this.filteredInventory = [];
    this.currentPage = 1;
    this.itemsPerPage = 10;
    this.totalPages = 1;
    this.editingItem = null;
    
    this.initializeEventListeners();
    this.loadInventoryData();
    // this.updateGreetingDate();
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

    // Modal close buttons
    safeAddEventListener('close-modal', 'click', () => {
      this.closeModal('item-modal');
    });

    safeAddEventListener('close-delete-modal', 'click', () => {
      this.closeModal('delete-modal');
    });

    // Form submission
    safeAddEventListener('item-form', 'submit', (e) => {
      e.preventDefault();
      this.handleFormSubmit();
    });

    // Cancel buttons
    safeAddEventListener('cancel-btn', 'click', () => {
      this.closeModal('item-modal');
    });

    safeAddEventListener('cancel-delete-btn', 'click', () => {
      this.closeModal('delete-modal');
    });

    // Search functionality
    safeAddEventListener('search-input', 'input', (e) => {
      this.handleSearch(e.target.value);
    });

    safeAddEventListener('table-search', 'input', (e) => {
      this.handleSearch(e.target.value);
    });

    // Entries per page
    safeAddEventListener('entries-per-page', 'change', () => {
      this.changeMenuPageSize();
    });

    // Pagination buttons
    safeAddEventListener('prev-btn', 'click', () => {
      this.changeMenuPage(-1);
    });

    safeAddEventListener('next-btn', 'click', () => {
      this.changeMenuPage(1);
    });

    // Delete confirmation
    safeAddEventListener('confirm-delete-btn', 'click', () => {
      this.confirmDelete();
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

    // Bulk stock button
    safeAddEventListener('bulk-stock-btn', 'click', () => {
      this.openBulkStockModal();
    });

    // Consumption log button
    safeAddEventListener('consumption-log-btn', 'click', () => {
      this.openConsumptionLogModal();
    });

    // Add stock form
    safeAddEventListener('add-stock-form', 'submit', (e) => {
      e.preventDefault();
      this.handleAddStockSubmit();
    });

    // Bulk stock form
    safeAddEventListener('bulk-stock-form', 'submit', (e) => {
      e.preventDefault();
      this.handleBulkStockSubmit();
    });

    // Modal close buttons
    safeAddEventListener('close-add-stock-modal', 'click', () => {
      this.closeModal('add-stock-modal');
    });

    safeAddEventListener('close-bulk-stock-modal', 'click', () => {
      this.closeModal('bulk-stock-modal');
    });

    safeAddEventListener('close-consumption-log-modal', 'click', () => {
      this.closeModal('consumption-log-modal');
    });

    // Cancel buttons
    safeAddEventListener('cancel-add-stock-btn', 'click', () => {
      this.closeModal('add-stock-modal');
    });

    safeAddEventListener('cancel-bulk-stock-btn', 'click', () => {
      this.closeModal('bulk-stock-modal');
    });

    // Add bulk item button
    safeAddEventListener('add-bulk-item-btn', 'click', () => {
      this.addBulkItem();
    });

    // Refresh logs button
    safeAddEventListener('refresh-logs-btn', 'click', () => {
      this.loadConsumptionLogs();
    });

    // Log search
    safeAddEventListener('log-search', 'input', (e) => {
      this.filterConsumptionLogs(e.target.value);
    });
  }

  async loadInventoryData() {
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
      }

      // Load inventory list
      const listResponse = await fetch('/inventory/list');
      const listData = await listResponse.json();
      
      if (listResponse.ok) {
        console.log('Inventory list loaded:', listData);
        this.inventory = listData.data || listData;
        this.filteredInventory = [...this.inventory];
        this.renderInventoryTable();
      } else {
        // Fallback to sample data if API fails
        this.loadSampleData();
      }
    } catch (error) {
      console.error('Error loading inventory data:', error);
      console.log('Loading sample data as fallback...');
      this.loadSampleData();
    }
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
        unit: "gram"
      },
      {
        id: 2,
        name: "Milk",
        category: "ingredient",
        current_quantity: 8.0,
        minimum_quantity: 15.0,
        unit: "milliliter"
      },
      {
        id: 3,
        name: "Sugar",
        category: "ingredient",
        current_quantity: 0.0,
        minimum_quantity: 5.0,
        unit: "gram"
      },
      {
        id: 4,
        name: "Coffee Cups",
        category: "packaging",
        current_quantity: 50,
        minimum_quantity: 100,
        unit: "piece"
      },
      {
        id: 5,
        name: "Straws",
        category: "packaging",
        current_quantity: 75,
        minimum_quantity: 200,
        unit: "piece"
      }
    ];

    this.inventory = sampleInventory;
    this.filteredInventory = [...this.inventory];
    
    // Update overview cards with sample data
    this.updateOverviewCards({
      total_items: sampleInventory.length,
      critical_count: sampleInventory.filter(item => item.current_quantity <= 0).length,
      low_stock_count: sampleInventory.filter(item => item.current_quantity > 0 && item.current_quantity <= item.minimum_quantity).length,
      warning_count: sampleInventory.filter(item => item.current_quantity > item.minimum_quantity && item.current_quantity <= item.minimum_quantity * 1.5).length
    });

    this.renderInventoryTable();
    console.log('Sample data loaded and table rendered');
  }

  updateOverviewCards(summaryData) {
    // Update overview cards with real data
    if (summaryData.total_items !== undefined) {
      document.getElementById('total-items').textContent = summaryData.total_items;
    }
    if (summaryData.critical_count !== undefined) {
      document.getElementById('critical-items').textContent = summaryData.critical_count;
    }
    if (summaryData.low_stock_count !== undefined) {
      document.getElementById('low-stock-items').textContent = summaryData.low_stock_count;
    }
    if (summaryData.warning_count !== undefined) {
      document.getElementById('warning-items').textContent = summaryData.warning_count;
    }
  }

  handleSearch(searchTerm) {
    if (!searchTerm.trim()) {
      this.filteredInventory = [...this.inventory];
    } else {
      this.filteredInventory = this.inventory.filter(item => 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    this.currentPage = 1;
    this.renderInventoryTable();
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

    if (pageData.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem;">
            No inventory items found
          </td>
        </tr>
      `;
      const tableInfo = document.getElementById('table-info');
      if (tableInfo) {
        tableInfo.textContent = 'Showing 0 of 0 entries';
      }
    } else {
      pageData.forEach((item, index) => {
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
      <td>${this.capitalizeFirst(item.category)}</td>
      <td>${item.current_quantity.toFixed(2)}</td>
      <td>${this.capitalizeFirst(item.unit)}</td>
      <td>${item.minimum_quantity.toFixed(2)}</td>
      <td>
        <span class="status-label ${status.class}">${status.text}</span>
      </td>
      <td>
        <div class="action-buttons">
          <button class="btn-edit" onclick="inventoryManager.editItem(${item.id})" title="Edit">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn-delete" onclick="inventoryManager.deleteItem(${item.id}, '${item.name}')" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    
    return row;
  }

  getStockStatus(item) {
    if (item.current_quantity <= 0) {
      return { class: 'status-badge status-out-of-stock', text: 'Out of Stock' };
    } else if (item.current_quantity <= item.minimum_quantity) {
      return { class: 'status-badge status-low-stock', text: 'Low Stock' };
    } else if (item.current_quantity <= item.minimum_quantity * 1.5) {
      return { class: 'status-badge status-warning', text: 'Warning' };
    } else {
      return { class: 'status-badge status-in-stock', text: 'In Stock' };
    }
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

    // Update prev/next buttons
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

  applyStockFilter() {
    const statusFilter = document.getElementById('status-filter');
    const quantityMin = document.getElementById('quantity-min');
    const quantityMax = document.getElementById('quantity-max');

    if (!statusFilter || !quantityMin || !quantityMax) {
      console.warn("Filter elements not found in DOM");
      return;
    }

    const statusValue = statusFilter.value;
    const minValue = parseFloat(quantityMin.value) || 0;
    const maxValue = parseFloat(quantityMax.value) || Infinity;

    this.filteredInventory = this.inventory.filter(item => {
      const statusMatch = !statusValue ||
        (statusValue === 'Yes' && item.current_quantity > item.minimum_quantity) ||
        (statusValue === 'No' && item.current_quantity <= item.minimum_quantity);
      const quantityMatch = item.current_quantity >= minValue && item.current_quantity <= maxValue;
      return statusMatch && quantityMatch;
    });

    this.currentPage = 1;
    this.renderInventoryTable();
    this.toggleFilterStock();
  }

  clearStockFilter() {
    const statusFilter = document.getElementById('status-filter');
    const quantityMin = document.getElementById('quantity-min');
    const quantityMax = document.getElementById('quantity-max');

    if (statusFilter) statusFilter.value = '';
    if (quantityMin) quantityMin.value = '';
    if (quantityMax) quantityMax.value = '';

    this.filteredInventory = [...this.inventory];
    this.currentPage = 1;
    this.renderInventoryTable();
    this.toggleFilterStock();
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

    this.showModal('item-modal');
  }

  deleteItem(itemId, itemName) {
    this.editingItem = { id: itemId, name: itemName };
    const deleteItemName = document.getElementById('delete-item-name');
    if (deleteItemName) deleteItemName.textContent = itemName;
    this.showModal('delete-modal');
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
      category: formData.get('category'),
      unit: formData.get('unit'),
      current_quantity: parseFloat(formData.get('current_quantity')),
      minimum_quantity: parseFloat(formData.get('minimum_quantity'))
    };

    try {
      let response;
      if (this.editingItem) {
        // Update existing item
        itemData.id = this.editingItem.id;
        response = await fetch('/inventory/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(itemData)
        });
      } else {
        // Add new item
        response = await fetch('/inventory/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(itemData)
        });
      }

      if (response.ok) {
        this.showSuccess(this.editingItem ? 'Item updated successfully' : 'Item added successfully');
        this.closeModal('item-modal');
        this.loadInventoryData(); // Reload data
      } else {
        const errorData = await response.json();
        this.showError(errorData.error || 'Failed to save item');
      }
    } catch (error) {
      console.error('Error saving item:', error);
      // Fallback: add to local sample data for demonstration
      this.handleLocalFormSubmission(itemData);
    }
  }

  handleLocalFormSubmission(itemData) {
    if (this.editingItem) {
      // Update existing item in local data
      const index = this.inventory.findIndex(item => item.id === this.editingItem.id);
      if (index !== -1) {
        this.inventory[index] = { ...this.inventory[index], ...itemData };
        this.showSuccess('Item updated successfully (local demo)');
      }
    } else {
      // Add new item to local data
      const newId = Math.max(...this.inventory.map(item => item.id), 0) + 1;
      const newItem = { ...itemData, id: newId };
      this.inventory.push(newItem);
      this.showSuccess('Item added successfully (local demo)');
    }

    this.filteredInventory = [...this.inventory];
    this.renderInventoryTable();
    this.updateOverviewCards({
      total_items: this.inventory.length,
      critical_count: this.inventory.filter(item => item.current_quantity <= 0).length,
      low_stock_count: this.inventory.filter(item => item.current_quantity > 0 && item.current_quantity <= item.minimum_quantity).length,
      warning_count: this.inventory.filter(item => item.current_quantity > item.minimum_quantity && item.current_quantity <= item.minimum_quantity * 1.5).length
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
        this.loadInventoryData(); // Reload data
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

      this.filteredInventory = [...this.inventory];
      this.renderInventoryTable();
      this.updateOverviewCards({
        total_items: this.inventory.length,
        critical_count: this.inventory.filter(item => item.current_quantity <= 0).length,
        low_stock_count: this.inventory.filter(item => item.current_quantity > 0 && item.current_quantity <= item.minimum_quantity).length,
        warning_count: this.inventory.filter(item => item.current_quantity > item.minimum_quantity && item.current_quantity <= item.minimum_quantity * 1.5).length
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

  async handleAddStockSubmit() {
    // const formData = new FormData(document.getElementById('add-stock-form'));const addStockForm = document.getElementById('add-stock-form');
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
        this.loadInventoryData();
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

  // Bulk Stock Modal Methods
  openBulkStockModal() {
    this.populateBulkIngredientSelect();
    this.showModal('bulk-stock-modal');
  }

  populateBulkIngredientSelect() {
    const selects = document.querySelectorAll('#bulk-stock-items select[name="ingredient_id[]"]');
    if (selects.length === 0) {
      console.warn("Bulk stock select elements not found in DOM");
    }
    selects.forEach(select => {
      select.innerHTML = '<option value="">Select Ingredient</option>';
      this.inventory.forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.name} (${item.current_quantity.toFixed(2)} ${item.unit})`;
        select.appendChild(option);
      });
    });
  }

  addBulkItem() {
    const container = document.getElementById('bulk-stock-items');
    // if (!container) {
    //   console.warn("Bulk stock items container not found in DOM");
    //   return;
    // }
    addStockForm.reset();
    const newItem = document.createElement('div');
    newItem.className = 'bulk-stock-item';
    newItem.innerHTML = `
      <select name="ingredient_id[]" required>
        <option value="">Select Ingredient</option>
      </select>
      <input type="number" name="quantity[]" placeholder="Qty" min="0" step="0.01" required>
      <button type="button" class="remove-bulk-item-btn" onclick="inventoryManager.removeBulkItem(this)">
        <i class="fas fa-minus"></i>
      </button>
    `;
    
    container.appendChild(newItem);
    this.populateBulkIngredientSelect();
  }

  removeBulkItem(button) {
    button.parentElement.remove();
  }

  async handleBulkStockSubmit() {
    // const formData = new FormData(document.getElementById('bulk-stock-form'));
    const bulkStockForm = document.getElementById('bulk-stock-form');
    if (!bulkStockForm) {
      console.warn("Bulk stock form not found in DOM");
      return;
    }

    const formData = new FormData(bulkStockForm);
    const ingredientIds = formData.getAll('ingredient_id[]');
    const quantities = formData.getAll('quantity[]');
    const notes = formData.get('notes') || '';

    const stockItems = ingredientIds.map((id, index) => ({
      ingredient_id: parseInt(id),
      quantity: parseFloat(quantities[index])
    }));

    const bulkData = {
      stock_items: stockItems,
      notes: notes
    };

    try {
      const response = await fetch('/inventory/stock/bulk_add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bulkData)
      });

      if (response.ok) {
        this.showSuccess('Bulk stock added successfully');
        this.closeModal('bulk-stock-modal');
        this.loadInventoryData();
        // document.getElementById('bulk-stock-form').reset();
        // Reset bulk items to single item
        bulkStockForm.reset();
        document.getElementById('bulk-stock-items').innerHTML = `
          <div class="bulk-stock-item">
            <select name="ingredient_id[]" required>
              <option value="">Select Ingredient</option>
            </select>
            <input type="number" name="quantity[]" placeholder="Qty" min="0" step="0.01" required>
            <button type="button" class="remove-bulk-item-btn" onclick="inventoryManager.removeBulkItem(this)">
              <i class="fas fa-minus"></i>
            </button>
          </div>
        `;
      } else {
        const errorData = await response.json();
        this.showError(errorData.error || 'Failed to add bulk stock');
      }
    } catch (error) {
      console.error('Error adding bulk stock:', error);
      this.showError('Failed to add bulk stock');
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
}

// Global functions for onclick handlers
window.removeBulkItem = function(button) {
  if (window.inventoryManager) {
    window.inventoryManager.removeBulkItem(button);
  }
};

// Initialize the inventory manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('Initializing InventoryManager...');
  window.inventoryManager = new InventoryManager();
});