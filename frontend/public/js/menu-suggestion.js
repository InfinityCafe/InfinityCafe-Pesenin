// Global variables
let suggestions = [];
let filteredSuggestions = [];
let currentPage = 1;
let pageSize = 10;
let totalPages = 1;

// Initialize page
document.addEventListener('DOMContentLoaded', function() {
  initializePage();
  setupEventListeners();
});

function initializePage() {
  loadSuggestions();
  updateStats();
}

function setupEventListeners() {
  // Search functionality
  const searchInput = document.getElementById('search-suggestions');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      applySuggestionFilter();
    });
  }

  // Close filter dropdown when clicking outside
  document.addEventListener('click', function(event) {
    const filterDropdown = document.getElementById('suggestion-filter-dropdown');
    if (filterDropdown && !event.target.closest('.filter-container')) {
      filterDropdown.classList.remove('show');
    }
  });
}

// Load suggestions from API
async function loadSuggestions() {
  showLoading(true);
  try {
    const response = await fetch('/menu_suggestion');
    if (!response.ok) {
      throw new Error('Failed to fetch suggestions');
    }
    
    const data = await response.json();
    if (data.status === 'success') {
      suggestions = data.data || [];
      filteredSuggestions = [...suggestions];
      applySuggestionFilter(); // Apply default filter (newest)
      updateStats();
    } else {
      throw new Error(data.message || 'Failed to load suggestions');
    }
  } catch (error) {
    console.error('Error loading suggestions:', error);
    showErrorModal('Gagal memuat usulan menu: ' + error.message);
  } finally {
    showLoading(false);
  }
}

// Toggle filter dropdown
function toggleSuggestionFilter() {
  const dropdown = document.getElementById('suggestion-filter-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('show');
  }
}

// Apply suggestion filter
function applySuggestionFilter() {
  const searchTerm = document.getElementById('search-suggestions')?.value.toLowerCase() || '';
  const sortFilter = document.getElementById('suggestion-sort-filter')?.value || 'newest';
  const dateMin = document.getElementById('suggestion-date-min')?.value;
  const dateMax = document.getElementById('suggestion-date-max')?.value;

  filteredSuggestions = suggestions.filter(suggestion => {
    // Search filter
    const matchesSearch = suggestion.menu_name.toLowerCase().includes(searchTerm) ||
                         suggestion.customer_name.toLowerCase().includes(searchTerm);

    // Date range filter
    let matchesDate = true;
    if (dateMin || dateMax) {
      const suggestionDate = new Date(suggestion.timestamp);
      const startDate = dateMin ? new Date(dateMin) : null;
      const endDate = dateMax ? new Date(dateMax) : null;
      if (startDate) startDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(23, 59, 59, 999);
      matchesDate = (!startDate || suggestionDate >= startDate) &&
                    (!endDate || suggestionDate <= endDate);
    }

    return matchesSearch && matchesDate;
  });

  // Apply sorting
  sortSuggestions(sortFilter);

  currentPage = 1; // Reset to first page
  renderSuggestions();

  // Close dropdown
  const filterDropdown = document.getElementById('suggestion-filter-dropdown');
  if (filterDropdown) {
    filterDropdown.classList.remove('show');
  }
}

// Clear suggestion filter
function clearSuggestionFilter() {
  const searchInput = document.getElementById('search-suggestions');
  const sortFilter = document.getElementById('suggestion-sort-filter');
  const dateMin = document.getElementById('suggestion-date-min');
  const dateMax = document.getElementById('suggestion-date-max');

  if (searchInput) searchInput.value = '';
  if (sortFilter) sortFilter.value = 'newest';
  if (dateMin) dateMin.value = '';
  if (dateMax) dateMax.value = '';

  filteredSuggestions = [...suggestions];
  sortSuggestions('newest'); // Default sort by newest
  currentPage = 1; // Reset to first page
  renderSuggestions();

  // Close dropdown
  const filterDropdown = document.getElementById('suggestion-filter-dropdown');
  if (filterDropdown) {
    filterDropdown.classList.remove('show');
  }
}

// Filter suggestions based on search query and date range
function filterSuggestions(query) {
  // This function is replaced by applySuggestionFilter, but kept for compatibility
  applySuggestionFilter();
}

// Sort suggestions
function sortSuggestions(sortType) {
  switch (sortType) {
    case 'newest':
      filteredSuggestions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      break;
    case 'oldest':
      filteredSuggestions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      break;
    case 'popular':
      // Sort by number of similar menu_name occurrences
      const menuCounts = {};
      suggestions.forEach(suggestion => {
        menuCounts[suggestion.menu_name] = (menuCounts[suggestion.menu_name] || 0) + 1;
      });
      filteredSuggestions.sort((a, b) => {
        const countA = menuCounts[a.menu_name] || 1;
        const countB = menuCounts[b.menu_name] || 1;
        return countB - countA || new Date(b.timestamp) - new Date(a.timestamp); // Fallback to newest
      });
      break;
  }
  currentPage = 1; // Reset to first page
  renderSuggestions();
}

