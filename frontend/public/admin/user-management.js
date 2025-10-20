const BASE_URL = "";

// Global variables for pagination and filtering
let allUsers = [];
let filteredUsers = [];
let usersLoaded = false;
let userCurrentPage = 1;
let userPageSize = 10;
let userTotalPages = 1;
let adminPageInitialized = false;

function initializeAdminPage() {
    if (adminPageInitialized) {
        return;
    }
    if (window.currentUserRole !== 'admin') {
        console.warn('User Management is restricted to admin role.');
        return;
    }

    adminPageInitialized = true;

    const addUserForm = document.getElementById('add-user-form');
    const editUserForm = document.getElementById('edit-user-form');
    const changePasswordForm = document.getElementById('change-password-form');

    if (addUserForm) {
        addUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveUser();
        });
    }
    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveEditUser();
        });
    }
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await changePassword();
        });
    }

    setupSearch();
    loadUsers();
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.currentUserRole === 'admin') {
        initializeAdminPage();
    }
});

document.addEventListener('auth:role', (event) => {
    const role = event && event.detail ? event.detail.role : null;
    if (role === 'admin') {
        initializeAdminPage();
    }
});

async function loadUsers() {
    const token = localStorage.getItem('access_token');
    if (!token) {
        console.error("No token found, cannot fetch users.");
        logout();
        return;
    }

    try {
        const cb = Date.now();
        const response = await fetch(`${BASE_URL}/admin/users?cb=${cb}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            cache: 'no-store'
        });

        if (response.status === 401 || response.status === 403) {
            logout();
            return;
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        let users;
        try {
            const result = await response.json();
            if (result.status === 'success' && Array.isArray(result.data)) {
                users = result.data;
            } else {
                throw new Error(result.detail || 'Invalid data structure from API');
            }
        } catch (parseError) {
            throw new Error('Invalid JSON response from server');
        }

        allUsers = users.map(user => ({
            id: user.id,
            username: user.username,
            role: user.role,
            is_active: user.is_active
        }));
        filteredUsers = [...allUsers];
        usersLoaded = true;

        userCurrentPage = 1;
        await renderUserTable();
        updateUserPagination();

        return allUsers;
    } catch (error) {
        console.error('Error loading users:', error);
        const tbody = document.querySelector('#user-table tbody');
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Error loading users: ' + errorMessage + '</td></tr>';
        document.getElementById('offline-banner').classList.remove('hidden');
        throw error;
    }
}

async function renderUserTable() {
    const tbody = document.querySelector('#user-table tbody');
    tbody.innerHTML = '';

    if (!usersLoaded) {
        await loadUsers();
    }

    const startIndex = (userCurrentPage - 1) * userPageSize;
    const endIndex = startIndex + userPageSize;
    const currentPageData = filteredUsers.slice(startIndex, endIndex);

    if (currentPageData.length > 0) {
        currentPageData.forEach((user, index) => {
            const row = document.createElement('tr');
            const statusClass = user.is_active ? 'status-available' : 'status-unavailable';
            const statusText = user.is_active ? 'Active' : 'Inactive';
            const toggleActionText = user.is_active ? 'Disable' : 'Enable';
            const toggleIcon = user.is_active ? 'fa-toggle-on' : 'fa-toggle-off';

            row.innerHTML = `
                <td>${startIndex + index + 1}</td>
                <td>${user.username}</td>
                <td>${user.role.charAt(0).toUpperCase() + user.role.slice(1)}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td class="action-header">
                    <button class="table-action-btn" onclick="editUser('${user.username}')"><i class="fas fa-edit"></i></button>
                    <button class="table-action-btn" onclick="openChangePasswordModal('${user.username}')"><i class="fas fa-key"></i></button>
                    <button class="table-action-btn" onclick="confirmToggleUserStatus('${user.username}', ${user.is_active})"><i class="fas ${toggleIcon}"></i></button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1rem;">No users found</td></tr>';
    }

    updateUserTableInfo();
}

function updateUserPagination() {
    userTotalPages = Math.ceil(filteredUsers.length / userPageSize);
    if (userTotalPages === 0) userTotalPages = 1;

    if (userCurrentPage > userTotalPages) {
        userCurrentPage = userTotalPages;
    }

    renderUserPagination();
}

function renderUserPagination() {
    const pageNumbers = document.getElementById('user-page-numbers');
    const prevBtn = document.getElementById('user-prev-btn');
    const nextBtn = document.getElementById('user-next-btn');
    const paginationInfo = document.getElementById('user-pagination-info');

    paginationInfo.textContent = `Page ${userCurrentPage} of ${userTotalPages}`;
    prevBtn.disabled = userCurrentPage === 1;
    nextBtn.disabled = userCurrentPage === userTotalPages;

    pageNumbers.innerHTML = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, userCurrentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(userTotalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.className = `page-number ${i === userCurrentPage ? 'active' : ''}`;
        pageBtn.textContent = i;
        pageBtn.onclick = () => {
            userCurrentPage = i;
            renderUserTable();
            renderUserPagination();
        };
        pageNumbers.appendChild(pageBtn);
    }
}

function updateUserTableInfo() {
    const tableInfo = document.getElementById('user-table-info');
    const startIndex = (userCurrentPage - 1) * userPageSize + 1;
    const endIndex = Math.min(userCurrentPage * userPageSize, filteredUsers.length);
    const total = filteredUsers.length;

    tableInfo.textContent = `Showing ${startIndex} to ${endIndex} of ${total} entries`;
}

async function changeUserPage(direction) {
    const newPage = userCurrentPage + direction;
    if (newPage >= 1 && newPage <= userTotalPages) {
        userCurrentPage = newPage;
        await renderUserTable();
        renderUserPagination();
    }
}

async function changeUserPageSize() {
    userPageSize = parseInt(document.getElementById('user-page-size').value);
    userCurrentPage = 1;
    updateUserPagination();
    await renderUserTable();
}

function toggleFilterUser() {
    const dropdown = document.getElementById('user-filter-dropdown');
    dropdown.classList.toggle('show');
}

async function applyUserFilter() {
    const searchTerm = document.getElementById('user-search').value.toLowerCase();
    const roleFilter = document.getElementById('user-role-filter').value;
    const statusFilter = document.getElementById('user-status-filter').value;

    filteredUsers = allUsers.filter(user => {
        const matchesSearch = user.username.toLowerCase().includes(searchTerm);
        const matchesRole = !roleFilter || user.role === roleFilter;
        const matchesStatus = !statusFilter || String(user.is_active) === statusFilter;
        return matchesSearch && matchesRole && matchesStatus;
    });

    userCurrentPage = 1;
    updateUserPagination();
    await renderUserTable();

    document.getElementById('user-filter-dropdown').classList.remove('show');
}

function clearUserFilter() {
    document.getElementById('user-search').value = '';
    document.getElementById('user-role-filter').value = '';
    document.getElementById('user-status-filter').value = '';

    filteredUsers = [...allUsers];
    userCurrentPage = 1;
    updateUserPagination();
    renderUserTable();

    document.getElementById('user-filter-dropdown').classList.remove('show');
}

document.addEventListener('click', function(event) {
    const userFilterDropdown = document.getElementById('user-filter-dropdown');
    if (!event.target.closest('.filter-container')) {
        userFilterDropdown.classList.remove('show');
    }
});

async function saveUser() {
    const form = document.getElementById('add-user-form');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;

    if (!username || !password) {
        showErrorModal('Username and password cannot be empty.');
        return;
    }

    const data = {
        username: username,
        password: password,
        role: role
    };

    const token = localStorage.getItem('access_token');
    try {
        const response = await fetch(`${BASE_URL}/admin/create_user`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            let errorMessage = 'Failed to create user';
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorData.message || errorMessage;
            } catch (parseError) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();
        closeAddUserModal();
        await loadUsers();
        showSuccessModal(result.message || `User '${username}' created successfully.`);
    } catch (error) {
        console.error('Error creating user:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error creating user: ' + errorMessage);
    }
}

async function saveEditUser() {
    const originalUsername = document.getElementById('edit-original-username').value;
    const newUsername = document.getElementById('edit-new-username').value.trim();

    if (!originalUsername) {
        showErrorModal('Original username is missing.');
        return;
    }
    if (!newUsername) {
        showErrorModal('New username cannot be empty.');
        return;
    }
    if (newUsername === originalUsername) {
        showErrorModal('New username must be different from the current username.');
        return;
    }

    const token = localStorage.getItem('access_token');
    try {
        const response = await fetch(`${BASE_URL}/admin/change_password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                username: originalUsername,
                new_username: newUsername
            })
        });

        if (!response.ok) {
            let errorMessage = 'Failed to update username';
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorData.message || errorMessage;
            } catch (parseError) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();
        closeEditUserModal();
        await loadUsers();
        showSuccessModal(result.message || `Username updated to '${newUsername}'.`);
    } catch (error) {
        console.error('Error updating username:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error updating username: ' + errorMessage);
    }
}

async function editUser(username) {
    try {
        const user = allUsers.find(u => u.username === username);
        if (!user) {
            throw new Error('User not found');
        }

        document.getElementById('edit-original-username').value = user.username;
        document.getElementById('edit-current-username').textContent = user.username;
        document.getElementById('edit-new-username').value = '';

        document.getElementById('edit-user-modal').classList.remove('hidden');
    } catch (error) {
        console.error('Error loading user for edit:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error loading user for edit: ' + errorMessage);
    }
}

async function changePassword() {
    const form = document.getElementById('change-password-form');
    const username = document.getElementById('change-password-username').value;
    const newPassword = document.getElementById('new_password').value;

    if (!newPassword) {
        showErrorModal('New password cannot be empty.');
        return;
    }

    const data = {
        username: username,
        new_password: newPassword
    };

    const token = localStorage.getItem('access_token');
    try {
        const response = await fetch(`${BASE_URL}/admin/change_password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            let errorMessage = 'Failed to change password';
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorData.message || errorMessage;
            } catch (parseError) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();
        closeChangePasswordModal();
        showSuccessModal(result.message || `Password for '${username}' has been changed.`);
    } catch (error) {
        console.error('Error changing password:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error changing password: ' + errorMessage);
    }
}

async function toggleUserStatus(username, isActive) {
    const action = isActive ? 'disable' : 'enable';
    const token = localStorage.getItem('access_token');
    try {
        const response = await fetch(`${BASE_URL}/admin/status_user`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                username: username,
                disable: isActive
            })
        });

        if (!response.ok) {
            let errorMessage = 'Failed to update user status';
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorData.message || errorMessage;
            } catch (parseError) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();
        await loadUsers();
        showSuccessModal(result.message || `User '${username}' has been ${action}d.`);
    } catch (error) {
        console.error('Error toggling user status:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error toggling user status: ' + errorMessage);
    }
}

