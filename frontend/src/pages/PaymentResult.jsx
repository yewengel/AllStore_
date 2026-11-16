import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useCurrency } from '../context/CurrencyContext';
import {
  paymentMethodLabel,
  paymentStatusLabel,
  paymentStatusClass,
} from '../utils/payment';

const formatDate = (value) => value
  ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  : '—';

const OUTCOMES = {
  success: {
    icon: '✓',
    title: 'Payment Confirmed',
    message: 'Your payment was verified by our team. Thank you for your purchase.',
  },
  pending: {
    icon: '→',
    title: 'Awaiting Payment',
    message: 'Your order is reserved. Transfer the exact amount to the account below using your bank or mobile-money app. Then submit your receipt from Order Details. No transfer has been made or verified by AllStore.',
  },
  verification: {
    icon: '⏳',
    title: 'Pending Verification',
    message: 'Your receipt has been submitted. An administrator will verify the transfer in the receiving account before marking it paid.',
  },
  failed: {
    icon: '✕',
    title: 'Payment Rejected',
    message: 'Your payment proof was rejected. Review the reason and upload corrected proof from your order.',
  },
  cancelled: {
    icon: '⊘',
    title: 'Payment Cancelled',
    message: 'This payment was cancelled. Your order will not be processed until payment is completed.',
  },
};

