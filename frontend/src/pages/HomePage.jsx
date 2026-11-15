import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useCart } from '../context/CartContext';
import { useCurrency } from '../context/CurrencyContext';
import { getProductCurrency } from '../utils/currency';
import categories from '../data/categories';
import PaginationControls from '../components/PaginationControls';
import RecentlyViewedProducts from '../components/RecentlyViewedProducts';
import WishlistButton from '../components/WishlistButton';

const HOME_PAGE_SIZE = 10;

const HomePage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPage = Number(searchParams.get('page') || 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [fetchError, setFetchError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();
  const [addedId, setAddedId] = useState(null);

  useEffect(() => {
    let isActive = true;

    const fetchInitialProducts = async () => {
      setLoading(true);
      setFetchError('');
      try {
        const { data } = await api.get('/products', {
          params: { page, limit: HOME_PAGE_SIZE, sort: 'newest' },
        });
        if (!isActive) return;
        setFeaturedProducts(Array.isArray(data.products) ? data.products : []);
        const pageCount = Math.max(1, Number(data.pages) || 1);
        setTotalPages(pageCount);
        if (page > pageCount) {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.set('page', String(pageCount));
          setSearchParams(nextParams, { replace: true });
        }
      } catch (error) {
        console.error('Error fetching homepage products:', error);
        if (isActive) {
          setFetchError('Products could not be loaded. Please try again.');
          setFeaturedProducts([]);
          setTotalPages(1);
        }
      } finally {
        if (isActive) setLoading(false);
      }
    };

    fetchInitialProducts();
    return () => {
      isActive = false;
    };
  }, [page, retryCount, searchParams, setSearchParams]);

  const handleAddToCart = (product) => {
    if (product.variants?.length) {
      navigate(`/products/${product._id}`);
      return;
    }
    addToCart(product, 1);
    setAddedId(product._id);
    setTimeout(() => setAddedId(null), 1800);
  };

  const heroImage = categories.find((category) => category.name === 'Home & Kitchen');
  const secondaryHeroImages = categories
    .filter((category) => ["Women's Fashion", 'Electronics'].includes(category.name))
    .slice(0, 1);

  return (
    <div className="home-page">
      <section className="store-hero">
        <div className="container store-hero-grid">
          <div className="store-hero-copy">
            <p className="store-eyebrow">ALLSTORE · EVERYDAY FINDS</p>
            <h1>Everything you love, all in one place.</h1>
            <p className="store-hero-description">
              Explore thoughtful finds for your home, style, and everyday life.
              Find something useful, delightful, and uniquely yours.
            </p>
            <Link to="/products" className="store-shop-button">
              Shop Now
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </Link>
          </div>

          <div className="store-hero-gallery">
            <img
              className="store-hero-main-image"
              src={heroImage?.image}
              alt="Home and kitchen collection"
            />
            <div className="store-hero-side-images">
              {secondaryHeroImages.map((category) => (
                <img key={category.name} src={category.image} alt={`${category.name} collection`} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="store-category-section">
        <div className="container">
          <div className="store-section-heading">
            <div>
              <h2>Shop by category</h2>
              <p>Browse our collections.</p>
            </div>
            <Link to="/products">View all products <span aria-hidden="true">→</span></Link>
          </div>
          <div className="store-category-grid">
            {categories.map((category) => (
              <Link
                key={category.name}
                to={`/products?category=${encodeURIComponent(category.name)}`}
                className="store-category-card"
              >
                <span className="store-category-image-frame" aria-hidden="true">
                  <img src={category.image} alt="" loading="lazy" />
                </span>
                <span className="store-category-label">{category.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="store-products-section">
        <div className="container">
          <div className="store-section-heading">
            <div>
              <h2>Explore Our Products</h2>
              <p>Discover something you&apos;ll love.</p>
            </div>
          </div>

          {loading ? (
            <div className="store-catalog-state" role="status">
              <div className="spinner" />
              <p>Loading products from AllStore...</p>
            </div>
          ) : fetchError ? (
            <div className="store-catalog-state" role="alert">
              <p>{fetchError}</p>
              <button type="button" className="btn-primary" onClick={() => setRetryCount((count) => count + 1)}>
                Try again
              </button>
            </div>
          ) : featuredProducts.length > 0 ? (
            <>
              <div className="store-products-grid">
                {featuredProducts.map((product) => {
                  const isAdded = addedId === product._id;
                  const isOutOfStock = !(product.stockQuantity > 0);
                  return (
                    <div key={product._id} className="product-card store-home-product-card">
                      <div className="product-image-container">
                        <WishlistButton productId={product._id} />
                        <Link to={`/products/${product._id}`}>
                          <img
                            src={getProductImageUrl(product.image)}
                            alt={product.name}
                            className="product-img store-home-product-img"
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.src = '/uploads/sample-product.svg';
                            }}
                          />
                        </Link>
                        <span className="category-pill">{product.category}</span>
                        {product.stockQuantity <= 0 && <span className="sold-out-overlay">Sold Out</span>}
                      </div>
                      <div className="product-info">
                        <Link to={`/products/${product._id}`} className="product-title-link">
                          <h3 className="product-name">{product.name}</h3>
                        </Link>
                        <p className="product-snippet">{product.description}</p>
                        <div className="stock-status-line">
                          {product.stockQuantity > 0 ? (
                            <span className="in-stock-label">
                              <span className="dot in-stock" /> {product.stockQuantity} in stock
                            </span>
                          ) : (
                            <span className="out-of-stock-label">
                              <span className="dot out-of-stock" /> Out of Stock
                            </span>
                          )}
                        </div>
                        <div className="product-footer">
                          <div className="product-price-col">
                            <span className="price-label">Price</span>
                            <span className="product-price">{formatPrice(product.price, getProductCurrency(product))}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddToCart(product)}
                            className={`btn-add-cart ${isAdded ? 'added' : ''}`}
                            disabled={isOutOfStock}
                          >
                            {isOutOfStock ? 'Unavailable' : product.variants?.length ? 'Choose Options' : isAdded ? '✓ Added' : 'Add to Cart'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <PaginationControls
                page={page}
                pages={totalPages}
                onPageChange={(nextPage) => {
                  const nextParams = new URLSearchParams(searchParams);
                  nextParams.set('page', String(nextPage));
                  setSearchParams(nextParams);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </>
          ) : (
            <div className="store-catalog-state">
              <p>No products are available right now. Please check back soon.</p>
              <Link to="/products" className="btn-primary">Browse products</Link>
            </div>
          )}
        </div>
      </section>
      <RecentlyViewedProducts />
    </div>
  );
};

export default HomePage;
