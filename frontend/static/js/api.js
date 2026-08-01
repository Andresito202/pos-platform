const configuredApiBase = window.APP_CONFIG?.API_BASE_URL?.replace(/\/$/, '') || '';
const API_BASE = `${configuredApiBase}/api`;

function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function getUser() {
  const u = localStorage.getItem('user');
  return u ? JSON.parse(u) : null;
}

function setUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = '/login.html';
  }
}

async function api(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch {
    throw new Error('No se pudo conectar con el servicio. Intenta nuevamente en unos segundos.');
  }

  if (res.status === 401) {
    logout();
    return;
  }
  if (res.status === 204) return null;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new Error(getFriendlyError(res.status, data));
  }
  return data;
}

function getFriendlyError(status, data) {
  if (status === 400 || status === 422) {
    return typeof data?.detail === 'string'
      ? data.detail
      : 'Revisa la informacion ingresada e intenta nuevamente.';
  }
  if (status === 403) return 'No tienes permisos para realizar esta accion.';
  if (status === 404) return 'No se encontro el recurso solicitado.';
  if (status >= 500) return 'El servicio esta iniciando o no esta disponible. Intenta nuevamente en unos segundos.';
  return 'No fue posible completar la solicitud.';
}

async function apiGet(endpoint) {
  return api(endpoint);
}

async function apiPost(endpoint, body) {
  return api(endpoint, { method: 'POST', body: JSON.stringify(body) });
}

async function apiPut(endpoint, body) {
  return api(endpoint, { method: 'PUT', body: JSON.stringify(body) });
}

async function apiDelete(endpoint) {
  return api(endpoint, { method: 'DELETE' });
}

function showAlert(container, message, type = 'danger') {
  const allowedTypes = ['success', 'info', 'warning', 'danger'];
  const safeType = allowedTypes.includes(type) ? type : 'danger';
  container.replaceChildren();

  const alert = document.createElement('div');
  alert.className = `alert alert-${safeType} alert-dismissible fade show`;
  alert.setAttribute('role', 'alert');
  alert.textContent = message;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn-close';
  closeButton.setAttribute('data-bs-dismiss', 'alert');
  closeButton.setAttribute('aria-label', 'Cerrar');

  alert.appendChild(closeButton);
  container.appendChild(alert);
}

function formatMoney(val) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('es-CO');
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('es-CO');
}
