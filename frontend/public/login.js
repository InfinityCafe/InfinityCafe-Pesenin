const form = document.getElementById('login-form');
const errorDiv = document.getElementById('login-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorDiv.style.display = 'none';
  const username = form.username.value.trim();
  const password = form.password.value;

  if (!username || !password) {
    errorDiv.textContent = 'Username dan password wajib diisi.';
    errorDiv.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      throw new Error('Gagal login.');
    }
    const data = await res.json();
    if (data.access_token) {
      localStorage.setItem('access_token', data.access_token);
      
      // Create a temporary token for secure navigation
      const tempToken = btoa(data.access_token).substring(0, 20) + Date.now();
      sessionStorage.setItem('temp_token', data.access_token);
      sessionStorage.setItem('temp_token_id', tempToken);
      
      // Navigate with temporary token that will be immediately removed
      window.location.href = `/dashboard?temp=${tempToken}`;
    } else {
      errorDiv.textContent = data.detail || 'Username atau password salah.';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    errorDiv.textContent = 'Gagal login. Pastikan username dan password benar.';
    errorDiv.style.display = 'block';
  }
});