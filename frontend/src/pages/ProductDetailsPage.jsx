import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useCart } from '../context/CartContext';
import { useCurrency } from '../context/CurrencyContext';
import { getProductCurrency } from '../utils/currency';
import { useAuth } from '../context/AuthContext';
import WishlistButton from '../components/WishlistButton';
import NotFoundPage from './NotFoundPage';
import { recordGuestRecentlyViewed } from '../utils/recentlyViewed';

const getOptionEntries = (options) => (
  options instanceof Map ? [...options.entries()] :
    options && typeof options === 'object' ? Object.entries(options) : []
);

const optionValue = (variant, name) => (
  getOptionEntries(variant?.options).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
);

const ProductDetailsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [qty, setQty] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState({});
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [optionError, setOptionError] = useState('');
  const [addedMessage, setAddedMessage] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewSummary, setReviewSummary] = useState({ averageRating: 0, reviewCount: 0 });
  const [reviewOrders, setReviewOrders] = useState([]);
  const [reviewOrderId, setReviewOrderId] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewMessage, setReviewMessage] = useState('');
  const [reviewError, setReviewError] = useState('');

  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();
  const { user } = useAuth();

  useEffect(() => {
    let active = true;
    const fetchProduct = async () => {
      try {
        setLoading(true);
        const { data } = await api.get(`/products/${id}`);
        if (!active) return;
        setProduct(data);
        setRelatedProducts([]);
        setSelectedOptions({});
        setSelectedImageIndex(0);
        setQty(1);
        setOptionError('');
        setError(null);
      } catch (err) {
        if (active) setError(err.response?.data?.message || 'Product could not be found');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchProduct();
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!product?._id) return;
    if (user?.role === 'customer') {
      api.post(`/customer/recently-viewed/${product._id}`)
        .catch((requestError) => console.error('Failed to track recently viewed product:', requestError));
    } else {
      recordGuestRecentlyViewed(product._id);
    }
  }, [product?._id, user?._id, user?.role]);

  useEffect(() => {
    let active = true;
    api.get(`/products/${id}/reviews`)
      .then(({ data }) => {
        if (!active) return;
        setReviews(data.reviews || []);
        setReviewSummary({
          averageRating: Number(data.averageRating) || 0,
          reviewCount: Number(data.reviewCount) || 0,
        });
      })
      .catch((requestError) => {
        console.error('Failed to load product reviews:', requestError);
        if (active) setReviewError('Customer reviews could not be loaded.');
      });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    let active = true;
    if (!user || user.role !== 'customer') {
      return () => { active = false; };
    }
    api.get('/orders/my-orders')
      .then(({ data }) => {
        if (!active) return;
        const eligible = (Array.isArray(data) ? data : []).filter((order) => {
          const items = order.orderItems?.length ? order.orderItems : order.items || [];
          return order.orderStatus === 'Delivered' &&
            items.some((item) => String(item.product?._id || item.product) === String(id));
        });
        setReviewOrders(eligible);
        setReviewOrderId(String(eligible[0]?._id || ''));
      })
      .catch((requestError) => {
        console.error('Failed to load eligible review purchases:', requestError);
      });
    return () => { active = false; };
  }, [id, user]);

  const submitReview = async (event) => {
    event.preventDefault();
    setReviewSubmitting(true);
    setReviewError('');
    setReviewMessage('');
    try {
      await api.post(`/products/${id}/reviews`, {
        orderId: reviewOrderId,
        rating: reviewRating,
        body: reviewBody,
      });
      setReviewBody('');
      setReviewMessage('Thank you. Your review is awaiting Admin moderation before it appears publicly.');
    } catch (requestError) {
      setReviewError(requestError.response?.data?.message || 'Your review could not be submitted.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!product?.category) {
      return () => { active = false; };
    }

    api.get('/products', { params: { category: product.category, limit: 6, sort: 'popular' } })
      .then(({ data }) => {
        if (!active) return;
        const products = Array.isArray(data) ? data : data.products || [];
        setRelatedProducts(products.filter((item) => item._id !== product._id).slice(0, 4));
      })
      .catch((relatedError) => {
        console.error('Failed to load related products:', relatedError);
        if (active) setRelatedProducts([]);
      });

    return () => { active = false; };
  }, [product]);

  const variants = useMemo(
    () => Array.isArray(product?.variants) ? product.variants : [],
    [product]
  );
  const optionNames = useMemo(() => {
    const names = new Map();
    variants.forEach((variant) => {
      getOptionEntries(variant.options).forEach(([name]) => {
        if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
      });
    });
    const allNames = [...names.values()];
    return [
      ...allNames.filter((name) => ['color', 'colour'].includes(name.toLowerCase())),
      ...allNames.filter((name) => name.toLowerCase() === 'size'),
      ...allNames.filter((name) => !['color', 'colour', 'size'].includes(name.toLowerCase())).sort(),
    ];
  }, [variants]);

  const selectedVariant = useMemo(() => {
    if (!variants.length || !optionNames.length || optionNames.some((name) => !selectedOptions[name])) return null;
    return variants.find((variant) => optionNames.every(
      (name) => optionValue(variant, name) === selectedOptions[name]
    )) || null;
  }, [optionNames, selectedOptions, variants]);

  const currentPrice = selectedVariant?.price ?? product?.price ?? 0;
  const currentStock = selectedVariant ? Number(selectedVariant.stockQuantity) : Number(product?.stockQuantity || 0);
  const isSelectedVariantAvailable = Boolean(
    selectedVariant && selectedVariant.isAvailable !== false && Number(selectedVariant.stockQuantity) > 0
  );
  const hasAvailableVariants = variants.some(
    (variant) => variant.isAvailable !== false && Number(variant.stockQuantity) > 0
  );
  const galleryImages = useMemo(() => {
    if (!product) return [];
    const productImages = [product.image, ...(Array.isArray(product.images) ? product.images : [])];
    const images = [selectedVariant?.image, ...productImages].filter(Boolean);
    return [...new Set(images)];
  }, [product, selectedVariant]);
  const displayedImage = galleryImages[selectedImageIndex] || product?.image;

  const handleOptionChange = (name, value) => {
    setSelectedOptions((current) => {
      const next = { ...current };
      if (next[name] === value) delete next[name];
      else next[name] = value;
      return next;
    });
    setQty(1);
    setSelectedImageIndex(0);
    setOptionError('');
  };

  const isOptionUnavailable = (name, value) => {
    const candidateOptions = { ...selectedOptions, [name]: value };
    const matchingVariants = variants.filter((variant) => Object.entries(candidateOptions).every(
      ([selectedName, selectedValue]) => optionValue(variant, selectedName) === selectedValue
    ));
    return !matchingVariants.some(
      (variant) => variant.isAvailable !== false && Number(variant.stockQuantity) > 0
    );
  };

  const addSelectedProduct = (buyNow = false) => {
    if (variants.length && !selectedVariant) {
      setOptionError('Select all available options before adding this product to your cart.');
      return;
    }
    if ((variants.length > 0 && !isSelectedVariantAvailable) || currentStock <= 0 || qty > currentStock) {
      setOptionError('The selected option is currently out of stock.');
      return;
    }

    try {
      addToCart(product, qty, selectedVariant);
      if (buyNow) {
        navigate('/cart');
        return;
      }
      setOptionError('');
      setAddedMessage(true);
      setTimeout(() => setAddedMessage(false), 2500);
    } catch (addError) {
      setOptionError(addError.message || 'This product could not be added to your cart.');
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
    return <NotFoundPage title="Product Not Found" message={error || 'The requested product does not exist or has been removed.'} />;
  }

  return (
    <div className="product-details-page">
      <div className="container">
        <nav className="breadcrumb">
          <Link to="/">Home</Link>
          <span className="separator">/</span>
          <Link to="/products">Products</Link>
          <span className="separator">/</span>
          <span className="current">{product.name}</span>
        </nav>

        <div className="product-details-grid">
          <div className="product-gallery-col">
            <div className="product-main-image-card">
              <img
                src={getProductImageUrl(displayedImage)}
                alt={product.name}
                className="product-detail-img"
                onError={(event) => { event.currentTarget.src = '/uploads/sample-product.svg'; }}
              />
            </div>
            {galleryImages.length > 1 && (
              <div className="product-gallery-thumbnails" aria-label="Product images">
                {galleryImages.map((image, index) => (
                  <button
                    type="button"
                    key={image}
                    className={`product-gallery-thumbnail${selectedImageIndex === index ? ' selected' : ''}`}
                    onClick={() => setSelectedImageIndex(index)}
                    aria-label={`Show product image ${index + 1}`}
                    aria-pressed={selectedImageIndex === index}
                  >
                    <img
                      src={getProductImageUrl(image)}
                      alt=""
                      onError={(event) => { event.currentTarget.src = '/uploads/sample-product.svg'; }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="product-summary-col">
            <span className="detail-category-badge">{product.category}</span>
            {product.brand && <p className="detail-brand">{product.brand}</p>}
            <h1 className="detail-title">{product.name}</h1>
            <div className="product-detail-wishlist"><WishlistButton productId={product._id} /></div>

            <div className="detail-price-box">
              <span className="detail-price">{formatPrice(currentPrice, getProductCurrency(product))}</span>
              <span className="detail-tax-note">Tax included &bull; Fast shipping available</span>
            </div>

            {optionNames.length > 0 && (
              <div className="product-variant-options">
                {optionNames.map((name) => {
                  const values = [...new Set(variants.map((variant) => optionValue(variant, name)).filter(Boolean))];
                  const isColor = ['color', 'colour'].includes(name.toLowerCase());
                  return (
                    <fieldset className="product-option-group" key={name}>
                      <legend>{name}{selectedOptions[name] ? `: ${selectedOptions[name]}` : ''}</legend>
                      <div className={isColor ? 'product-option-choices color-option-choices' : 'product-option-choices'}>
                        {values.map((value) => {
                          const unavailable = isOptionUnavailable(name, value);
                          const selected = selectedOptions[name] === value;
                          return (
                            <button
                              type="button"
                              key={value}
                              className={`product-option-choice${selected ? ' selected' : ''}${unavailable ? ' unavailable' : ''}`}
                              onClick={() => handleOptionChange(name, value)}
                              disabled={unavailable}
                              aria-pressed={selected}
                              title={unavailable ? `${value} is unavailable` : value}
                            >
                              {isColor && (
                                <span
                                  className="product-color-swatch"
                                  style={{
                                    backgroundColor:
                                      variants.find((variant) => optionValue(variant, name) === value)?.colorValue || value,
                                  }}
                                  aria-hidden="true"
                                />
                              )}
                              <span>{value}</span>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            )}

            <div className="detail-stock-indicator">
              {variants.length > 0 && !selectedVariant ? (
                hasAvailableVariants
                  ? <span className="stock-badge in-stock">Select options to see availability</span>
                  : <span className="stock-badge out-of-stock"><span className="dot out-of-stock"></span> Out of Stock</span>
              ) : currentStock <= 0 || (selectedVariant && !isSelectedVariantAvailable) ? (
                <span className="stock-badge out-of-stock">
                  <span className="dot out-of-stock"></span> Out of Stock
                </span>
              ) : (
                <span className="stock-badge in-stock">
                  <span className="dot in-stock"></span> In Stock ({currentStock} units available)
                </span>
              )}
            </div>

            <div className="detail-description-section">
              <h3>Description</h3>
              <p className="detail-description-text">{product.description}</p>
            </div>

            {(variants.length > 0 ? hasAvailableVariants : currentStock > 0) && (
              <div className="purchase-controls">
                <div className="quantity-selector-group">
                  <label htmlFor="qty-select">Quantity:</label>
                  <div className="quantity-counter">
                    <button
                      type="button"
                      onClick={() => setQty((previous) => Math.max(1, previous - 1))}
                      disabled={qty <= 1}
                      className="qty-btn"
                    >
                      -
                    </button>
                    <span id="qty-select" className="qty-value">{qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty((previous) => Math.min(currentStock, previous + 1))}
                      disabled={qty >= currentStock}
                      className="qty-btn"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="detail-buttons-row">
                  <button
                    type="button"
                    onClick={() => addSelectedProduct(false)}
                    className="btn-primary add-to-cart-big"
                    disabled={(variants.length > 0 && (!selectedVariant || !isSelectedVariantAvailable)) || currentStock <= 0}
                  >
                    Add to Cart
                  </button>
                  <button
                    type="button"
                    onClick={() => addSelectedProduct(true)}
                    className="btn-secondary buy-now-big"
                    disabled={(variants.length > 0 && (!selectedVariant || !isSelectedVariantAvailable)) || currentStock <= 0}
                  >
                    Buy Now
                  </button>
                </div>

                {optionError && <p className="product-option-error" role="alert">{optionError}</p>}
                {addedMessage && (
                  <div className="alert-success-toast">
                    ✓ Added {qty} {qty === 1 ? 'item' : 'items'} to your cart!{' '}
                    <Link to="/cart" className="alert-link">View Cart</Link>
                  </div>
                )}
              </div>
            )}

            <div className="product-perks">
              <div className="perk-item"><span className="perk-icon">✓</span><span>Genuine retail item backed by guarantee</span></div>
              <div className="perk-item"><span className="perk-icon">✓</span><span>Real-time database inventory reservation</span></div>
              <div className="perk-item"><span className="perk-icon">✓</span><span>30-day return policy for peace of mind</span></div>
            </div>
          </div>
        </div>

        <section className="product-reviews-section" aria-labelledby="product-reviews-title">
          <div className="section-heading">
            <div>
              <h2 id="product-reviews-title">Customer Reviews</h2>
              <p>
                <span className="review-stars" aria-label={`${reviewSummary.averageRating.toFixed(1)} out of 5 stars`}>
                  {reviewSummary.reviewCount ? '★'.repeat(Math.round(reviewSummary.averageRating)) : '☆☆☆☆☆'}
                </span>
                {' '}{reviewSummary.reviewCount
                  ? `${reviewSummary.averageRating.toFixed(1)} · ${reviewSummary.reviewCount} ${reviewSummary.reviewCount === 1 ? 'review' : 'reviews'}`
                  : 'No reviews yet'}
              </p>
            </div>
          </div>
          {reviewError && <p className="alert-error-banner" role="alert">{reviewError}</p>}
          {user?.role === 'customer' && (reviewOrders.length > 0) ? (
            <form className="product-review-form" onSubmit={submitReview}>
              <h3>Review a delivered purchase</h3>
              {reviewOrders.length > 1 && (
                <label>
                  Purchase
                  <select value={reviewOrderId} onChange={(event) => setReviewOrderId(event.target.value)} required>
                    {reviewOrders.map((order) => <option key={order._id} value={order._id}>{order.orderNumber || order._id}</option>)}
                  </select>
                </label>
              )}
              <label>
                Rating
                <select value={reviewRating} onChange={(event) => setReviewRating(Number(event.target.value))}>
                  {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} star{rating === 1 ? '' : 's'}</option>)}
                </select>
              </label>
              <label>
                Your review
                <textarea value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} minLength="3" maxLength="2000" rows="4" required />
              </label>
              <button type="submit" className="btn-primary" disabled={reviewSubmitting || !reviewOrderId}>
                {reviewSubmitting ? 'Submitting…' : 'Submit review'}
              </button>
              {reviewMessage && <p className="alert-success-toast" role="status">{reviewMessage}</p>}
            </form>
          ) : user?.role === 'customer' ? (
            <p className="review-purchase-note">Reviews are available after this product has been delivered to you.</p>
          ) : (
            <p className="review-purchase-note"><Link to="/login">Sign in</Link> with a customer account to review a delivered purchase.</p>
          )}
          <div className="product-review-list">
            {reviews.map((review) => (
              <article className="product-review-card" key={review.id}>
                <div className="product-review-card-heading">
                  <strong>{review.customerName}</strong>
                  <span className="review-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
                </div>
                <p>{review.body}</p>
                <time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString()}</time>
              </article>
            ))}
            {!reviews.length && !reviewError && <p className="review-purchase-note">Be the first to share your experience.</p>}
          </div>
        </section>

        {relatedProducts.length > 0 && (
          <section className="related-products-section">
            <div className="section-heading">
              <div><h2>Related Products</h2><p>More items from {product.category}</p></div>
            </div>
            <div className="related-products-grid">
              {relatedProducts.map((relatedProduct) => (
                <Link
                  className="related-product-card"
                  to={`/products/${relatedProduct._id}`}
                  key={relatedProduct._id}
                >
                  <img
                    src={getProductImageUrl(relatedProduct.image)}
                    alt={relatedProduct.name}
                    onError={(event) => { event.currentTarget.src = '/uploads/sample-product.svg'; }}
                  />
                  <span>{relatedProduct.name}</span>
                  <strong>{formatPrice(relatedProduct.price, getProductCurrency(relatedProduct))}</strong>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default ProductDetailsPage;
