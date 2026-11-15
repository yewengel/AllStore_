/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';

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
          localStorage.setItem('user', JSON.stringify(data));
        } catch {
          // Token expired or invalid
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setUser(null);
          setToken(null);
        }
      }
      setLoading(false);
    };

    restoreSession();
  }, []);

  // Login handler
  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem(
      'user',
      JSON.stringify({ _id: data._id, name: data.name, email: data.email, role: data.role })
    );
    setToken(data.token);
    setUser({ _id: data._id, name: data.name, email: data.email, role: data.role });
    return data;
  };

  const loginAdmin = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.role !== 'admin') {
      const error = new Error('Access denied. This sign-in is for administrators only.');
      error.code = 'ADMIN_ACCESS_DENIED';
      throw error;
    }

    const adminUser = { _id: data._id, name: data.name, email: data.email, role: data.role };
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(adminUser));
    setToken(data.token);
    setUser(adminUser);
    return data;
  };

  // Register handler
  const register = async (name, email, password) => {
    const { data } = await api.post('/auth/register', { name, email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem(
      'user',
      JSON.stringify({ _id: data._id, name: data.name, email: data.email, role: data.role })
    );
    setToken(data.token);
    setUser({ _id: data._id, name: data.name, email: data.email, role: data.role });
    return data;
  };

  // Logout handler
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
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
