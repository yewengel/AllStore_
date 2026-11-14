import { useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useCurrency } from '../context/CurrencyContext';
import { currencyOptions } from '../utils/currency';
import categories from '../data/categories';

const CurrencyDropdown = () => {
  const { currency, setCurrency } = useCurrency();
  const dropdownRef = useRef(null);
  const selectedOption = currencyOptions.find((option) => option.code === currency);

  return (
    <details className="store-currency-dropdown" ref={dropdownRef}>
      <summary className="store-currency-trigger" aria-label={`Currency: ${currency}`}>
        <span>{currency} / {selectedOption.symbol}</span>
        <svg className="store-currency-caret" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <div className="store-currency-panel" role="menu" aria-label="Select currency">
        <span className="store-currency-panel-title">Display currency</span>
        {currencyOptions.map((option) => (
          <button
            key={option.code}
            type="button"
            role="menuitemradio"
            aria-checked={currency === option.code}
            className={currency === option.code ? 'selected' : ''}
            onClick={() => {
              setCurrency(option.code);
              if (dropdownRef.current) dropdownRef.current.open = false;
            }}
          >
            <span>{option.code} / {option.symbol} — {option.label}</span>
            {currency === option.code && <span className="store-currency-check" aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </details>
  );
};

const Navbar = () => {
  const { user, isCustomer, logout } = useAuth();
  const { totalItems } = useCart();
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const handleSearch = (event) => {
    event.preventDefault();
    const query = searchTerm.trim();
    navigate(query ? `/products?keyword=${encodeURIComponent(query)}` : '/products');
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <>
      <div className="announcement-bar">
        <div className="container announcement-content">
          <strong>Welcome to AllStore</strong>
          <span>Discover products for every lifestyle.</span>
        </div>
      </div>

      <header className="navbar">
        <div className="container">
          <div className="store-nav-main">
            <Link to="/" className="store-brand" aria-label="AllStore home">
              <img
                src="/images/allstore-logo.png"
                alt="AllStore — Shop Smart. Live Better."
                className="store-brand-logo"
              />
            </Link>

            <div className="store-search-area">
              <form className="store-search" role="search" onSubmit={handleSearch}>
                <label className="visually-hidden" htmlFor="store-search-input">
                  Search products
                </label>
                <input
                  id="store-search-input"
                  type="search"
                  placeholder="Search products and categories"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
                <button type="submit" aria-label="Search AllStore">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m16 16 4 4" />
                  </svg>
                </button>
              </form>
            </div>

            <div className="store-nav-actions">
              <CurrencyDropdown />
              {user ? (
                <button type="button" className="store-nav-text-action" onClick={handleLogout}>
                  Logout
                </button>
              ) : (
                <Link to="/login" className="store-nav-action">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M5 21a7 7 0 0 1 14 0" />
                  </svg>
                  <span>Account</span>
                </Link>
              )}
              {isCustomer && (
                <NavLink to="/my-orders" className="store-nav-action store-orders-action" aria-label="My Orders">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 2h9l4 4v16H6z" />
                    <path d="M15 2v4h4" />
                    <path d="M9 12h7M9 16h7" />
                  </svg>
                  <span>My Orders</span>
                </NavLink>
              )}
              {isCustomer && (
                <NavLink to="/payments" className="store-nav-action store-payments-action" aria-label="Payment History">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <path d="M2 10h20" />
                    <path d="M6 15h4" />
                  </svg>
                  <span>Payments</span>
                </NavLink>
              )}
              <NavLink to="/cart" className="store-nav-action store-cart-action" aria-label={`Cart, ${totalItems} items`}>
                <span className="store-cart-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="9" cy="20" r="1" />
                    <circle cx="18" cy="20" r="1" />
                    <path d="M2 3h2l2.5 12.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L21 8H5" />
                  </svg>
                  <span className="store-cart-count" aria-live="polite">{totalItems}</span>
                </span>
                <span>Cart</span>
              </NavLink>
            </div>
          </div>

          <nav className="store-category-nav" aria-label="Shop product categories">
            <div className="store-category-links">
              <NavLink to="/products" end className={({ isActive }) => (isActive ? 'active' : '')}>
                All products
              </NavLink>
              {categories.map((category) => (
                <NavLink
                  key={category.name}
                  to={`/products?category=${encodeURIComponent(category.name)}`}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  {category.name}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </header>
    </>
  );
};

export default Navbar;