// Render suggestions list
function renderSuggestions() {
  const tbody = document.getElementById('suggestions-tbody');
  const noData = document.getElementById('no-suggestions');
  
  if (!tbody) return;
  
  if (filteredSuggestions.length === 0) {
    tbody.innerHTML = '';
    if (noData) noData.classList.remove('hidden');
    return;
  }
  
  if (noData) noData.classList.add('hidden');
  
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredSuggestions.length);
  const pageData = filteredSuggestions.slice(startIndex, endIndex);
  
  const suggestionsHtml = pageData.map((suggestion, index) => {
    const timestamp = new Date(suggestion.timestamp || Date.now());
    const formattedDate = timestamp.toLocaleDateString('id-ID', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const rowNumber = startIndex + index + 1; // Nomor berurutan
    
    return `
      <tr data-index="${startIndex + index}">
        <td>${rowNumber}</td>
        <td>${suggestion.menu_name}</td>
        <td>${suggestion.customer_name}</td>
        <td>${formattedDate}</td>
        <td>
          <button class="table-action-btn" onclick="viewSuggestionDetail(${startIndex + index})" title="Lihat Detail">
            <i class="fas fa-eye"></i>
          </button>
          <button class="table-action-btn" onclick="approveSuggestion('${suggestion.usulan_id}')" title="Setujui">
            <i class="fas fa-check"></i>
          </button>
          <button class="table-action-btn" onclick="rejectSuggestion('${suggestion.usulan_id}')" title="Tolak">
            <i class="fas fa-times"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
  
  tbody.innerHTML = suggestionsHtml;
  updatePagination();
}

// Update statistics
function updateStats() {
  const totalEl = document.getElementById('total-suggestions');
  const todayEl = document.getElementById('today-suggestions');
  const popularEl = document.getElementById('popular-suggestions');
  
  if (totalEl) totalEl.textContent = suggestions.length;
  
  if (todayEl) {
    const today = new Date();
    const todaySuggestions = suggestions.filter(suggestion => {
      const suggestionDate = new Date(suggestion.timestamp);
      return suggestionDate.toDateString() === today.toDateString();
    });
    todayEl.textContent = todaySuggestions.length;
  }
  
  if (popularEl) {
    // For now, show count of suggestions with more than 1 occurrence
    const menuCounts = {};
    suggestions.forEach(suggestion => {
      menuCounts[suggestion.menu_name] = (menuCounts[suggestion.menu_name] || 0) + 1;
    });
    const popularCount = Object.values(menuCounts).filter(count => count > 1).length;
    popularEl.textContent = popularCount;
  }
}

// Modal functions
function openSuggestionModal() {
  const modal = document.getElementById('suggestion-modal');
  if (modal) {
    modal.classList.remove('hidden');
    // Reset form
    document.getElementById('suggestion-form').reset();
  }
}

function closeSuggestionModal() {
  const modal = document.getElementById('suggestion-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}



// Submit suggestion
async function submitSuggestion() {
  const form = document.getElementById('suggestion-form');
  const formData = new FormData(form);
  
  const menuName = formData.get('menu_name')?.trim();
  const customerName = formData.get('customer_name')?.trim();
  const description = formData.get('description')?.trim();
  
  if (!menuName || !customerName) {
    showErrorModal('Nama menu dan nama customer harus diisi');
    return;
  }
  
  try {
    const response = await fetch('/menu_suggestion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        menu_name: menuName,
        customer_name: customerName,
        description: description || null
      })
    });
    
    const result = await response.json();
    
    if (result.status === 'success') {
      closeSuggestionModal();
      showSuccessModal('Usulan menu berhasil dikirim!');
      // Reload suggestions
      loadSuggestions();
    } else if (result.status === 'duplicate') {
      showErrorModal('Menu ini sudah ada atau sudah diusulkan sebelumnya');
    } else {
      showErrorModal('Gagal mengirim usulan menu');
    }
  } catch (error) {
    console.error('Error submitting suggestion:', error);
    showErrorModal('Gagal mengirim usulan menu. Silakan coba lagi.');
  }
}

// View suggestion detail
function viewSuggestionDetail(index) {
  const suggestion = filteredSuggestions[index];
  if (!suggestion) return;

  const timestamp = new Date(suggestion.timestamp || Date.now());
  const formattedDate = timestamp.toLocaleDateString('id-ID', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const modal = document.getElementById('view-suggestion-modal');
  if (!modal) return;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '-';
  };

  setText('view-menu-name', suggestion.menu_name);
  setText('view-customer-name', suggestion.customer_name);
  setText('view-timestamp', formattedDate);
  setText('view-usulan-id', suggestion.usulan_id);
  const descEl = document.getElementById('view-description');
  if (descEl) descEl.textContent = suggestion.description || 'Tidak ada deskripsi';

  modal.classList.remove('hidden');
}

function closeViewSuggestionModal() {
  const modal = document.getElementById('view-suggestion-modal');
  if (modal) modal.classList.add('hidden');
}

function approveSuggestionFromView() {
  const idEl = document.getElementById('view-usulan-id');
  if (!idEl) return;
  approveSuggestion(idEl.textContent);
}

// Approve suggestion (placeholder function)
function approveSuggestion(usulanId) {
  if (confirm('Apakah Anda yakin ingin menyetujui usulan menu ini?')) {
    // TODO: Implement approval logic
    alert('Fitur persetujuan usulan menu akan segera tersedia');
  }
}

// Reject suggestion (placeholder function)
function rejectSuggestion(usulanId) {
  if (confirm('Apakah Anda yakin ingin menolak usulan menu ini?')) {
    // TODO: Implement rejection logic
    alert('Fitur penolakan usulan menu akan segera tersedia');
  }
}

// Utility functions
function showLoading(show) {
  const loading = document.getElementById('loading-suggestions');
  if (loading) {
    loading.classList.toggle('hidden', !show);
  }
}



function refreshSuggestions() {
  loadSuggestions();
}

// Close modals when clicking outside
document.addEventListener('click', function(event) {
  if (event.target.classList.contains('modal')) {
    event.target.classList.add('hidden');
  }
});

// Close modals with Escape key
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    document.querySelectorAll('.modal').forEach(modal => {
      modal.classList.add('hidden');
    });
  }
});

// Pagination functions
function updatePagination() {
  totalPages = Math.ceil(filteredSuggestions.length / pageSize);
  currentPage = Math.min(currentPage, totalPages);
  if (currentPage < 1) currentPage = 1;
  
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredSuggestions.length);
  
  // Update pagination info
  const paginationInfo = document.getElementById('pagination-info');
  if (paginationInfo) {
    paginationInfo.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${filteredSuggestions.length} entries`;
  }
  
  // Update pagination controls
  updatePaginationControls();
  
  // Render current page data
  renderCurrentPage();
}

function updatePaginationControls() {
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  const pageNumbers = document.getElementById('page-numbers');
  
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  
  if (pageNumbers) {
    pageNumbers.innerHTML = generatePageNumbers();
  }
}

function generatePageNumbers() {
  const pages = [];
  const maxVisiblePages = 5;
  
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }
  
  // Add first page if not visible
  if (startPage > 1) {
    pages.push(`<button class="page-number" onclick="goToPage(1)">1</button>`);
    if (startPage > 2) {
      pages.push(`<span class="page-ellipsis">...</span>`);
    }
  }
  
  // Add visible pages
  for (let i = startPage; i <= endPage; i++) {
    const activeClass = i === currentPage ? 'active' : '';
    pages.push(`<button class="page-number ${activeClass}" onclick="goToPage(${i})">${i}</button>`);
  }
  
  // Add last page if not visible
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      pages.push(`<span class="page-ellipsis">...</span>`);
    }
    pages.push(`<button class="page-number" onclick="goToPage(${totalPages})">${totalPages}</button>`);
  }
  
  return pages.join('');
}

