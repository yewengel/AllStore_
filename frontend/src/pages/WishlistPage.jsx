import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useWishlist } from '../context/WishlistContext';
import { useCart } from '../context/CartContext';
import { useCurrency } from '../context/CurrencyContext';
import { getProductCurrency } from '../utils/currency';

const WishlistPage = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addedId, setAddedId] = useState('');
  const { toggleProduct } = useWishlist();
  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();

  useEffect(() => {
    let active = true;
    api.get('/customer/wishlist')
      .then(({ data }) => {
        if (active) setProducts(Array.isArray(data) ? data : []);
      })
      .catch((requestError) => {
        console.error('Failed to load wishlist:', requestError);
        if (active) setError(requestError.response?.data?.message || 'Your wishlist could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const removeProduct = async (id) => {
    try {
      await toggleProduct(id);
      setProducts((current) => current.filter((product) => String(product._id) !== String(id)));
    } catch (requestError) {
      console.error('Failed to remove wishlist item:', requestError);
      setError(requestError.response?.data?.message || 'The item could not be removed.');
    }
  };

  return (
    <div className="container wishlist-page">
      <header className="page-header">
        <div><h1 className="page-title">My Wishlist</h1><p className="page-description">Your saved AllStore favorites.</p></div>
      </header>
      {error && <p className="alert-error-banner" role="alert">{error}</p>}
      {loading ? <p role="status">Loading your wishlist…</p> : products.length ? (
        <div className="products-grid">
          {products.map((product) => (
            <article key={product._id} className="product-card">
              <Link to={`/products/${product._id}`} className="wishlist-product-image">
                <img src={getProductImageUrl(product.image)} alt={product.name} />
              </Link>
              <div className="product-info">
                <Link to={`/products/${product._id}`} className="product-title-link"><h2 className="product-name">{product.name}</h2></Link>
                <p className="product-price">{formatPrice(product.price, getProductCurrency(product))}</p>
                <div className="wishlist-card-actions">
                  <button
                    type="button"
                    className="btn-add-cart"
                    disabled={product.stockQuantity <= 0 || product.variants?.length > 0}
                    onClick={() => {
                      addToCart(product, 1);
                      setAddedId(product._id);
                      window.setTimeout(() => setAddedId(''), 1500);
                    }}
                  >
                    {product.variants?.length ? 'Choose Options' : product.stockQuantity > 0 ? addedId === product._id ? '✓ Added' : 'Add to Cart' : 'Unavailable'}
                  </button>
                  {product.variants?.length > 0 && <Link className="btn-secondary" to={`/products/${product._id}`}>Choose options</Link>}
                  <button type="button" className="wishlist-remove-button" onClick={() => removeProduct(product._id)}>Remove</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-results-box"><h2>Your wishlist is empty</h2><p>Save products you like and they will be here.</p><Link className="btn-primary" to="/products">Browse products</Link></div>
      )}
    </div>
  );
};

export default WishlistPage;
