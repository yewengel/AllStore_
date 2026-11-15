import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';
import { getProductCurrency } from '../utils/currency';
import { getGuestRecentlyViewed } from '../utils/recentlyViewed';

const RecentlyViewedProducts = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [products, setProducts] = useState([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (user?.role === 'customer') {
          const { data } = await api.get('/customer/recently-viewed');
          if (active) setProducts(Array.isArray(data) ? data : []);
          return;
        }
        const ids = getGuestRecentlyViewed();
        const results = await Promise.allSettled(ids.map((id) => api.get(`/products/${id}`)));
        const productsFound = results.flatMap((result) => {
          if (result.status === 'fulfilled') return [result.value.data];
          console.error('A recently viewed product is no longer available:', result.reason);
          return [];
        });
        if (active) setProducts(productsFound);
      } catch (error) {
        console.error('Failed to load recently viewed products:', error);
        if (active) setProducts([]);
      }
    };
    load();
    return () => { active = false; };
  }, [user?._id, user?.role]);

  if (!products.length) return null;
  return (
    <section className="recently-viewed-section container">
      <div className="store-section-heading"><div><h2>Recently viewed</h2><p>Pick up where you left off.</p></div></div>
      <div className="recently-viewed-grid">
        {products.map((product) => (
          <Link className="recently-viewed-card" to={`/products/${product._id}`} key={product._id}>
            <img src={getProductImageUrl(product.image)} alt={product.name} loading="lazy" />
            <span>{product.name}</span>
            <strong>{formatPrice(product.price, getProductCurrency(product))}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
};

export default RecentlyViewedProducts;
