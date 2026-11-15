import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import CurrencyDropdown from './CurrencyDropdown';
import api, { getProductImageUrl } from '../api/axios';
import categories from '../data/categories';
import { useCurrency } from '../context/CurrencyContext';
import { getProductCurrency } from '../utils/currency';
import NotificationBell from './NotificationBell';

const Navbar = () => {
  const { user, isCustomer, logout } = useAuth();
  const { totalItems } = useCart();
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const searchAreaRef = useRef(null);
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const suggestionQuery = searchTerm.trim().toLowerCase();

  useEffect(() => {
    if (!suggestionQuery) return undefined;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await api.get('/products', {
          params: { keyword: suggestionQuery, limit: 5 },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setSuggestions(Array.isArray(data.products) ? data.products : []);
          setSuggestionsError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Failed to fetch product search suggestions:', error);
          setSuggestions([]);
          setSuggestionsError('Product suggestions could not be loaded.');
        }
      } finally {
        if (!controller.signal.aborted) setSuggestionsLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [suggestionQuery]);

  useEffect(() => {
    const closeSuggestionsOutsideSearch = (event) => {
      if (!searchAreaRef.current?.contains(event.target)) {
        setSuggestionsOpen(false);
        setActiveSuggestionIndex(-1);
      }
    };

    document.addEventListener('pointerdown', closeSuggestionsOutsideSearch);
    return () => document.removeEventListener('pointerdown', closeSuggestionsOutsideSearch);
  }, []);

  const closeSuggestions = () => {
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
  };

  const handleSearch = (event) => {
    event.preventDefault();
    const query = searchTerm.trim();
    closeSuggestions();
    navigate(query ? `/products?keyword=${encodeURIComponent(query)}` : '/products');
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'Escape') {
      closeSuggestions();
      return;
    }

    if (!suggestionsOpen || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSuggestionIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSuggestionIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && suggestions[activeSuggestionIndex]) {
      event.preventDefault();
      const product = suggestions[activeSuggestionIndex];
      closeSuggestions();
      navigate(`/products/${product._id}`);
    }
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

            <div className="store-search-area" ref={searchAreaRef}>
              <form className="store-search" role="search" onSubmit={handleSearch}>
                <label className="visually-hidden" htmlFor="store-search-input">
                  Search products
                </label>
                <input
                  id="store-search-input"
                  type="search"
                  placeholder="Search products, brands, descriptions, or keywords"
                  autoComplete="off"
                  maxLength={200}
                  value={searchTerm}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={suggestionsOpen && Boolean(suggestionQuery)}
                  aria-controls="store-product-suggestions"
                  aria-activedescendant={
                    suggestions[activeSuggestionIndex]
                      ? `store-product-suggestion-${suggestions[activeSuggestionIndex]._id}`
                      : undefined
                  }
                  onFocus={() => {
                    if (suggestionQuery) setSuggestionsOpen(true);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  onChange={(event) => {
                    const value = event.target.value;
                    const nextQuery = value.trim().toLowerCase();
                    setSearchTerm(value);
                    setActiveSuggestionIndex(-1);
                    if (!nextQuery) {
                      setSuggestions([]);
                      setSuggestionsOpen(false);
                      setSuggestionsLoading(false);
                      setSuggestionsError('');
                    } else {
                      setSuggestionsOpen(true);
                      setSuggestionsError('');
                      if (nextQuery !== suggestionQuery) {
                        setSuggestions([]);
                        setSuggestionsLoading(true);
                      }
                    }
                  }}
                />
                <button type="submit" aria-label="Search AllStore">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m16 16 4 4" />
                  </svg>
                </button>
              </form>
              {suggestionsOpen && suggestionQuery && (
                <div
                  id="store-product-suggestions"
                  className="store-search-suggestions"
                  role="listbox"
                  aria-label="Product suggestions"
                  aria-busy={suggestionsLoading}
                >
                  {suggestionsLoading ? (
                    <div className="store-search-suggestion-message" role="status">Searching products…</div>
                  ) : suggestionsError ? (
                    <div className="store-search-suggestion-message" role="status">{suggestionsError}</div>
                  ) : suggestions.length > 0 ? (
                    suggestions.map((product, index) => (
                      <Link
                        key={product._id}
                        id={`store-product-suggestion-${product._id}`}
                        to={`/products/${product._id}`}
                        role="option"
                        aria-selected={activeSuggestionIndex === index}
                        className={`store-search-suggestion${activeSuggestionIndex === index ? ' active' : ''}`}
                        onClick={closeSuggestions}
                      >
                        <img src={getProductImageUrl(product.image)} alt="" loading="lazy" />
                        <span className="store-search-suggestion-name">{product.name}</span>
                        <span className="store-search-suggestion-price">
                          {formatPrice(product.price, getProductCurrency(product))}
                        </span>
                      </Link>
                    ))
                  ) : (
                    <div className="store-search-suggestion-message" role="status">No matching products found.</div>
                  )}
                </div>
              )}
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
              {isCustomer && (
                <NavLink to="/wishlist" className="store-nav-action store-nav-wishlist-action" aria-label="Wishlist">
                  <span aria-hidden="true">♥</span><span>Wishlist</span>
                </NavLink>
              )}
              {isCustomer && <NotificationBell />}
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
