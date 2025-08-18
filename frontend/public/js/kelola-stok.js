// Kelola Stok Page JavaScript

class InventoryManager {
  constructor() {
    this.inventory = [];
    this.filteredInventory = [];
    this.currentPage = 1;
    this.itemsPerPage = 10;
    this.editingItem = null;
    
    this.initializeEventListeners();
    this.loadInventoryData();
    this.updateGreetingDate();
  }

  initializeEventListeners() {
    // Add item button
    document.getElementById('add-item-btn').addEventListener('click', () => {
      this.openAddItemModal();
    });

    // Modal close buttons
    document.getElementById('close-modal').addEventListener('click', () => {
      this.closeModal('item-modal');
    });

    document.getElementById('close-delete-modal').addEventListener('click', () => {
      this.closeModal('delete-modal');
    });

    // Form submission
    document.getElementById('item-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleFormSubmit();
    });

    // Cancel buttons
    document.getElementById('cancel-btn').addEventListener('click', () => {
      this.closeModal('item-modal');
    });

    document.getElementById('cancel-delete-btn').addEventListener('click', () => {
      this.closeModal('delete-modal');
    });

    // Search functionality
    document.getElementById('search-input').addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
    });

    // Entries per page
    document.getElementById('entries-per-page').addEventListener('change', (e) => {
      this.itemsPerPage = parseInt(e.target.value);
      this.currentPage = 1;
      this.renderInventoryTable();
    });

    // Delete confirmation
    document.getElementById('confirm-delete-btn').addEventListener('click', () => {
      this.confirmDelete();
    });

    // Kitchen toggle switch
    const kitchenToggle = document.getElementById('kitchen-toggle');
    if (kitchenToggle) {
      kitchenToggle.addEventListener('change', (e) => {
        this.handleKitchenToggle(e.target.checked);
      });
    }

    // Add stock button
    document.getElementById('add-stock-btn').addEventListener('click', () => {
      this.openAddStockModal();
    });

    // Bulk stock button
    document.getElementById('bulk-stock-btn').addEventListener('click', () => {
      this.openBulkStockModal();
    });

    // Consumption log button
    document.getElementById('consumption-log-btn').addEventListener('click', () => {
      this.openConsumptionLogModal();
    });

    // Add stock form
    document.getElementById('add-stock-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAddStockSubmit();
    });

    // Bulk stock form
    document.getElementById('bulk-stock-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleBulkStockSubmit();
    });

    // Modal close buttons
    document.getElementById('close-add-stock-modal').addEventListener('click', () => {
      this.closeModal('add-stock-modal');
    });

    document.getElementById('close-bulk-stock-modal').addEventListener('click', () => {
      this.closeModal('bulk-stock-modal');
    });

    document.getElementById('close-consumption-log-modal').addEventListener('click', () => {
      this.closeModal('consumption-log-modal');
    });

    // Cancel buttons
    document.getElementById('cancel-add-stock-btn').addEventListener('click', () => {
      this.closeModal('add-stock-modal');
    });

    document.getElementById('cancel-bulk-stock-btn').addEventListener('click', () => {
      this.closeModal('bulk-stock-modal');
    });

    // Add bulk item button
    document.getElementById('add-bulk-item-btn').addEventListener('click', () => {
      this.addBulkItem();
    });

    // Refresh logs button
    document.getElementById('refresh-logs-btn').addEventListener('click', () => {
      this.loadConsumptionLogs();
    });

    // Log search
    document.getElementById('log-search').addEventListener('input', (e) => {
      this.filterConsumptionLogs(e.target.value);
    });
  }

  updateGreetingDate() {
    const now = new Date();
    const options = { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    };
    const formattedDate = now.toLocaleDateString('en-US', options);
    document.getElementById('greeting-date').textContent = formattedDate;
  }

  async loadInventoryData() {
    try {
      // Load inventory summary
      const summaryResponse = await fetch('/inventory/summary');
      const summaryData = await summaryResponse.json();
      
      if (summaryResponse.ok) {
        this.updateOverviewCards(summaryData);
      } else {
        // Fallback to sample data if API fails
        this.loadSampleData();
      }

      // Load inventory list
      const listResponse = await fetch('/inventory/list');
      const listData = await listResponse.json();
      
      if (listResponse.ok) {
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
      return;
    }

    pageData.forEach((item, index) => {
      const row = this.createTableRow(item, startIndex + index + 1);
      tbody.appendChild(row);
    });

    this.updatePagination();
  }

  createTableRow(item, rowNumber) {
    const row = document.createElement('tr');
    const status = this.getStockStatus(item);
    
    row.innerHTML = `
      <td>${rowNumber}</td>
      <td>${item.name}</td>
      <td>${this.capitalizeFirst(item.category)}</td>
      <td>${item.current_quantity}</td>
      <td>${item.minimum_quantity}</td>
      <td>${this.capitalizeFirst(item.unit)}</td>
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
      return { class: 'status-out-of-stock', text: 'Out of Stock' };
    } else if (item.current_quantity <= item.minimum_quantity) {
      return { class: 'status-low-stock', text: 'Low Stock' };
    } else if (item.current_quantity <= item.minimum_quantity * 1.5) {
      return { class: 'status-warning', text: 'Warning' };
    } else {
      return { class: 'status-in-stock', text: 'In Stock' };
    }
  }

  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  updatePagination() {
    const totalPages = Math.ceil(this.filteredInventory.length / this.itemsPerPage);
    const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
    const endItem = Math.min(this.currentPage * this.itemsPerPage, this.filteredInventory.length);
    
    // Update pagination info
    const paginationInfo = document.querySelector('.pagination-info');
    paginationInfo.innerHTML = `
      <span>Showing ${startItem} to ${endItem} of ${this.filteredInventory.length} entries</span>
      <span>Page ${this.currentPage} of ${totalPages}</span>
    `;

    // Update page numbers
    const pageNumbers = document.querySelector('.page-numbers');
    pageNumbers.innerHTML = '';

    // Previous button
    if (this.currentPage > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'page-btn';
      prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
      prevBtn.onclick = () => this.goToPage(this.currentPage - 1);
      pageNumbers.appendChild(prevBtn);
    }

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= this.currentPage - 1 && i <= this.currentPage + 1)) {
        const pageBtn = document.createElement('button');
        pageBtn.className = `page-btn ${i === this.currentPage ? 'active' : ''}`;
        pageBtn.textContent = i;
        pageBtn.onclick = () => this.goToPage(i);
        pageNumbers.appendChild(pageBtn);
      } else if (i === this.currentPage - 2 || i === this.currentPage + 2) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.padding = '0.5rem';
        ellipsis.style.color = '#8D7272';
        pageNumbers.appendChild(ellipsis);
      }
    }

    // Next button
    if (this.currentPage < totalPages) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'page-btn next-page';
      nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
      nextBtn.onclick = () => this.goToPage(this.currentPage + 1);
      pageNumbers.appendChild(nextBtn);
    }
  }

  goToPage(page) {
    this.currentPage = page;
    this.renderInventoryTable();
  }

  openAddItemModal() {
    this.editingItem = null;
    document.getElementById('modal-title').textContent = 'Add New Item';
    document.getElementById('item-form').reset();
    this.showModal('item-modal');
  }

  editItem(itemId) {
    const item = this.inventory.find(i => i.id === itemId);
    if (!item) return;

    this.editingItem = item;
    document.getElementById('modal-title').textContent = 'Edit Item';
    
    // Populate form fields
    document.getElementById('item-name').value = item.name;
    document.getElementById('item-category').value = item.category;
    document.getElementById('item-unit').value = item.unit;
    document.getElementById('item-current').value = item.current_quantity;
    document.getElementById('item-minimum').value = item.minimum_quantity;
    
    this.showModal('item-modal');
  }

  deleteItem(itemId, itemName) {
    this.editingItem = { id: itemId, name: itemName };
    document.getElementById('delete-item-name').textContent = itemName;
    this.showModal('delete-modal');
  }

  async handleFormSubmit() {
    const formData = new FormData(document.getElementById('item-form'));
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
    document.getElementById(modalId).classList.remove('hidden');
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
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
    select.innerHTML = '<option value="">Select Ingredient</option>';
    
    this.inventory.forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.name} (${item.current_quantity} ${item.unit})`;
      select.appendChild(option);
    });
  }

  async handleAddStockSubmit() {
    const formData = new FormData(document.getElementById('add-stock-form'));
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
    selects.forEach(select => {
      select.innerHTML = '<option value="">Select Ingredient</option>';
      this.inventory.forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.name} (${item.current_quantity} ${item.unit})`;
        select.appendChild(option);
      });
    });
  }

  addBulkItem() {
    const container = document.getElementById('bulk-stock-items');
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
    const formData = new FormData(document.getElementById('bulk-stock-form'));
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
        document.getElementById('bulk-stock-form').reset();
        // Reset bulk items to single item
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
      }
    } catch (error) {
      console.error('Error loading consumption logs:', error);
      this.showError('Failed to load consumption logs');
    }
  }

  renderConsumptionLogs(logs) {
    const tbody = document.getElementById('consumption-log-tbody');
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
        <td>${new Date(log.created_at).toLocaleString()}</td>
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
let inventoryManager;
document.addEventListener('DOMContentLoaded', () => {
  inventoryManager = new InventoryManager();
});

// Global functions for onclick handlers
window.inventoryManager = null;
document.addEventListener('DOMContentLoaded', () => {
  window.inventoryManager = inventoryManager;
});
