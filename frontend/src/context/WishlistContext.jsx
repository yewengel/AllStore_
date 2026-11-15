/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api/axios';
import { useAuth } from './AuthContext';

const WishlistContext = createContext(null);

export const WishlistProvider = ({ children }) => {
  const { user } = useAuth();
  const [productIds, setProductIds] = useState([]);

  useEffect(() => {
    let active = true;
    if (user?.role !== 'customer') return () => { active = false; };
    api.get('/customer/wishlist')
      .then(({ data }) => {
        if (active) {
          setProductIds((Array.isArray(data) ? data : [])
            .filter((product) => product?._id)
            .map((product) => String(product._id)));
        }
      })
      .catch((error) => {
        console.error('Failed to load customer wishlist:', error);
      });
    return () => { active = false; };
  }, [user?._id, user?.role]);

  const toggleProduct = useCallback(async (productId) => {
    const id = String(productId);
    const saved = productIds.includes(id);
    if (saved) {
      await api.delete(`/customer/wishlist/${id}`);
      setProductIds((current) => current.filter((entry) => entry !== id));
    } else {
      await api.post(`/customer/wishlist/${id}`);
      setProductIds((current) => current.includes(id) ? current : [...current, id]);
    }
    return !saved;
  }, [productIds]);

  const value = useMemo(() => {
    const visibleProductIds = user?.role === 'customer' ? productIds : [];
    return {
      productIds: visibleProductIds,
      isSaved: (productId) => visibleProductIds.includes(String(productId)),
      toggleProduct,
    };
  }, [productIds, toggleProduct, user?.role]);

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
};

export const useWishlist = () => {
  const context = useContext(WishlistContext);
  if (!context) throw new Error('useWishlist must be used within a WishlistProvider');
  return context;
};