async function viewUser(userId) {
    try {
        const user = allUsers.find(u => u.id === userId);
        if (!user) {
            throw new Error('User not found');
        }

        document.getElementById('view-user-username').textContent = user.username;
        document.getElementById('view-user-role').textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
        document.getElementById('view-user-status').innerHTML = 
            `<span class="status-badge ${user.is_active ? 'status-available' : 'status-unavailable'}">
                ${user.is_active ? 'Active' : 'Inactive'}
            </span>`;

        document.getElementById('view-user-modal').setAttribute('data-user-id', userId);
        document.getElementById('view-user-modal').classList.remove('hidden');
    } catch (error) {
        console.error('Error viewing user:', error);
        const errorMessage = error && error.message ? error.message : 'Unknown error occurred';
        showErrorModal('Error loading user details: ' + errorMessage);
    }
}

function openAddUserModal() {
    document.getElementById('add-user-form').reset();
    document.getElementById('add-user-form-error').textContent = '';
    document.getElementById('add-user-modal').classList.remove('hidden');
}

function closeAddUserModal() {
    document.getElementById('add-user-form').reset();
    document.getElementById('add-user-form-error').textContent = '';
    document.getElementById('add-user-modal').classList.add('hidden');
}

function openEditUserModal() {
    document.getElementById('edit-user-modal').classList.remove('hidden');
}

