/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';
import { clearAuthSession, persistAuthSession } from '../api/authToken';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [loading, setLoading] = useState(true);

  // Restore authenticated session on load
  useEffect(() => {
    const restoreSession = async () => {
      const storedToken = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');

      if (storedToken && storedUser) {
        try {
          setUser(JSON.parse(storedUser));
          setToken(storedToken);
          // Verify with backend profile endpoint
          const { data } = await api.get('/auth/profile');
          setUser(data);
          persistAuthSession({ ...data, token: storedToken });
        } catch {
          // Token expired or invalid
          clearAuthSession();
          setUser(null);
          setToken(null);
        }
      }
      setLoading(false);
    };

    restoreSession();
    const syncSession = () => {
      const storedToken = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');
      if (!storedToken || !storedUser) {
        setUser(null);
        setToken(null);
        return;
      }
      try {
        const user = JSON.parse(storedUser);
        setUser(user);
        setToken(storedToken);
        if (user.role !== 'admin') localStorage.removeItem('adminToken');
      } catch {
        clearAuthSession();
        setUser(null);
        setToken(null);
      }
    };
    window.addEventListener('storage', syncSession);
    return () => window.removeEventListener('storage', syncSession);
  }, []);

  // Login handler
  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    const user = persistAuthSession(data);
    setToken(data.token);
    setUser(user);
    return data;
  };

  const loginAdmin = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.role !== 'admin') {
      const error = new Error('Access denied. This sign-in is for administrators only.');
      error.code = 'ADMIN_ACCESS_DENIED';
      throw error;
    }

    const adminUser = persistAuthSession(data);
    setToken(data.token);
    setUser(adminUser);
    return data;
  };

  // Register handler
  const register = async (name, email, password) => {
    const { data } = await api.post('/auth/register', { name, email, password });
    const user = persistAuthSession(data);
    setToken(data.token);
    setUser(user);
    return data;
  };

  // Logout handler
  const logout = () => {
    clearAuthSession();
    setUser(null);
    setToken(null);
  };

  const isAdmin = user && user.role === 'admin';
  const isCustomer = user && user.role === 'customer';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAdmin,
        isCustomer,
        login,
        loginAdmin,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
