const ADMIN_TOKEN_KEY = 'adminToken';
const TOKEN_KEY = 'token';
const USER_KEY = 'user';

const isAdminRequest = (url = '') => {
  const path = String(url).split('?')[0];
  return path === '/admin' ||
    path.startsWith('/admin/') ||
    (path.startsWith('/payment-settings') && path !== '/payment-settings/public');
};

const storedUser = (storage) => {
  try {
    return JSON.parse(storage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
};

export const getRequestToken = (url, storage = localStorage) => {
  if (isAdminRequest(url) && storedUser(storage)?.role === 'admin') {
    return storage.getItem(ADMIN_TOKEN_KEY);
  }
  return storage.getItem(TOKEN_KEY);
};

export const persistAuthSession = (data) => {
  const user = { _id: data._id, name: data.name, email: data.email, role: data.role };
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (data.role === 'admin') {
    localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
  } else {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
  return user;
};

export const clearAuthSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};
