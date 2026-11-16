import axios from 'axios';
import { getRequestToken } from './authToken';
import { getApiBaseUrl } from './apiBaseUrl';

const API_BASE_URL = getApiBaseUrl(import.meta.env.VITE_API_URL, import.meta.env.PROD);
const BACKEND_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to attach JWT token to headers if present
api.interceptors.request.use(
  (config) => {
    const token = getRequestToken(config.url);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for handling 401 unauthorized globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Optional: Handle token expiration
    }
    return Promise.reject(error);
  }
);

/**
 * Helper to resolve product image URLs
 * Supports both local `/uploads/...` paths served by Express and remote URLs (Unsplash, etc.)
 */
export const getProductImageUrl = (imagePath) => {
  if (!imagePath) return '/uploads/sample-product.svg';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath;
  }
  return `${BACKEND_BASE_URL}${imagePath.startsWith('/') ? '' : '/'}${imagePath}`;
};

export default api;

