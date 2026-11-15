import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useCart } from '../context/CartContext';
import categories from '../data/categories';
import { useCurrency } from '../context/CurrencyContext';
import { getProductCurrency } from '../utils/currency';
import PaginationControls from '../components/PaginationControls';
import WishlistButton from '../components/WishlistButton';

const PAGE_SIZE = 10;
const ProductsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCategory = searchParams.get('category') || 'All';
  const selectedCategory = requestedCategory;
  const selectedSubcategory = searchParams.get('subcategory') || '';
  const selectedBrand = searchParams.get('brand') || '';
  const keyword = searchParams.get('keyword') || searchParams.get('search') || '';
  const minPrice = searchParams.get('minPrice') || '';
  const maxPrice = searchParams.get('maxPrice') || '';
  const sort = searchParams.get('sort') || 'newest';
  const requestedPage = Number(searchParams.get('page') || 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [products, setProducts] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [facets, setFacets] = useState({ categories: [], subcategories: [], brands: [] });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [facetError, setFacetError] = useState('');
  const [resultCount, setResultCount] = useState(0);

  const setFilterParam = (name, value) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value.trim()) {
      nextParams.set(name, value);
    } else {
      nextParams.delete(name);
    }
    if (name !== 'page') nextParams.delete('page');
    if (name === 'keyword') nextParams.delete('search');
    if (name === 'category' && value !== selectedCategory) {
      nextParams.delete('subcategory');
      nextParams.delete('brand');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();
  const [addedId, setAddedId] = useState(null);

  useEffect(() => {
    let active = true;
    api.get('/products/filters', {
      params: selectedCategory !== 'All' ? { category: selectedCategory } : {},
    })
      .then(({ data }) => {
        if (active) {
          setFacets({
            categories: Array.isArray(data.categories) ? data.categories : [],
            subcategories: Array.isArray(data.subcategories) ? data.subcategories : [],
            brands: Array.isArray(data.brands) ? data.brands : [],
          });
          setFacetError('');
        }
      })
      .catch((error) => {
        console.error('Failed to load product filters:', error);
        if (active) setFacetError('Some product filter options could not be loaded.');
      });
    return () => { active = false; };
  }, [selectedCategory]);

  // Fetch products with filters
  useEffect(() => {
    let active = true;
    const fetchProducts = async () => {
      const minimum = minPrice === '' ? null : Number(minPrice);
      const maximum = maxPrice === '' ? null : Number(maxPrice);
      const priceError = minimum !== null && (!Number.isFinite(minimum) || minimum < 0)
        ? 'Minimum price must be a non-negative number.'
        : maximum !== null && (!Number.isFinite(maximum) || maximum < 0)
          ? 'Maximum price must be a non-negative number.'
          : minimum !== null && maximum !== null && minimum > maximum
            ? 'Minimum price cannot be greater than maximum price.'
            : '';

      if (priceError) {
        setProducts([]);
        setResultCount(0);
        setTotalPages(1);
        setFetchError(priceError);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const params = {};
        if (keyword.trim()) params.keyword = keyword.trim();
        if (selectedCategory && selectedCategory !== 'All') params.category = selectedCategory;
        if (selectedSubcategory) params.subcategory = selectedSubcategory;
        if (selectedBrand) params.brand = selectedBrand;
        if (minPrice) params.minPrice = minPrice;
        if (maxPrice) params.maxPrice = maxPrice;
        if (sort) params.sort = sort;
        params.page = page;
        params.limit = PAGE_SIZE;

        const { data } = await api.get('/products', { params });
        if (active) {
          setProducts(data.products || []);
          setResultCount(data.total ?? data.count ?? data.products?.length ?? 0);
          const pageCount = Math.max(1, Number(data.pages) || 1);
          setTotalPages(pageCount);
          if (page > pageCount) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('page', String(pageCount));
            setSearchParams(nextParams, { replace: true });
          }
          setFetchError('');
        }
      } catch (error) {
        console.error('Failed to fetch products:', error);
        if (active) {
          setProducts([]);
          setResultCount(0);
          setTotalPages(1);
          setFetchError(error.response?.data?.message || 'The product catalog could not be loaded. Please try again in a moment.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    // Debounce search input
    const timer = setTimeout(() => {
      fetchProducts();
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [keyword, selectedCategory, selectedSubcategory, selectedBrand, minPrice, maxPrice, sort, page, searchParams, setSearchParams]);

  const categoryOptions = [
    ...new Set([
      ...categories.map((category) => category.name),
      ...facets.categories,
    ]),
  ];

  const handleAddToCart = (product) => {
    if (product.variants?.length) {
      navigate(`/products/${product._id}`);
      return;
    }
    addToCart(product, 1);
    setAddedId(product._id);
    setTimeout(() => setAddedId(null), 1800);
  };

  const handleResetFilters = () => {
    const nextParams = new URLSearchParams(searchParams);
    ['category', 'subcategory', 'brand', 'keyword', 'search', 'minPrice', 'maxPrice', 'sort', 'page']
      .forEach((name) => nextParams.delete(name));
    setSearchParams(nextParams);
  };

  const handleCategoryChange = (event) => {
    setFilterParam('category', event.target.value === 'All' ? '' : event.target.value);
  };

  const hasActiveFilters = Boolean(
    keyword || selectedCategory !== 'All' || selectedSubcategory || selectedBrand ||
    minPrice || maxPrice || sort !== 'newest'
  );

  return (
    <div className="products-page">
      <div className="container">
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">Product Catalog</h1>
            <p className="page-description">Browse and filter our inventory of high-quality products.</p>
          </div>
          <span className="results-count-badge" aria-live="polite">
            {loading ? 'Updating products…' : `${resultCount} ${resultCount === 1 ? 'Product' : 'Products'} Found`}
          </span>
        </div>

        {facetError && <div className="alert-error-banner" role="status">{facetError}</div>}
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
              placeholder="Search names, descriptions, brands, or keywords..."
              maxLength={200}
              value={keyword}
              onChange={(e) => setFilterParam('keyword', e.target.value)}
              className="search-input"
            />
            {keyword && (
              <button onClick={() => setFilterParam('keyword', '')} className="clear-search-btn" title="Clear search" aria-label="Clear search">
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

            {facets.subcategories.length > 0 && (
              <div className="filter-control-group">
                <label htmlFor="subcategory-select">Subcategory</label>
                <select
                  id="subcategory-select"
                  value={selectedSubcategory}
                  onChange={(event) => setFilterParam('subcategory', event.target.value)}
                  className="filter-select"
                >
                  <option value="">All Subcategories</option>
                  {selectedSubcategory && !facets.subcategories.includes(selectedSubcategory) && (
                    <option value={selectedSubcategory}>{selectedSubcategory}</option>
                  )}
                  {facets.subcategories.map((subcategory) => (
                    <option key={subcategory} value={subcategory}>{subcategory}</option>
                  ))}
                </select>
              </div>
            )}

            {facets.brands.length > 0 && (
              <div className="filter-control-group">
                <label htmlFor="brand-select">Brand</label>
                <select
                  id="brand-select"
                  value={selectedBrand}
                  onChange={(event) => setFilterParam('brand', event.target.value)}
                  className="filter-select"
                >
                  <option value="">All Brands</option>
                  {selectedBrand && !facets.brands.includes(selectedBrand) && (
                    <option value={selectedBrand}>{selectedBrand}</option>
                  )}
                  {facets.brands.map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Price range filters */}
            <div className="filter-control-group">
              <label htmlFor="min-price">Min Price (ETB)</label>
              <input
                id="min-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="No minimum"
                value={minPrice}
                onChange={(e) => setFilterParam('minPrice', e.target.value)}
                className="filter-input-price"
              />
            </div>
            <div className="filter-control-group">
              <label htmlFor="max-price">Max Price (ETB)</label>
              <input
                id="max-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="No maximum"
                value={maxPrice}
                onChange={(e) => setFilterParam('maxPrice', e.target.value)}
                className="filter-input-price"
              />
            </div>

            {/* Sort Selector */}
            <div className="filter-control-group">
              <label htmlFor="sort-select">Sort By</label>
              <select
                id="sort-select"
                value={sort}
                onChange={(e) => setFilterParam('sort', e.target.value === 'newest' ? '' : e.target.value)}
                className="filter-select"
              >
                <option value="newest">Newest First</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="name-asc">Name: A - Z</option>
                <option value="popular">Popularity</option>
              </select>
            </div>

            {/* Reset button */}
            {hasActiveFilters && (
              <button onClick={handleResetFilters} className="btn-reset-filters">
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Product Grid */}
        {(selectedCategory !== 'All' || selectedSubcategory || selectedBrand) && (
          <div className="active-category-label">
            Showing category: <strong>{selectedCategory}</strong>
            {selectedSubcategory && <> · Subcategory: <strong>{selectedSubcategory}</strong></>}
            {selectedBrand && <> · Brand: <strong>{selectedBrand}</strong></>}
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
                  <WishlistButton productId={product._id} />
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
                      <span className="product-price">{formatPrice(product.price, getProductCurrency(product))}</span>
                    </div>

                    {product.stockQuantity > 0 ? (
                      <button
                        onClick={() => handleAddToCart(product)}
                        className={`btn-add-cart ${addedId === product._id ? 'added' : ''}`}
                      >
                        {product.variants?.length ? 'Choose Options' : addedId === product._id ? '✓ Added' : 'Add to Cart'}
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
        {!loading && products.length > 0 && (
          <PaginationControls
            page={page}
            pages={totalPages}
            onPageChange={(nextPage) => {
              const nextParams = new URLSearchParams(searchParams);
              nextParams.set('page', String(nextPage));
              setSearchParams(nextParams);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default ProductsPage;
