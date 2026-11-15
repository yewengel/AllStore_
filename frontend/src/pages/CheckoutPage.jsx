import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import api, { getProductImageUrl } from '../api/axios';
import { toEtb } from '../utils/currency';
import { useCurrency } from '../context/CurrencyContext';
import { ONLINE_PAYMENT_OPTIONS } from '../utils/payment';

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
  const [paymentMethod, setPaymentMethod] = useState('');
  const [transactionReference, setTransactionReference] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);

  const [paymentConfig, setPaymentConfig] = useState(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const submittingRef = useRef(false);
  const checkoutRequestRef = useRef({ fingerprint: '', key: '' });

  useEffect(() => {
    let active = true;
    api.get('/payment-settings/public')
      .then(({ data }) => {
        if (!active) return;
        setPaymentConfig(data);
        const configuredMethods = Object.keys(data?.paymentMethods || {});
        setPaymentMethod(configuredMethods[0] || '');
      })
      .catch(() => { if (active) setPaymentConfig(null); })
      .finally(() => { if (active) setConfigLoaded(true); });
    return () => { active = false; };
  }, []);

  const paymentMethods = useMemo(() => {
    const configured = paymentConfig?.paymentMethods || {};
    const methodDetails = {
      'Bank Transfer': {
        label: 'Bank Transfer',
        icon: '🏦',
        description: 'Transfer to the store bank account and submit your receipt.',
      },
      ...Object.fromEntries(ONLINE_PAYMENT_OPTIONS.map((option) => [option.value, option])),
    };
    return Object.entries(configured)
      .filter(([, details]) => details && typeof details === 'object')
      .map(([value, details]) => ({ value, ...methodDetails[value], details }));
  }, [paymentConfig]);

  const shippingCost = totalPrice >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_COST;
  const discount = 0;
  const grandTotal = Number((totalPrice + shippingCost - discount).toFixed(2));

  const selectedMethod = paymentMethods.find((method) => method.value === paymentMethod);

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);

    if (!phoneNumber.trim() || !address.trim() || !city.trim() || !postalCode.trim() || !country.trim()) {
      setError('Please fill in your phone number and all required shipping address fields.');
      return;
    }
    if (!selectedMethod) {
      setError('There are no configured online payment methods available. Please contact the store.');
      return;
    }
    if (!receiptFile) {
      setError('Upload your payment screenshot or receipt before submitting the order.');
      return;
    }

    submittingRef.current = true;
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
        ...(transactionReference.trim() ? { transactionReference: transactionReference.trim() } : {}),
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
      const receipt = new FormData();
      receipt.append('receipt', receiptFile);
      if (transactionReference.trim()) receipt.append('transactionReference', transactionReference.trim());
      try {
        await api.post(`/payments/bank-transfer/${data._id}/receipt`, receipt, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } catch (uploadError) {
        clearCart();
        navigate(`/orders/${data._id}`, {
          replace: true,
          state: {
            paymentActionError: uploadError.response?.data?.message
              || 'Your order was created, but the receipt could not be uploaded. Please submit it from this page.',
          },
        });
        return;
      }

      clearCart();
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
      submittingRef.current = false;
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

  const placeOrderLabel = `Submit Payment Proof (${formatPrice(grandTotal, 'ETB')})`;

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
                  <h3>Pay online (ETB)</h3>
                  {paymentMethods.map((method) => (
                    <label
                      key={method.value}
                      className={`payment-radio-label ${paymentMethod === method.value ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={method.value}
                        checked={paymentMethod === method.value}
                        onChange={(event) => setPaymentMethod(event.target.value)}
                      />
                      <span className="payment-icon" aria-hidden="true">{method.icon}</span>
                      <div><strong>{method.label}</strong><p>{method.description}</p></div>
                    </label>
                  ))}
                  {configLoaded && !paymentMethods.length && (
                    <p className="payment-config-message">
                      Online payment is not available yet. The store owner must configure a payment method.
                    </p>
                  )}
                </div>
              </div>

              {selectedMethod && (
                <div className="bank-transfer-details" style={{ marginTop: '16px' }}>
                  <h4>{selectedMethod.label} payment instructions</h4>
                  {selectedMethod.value === 'Bank Transfer' && <>
                    <p><span>Bank name</span><strong>{selectedMethod.details.bankName}</strong></p>
                    <p><span>Account holder</span><strong>{selectedMethod.details.accountName}</strong></p>
                    <p><span>Account number</span><strong>{selectedMethod.details.accountNumber}</strong></p>
                    {selectedMethod.details.branch && <p><span>Branch</span><strong>{selectedMethod.details.branch}</strong></p>}
                  </>}
                  {selectedMethod.value === 'Telebirr' && <>
                    <p><span>Business name</span><strong>{selectedMethod.details.businessName}</strong></p>
                    <p><span>Merchant account / number</span><strong>{selectedMethod.details.accountDetails}</strong></p>
                  </>}
                  {selectedMethod.value === 'CBE Birr' && <>
                    <p><span>Account holder</span><strong>{selectedMethod.details.accountName}</strong></p>
                    <p><span>Account / merchant details</span><strong>{selectedMethod.details.accountDetails}</strong></p>
                  </>}
                  {selectedMethod.details.instructions && <p><span>Instructions</span><strong>{selectedMethod.details.instructions}</strong></p>}
                  <p><span>Exact amount</span><strong>{formatPrice(grandTotal, 'ETB')}</strong></p>
                  <small>Pay the exact amount using your banking or payment app, then submit a screenshot or receipt. Your order will not be processed until an Admin verifies the payment.</small>
                </div>
              )}

              {selectedMethod && (
                <div className="form-group" style={{ marginTop: '16px' }}>
                  <label htmlFor="transactionReference">Payment Transaction Reference (if available)</label>
                  <input
                    id="transactionReference"
                    type="text"
                    maxLength="200"
                    placeholder="Enter the reference from your payment app"
                    value={transactionReference}
                    onChange={(e) => setTransactionReference(e.target.value)}
                    className="form-input"
                  />
                </div>
              )}

              {selectedMethod && (
                <div className="form-group">
                  <label htmlFor="receiptFile">Upload Payment Screenshot / Receipt (JPG, JPEG, PNG, or PDF) *</label>
                  <input
                    id="receiptFile"
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                    onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                    className="form-input"
                    required
                  />
                </div>
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
                disabled={loading || !selectedMethod}
                className="btn-primary btn-checkout-action"
              >
                {loading ? 'Processing…' : placeOrderLabel}
              </button>

              <p className="stock-notice">
                {'🔒 Your payment proof will be verified by an Admin before your order is processed.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutPage;