function closeEditUserModal() {
    const form = document.getElementById('edit-user-form');
    form.reset();
    document.getElementById('edit-current-username').textContent = '';
    document.getElementById('edit-user-form-error').textContent = '';
    document.getElementById('edit-user-modal').classList.add('hidden');
}

function openChangePasswordModal(username) {
    document.getElementById('change-password-form').reset();
    document.getElementById('change-password-form-error').textContent = '';
    document.getElementById('change-password-username').value = username;
    document.getElementById('display-username').textContent = username;
    document.getElementById('change-password-modal').classList.remove('hidden');
}

function closeChangePasswordModal() {
    document.getElementById('change-password-form').reset();
    document.getElementById('change-password-form-error').textContent = '';
    document.getElementById('change-password-modal').classList.add('hidden');
}

function closeViewUserModal() {
    document.getElementById('view-user-modal').classList.add('hidden');
    document.getElementById('view-user-modal').removeAttribute('data-user-id');
}

function confirmToggleUserStatus(username, isActive) {
    const action = isActive ? 'disable' : 'enable';
    const confirmLabel = isActive ? 'Disable' : 'Enable';
    showUserConfirmModal(
        `Are you sure you want to ${action} the user '${username}'?`,
        () => {
            toggleUserStatus(username, isActive);
        },
        confirmLabel
    );
}

function setupSearch() {
    const userSearch = document.getElementById('user-search');
    if (userSearch) {
        userSearch.addEventListener('input', applyUserFilter);
    }
}