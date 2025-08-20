// Login guard
if (!localStorage.getItem('access_token')) {
  window.location.href = '/login';
}

// Global variables
let suggestions = [];
let filteredSuggestions = [];

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
      filterSuggestions(this.value);
    });
  }

  // Sort filter
  const sortFilter = document.getElementById('sort-filter');
  if (sortFilter) {
    sortFilter.addEventListener('change', function() {
      sortSuggestions(this.value);
    });
  }
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
      renderSuggestions();
      updateStats();
    } else {
      throw new Error(data.message || 'Failed to load suggestions');
    }
  } catch (error) {
    console.error('Error loading suggestions:', error);
    showError('Gagal memuat usulan menu: ' + error.message);
  } finally {
    showLoading(false);
  }
}

// Render suggestions list
function renderSuggestions() {
  const container = document.getElementById('suggestions-list');
  const noData = document.getElementById('no-suggestions');
  
  if (!container) return;
  
  if (filteredSuggestions.length === 0) {
    container.innerHTML = '';
    if (noData) noData.classList.remove('hidden');
    return;
  }
  
  if (noData) noData.classList.add('hidden');
  
  const suggestionsHtml = filteredSuggestions.map((suggestion, index) => {
    const timestamp = new Date(suggestion.timestamp || Date.now());
    const formattedDate = timestamp.toLocaleDateString('id-ID', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    return `
      <div class="suggestion-card" data-index="${index}">
        <div class="suggestion-header">
          <div class="suggestion-title">
            <h4>${suggestion.menu_name}</h4>
            <span class="suggestion-author">oleh ${suggestion.customer_name}</span>
          </div>
          <div class="suggestion-date">
            <i class="fas fa-clock"></i>
            ${formattedDate}
          </div>
        </div>
        <div class="suggestion-actions">
          <button class="btn btn-sm btn-outline-primary" onclick="viewSuggestionDetail(${index})">
            <i class="fas fa-eye"></i> Detail
          </button>
          <button class="btn btn-sm btn-outline-success" onclick="approveSuggestion('${suggestion.usulan_id}')">
            <i class="fas fa-check"></i> Setujui
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="rejectSuggestion('${suggestion.usulan_id}')">
            <i class="fas fa-times"></i> Tolak
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = suggestionsHtml;
}

// Filter suggestions based on search query
function filterSuggestions(query) {
  if (!query.trim()) {
    filteredSuggestions = [...suggestions];
  } else {
    const lowerQuery = query.toLowerCase();
    filteredSuggestions = suggestions.filter(suggestion => 
      suggestion.menu_name.toLowerCase().includes(lowerQuery) ||
      suggestion.customer_name.toLowerCase().includes(lowerQuery)
    );
  }
  renderSuggestions();
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
      // For now, sort by timestamp (newest first) since we don't have popularity data
      filteredSuggestions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      break;
  }
  renderSuggestions();
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

function closeSuccessModal() {
  const modal = document.getElementById('success-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function closeErrorModal() {
  const modal = document.getElementById('error-modal');
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
  
  if (!menuName || !customerName) {
    showError('Nama menu dan nama customer harus diisi');
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
        customer_name: customerName
      })
    });
    
    const result = await response.json();
    
    if (result.status === 'success') {
      closeSuggestionModal();
      showSuccess(result.message || 'Usulan menu berhasil dikirim!');
      // Reload suggestions
      loadSuggestions();
    } else if (result.status === 'duplicate') {
      showError(result.message || 'Menu ini sudah ada atau sudah diusulkan sebelumnya');
    } else {
      showError(result.message || 'Gagal mengirim usulan menu');
    }
  } catch (error) {
    console.error('Error submitting suggestion:', error);
    showError('Gagal mengirim usulan menu. Silakan coba lagi.');
  }
}

// View suggestion detail
function viewSuggestionDetail(index) {
  const suggestion = filteredSuggestions[index];
  if (!suggestion) return;
  
  // For now, just show an alert with details
  // In the future, this could open a detailed modal
  const timestamp = new Date(suggestion.timestamp);
  const formattedDate = timestamp.toLocaleDateString('id-ID', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  alert(`
Detail Usulan Menu:
Nama Menu: ${suggestion.menu_name}
Oleh: ${suggestion.customer_name}
Tanggal: ${formattedDate}
ID Usulan: ${suggestion.usulan_id}
  `);
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

function showSuccess(message) {
  const modal = document.getElementById('success-modal');
  const messageEl = document.getElementById('success-message');
  
  if (modal && messageEl) {
    messageEl.textContent = message;
    modal.classList.remove('hidden');
  }
}

function showError(message) {
  const modal = document.getElementById('error-modal');
  const messageEl = document.getElementById('error-message');
  
  if (modal && messageEl) {
    messageEl.textContent = message;
    modal.classList.remove('hidden');
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


