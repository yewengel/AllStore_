import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import OrderStatusBadge from '../components/OrderStatusBadge';
import { useCurrency } from '../context/CurrencyContext';
import { paymentMethodLabel, paymentStatusLabel, paymentStatusClass } from '../utils/payment';

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@allstore.com';
const formatDate = (value) => value
  ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  : '—';

const OrderDetailsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { formatPrice } = useCurrency();
  const [orderResult, setOrderResult] = useState({ id: null, order: null, error: '' });
  const [actionError, setActionError] = useState(location.state?.paymentActionError || '');
  const [canceling, setCanceling] = useState(false);
  const [paymentConfig, setPaymentConfig] = useState(null);
  const [paymentActionLoading, setPaymentActionLoading] = useState(false);
  const [receiptFile, setReceiptFile] = useState(null);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const isChapaReturn = new URLSearchParams(location.search).get('payment') === 'chapa';
  const isVerifyingPayment = isChapaReturn || paymentActionLoading;
  const loading = orderResult.id !== id;
  const order = loading ? null : orderResult.order;
  const error = loading ? '' : orderResult.error;

  useEffect(() => {
    let active = true;
    api.get(`/orders/${id}`)
      .then(({ data }) => {
        if (active) setOrderResult({ id, order: data, error: '' });
      })
      .catch((requestError) => {
        if (active) setOrderResult({
          id,
          order: null,
          error: requestError.response?.data?.message || 'Order details could not be loaded.',
        });
      });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    api.get('/payments/config')
      .then(({ data }) => setPaymentConfig(data))
      .catch(() => setPaymentConfig(null));
  }, []);

  useEffect(() => {
    if (!isChapaReturn) return undefined;
    let active = true;
    api.post(`/payments/chapa/verify/${id}`)
      .then(() => api.get(`/orders/${id}`))
      .then(({ data }) => {
        if (active) setOrderResult({ id, order: data, error: '' });
      })
      .catch((requestError) => {
        if (active) setActionError(requestError.response?.data?.message || 'Payment verification is still pending. Refresh this page shortly.');
      })
      .finally(() => {
        if (active) {
          setPaymentActionLoading(false);
          navigate(`/orders/${id}`, { replace: true });
        }
      });
    return () => { active = false; };
  }, [id, isChapaReturn, navigate]);

  const items = useMemo(() => order?.orderItems?.length
    ? order.orderItems
    : order?.items || [], [order]);
  const calculatedSubtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.qty, 0),
    [items]
  );
  const subtotal = order?.subtotal ?? calculatedSubtotal;
  const discount = order?.discountAmount || 0;
  const deliveryFee = order?.shippingCost ?? Math.max(0, order?.totalPrice - subtotal + discount);
  const canCancel = ['Pending', 'Confirmed'].includes(order?.orderStatus) && !order?.isPaid;
  const paymentStatus = order?.isPaid ? 'Paid' : order?.paymentStatus || 'Pending';
  const canPayOnline = order?.paymentMethod === 'Chapa Checkout' && ['Pending', 'Failed'].includes(paymentStatus);
  const canSubmitReceipt = order?.paymentMethod === 'Bank Transfer' &&
    ['Pending', 'Pending Verification', 'Rejected'].includes(paymentStatus) && !order?.isPaid;

  const handlePayNow = async () => {
    try {
      setPaymentActionLoading(true);
      setActionError('');
      const { data } = await api.post(`/payments/chapa/initialize/${id}`);
      window.location.assign(data.checkoutUrl);
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Secure Chapa checkout could not be opened.');
    } finally {
      setPaymentActionLoading(false);
    }
  };

  const handleReceiptUpload = async (event) => {
    event.preventDefault();
    if (!receiptFile) {
      setActionError('Choose a payment receipt before submitting.');
      return;
    }
    try {
      setPaymentActionLoading(true);
      setActionError('');
      const receipt = new FormData();
      receipt.append('receipt', receiptFile);
      await api.post(`/payments/bank-transfer/${id}/receipt`, receipt, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const { data } = await api.get(`/orders/${id}`);
      setOrderResult({ id, order: data, error: '' });
      setReceiptFile(null);
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Payment receipt could not be submitted.');
    } finally {
      setPaymentActionLoading(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!window.confirm('Cancel this order? Items will be returned to inventory.')) return;
    try {
      setCanceling(true);
      setActionError('');
      const { data } = await api.patch(`/orders/${id}/cancel`);
      setOrderResult({ id, order: data, error: '' });
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'This order could not be cancelled.');
    } finally {
      setCanceling(false);
    }
  };

  const handleDownloadReceipt = async () => {
    try {
      setDownloadingReceipt(true);
      setActionError('');
      const response = await api.get(`/payments/bank-transfer/${id}/receipt`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = order?.paymentReceipt?.originalName || 'payment-receipt';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setActionError('The payment receipt could not be downloaded.');
    } finally {
      setDownloadingReceipt(false);
    }
  };

  if (loading) {
    return <div className="container orders-state-card" role="status"><span className="spinner" /><p>Loading order details…</p></div>;
  }

  if (error || !order) {
    return (
      <div className="container order-detail-page">
        <div className="orders-state-card orders-error-state" role="alert">
          <h1>Order details unavailable</h1>
          <p>{error || 'Order not found.'}</p>
          <Link to="/my-orders" className="btn-primary">Back to My Orders</Link>
        </div>
      </div>
    );
  }

  const address = order.shippingAddress || {};
  const orderId = order.orderNumber || `#${order._id.slice(-8).toUpperCase()}`;
  const methodLabel = paymentMethodLabel(order.paymentMethod, order.paymentChannel);
  const statusLabel = paymentStatusLabel(paymentStatus, { isPaid: order.isPaid, paymentMethod: order.paymentMethod });
  const statusClass = paymentStatusClass(paymentStatus, { isPaid: order.isPaid, paymentMethod: order.paymentMethod });

  return (
    <div className="orders-page order-detail-page">
      <div className="container">
        <div className="order-detail-page-header">
          <div>
            <Link to="/my-orders" className="order-back-link">← Back to My Orders</Link>
            <h1 className="page-title">Order Details</h1>
            <p className="page-description">Review your purchase and delivery information.</p>
          </div>
          <OrderStatusBadge status={order.orderStatus} />
        </div>

        {actionError && <p className="orders-feedback error" role="alert">{actionError}</p>}

        <section className="order-detail-overview">
          <div><span>Order ID</span><strong>{orderId}</strong></div>
          <div><span>Order date</span><strong>{formatDate(order.createdAt)}</strong></div>
          <div><span>Order status</span><strong>{order.orderStatus || '—'}</strong></div>
          <div><span>Total amount</span><strong>{formatPrice(order.totalPrice, order.currency)}</strong></div>
          <div><span>Payment method</span><strong>{methodLabel}</strong></div>
          <div><span>Payment status</span><strong className={`payment-state ${statusClass}`}>{statusLabel}</strong></div>
        </section>

        <div className="order-details-layout">
          <div className="order-details-main">
            <section className="order-detail-panel">
              <div className="order-detail-section-heading"><h2>Ordered products</h2><span>{items.length} {items.length === 1 ? 'item' : 'items'}</span></div>
              <div className="order-detail-product-list">
                {items.map((item, index) => (
                  <article className="order-detail-product" key={`${item.product?._id || item.product || item.name}-${index}`}>
                    <img
                      src={getProductImageUrl(item.image)}
                      alt={item.name}
                      onError={(event) => { event.currentTarget.src = '/uploads/sample-product.svg'; }}
                    />
                    <div className="order-detail-product-info">
                      <strong>{item.name}</strong>
                      <span>Quantity: {item.qty}</span>
                      <span>Unit price: {formatPrice(item.price, item.currency || order.currency)}</span>
                    </div>
                    <strong className="order-detail-line-total">{formatPrice(item.price * item.qty, item.currency || order.currency)}</strong>
                  </article>
                ))}
              </div>
            </section>

            <section className="order-detail-panel">
              <div className="order-detail-section-heading"><h2>Delivery information</h2></div>
              <dl className="order-delivery-information">
                <div><dt>Customer name</dt><dd>{order.customerName || order.user?.name || '—'}</dd></div>
                <div><dt>Phone number</dt><dd>{order.phoneNumber || '—'}</dd></div>
                <div><dt>Street address</dt><dd>{address.address || order.deliveryAddress || '—'}</dd></div>
                <div><dt>City</dt><dd>{address.city || '—'}</dd></div>
                <div><dt>Region</dt><dd>{address.region || '—'}</dd></div>
                <div><dt>Country</dt><dd>{address.country || '—'}</dd></div>
                <div><dt>Postal code</dt><dd>{address.postalCode || '—'}</dd></div>
              </dl>
            </section>
          </div>

          <aside className="order-detail-sidebar">
            <section className="order-detail-panel order-price-summary">
              <h2>Price summary</h2>
              <div><span>Subtotal</span><strong>{formatPrice(subtotal, order.currency)}</strong></div>
              <div><span>Delivery fee</span><strong>{deliveryFee ? formatPrice(deliveryFee, order.currency) : 'Free'}</strong></div>
              {discount > 0 && <div><span>Discount</span><strong className="order-discount">−{formatPrice(discount, order.currency)}</strong></div>}
              <div className="order-price-total"><span>Total</span><strong>{formatPrice(order.totalPrice, order.currency)}</strong></div>
            </section>

            <section className="order-detail-panel order-payment-details">
              <h2>Payment details</h2>
              <div className="order-payment-detail-list">
                <div><span>Payment method</span><strong>{methodLabel}</strong></div>
                <div><span>Transaction reference</span><strong>{order.transactionReference || '—'}</strong></div>
                <div>
                  <span>Payment amount</span>
                  <strong>{formatPrice(order.paymentAmount ?? order.totalPrice, order.paymentCurrency || order.currency)}</strong>
                </div>
                <div>
                  <span>Payment status</span>
                  <strong className={`payment-state ${statusClass}`}>{statusLabel}</strong>
                </div>
                <div>
                  <span>Payment date</span>
                  <strong>{order.paymentDate || order.paidAt ? formatDate(order.paymentDate || order.paidAt) : '—'}</strong>
                </div>
              </div>
              {order.paymentReceipt ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleDownloadReceipt}
                  disabled={downloadingReceipt}
                >
                  {downloadingReceipt ? 'Preparing…' : 'Download bank receipt'}
                </button>
              ) : (
                <p className="payment-receipt-status">No bank receipt on file.</p>
              )}
            </section>

            <section className="order-detail-panel order-detail-actions">
              <h2>Need help?</h2>
              <Link to={`/orders/track/${order._id}`} className="btn-primary">Track Order</Link>
              <a className="btn-secondary" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Help with order ${orderId}`)}`}>Contact Support</a>
              {canPayOnline && (
                <button type="button" className="btn-primary" onClick={handlePayNow} disabled={isVerifyingPayment}>
                  {isVerifyingPayment ? 'Verifying payment…' : `Pay Now (${formatPrice(order.paymentAmount ?? order.totalPrice, order.paymentCurrency || order.currency)})`}
                </button>
              )}
              {order.paymentMethod === 'Bank Transfer' && order.paymentReceipt && (
                <p className="payment-receipt-status">Receipt submitted: {order.paymentReceipt.originalName || 'Payment receipt'}</p>
              )}
              {canSubmitReceipt && (
                <form className="order-payment-receipt-form" onSubmit={handleReceiptUpload}>
                  {paymentConfig?.bankTransfer?.configured && (
                    <div className="order-bank-account">
                      <strong>Transfer to {paymentConfig.bankTransfer.bankName}</strong>
                      <span>{paymentConfig.bankTransfer.accountName}</span>
                      <span>Account: {paymentConfig.bankTransfer.accountNumber}</span>
                      {paymentConfig.bankTransfer.branch && <span>Branch: {paymentConfig.bankTransfer.branch}</span>}
                    </div>
                  )}
                  <label htmlFor="order-payment-receipt">Upload or replace transfer receipt</label>
                  <input id="order-payment-receipt" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} />
                  <button type="submit" className="btn-primary" disabled={paymentActionLoading || !receiptFile}>
                    {paymentActionLoading ? 'Submitting…' : 'Submit receipt for verification'}
                  </button>
                </form>
              )}
              {order.paymentStatus === 'Rejected' && order.paymentReviewNote && (
                <p className="payment-receipt-status">Transfer rejected: {order.paymentReviewNote}</p>
              )}
              {isVerifyingPayment && isChapaReturn && (
                <p className="payment-receipt-status" role="status">Verifying payment securely with Chapa…</p>
              )}
              {canCancel && (
                <button type="button" className="btn-cancel-order" onClick={handleCancelOrder} disabled={canceling}>
                  {canceling ? 'Cancelling…' : 'Cancel Order'}
                </button>
              )}
              <button type="button" className="order-back-button" onClick={() => navigate('/my-orders')}>Back to My Orders</button>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default OrderDetailsPage;
