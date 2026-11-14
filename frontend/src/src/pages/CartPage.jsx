import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { getProductImageUrl } from '../api/axios';
import { toEtb } from '../utils/currency';
import { useCurrency } from '../context/CurrencyContext';

const FREE_SHIPPING_THRESHOLD = toEtb(100, 'USD');
const STANDARD_SHIPPING_COST = toEtb(9.99, 'USD');

const CartPage = () => {
  const { cartItems, totalItems, totalPrice, updateQuantity, removeFromCart, clearCart } = useCart();
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();

  const handleProceedToCheckout = () => {
    if (!user) {
      navigate('/login', { state: { from: { pathname: '/checkout' } } });
    } else {
      navigate('/checkout');
    }
  };

  if (cartItems.length === 0) {
    return (
      <div className="cart-page">
        <div className="container" style={{ padding: '80px 24px', textAlign: 'center' }}>
          <div className="empty-cart-card">
            <div className="empty-cart-icon">🛒</div>
            <h2>Your Shopping Cart is Empty</h2>
            <p>Looks like you haven't added any products to your shopping cart yet.</p>
            <Link to="/products" className="btn-primary" style={{ marginTop: '24px', display: 'inline-block' }}>
              Explore Products Catalog
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const shippingCost = totalPrice >= FREE_SHIPPING_THRESHOLD || totalPrice === 0
    ? 0
    : STANDARD_SHIPPING_COST;
  const grandTotal = totalPrice + shippingCost;

  return (
    <div className="cart-page">
      <div className="container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Shopping Cart</h1>
            <p className="page-description">Review your selected items and proceed to checkout.</p>
          </div>
          <button onClick={clearCart} className="btn-clear-cart" title="Remove all items">
            Clear Entire Cart
          </button>
        </div>

        <div className="cart-layout-grid">
          {/* Left: Cart items list */}
          <div className="cart-items-col">
            <div className="cart-table-wrapper">
              <div className="cart-table-header">
                <span className="col-product">Product</span>
                <span className="col-price">Price</span>
                <span className="col-qty">Quantity</span>
                <span className="col-total">Subtotal</span>
                <span className="col-action"></span>
              </div>

              <div className="cart-items-list">
                {cartItems.map((item) => (
                  <div key={item.product} className="cart-item-row">
                    {/* Product info */}
                    <div className="col-product cart-product-meta">
                      <img
                        src={getProductImageUrl(item.image)}
                        alt={item.name}
                        className="cart-item-thumb"
                        onError={(e) => {
                          e.target.src = '/uploads/sample-product.svg';
                        }}
                      />
                      <div className="cart-item-info">
                        <Link to={`/products/${item.product}`} className="cart-item-name">
                          {item.name}
                        </Link>
                        <span className="cart-item-category">{item.category}</span>
                        {item.stockQuantity <= 5 && item.stockQuantity > 0 && (
                          <span className="low-stock-warning">Only {item.stockQuantity} left!</span>
                        )}
                      </div>
                    </div>

                    {/* Unit Price */}
                    <div className="col-price cart-unit-price">{formatPrice(item.price, item.currency)}</div>

                    {/* Quantity controls */}
                    <div className="col-qty">
                      <div className="quantity-counter compact">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product, item.qty - 1)}
                          className="qty-btn"
                          aria-label="Decrease quantity"
                        >
                          -
                        </button>
                        <span className="qty-value">{item.qty}</span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product, item.qty + 1)}
                          disabled={item.qty >= item.stockQuantity}
                          className="qty-btn"
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Subtotal */}
                    <div className="col-total cart-subtotal-price">
                      {formatPrice(item.price * item.qty, item.currency)}
                    </div>

                    {/* Remove Action */}
                    <div className="col-action">
                      <button
                        onClick={() => removeFromCart(item.product)}
                        className="btn-remove-item"
                        title="Remove product"
                        aria-label={`Remove ${item.name}`}
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="cart-table-footer">
              <Link to="/products" className="btn-secondary">
                &larr; Continue Shopping
              </Link>
            </div>
          </div>

          {/* Right: Order Summary */}
          <div className="cart-summary-col">
            <div className="order-summary-card">
              <h3 className="summary-title">Order Summary</h3>

              <div className="summary-line">
                <span>Items Subtotal ({totalItems})</span>
                <span>{formatPrice(totalPrice, 'ETB')}</span>
              </div>

              <div className="summary-line">
                <span>Shipping</span>
                <span>{shippingCost === 0 ? <strong style={{ color: '#10b981' }}>FREE</strong> : formatPrice(shippingCost, 'ETB')}</span>
              </div>

              {shippingCost > 0 && (
                <p className="shipping-promo-text">
                  Add {formatPrice(FREE_SHIPPING_THRESHOLD - totalPrice, 'ETB')} more to qualify for <strong>FREE shipping</strong>!
                </p>
              )}

              <div className="summary-divider"></div>

              <div className="summary-total-line">
                <span>Estimated Total</span>
                <span className="summary-grand-total">{formatPrice(grandTotal, 'ETB')}</span>
              </div>

              <button onClick={handleProceedToCheckout} className="btn-primary btn-checkout-action">
                Proceed to Checkout &rarr;
              </button>

              <div className="summary-security-badge">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Encrypted 256-bit secure checkout</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CartPage;

