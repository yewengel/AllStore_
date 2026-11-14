import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useCart } from '../context/CartContext';
import { useCurrency } from '../context/CurrencyContext';

const ProductDetailsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [qty, setQty] = useState(1);
  const [addedMessage, setAddedMessage] = useState(false);

  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setLoading(true);
        const { data } = await api.get(`/products/${id}`);
        setProduct(data);
        setError(null);
      } catch (err) {
        setError(err.response?.data?.message || 'Product could not be found');
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [id]);

  const handleAddToCart = () => {
    if (product && product.stockQuantity > 0) {
      addToCart(product, qty);
      setAddedMessage(true);
      setTimeout(() => setAddedMessage(false), 2500);
    }
  };

  const handleBuyNow = () => {
    if (product && product.stockQuantity > 0) {
      addToCart(product, qty);
      navigate('/cart');
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '80px 24px' }}>
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading product details...</p>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="container" style={{ padding: '80px 24px', textAlign: 'center' }}>
        <div className="empty-results-box">
          <div className="empty-icon">⚠️</div>
          <h3>Product Not Found</h3>
          <p>{error || 'The requested product does not exist or has been removed.'}</p>
          <Link to="/products" className="btn-primary" style={{ marginTop: '20px', display: 'inline-block' }}>
            Back to Products Catalog
          </Link>
        </div>
      </div>
    );
  }

  const isOutOfStock = product.stockQuantity <= 0;

  return (
    <div className="product-details-page">
      <div className="container">
        {/* Breadcrumb */}
        <nav className="breadcrumb">
          <Link to="/">Home</Link>
          <span className="separator">/</span>
          <Link to="/products">Products</Link>
          <span className="separator">/</span>
          <span className="current">{product.name}</span>
        </nav>

        {/* Product Details Layout */}
        <div className="product-details-grid">
          {/* Left: Product Image */}
          <div className="product-gallery-col">
            <div className="product-main-image-card">
              <img
                src={getProductImageUrl(product.image)}
                alt={product.name}
                className="product-detail-img"
                onError={(e) => {
                  e.target.src = '/uploads/sample-product.svg';
                }}
              />
            </div>
          </div>

          {/* Right: Product Info & Actions */}
          <div className="product-summary-col">
            <span className="detail-category-badge">{product.category}</span>
            <h1 className="detail-title">{product.name}</h1>

            <div className="detail-price-box">
              <span className="detail-price">{formatPrice(product.price, product.currency)}</span>
              <span className="detail-tax-note">Tax included &bull; Fast shipping available</span>
            </div>

            <div className="detail-stock-indicator">
              {isOutOfStock ? (
                <span className="stock-badge out-of-stock">
                <span className="dot out-of-stock"></span> Out of Stock
                </span>
              ) : (
                <span className="stock-badge in-stock">
                <span className="dot in-stock"></span> In Stock ({product.stockQuantity} units available)
                </span>
              )}
            </div>

            <div className="detail-description-section">
              <h3>Description</h3>
              <p className="detail-description-text">{product.description}</p>
            </div>

            {/* Purchase Form */}
            {!isOutOfStock && (
              <div className="purchase-controls">
                <div className="quantity-selector-group">
                  <label htmlFor="qty-select">Quantity:</label>
                  <div className="quantity-counter">
                    <button
                      type="button"
                      onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                      disabled={qty <= 1}
                      className="qty-btn"
                    >
                      -
                    </button>
                    <span className="qty-value">{qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty((prev) => Math.min(product.stockQuantity, prev + 1))}
                      disabled={qty >= product.stockQuantity}
                      className="qty-btn"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="detail-buttons-row">
                  <button onClick={handleAddToCart} className="btn-primary add-to-cart-big">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="8" cy="21" r="1" />
                      <circle cx="19" cy="21" r="1" />
                      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
                    </svg>
                    Add to Cart
                  </button>
                  <button onClick={handleBuyNow} className="btn-secondary buy-now-big">
                    Buy Now
                  </button>
                </div>

                {addedMessage && (
                  <div className="alert-success-toast">
                    ✓ Added {qty} {qty === 1 ? 'item' : 'items'} to your cart!{' '}
                    <Link to="/cart" className="alert-link">
                      View Cart
                    </Link>
                  </div>
                )}
              </div>
            )}

            {/* Feature Highlights */}
            <div className="product-perks">
              <div className="perk-item">
                <span className="perk-icon">✓</span>
                <span>Genuine retail item backed by guarantee</span>
              </div>
              <div className="perk-item">
                <span className="perk-icon">✓</span>
                <span>Real-time database inventory reservation</span>
              </div>
              <div className="perk-item">
                <span className="perk-icon">✓</span>
                <span>30-day return policy for peace of mind</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailsPage;

