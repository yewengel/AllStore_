import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import api, { getProductImageUrl } from '../api/axios';
import { toEtb } from '../utils/currency';
import { useCurrency } from '../context/CurrencyContext';
import { ONLINE_PAYMENT_OPTIONS, isMethodEnabled, isOnlinePaymentMethod } from '../utils/payment';

const FREE_SHIPPING_THRESHOLD = toEtb(100, 'USD');
const STANDARD_SHIPPING_COST = toEtb(9.99, 'USD');

const CheckoutPage = () => {
  const { cartItems, totalItems, totalPrice, clearCart } = useCart();
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();

  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('Ethiopia');
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || '');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash on Delivery');
  const [transactionReference, setTransactionReference] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);

  const [paymentConfig, setPaymentConfig] = useState(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    api.get('/payments/config')
      .then(({ data }) => {
        if (!active) return;
        setPaymentConfig(data);
        const firstOnline = ONLINE_PAYMENT_OPTIONS.find((option) => isMethodEnabled(option, data?.chapa));
        setPaymentMethod(firstOnline ? firstOnline.value : 'Cash on Delivery');
      })
      .catch(() => { if (active) setPaymentConfig(null); })
      .finally(() => { if (active) setConfigLoaded(true); });
    return () => { active = false; };
  }, []);

  const chapaEnabled = Boolean(paymentConfig?.chapa?.enabled);
  const bankTransferConfigured = Boolean(paymentConfig?.bankTransfer?.configured);
  const onlineMethodsAvailable = useMemo(
    () => ONLINE_PAYMENT_OPTIONS.filter((option) => isMethodEnabled(option, paymentConfig?.chapa)),
    [paymentConfig]
  );

  const shippingCost = totalPrice >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_COST;
  const discount = 0;
  const grandTotal = Number((totalPrice + shippingCost - discount).toFixed(2));

  const isOnline = isOnlinePaymentMethod(paymentMethod);
  const isBankTransfer = paymentMethod === 'Bank Transfer';
  const isCashOnDelivery = paymentMethod === 'Cash on Delivery';

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    setError(null);

    if (!phoneNumber.trim() || !address.trim() || !city.trim() || !postalCode.trim() || !country.trim()) {
      setError('Please fill in your phone number and all required shipping address fields.');
      return;
    }
    if (isBankTransfer && !transactionReference.trim()) {
      setError('Enter the bank transfer transaction reference so we can verify your payment.');
      return;
    }

    try {
      setLoading(true);

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
        paymentMethod,
        deliveryDetails: { region, deliveryInstructions },
        ...(isBankTransfer ? { transactionReference: transactionReference.trim() } : {}),
      };

      const { data } = await api.post('/orders', orderPayload);
      clearCart();

      if (isOnline) {
        // Online payments always redirect to the gateway's secure hosted checkout.
        try {
          const { data: checkout } = await api.post(`/payments/chapa/initialize/${data._id}`);
          window.location.assign(checkout.checkoutUrl);
          return;
        } catch (initError) {
          navigate(`/orders/${data._id}`, {
            replace: true,
            state: {
              paymentActionError: initError.response?.data?.message
                || 'Secure checkout could not be opened. You can retry payment from your order.',
            },
          });
          return;
        }
      }

      if (isBankTransfer && receiptFile) {
        try {
          const receipt = new FormData();
          receipt.append('receipt', receiptFile);
          await api.post(`/payments/bank-transfer/${data._id}/receipt`, receipt, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch (uploadError) {
          setError(uploadError.response?.data?.message
            || 'Your order was placed, but the receipt could not be uploaded. You can upload it from the order page.');
        }
      }

      navigate(`/payment/result/${data._id}`, {
        state: { newOrderPlaced: true, orderNumber: data.orderNumber },
      });
    } catch (err) {
      console.error('Failed to place order:', err);
      setError(
        err.response?.data?.message || 'An error occurred while placing your order. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

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

  const placeOrderLabel = isOnline
    ? `Pay Securely (${formatPrice(grandTotal, 'ETB')})`
    : `Place Order (${formatPrice(grandTotal, 'ETB')})`;

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
                  <h3>Online payment (ETB)</h3>
                  {ONLINE_PAYMENT_OPTIONS.map((option) => {
                    const enabled = isMethodEnabled(option, paymentConfig?.chapa);
                    return (
                      <label
                        key={option.value}
                        className={`payment-radio-label ${paymentMethod === option.value ? 'selected' : ''} ${enabled ? '' : 'disabled'}`}
                      >
                        <input
                          type="radio"
                          name="paymentMethod"
                          value={option.value}
                          checked={paymentMethod === option.value}
                          disabled={!enabled}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                        />
                        <span className="payment-icon" aria-hidden="true">{option.icon}</span>
                        <div>
                          <strong>{option.label}</strong>
                          <p>{option.description}</p>
                          {!enabled && <small>Currently unavailable</small>}
                        </div>
                      </label>
                    );
                  })}
                  {configLoaded && !chapaEnabled && (
                    <p className="payment-config-message">
                      Online card and mobile-money payments are not available right now.
                      {paymentConfig?.chapa?.message ? ` ${paymentConfig.chapa.message}` : ''}
                    </p>
                  )}
                  {chapaEnabled && onlineMethodsAvailable.length > 0 && (
                    <p className="payment-config-message">
                      You will be redirected to the secure {paymentConfig?.chapa?.mode === 'live' ? 'live' : 'sandbox'} checkout to complete your payment.
                    </p>
                  )}
                </div>

                <div className="payment-group">
                  <h3>Other methods</h3>

                  <label className={`payment-radio-label ${isBankTransfer ? 'selected' : ''} ${bankTransferConfigured ? '' : 'disabled'}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="Bank Transfer"
                      checked={isBankTransfer}
                      disabled={!bankTransferConfigured}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                    />
                    <span className="payment-icon" aria-hidden="true">🏦</span>
                    <div>
                      <strong>Bank Transfer</strong>
                      <p>Transfer to our bank account, then submit the reference</p>
                      {!bankTransferConfigured && <small>Not configured for this store</small>}
                    </div>
                  </label>

                  <label className={`payment-radio-label ${isCashOnDelivery ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="Cash on Delivery"
                      checked={isCashOnDelivery}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                    />
                    <span className="payment-icon" aria-hidden="true">💵</span>
                    <div>
                      <strong>Cash on Delivery (COD)</strong>
                      <p>Pay in cash when your order is delivered</p>
                    </div>
                  </label>
                </div>
              </div>

              {isBankTransfer && bankTransferConfigured && (
                <div className="bank-transfer-details" style={{ marginTop: '16px' }}>
                  <h4>Bank transfer instructions</h4>
                  <p><span>Bank name</span><strong>{paymentConfig.bankTransfer.bankName}</strong></p>
                  <p><span>Account name</span><strong>{paymentConfig.bankTransfer.accountName}</strong></p>
                  <p><span>Account number</span><strong>{paymentConfig.bankTransfer.accountNumber}</strong></p>
                  {paymentConfig.bankTransfer.branch && (
                    <p><span>Branch</span><strong>{paymentConfig.bankTransfer.branch}</strong></p>
                  )}
                  <p><span>Exact amount</span><strong>{formatPrice(grandTotal, 'ETB')}</strong></p>
                  <small>
                    Transfer the exact amount, then enter the transaction reference below.
                    Upload your receipt now or later from the order page. Your payment stays
                    &ldquo;Awaiting Verification&rdquo; until our team confirms it.
                  </small>
                </div>
              )}

              {isBankTransfer && (
                <div className="form-group" style={{ marginTop: '16px' }}>
                  <label htmlFor="transactionReference">Transaction Reference *</label>
                  <input
                    id="transactionReference"
                    type="text"
                    maxLength="200"
                    placeholder="e.g. FT23012ABCD"
                    value={transactionReference}
                    onChange={(e) => setTransactionReference(e.target.value)}
                    className="form-input"
                  />
                </div>
              )}

              {isBankTransfer && (
                <div className="form-group">
                  <label htmlFor="receiptFile">Payment Receipt (optional: JPG, PNG, WebP, or PDF)</label>
                  <input
                    id="receiptFile"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                    className="form-input"
                  />
                </div>
              )}

              {isCashOnDelivery && (
                <div className="bank-transfer-details" style={{ marginTop: '16px' }}>
                  <h4>Cash on Delivery</h4>
                  <p><span>Amount due on delivery</span><strong>{formatPrice(grandTotal, 'ETB')}</strong></p>
                  <small>
                    No online payment is required now. Please have the exact amount ready for the
                    delivery agent. This order is marked <strong>Unpaid</strong> until collection.
                  </small>
                </div>
              )}
            </form>
          </div>

          {/* Right: Order Review */}
          <div className="checkout-summary-col">
            <div className="order-summary-card">
              <h3 className="summary-title">Order Summary ({totalItems} items)</h3>

              <div className="checkout-items-preview">
                {cartItems.map((item) => (
                  <div key={item.product} className="checkout-item-compact">
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
                    </div>
                    <span className="checkout-item-subtotal">{formatPrice(item.price * item.qty, item.currency)}</span>
                  </div>
                ))}
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
                disabled={loading}
                className="btn-primary btn-checkout-action"
              >
                {loading ? 'Processing…' : placeOrderLabel}
              </button>

              <p className="stock-notice">
                {isOnline
                  ? '🔒 You will be redirected to the secure payment gateway to complete your purchase.'
                  : '⚡ Fast order processing and instant order confirmation.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutPage;
