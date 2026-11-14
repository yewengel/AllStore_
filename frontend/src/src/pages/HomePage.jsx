import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useCart } from '../context/CartContext';
import { useCurrency } from '../context/CurrencyContext';
import categories from '../data/categories';

const HOME_PAGE_SIZE = 3;
const PRODUCT_BATCH_SIZE = 30;

const canLoadMore = (pagination) =>
  pagination.categoryStreams.some((stream) => stream.nextPage <= stream.totalPages);

const getMixedProducts = (categoryStreams) => {
  const mixedProducts = [];
  const seenIds = new Set();
  let index = 0;
  let foundProduct = true;

  while (foundProduct) {
    foundProduct = false;
    categoryStreams.forEach((stream) => {
      const product = stream.products[index];
      if (product && !seenIds.has(product._id)) {
        seenIds.add(product._id);
        mixedProducts.push(product);
        foundProduct = true;
      }
    });
    index += 1;
  }

  return mixedProducts;
};

const fetchNextCategoryRound = async (pagination, firstRound = false) => {
  const streams = firstRound
    ? pagination.categoryStreams
    : pagination.categoryStreams.filter((stream) => stream.nextPage <= stream.totalPages);

  if (streams.length === 0) return;

  const results = await Promise.all(
    streams.map(async (stream) => {
      const requestedPage = stream.nextPage;
      const { data } = await api.get('/products', {
        params: {
          category: stream.name,
          page: requestedPage,
          limit: HOME_PAGE_SIZE,
        },
      });
      return { stream, requestedPage, data };
    })
  );

  results.forEach(({ stream, requestedPage, data }) => {
    stream.products.push(...(Array.isArray(data.products) ? data.products : []));
    stream.totalPages = Number.isInteger(data.pages) ? data.pages : requestedPage;
    stream.nextPage = requestedPage + 1;
  });
  pagination.products = getMixedProducts(pagination.categoryStreams);
};

const HomePage = () => {
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PRODUCT_BATCH_SIZE);
  const paginationRef = useRef(null);
  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();
  const [addedId, setAddedId] = useState(null);

  useEffect(() => {
    let isActive = true;

    const fetchInitialProducts = async () => {
      setLoading(true);
      setFetchError('');
      paginationRef.current = null;
      try {
        const { data: categoryData } = await api.get('/products/categories');
        const categoryNames = [...new Set(
          (Array.isArray(categoryData) ? categoryData : [])
            .filter((name) => typeof name === 'string' && name.trim())
            .map((name) => name.trim())
        )].sort((a, b) => a.localeCompare(b));
        const pagination = {
          categoryStreams: categoryNames.map((name) => ({
            name,
            nextPage: 1,
            totalPages: 1,
            products: [],
          })),
          products: [],
        };

        if (pagination.categoryStreams.length > 0) {
          await fetchNextCategoryRound(pagination, true);
          while (pagination.products.length < PRODUCT_BATCH_SIZE && canLoadMore(pagination)) {
            await fetchNextCategoryRound(pagination);
          }
        }

        if (!isActive) return;
        paginationRef.current = pagination;
        setVisibleCount(PRODUCT_BATCH_SIZE);
        setFeaturedProducts(pagination.products.slice(0, PRODUCT_BATCH_SIZE));
        setHasMore(
          pagination.products.length > PRODUCT_BATCH_SIZE || canLoadMore(pagination)
        );
      } catch (error) {
        console.error('Error fetching homepage products:', error);
        if (isActive) {
          setFetchError('Products could not be loaded. Please try again.');
          setFeaturedProducts([]);
          setHasMore(false);
        }
      } finally {
        if (isActive) setLoading(false);
      }
    };

    fetchInitialProducts();
    return () => {
      isActive = false;
    };
  }, [retryCount]);

  const handleAddToCart = (product) => {
    addToCart(product, 1);
    setAddedId(product._id);
    setTimeout(() => setAddedId(null), 1800);
  };

  const handleLoadMore = async () => {
    const pagination = paginationRef.current;
    if (!pagination || loadingMore) return;

    setLoadingMore(true);
    setLoadMoreError('');
    const nextVisibleCount = visibleCount + PRODUCT_BATCH_SIZE;
    try {
      while (pagination.products.length < nextVisibleCount && canLoadMore(pagination)) {
        await fetchNextCategoryRound(pagination);
      }
      setVisibleCount(nextVisibleCount);
      setFeaturedProducts(pagination.products.slice(0, nextVisibleCount));
      setHasMore(
        pagination.products.length > nextVisibleCount || canLoadMore(pagination)
      );
    } catch (error) {
      console.error('Error loading more homepage products:', error);
      setLoadMoreError('More products could not be loaded. Please try again.');
    } finally {
      setLoadingMore(false);
    }
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
                            <span className="product-price">{formatPrice(product.price, product.currency)}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddToCart(product)}
                            className={`btn-add-cart ${isAdded ? 'added' : ''}`}
                            disabled={isOutOfStock}
                          >
                            {isOutOfStock ? 'Unavailable' : isAdded ? '✓ Added' : 'Add to Cart'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {loadMoreError && <p className="store-load-error" role="alert">{loadMoreError}</p>}
              {hasMore && (
                <div className="store-view-more">
                  <button type="button" onClick={handleLoadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'VIEW MORE'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="store-catalog-state">
              <p>No products are available right now. Please check back soon.</p>
              <Link to="/products" className="btn-primary">Browse products</Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default HomePage;
