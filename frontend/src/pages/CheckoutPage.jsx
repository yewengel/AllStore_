import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import api, { getProductImageUrl } from '../api/axios';
import { toEtb } from '../utils/currency';
import { useCurrency } from '../context/CurrencyContext';
import { isUsablePaymentAccount } from '../utils/paymentAccount';

const FREE_SHIPPING_THRESHOLD = toEtb(100, 'USD');
const STANDARD_SHIPPING_COST = toEtb(9.99, 'USD');
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const RECEIPT_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

const isReceiptImage = (file) => {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return file.size > 0 && file.size <= RECEIPT_MAX_BYTES && RECEIPT_TYPES.get(extension) === file.type;
};

const CheckoutPage = () => {
  const { cartItems, totalItems, totalPrice, clearCart } = useCart();
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('Ethiopia');
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || '');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [receiptSelection, setReceiptSelection] = useState(null);
  const [showReceiptSubmission, setShowReceiptSubmission] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(null);
  const [pendingOrder, setPendingOrder] = useState(null);

  const [paymentConfig, setPaymentConfig] = useState(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const submittingRef = useRef(false);
  const checkoutRequestRef = useRef({ fingerprint: '', key: '' });
  const pendingOrderRef = useRef(null);
  const receiptSubmissionKeyRef = useRef('');
  const receiptPreviewUrlRef = useRef('');

  const loadPaymentAccounts = useCallback(async (showLoading = true, signal) => {
    if (showLoading) setConfigLoaded(false);
    setConfigError('');
    try {
      const { data } = await api.get('/payment-settings/public', { signal });
      const accounts = Array.isArray(data?.accounts) ? data.accounts.filter(isUsablePaymentAccount) : [];
      setPaymentConfig({ ...data, accounts });
      setPaymentAccountId((current) => accounts.some((account) => account.id === current) ? current : '');
    } catch (requestError) {
      if (signal?.aborted) return;
      setPaymentConfig(null);
      setPaymentAccountId('');
      setConfigError(requestError.response?.data?.message || 'Payment accounts could not be loaded. Please retry.');
    } finally {
      if (!signal?.aborted) setConfigLoaded(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadPaymentAccounts(false, controller.signal); }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadPaymentAccounts]);

  useEffect(() => () => {
    if (receiptPreviewUrlRef.current) URL.revokeObjectURL(receiptPreviewUrlRef.current);
  }, []);

  const paymentAccounts = useMemo(
    () => (Array.isArray(paymentConfig?.accounts) ? paymentConfig.accounts.filter(isUsablePaymentAccount) : []),
    [paymentConfig]
  );

  const shippingCost = totalPrice >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_COST;
  const discount = 0;
  const grandTotal = Number((totalPrice + shippingCost - discount).toFixed(2));

  const selectedAccount = paymentAccounts.find((account) => account.id === paymentAccountId);
  const receiptPaymentAccount = pendingOrder?.paymentAccountSnapshot || selectedAccount;
  const receiptPaymentAmount = pendingOrder?.paymentAmount ?? grandTotal;

  const handlePlaceOrder = (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);

    if (!selectedAccount && !pendingOrder) {
      setError('Select an active payment account before continuing.');
      return;
    }
    if (!phoneNumber.trim() || !address.trim() || !city.trim() || !postalCode.trim() || !country.trim()) {
      setError('Please fill in your phone number and all required shipping address fields.');
      return;
    }
    setShowReceiptSubmission(true);
  };

  const handleReceiptSelection = (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    if (!isReceiptImage(file)) {
      setError(file.size > RECEIPT_MAX_BYTES
        ? 'The receipt image must be no larger than 5 MB.'
        : 'Choose a JPG, JPEG, PNG, or WebP receipt image.');
      event.target.value = '';
      return;
    }
    if (receiptPreviewUrlRef.current) URL.revokeObjectURL(receiptPreviewUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    receiptPreviewUrlRef.current = previewUrl;
    receiptSubmissionKeyRef.current = '';
    setReceiptSelection({ file, previewUrl });
    setError(null);
  };

  const handleSubmitOrderAndReceipt = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setError(null);
    if (!receiptPaymentAccount) {
      setError('Select an active payment account before continuing.');
      return;
    }
    if (!receiptSelection?.file) {
      setError('Upload a valid payment receipt before submitting your order.');
      return;
    }
    if (!isReceiptImage(receiptSelection.file)) {
      setError('Choose a JPG, JPEG, PNG, or WebP receipt image no larger than 5 MB.');
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      let order = pendingOrderRef.current;
      if (!order) {
        const orderPayload = {
          orderItems: cartItems.map((item) => ({
            product: item.product,
            qty: item.qty,
          })),
          shippingAddress: {
            address,
            city,
            region,
            postalCode,
            country,
          },
          phoneNumber,
          paymentAccountId,
          paymentAmount: grandTotal,
          deliveryDetails: { region, deliveryInstructions },
        };
        const fingerprint = JSON.stringify(orderPayload);
        if (checkoutRequestRef.current.fingerprint !== fingerprint) {
          checkoutRequestRef.current = {
            fingerprint,
            key: window.crypto.randomUUID(),
          };
        }
        orderPayload.checkoutRequestKey = checkoutRequestRef.current.key;

        const { data } = await api.post('/orders', orderPayload);
        order = {
          id: data._id,
          orderNumber: data.orderNumber,
          paymentAmount: data.paymentAmount ?? data.totalPrice ?? grandTotal,
          paymentAccountSnapshot: data.paymentAccountSnapshot || {
            ...selectedAccount,
          },
        };
        pendingOrderRef.current = order;
        setPendingOrder(order);
      }

      const receiptPayload = new FormData();
      receiptPayload.append('receipt', receiptSelection.file);
      receiptPayload.append('paymentAmount', String(order.paymentAmount));
      if (!receiptSubmissionKeyRef.current) {
        receiptSubmissionKeyRef.current = window.crypto.randomUUID();
      }
      receiptPayload.append('receiptSubmissionKey', receiptSubmissionKeyRef.current);
      await api.post(`/payments/bank-transfer/${order.id}/receipt`, receiptPayload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      clearCart();
      setSubmissionSuccess({ id: order.id, orderNumber: order.orderNumber });
      pendingOrderRef.current = null;
      setPendingOrder(null);
      checkoutRequestRef.current = { fingerprint: '', key: '' };
      receiptSubmissionKeyRef.current = '';
      if (receiptPreviewUrlRef.current) URL.revokeObjectURL(receiptPreviewUrlRef.current);
      receiptPreviewUrlRef.current = '';
      setReceiptSelection(null);
      setPaymentAccountId('');
      setShowReceiptSubmission(false);
    } catch (requestError) {
      const reason = requestError.response?.data?.message
        || 'The order or receipt could not be submitted. Your details and receipt are still available to retry.';
      setError(pendingOrderRef.current
        ? `Order ${pendingOrderRef.current.orderNumber || ''} was created, but the receipt was not confirmed. ${reason}`
        : reason);
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const closeReceiptSubmission = () => {
    if (!loading) setShowReceiptSubmission(false);
  };

  if (submissionSuccess) {
    return (
      <div className="container checkout-success-page">
        <section className="checkout-success-card" role="status" aria-live="polite">
          <div className="checkout-success-icon" aria-hidden="true">✓</div>
          <h1>Order submitted</h1>
          <p>Your order and payment receipt have been submitted successfully. Your payment is awaiting admin verification.</p>
          <p><strong>Order ID:</strong> {submissionSuccess.id}</p>
          {submissionSuccess.orderNumber && <p><strong>Order number:</strong> {submissionSuccess.orderNumber}</p>}
          <div className="checkout-success-actions">
            <Link to={`/orders/${submissionSuccess.id}`} className="btn-secondary">View order details</Link>
            <Link to="/my-orders" className="btn-primary">Go to My Orders</Link>
          </div>
        </section>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="container" style={{ padding: '80px 24px', textAlign: 'center' }}>
        <div className="empty-cart-card">
          <h2>No Items to Checkout</h2>
          <p>Please add products to your cart before proceeding to checkout.</p>
          <Link to="/products" className="btn-primary" style={{ marginTop: '20px', display: 'inline-block' }}>
            Go to Products
          </Link>
        </div>
      </div>
    );
  }

  const placeOrderLabel = `Place Order (${formatPrice(grandTotal, 'ETB')})`;

  return (
    <div className="checkout-page">
      <div className="container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Checkout</h1>
            <p className="page-description">Complete your delivery details and choose how you would like to pay.</p>
          </div>
          <Link to="/cart" className="back-link">
            &larr; Back to Cart
          </Link>
        </div>

        {error && <div className="alert-error-banner">{error}</div>}

        <div className="checkout-layout-grid">
          {/* Left: Delivery & Payment Form */}
          <div className="checkout-form-col">
            <form onSubmit={handlePlaceOrder} id="checkout-form" className="checkout-card">
              <h2 className="card-section-title">1. Your Details</h2>

              <div className="checkout-customer-summary">
                <div>
                  <span>Customer name</span>
                  <strong>{user?.name || '—'}</strong>
                </div>
                <div>
                  <span>Email</span>
                  <strong>{user?.email || '—'}</strong>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="phoneNumber">Phone Number *</label>
                <input
                  id="phoneNumber"
                  type="tel"
                  autoComplete="tel"
                  required
                  maxLength="50"
                  placeholder="e.g. +251 91 123 4567"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="address">Delivery Address *</label>
                <input
                  id="address"
                  type="text"
                  required
                  placeholder="e.g. Bole Road, House 123"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="city">City *</label>
                  <input
                    id="city"
                    type="text"
                    required
                    placeholder="e.g. Addis Ababa"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="region">Region</label>
                  <input
                    id="region"
                    type="text"
                    placeholder="e.g. Addis Ababa"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="postalCode">Postal / ZIP Code *</label>
                  <input
                    id="postalCode"
                    type="text"
                    required
                    placeholder="e.g. 1000"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="country">Country *</label>
                  <input
                    id="country"
                    type="text"
                    required
                    placeholder="e.g. Ethiopia"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="deliveryInstructions">Delivery Instructions</label>
                <textarea
                  id="deliveryInstructions"
                  rows="3"
                  maxLength="1000"
                  placeholder="e.g. Call on arrival, leave with the building receptionist."
                  value={deliveryInstructions}
                  onChange={(e) => setDeliveryInstructions(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="summary-divider" style={{ margin: '32px 0 24px' }}></div>

              <h2 className="card-section-title">2. Payment Method</h2>

              <div className="payment-options">
                <div className="payment-group">
                  <h3>Bank transfer or mobile money (ETB)</h3>
                  {!configLoaded && <p className="payment-config-message" role="status">Loading available payment accounts…</p>}
                  {configLoaded && configError && (
                    <p className="payment-config-message payment-config-error" role="alert">
                      {configError}
                      <button type="button" className="payment-retry-button" onClick={loadPaymentAccounts}>Retry</button>
                    </p>
                  )}
                  {paymentAccounts.map((account) => (
                    <label
                      key={account.id}
                      className={`payment-radio-label ${paymentAccountId === account.id ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="paymentAccountId"
                        value={account.id}
                        checked={paymentAccountId === account.id}
                        disabled={Boolean(pendingOrder)}
                        onChange={(event) => setPaymentAccountId(event.target.value)}
                      />
                      <span className="payment-icon" aria-hidden="true">{account.type === 'bank' ? '🏦' : '📱'}</span>
                      <div className="payment-account-option">
                        <strong>{account.name}</strong>
                        <p>{account.type === 'bank' ? 'Bank account' : 'Mobile-money account'} · {account.provider}</p>
                        <p>Account holder: {account.accountHolder}</p>
                        <p>Account number / payment details: {account.accountDetails}</p>
                        {account.branch && <p>Branch: {account.branch}</p>}
                        {account.instructions && <small>{account.instructions}</small>}
                      </div>
                    </label>
                  ))}
                  {configLoaded && !configError && !paymentAccounts.length && (
                    <p className="payment-config-message">
                      No active payment accounts are available. Please contact the store or try again later.
                    </p>
                  )}
                </div>
              </div>

              {selectedAccount && (
                <div className="bank-transfer-details" style={{ marginTop: '16px' }}>
                  <h4>{selectedAccount.name} payment instructions</h4>
                  <p><span>Provider</span><strong>{selectedAccount.provider}</strong></p>
                  <p><span>Account holder / merchant</span><strong>{selectedAccount.accountHolder}</strong></p>
                  <p><span>Account number / payment details</span><strong>{selectedAccount.accountDetails}</strong></p>
                  {selectedAccount.branch && <p><span>Branch</span><strong>{selectedAccount.branch}</strong></p>}
                  {selectedAccount.instructions && <p><span>Instructions</span><strong>{selectedAccount.instructions}</strong></p>}
                  <p><span>Exact amount</span><strong>{formatPrice(grandTotal, 'ETB')}</strong></p>
                  <small>Pay the exact amount using your banking or payment app, then submit a screenshot or receipt. Your order will not be processed until an Admin verifies the payment.</small>
                </div>
              )}

              {pendingOrder && (
                <p className="payment-config-message" role="status">
                  Order {pendingOrder.orderNumber || pendingOrder.id} has been created. Upload its receipt here to finish checkout; retrying will continue this same order.
                </p>
              )}
            </form>
          </div>

          {/* Right: Order Review */}
          <div className="checkout-summary-col">
            <div className="order-summary-card">
              <h3 className="summary-title">Order Summary ({totalItems} items)</h3>

              <div className="checkout-items-preview">
                {cartItems.map((item) => {
                  const selectedOptions = Object.entries(item.options || {})
                    .map(([name, value]) => `${name}: ${value}`)
                    .join(' · ');
                  return (
                  <div key={`${item.product}::${item.variantId || 'base'}`} className="checkout-item-compact">
                    <img
                      src={getProductImageUrl(item.image)}
                      alt={item.name}
                      className="checkout-thumb"
                      onError={(e) => {
                        e.target.src = '/uploads/sample-product.svg';
                      }}
                    />
                    <div className="checkout-item-details">
                      <span className="checkout-item-name">{item.name}</span>
                      <span className="checkout-item-meta">
                        Qty: {item.qty} &times; {formatPrice(item.price, item.currency)}
                      </span>
                      {selectedOptions && <span className="checkout-item-meta">{selectedOptions}</span>}
                    </div>
                    <span className="checkout-item-subtotal">{formatPrice(item.price * item.qty, item.currency)}</span>
                  </div>
                  );
                })}
              </div>

              <div className="summary-divider"></div>

              <div className="summary-line">
                <span>Subtotal</span>
                <span>{formatPrice(totalPrice, 'ETB')}</span>
              </div>

              <div className="summary-line">
                <span>Delivery fee</span>
                <span>{shippingCost === 0 ? <strong style={{ color: '#10b981' }}>FREE</strong> : formatPrice(shippingCost, 'ETB')}</span>
              </div>

              <div className="summary-line">
                <span>Discount</span>
                <span>{discount > 0 ? `−${formatPrice(discount, 'ETB')}` : formatPrice(0, 'ETB')}</span>
              </div>

              <div className="summary-divider"></div>

              <div className="summary-total-line">
                <span>Total Amount</span>
                <span className="summary-grand-total">{formatPrice(grandTotal, 'ETB')}</span>
              </div>

              <div className="customer-info-note">
                Ordering as <strong>{user?.name}</strong> ({user?.email})
              </div>

              <button
                type="submit"
                form="checkout-form"
                disabled={loading || !paymentAccounts.length}
                className="btn-primary btn-checkout-action"
              >
                {loading ? 'Processing…' : pendingOrder ? 'Resume receipt submission' : placeOrderLabel}
              </button>

              <p className="stock-notice">
                {'🔒 Transfer externally. Your receipt stays pending until an administrator verifies the transaction.'}
              </p>
            </div>
          </div>
        </div>
        {showReceiptSubmission && (
          <div className="checkout-receipt-overlay" role="presentation">
            <section
              className="checkout-receipt-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="checkout-receipt-title"
            >
              <div className="checkout-receipt-heading">
                <div>
                  <p className="checkout-receipt-step">Final step</p>
                  <h2 id="checkout-receipt-title">Upload payment receipt</h2>
                  <p>Transfer the exact amount using your bank or mobile-money app, then attach the receipt screenshot.</p>
                </div>
                <button
                  type="button"
                  className="checkout-receipt-close"
                  aria-label="Close receipt upload"
                  disabled={loading}
                  onClick={closeReceiptSubmission}
                >
                  ×
                </button>
              </div>

              {receiptPaymentAccount && (
                <div className="bank-transfer-details">
                  <h4>{receiptPaymentAccount.name} — selected payment account</h4>
                  <p><span>Account type</span><strong>{receiptPaymentAccount.type === 'bank' ? 'Bank' : 'Mobile money'}</strong></p>
                  <p><span>Provider</span><strong>{receiptPaymentAccount.provider}</strong></p>
                  <p><span>Account holder / merchant</span><strong>{receiptPaymentAccount.accountHolder}</strong></p>
                  <p><span>Account number / payment details</span><strong>{receiptPaymentAccount.accountDetails}</strong></p>
                  {receiptPaymentAccount.branch && <p><span>Branch</span><strong>{receiptPaymentAccount.branch}</strong></p>}
                  {receiptPaymentAccount.instructions && <p><span>Payment instructions</span><strong>{receiptPaymentAccount.instructions}</strong></p>}
                  <p><span>Exact amount</span><strong>{formatPrice(receiptPaymentAmount, 'ETB')}</strong></p>
                </div>
              )}

              <form className="checkout-receipt-form" onSubmit={handleSubmitOrderAndReceipt}>
                <label className="checkout-receipt-upload" htmlFor="checkoutReceipt">
                  <span>{receiptSelection ? 'Replace receipt screenshot' : 'Choose receipt screenshot'}</span>
                  <small>JPG, JPEG, PNG, or WebP · maximum 5 MB</small>
                  <input
                    id="checkoutReceipt"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    onChange={handleReceiptSelection}
                    disabled={loading}
                  />
                </label>

                {receiptSelection && (
                  <div className="checkout-receipt-preview">
                    <img src={receiptSelection.previewUrl} alt="Preview of uploaded payment receipt" />
                    <div>
                      <strong>{receiptSelection.file.name}</strong>
                      <span>{(receiptSelection.file.size / 1024).toFixed(0)} KB</span>
                    </div>
                  </div>
                )}

                {error && <p className="checkout-receipt-error" role="alert">{error}</p>}
                <div className="checkout-receipt-actions">
                  <button type="button" className="btn-secondary" disabled={loading} onClick={closeReceiptSubmission}>
                    Back to checkout
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={loading || !receiptSelection?.file || !receiptPaymentAccount}
                  >
                    {loading ? 'Submitting order and receipt…' : 'Submit Order and Payment Receipt'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckoutPage;