function renderCurrentPage() {
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredSuggestions.length);
  const pageData = filteredSuggestions.slice(startIndex, endIndex);
  
  const tbody = document.getElementById('suggestions-tbody');
  if (!tbody) return;
  
  const suggestionsHtml = pageData.map((suggestion, index) => {
    const timestamp = new Date(suggestion.timestamp || Date.now());
    const formattedDate = timestamp.toLocaleDateString('id-ID', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const rowNumber = startIndex + index + 1; // Nomor berurutan
    
    return `
      <tr data-index="${startIndex + index}">
        <td>${rowNumber}</td>
        <td>${suggestion.menu_name}</td>
        <td>${suggestion.customer_name}</td>
        <td>${formattedDate}</td>
        <td>
          <button class="table-action-btn" onclick="viewSuggestionDetail(${startIndex + index})" title="Lihat Detail">
            <i class="fas fa-eye"></i>
          </button>

        </td>
      </tr>
    `;
  }).join('');
  
  tbody.innerHTML = suggestionsHtml;
}

function changePage(direction) {
  const newPage = currentPage + direction;
  if (newPage >= 1 && newPage <= totalPages) {
    currentPage = newPage;
    updatePagination();
  }
}

function goToPage(page) {
  if (page >= 1 && page <= totalPages) {
    currentPage = page;
    updatePagination();
  }
}

function changePageSize() {
  const pageSizeSelect = document.getElementById('page-size');
  if (pageSizeSelect) {
    pageSize = parseInt(pageSizeSelect.value);
    currentPage = 1; // Reset to first page
    updatePagination();
  }
}

// Navigation function for menu and flavors tabs
function navigateToMenuTab(tab) {
  const token = localStorage.getItem('access_token');
  if (token) {
    // Create a temporary token for this session
    const tempToken = btoa(token).substring(0, 20) + Date.now();
    sessionStorage.setItem('temp_token', token);
    sessionStorage.setItem('temp_token_id', tempToken);
    
    // Navigate with temporary token that will be immediately removed
    window.location.href = `/menu-management?temp=${tempToken}#${tab}`;
  } else {
    window.location.href = '/login';
  }
}