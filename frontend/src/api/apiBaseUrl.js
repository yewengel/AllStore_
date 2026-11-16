const LOCAL_API_URL = 'http://localhost:5000/api';
const PRODUCTION_API_URL = 'https://allstore-backend.onrender.com/api';

export const getApiBaseUrl = (configuredUrl, isProduction) => {
  const configured = typeof configuredUrl === 'string' ? configuredUrl.trim() : '';
  return (configured || (isProduction ? PRODUCTION_API_URL : LOCAL_API_URL)).replace(/\/+$/, '');
};