const PaymentResult = () => {
  const { id } = useParams();
  const { formatPrice } = useCurrency();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get(`/orders/${id}`)
      .then(({ data }) => { if (active) setOrder(data); })
      .catch((fetchError) => {
        if (active) setError(fetchError.response?.data?.message || 'Order details could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [id]);

  const outcome = useMemo(() => {
    if (!order) return 'pending';
    if (order.isPaid || order.paymentStatus === 'Paid') return 'success';
    if (order.orderStatus === 'Cancelled' || order.paymentStatus === 'Cancelled') return 'cancelled';
    if (order.paymentStatus === 'Failed' || order.paymentStatus === 'Rejected') return 'failed';
    if (order.paymentStatus === 'Pending Verification') return 'verification';
    return 'pending';
  }, [order]);

  const items = useMemo(() => order?.orderItems?.length ? order.orderItems : order?.items || [], [order]);
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.price * item.qty, 0), [items]);

  if (loading) {
    return <div className="container orders-state-card" role="status"><span className="spinner" /><p>Checking your payment…</p></div>;
  }

  if (!order) {
    return (
      <div className="container payment-result-page">
        <div className="orders-state-card orders-error-state" role="alert">
          <h1>Payment result unavailable</h1>
          <p>{error || 'We could not load this payment result.'}</p>
          <Link to="/my-orders" className="btn-primary">Go to My Orders</Link>
        </div>
      </div>
    );
  }

  const details = OUTCOMES[outcome];
  const orderId = order.orderNumber || `#${order._id.slice(-8).toUpperCase()}`;
  const methodLabel = paymentMethodLabel(order.paymentMethod, order.paymentChannel);
  const statusLabel = paymentStatusLabel(order.paymentStatus, { isPaid: order.isPaid, paymentMethod: order.paymentMethod });
  const statusClass = paymentStatusClass(order.paymentStatus, { isPaid: order.isPaid, paymentMethod: order.paymentMethod });

  const outcomeMessage = (() => {
    if (order.paymentStatus === 'Rejected') {
      return `Your payment was rejected: ${order.paymentReviewNote || 'Please upload corrected payment proof from Order Details.'}`;
    }
    if (outcome !== 'pending') return details.message;
    return details.message;
  })();

  return (
    <div className="payment-result-page">
      <div className="container">
        <section className={`payment-result-card payment-result-${outcome}`}>
          <div className="payment-result-badge" aria-hidden="true">{details.icon}</div>
          <h1 className="payment-result-title">{details.title}</h1>
          <p className="payment-result-message">{outcomeMessage}</p>

          {error && <p className="payment-result-note" role="alert">{error}</p>}

          <div className="payment-result-grid">
            <div><span>Order number</span><strong>{orderId}</strong></div>
            <div><span>Payment method</span><strong>{methodLabel}</strong></div>
            <div>
              <span>Payment status</span>
              <strong className={`payment-state ${statusClass}`}>{statusLabel}</strong>
            </div>
            <div>
              <span>Amount</span>
              <strong>{formatPrice(order.paymentAmount ?? order.totalPrice, order.paymentCurrency || order.currency || 'ETB')}</strong>
            </div>
            <div><span>Currency</span><strong>{order.paymentCurrency || order.currency || 'ETB'}</strong></div>
            <div><span>Payment date</span><strong>{formatDate(order.paymentDate || order.paidAt)}</strong></div>
            {order.transactionReference && (
              <div><span>Transaction reference</span><strong>{order.transactionReference}</strong></div>
            )}
          </div>

          {order.paymentAccountSnapshot && outcome !== 'success' && (
            <div className="bank-transfer-details">
              <h4>{order.paymentAccountSnapshot.name} transfer details</h4>
              <p><span>Provider</span><strong>{order.paymentAccountSnapshot.provider}</strong></p>
              <p><span>Account holder</span><strong>{order.paymentAccountSnapshot.accountHolder}</strong></p>
              <p><span>Account number / mobile-money number</span><strong>{order.paymentAccountSnapshot.accountDetails}</strong></p>
              {order.paymentAccountSnapshot.branch && <p><span>Branch</span><strong>{order.paymentAccountSnapshot.branch}</strong></p>}
              {order.paymentAccountSnapshot.instructions && <p><span>Instructions</span><strong>{order.paymentAccountSnapshot.instructions}</strong></p>}
              <p><span>Exact amount to transfer</span><strong>{formatPrice(order.paymentAmount ?? order.totalPrice, order.paymentCurrency || order.currency || 'ETB')}</strong></p>
            </div>
          )}

          <div className="payment-result-actions">
            <Link to={`/orders/${order._id}`} className="btn-primary">
              {order.paymentStatus === 'Pending Verification' ? 'View Order' : 'View Order & Submit Receipt'}
            </Link>
            <Link to={`/orders/track/${order._id}`} className="btn-secondary">Track Order</Link>
            <Link to="/products" className="btn-secondary">Continue Shopping</Link>
          </div>
        </section>

        <section className="payment-result-summary">
          <h2>Order details</h2>
          <div className="checkout-items-preview">
            {items.map((item, index) => (
              <div key={`${item.product?._id || item.product || item.name}-${index}`} className="checkout-item-compact">
                <img
                  src={getProductImageUrl(item.image)}
                  alt={item.name}
                  className="checkout-thumb"
                  onError={(event) => { event.currentTarget.src = '/uploads/sample-product.svg'; }}
                />
                <div className="checkout-item-details">
                  <span className="checkout-item-name">{item.name}</span>
                  <span className="checkout-item-meta">Qty: {item.qty} × {formatPrice(item.price, item.currency || order.currency)}</span>
                  {Object.entries(item.options || {}).map(([name, value]) => (
                    <span className="checkout-item-meta" key={name}>{name}: {value}</span>
                  ))}
                </div>
                <span className="checkout-item-subtotal">{formatPrice(item.price * item.qty, item.currency || order.currency)}</span>
              </div>
            ))}
          </div>

          <div className="summary-divider"></div>
          <div className="summary-line"><span>Subtotal</span><span>{formatPrice(order.subtotal ?? subtotal, order.currency)}</span></div>
          <div className="summary-line">
            <span>Delivery fee</span>
            <span>{(order.shippingCost ?? 0) > 0 ? formatPrice(order.shippingCost, order.currency) : 'Free'}</span>
          </div>
          {(order.discountAmount ?? 0) > 0 && (
            <div className="summary-line"><span>Discount</span><span>−{formatPrice(order.discountAmount, order.currency)}</span></div>
          )}
          <div className="summary-total-line">
            <span>Total</span>
            <span className="summary-grand-total">{formatPrice(order.totalPrice, order.currency)}</span>
          </div>
        </section>
      </div>
    </div>
  );
};

export default PaymentResult;
