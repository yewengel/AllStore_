import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useCart } from '../context/CartContext';
import categories from '../data/categories';
import { useCurrency } from '../context/CurrencyContext';

const ProductsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCategory = searchParams.get('category') || 'All';
  const selectedCategory = requestedCategory;
  const [products, setProducts] = useState([]);
  const [existingCategories, setExistingCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Search & Filter state
  const keyword = searchParams.get('keyword') || searchParams.get('search') || '';
  const setKeyword = (value) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value.trim()) {
      nextParams.set('keyword', value);
      nextParams.delete('search');
    } else {
      nextParams.delete('keyword');
      nextParams.delete('search');
    }
    setSearchParams(nextParams, { replace: true });
  };
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('newest');

  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();
  const [addedId, setAddedId] = useState(null);

  useEffect(() => {
    api
      .get('/products/categories')
      .then((res) => {
        setExistingCategories(res.data || []);
      })
      .catch((err) => {
        console.error('Failed to load categories:', err);
      });
  }, []);

  // Fetch products with filters
  useEffect(() => {
    const fetchProducts = async () => {
      setLoading(true);
      try {
        const params = {};
        if (keyword.trim()) params.keyword = keyword.trim();
        if (selectedCategory && selectedCategory !== 'All') params.category = selectedCategory;
        if (maxPrice && !isNaN(maxPrice) && Number(maxPrice) > 0) params.maxPrice = maxPrice;
        if (sort) params.sort = sort;

        const { data } = await api.get('/products', { params });
        setProducts(data.products || []);
        setFetchError('');
      } catch (err) {
        console.error('Failed to fetch products:', err);
        setProducts([]);
        setFetchError('The product catalog could not be loaded. Please try again in a moment.');
      } finally {
        setLoading(false);
      }
    };

    // Debounce search input
    const timer = setTimeout(() => {
      fetchProducts();
    }, 250);

    return () => clearTimeout(timer);
  }, [keyword, selectedCategory, maxPrice, sort]);

  const categoryOptions = [
    ...categories.map((category) => category.name),
    ...existingCategories.filter((category) => !categories.some((item) => item.name === category)),
  ];

  const handleAddToCart = (product) => {
    addToCart(product, 1);
    setAddedId(product._id);
    setTimeout(() => setAddedId(null), 1800);
  };

  const handleResetFilters = () => {
    setMaxPrice('');
    setSort('newest');
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('category');
    nextParams.delete('keyword');
    nextParams.delete('search');
    setSearchParams(nextParams);
  };

  const handleCategoryChange = (event) => {
    const nextParams = new URLSearchParams(searchParams);
    if (event.target.value === 'All') {
      nextParams.delete('category');
    } else {
      nextParams.set('category', event.target.value);
    }
    setSearchParams(nextParams);
  };

  return (
    <div className="products-page">
      <div className="container">
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">Product Catalog</h1>
            <p className="page-description">Browse and filter our inventory of high-quality products.</p>
          </div>
          <span className="results-count-badge">
            {products.length} {products.length === 1 ? 'Product' : 'Products'} Found
          </span>
        </div>

        {fetchError && (
          <div className="alert-error-banner" role="alert">
            {fetchError}
          </div>
        )}

        {/* Search & Filter Toolbar */}
        <div className="filter-toolbar">
          <div className="search-box">
            <svg
              className="search-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search by product name..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="search-input"
            />
            {keyword && (
              <button onClick={() => setKeyword('')} className="clear-search-btn" title="Clear">
                &times;
              </button>
            )}
          </div>

          <div className="filter-controls">
            {/* Category Filter */}
            <div className="filter-control-group">
              <label htmlFor="category-select">Category</label>
              <select
                id="category-select"
                value={selectedCategory}
                onChange={handleCategoryChange}
                className="filter-select"
              >
                <option value="All">All Categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            {/* Max Price Filter */}
            <div className="filter-control-group">
              <label htmlFor="price-select">Max Price (ETB)</label>
              <input
                id="price-select"
                type="number"
                min="0"
                placeholder="e.g. 150"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="filter-input-price"
              />
            </div>

            {/* Sort Selector */}
            <div className="filter-control-group">
              <label htmlFor="sort-select">Sort By</label>
              <select
                id="sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="filter-select"
              >
                <option value="newest">Newest First</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="name-asc">Name: A - Z</option>
              </select>
            </div>

            {/* Reset button */}
            {(keyword || selectedCategory !== 'All' || maxPrice) && (
              <button onClick={handleResetFilters} className="btn-reset-filters">
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Product Grid */}
        {selectedCategory !== 'All' && (
          <div className="active-category-label">
            Showing category: <strong>{selectedCategory}</strong>
          </div>
        )}
        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Filtering catalog items...</p>
          </div>
        ) : products.length > 0 ? (
          <div className="products-grid">
            {products.map((product) => (
              <div key={product._id} className="product-card">
                <div className="product-image-container">
                  <Link to={`/products/${product._id}`}>
                    <img
                      src={getProductImageUrl(product.image)}
                      alt={product.name}
                      className="product-img"
                      onError={(e) => {
                        e.target.src = '/uploads/sample-product.svg';
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
                        <span className="dot in-stock"></span> {product.stockQuantity} in stock
                      </span>
                    ) : (
                      <span className="out-of-stock-label">
                        <span className="dot out-of-stock"></span> Out of Stock
                      </span>
                    )}
                  </div>

                  <div className="product-footer">
                    <div className="product-price-col">
                      <span className="price-label">Price</span>
                      <span className="product-price">{formatPrice(product.price, product.currency)}</span>
                    </div>

                    {product.stockQuantity > 0 ? (
                      <button
                        onClick={() => handleAddToCart(product)}
                        className={`btn-add-cart ${addedId === product._id ? 'added' : ''}`}
                      >
                        {addedId === product._id ? '✓ Added' : 'Add to Cart'}
                      </button>
                    ) : (
                      <button disabled className="btn-add-cart disabled">
                        Unavailable
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-results-box">
            <div className="empty-icon">🔍</div>
            <h3>No products found</h3>
            <p>We could not find any products matching your current search or filters.</p>
            <button onClick={handleResetFilters} className="btn-primary" style={{ marginTop: '16px' }}>
              Clear All Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductsPage;
