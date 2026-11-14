import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import OrderStatusBadge from '../components/OrderStatusBadge';
import { useCurrency } from '../context/CurrencyContext';

const MILESTONES = [
  { key: 'Pending', label: 'Order Placed', description: 'We received your order.' },
  { key: 'Confirmed', label: 'Order Confirmed', description: 'Your order has been confirmed.' },
  { key: 'Processing', label: 'Processing', description: 'Your items are being prepared.' },
  { key: 'Shipped', label: 'Shipped', description: 'Your package is on its way.' },
  { key: 'Out for Delivery', label: 'Out for Delivery', description: 'Your package is with the delivery courier.' },
  { key: 'Delivered', label: 'Delivered', description: 'Your order has arrived.' },
];
const STATUS_RANK = Object.fromEntries(MILESTONES.map((step, index) => [step.key, index]));

const formatDate = (value) => {
  if (!value) return 'Not available yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available yet';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const OrderTrack = () => {
  const { id } = useParams();
  const { formatPrice } = useCurrency();
  const [orderResult, setOrderResult] = useState({ id: null, order: null, error: '' });
  const loading = orderResult.id !== id;
  const order = loading ? null : orderResult.order;
  const error = loading ? '' : orderResult.error;

  useEffect(() => {
    let active = true;
    api.get(`/orders/track/${id}`)
      .then(({ data }) => {
        if (active) setOrderResult({ id, order: data, error: '' });
      })
      .catch((requestError) => {
        if (active) setOrderResult({
          id,
          order: null,
          error: requestError.response?.data?.message || 'Tracking information could not be loaded.',
        });
      });
    return () => { active = false; };
  }, [id]);

  const history = useMemo(() => {
    const entries = order?.trackingHistory || [];
    return [...entries].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  }, [order]);
  const latestUpdate = history.length ? history[history.length - 1] : null;
  const currentStatus = order?.orderStatus || 'Pending';
  const currentRank = STATUS_RANK[currentStatus] ?? -1;
  const orderLabel = order?.orderNumber || (order ? `#${order._id.slice(-8).toUpperCase()}` : '');
  const address = order?.shippingAddress;
  const items = order?.orderItems?.length ? order.orderItems : order?.items || [];
  const deliveryAddress = [
    address?.address,
    address?.subCity,
    address?.city,
    address?.region,
    address?.postalCode,
    address?.country,
  ].filter(Boolean).join(', ') || order?.deliveryAddress;

  if (loading) {
    return <div className="container orders-state-card" role="status"><span className="spinner" /><p>Loading tracking details…</p></div>;
  }

  if (error || !order) {
    return (
      <div className="container order-detail-page">
        <div className="orders-state-card orders-error-state" role="alert">
          <h1>Tracking information unavailable</h1>
          <p>{error || 'Order not found.'}</p>
          <Link to="/my-orders" className="btn-primary">Back to My Orders</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="orders-page tracking-page">
      <div className="container">
        <div className="order-detail-page-header">
          <div>
            <Link to="/my-orders" className="order-back-link">← Back to My Orders</Link>
            <h1 className="page-title">Track Your Order</h1>
            <p className="page-description">Delivery progress and updates for order {orderLabel}.</p>
          </div>
          <OrderStatusBadge status={currentStatus} />
        </div>

        <section className="tracking-summary-card">
          <div><span className="tracking-summary-label">Order ID</span><strong>{orderLabel}</strong></div>
          <div><span className="tracking-summary-label">Order date</span><strong>{formatDate(order.createdAt)}</strong></div>
          <div><span className="tracking-summary-label">Current status</span><strong>{currentStatus}</strong></div>
          <div><span className="tracking-summary-label">Estimated delivery</span><strong>{formatDate(order.estimatedDelivery)}</strong></div>
        </section>

        <div className="tracking-layout tracking-order-overview">
          <section className="tracking-card tracking-order-products">
            <div className="tracking-card-header"><h2>Items in this order</h2></div>
            <div className="tracking-product-list">
              {items.map((item, index) => (
                <article className="tracking-product-item" key={`${item.product?._id || item.product || item.name}-${index}`}>
                  <img src={getProductImageUrl(item.image)} alt={item.name} onError={(event) => { event.currentTarget.src = '/uploads/sample-product.svg'; }} />
                  <div><strong>{item.name}</strong><span>Qty {item.qty} · {formatPrice(item.price, item.currency || order.currency)} each</span></div>
                  <strong>{formatPrice(item.price * item.qty, item.currency || order.currency)}</strong>
                </article>
              ))}
              <div className="tracking-payment-summary">
                <div><span>Subtotal</span><strong>{formatPrice(order.subtotal ?? items.reduce((sum, item) => sum + item.price * item.qty, 0), order.currency)}</strong></div>
                <div><span>Delivery fee</span><strong>{order.shippingCost ? formatPrice(order.shippingCost, order.currency) : 'Free'}</strong></div>
                {order.discountAmount > 0 && <div><span>Discount</span><strong>−{formatPrice(order.discountAmount, order.currency)}</strong></div>}
                <div className="tracking-payment-total"><span>Order total</span><strong>{formatPrice(order.totalPrice, order.currency)}</strong></div>
                <div><span>Payment method</span><strong>{order.paymentMethod || 'Not provided'}</strong></div>
                <div><span>Payment status</span><strong>{order.isPaid ? 'Paid' : order.paymentStatus || 'Pending'}</strong></div>
                {order.transactionReference && <div><span>Transaction reference</span><strong>{order.transactionReference}</strong></div>}
              </div>
            </div>
          </section>

          <aside className="tracking-card tracking-side-card">
            <div className="tracking-card-header"><h2>Ship to</h2></div>
            <dl className="tracking-detail-list">
              <div><dt>Recipient</dt><dd>{order.recipientName || order.customerName || order.user?.name || 'Not provided'}</dd></div>
              <div><dt>Delivery phone</dt><dd>{order.deliveryPhoneNumber || order.phoneNumber || 'Not provided'}</dd></div>
              <div><dt>Delivery address</dt><dd>{deliveryAddress || 'Address not available'}</dd></div>
              {order.deliveryInstructions && <div><dt>Delivery instructions</dt><dd>{order.deliveryInstructions}</dd></div>}
            </dl>
          </aside>
        </div>

        {currentStatus === 'Cancelled' ? (
          <section className="tracking-cancelled-message" role="status">
            <span className="tracking-cancelled-icon" aria-hidden="true">×</span>
            <div><h2>This order was cancelled</h2><p>Delivery progress is no longer available for this order.</p></div>
          </section>
        ) : (
          <div className="tracking-layout">
            <section className="tracking-card">
              <div className="tracking-card-header"><h2>Delivery progress</h2></div>
              <div className="tracking-timeline">
                {MILESTONES.map((step, index) => {
                  const stepHistory = [...history].reverse().find((entry) => entry.status === step.key);
                  const state = index < currentRank ? 'completed' : index === currentRank ? 'current' : 'upcoming';
                  const timestamp = stepHistory?.timestamp || (step.key === 'Pending' ? order.createdAt : null);
                  return (
                    <article key={step.key} className={`tracking-step ${state}`}>
                      <div className="tracking-step-marker" aria-hidden="true">
                        <span>{state === 'completed' ? '✓' : state === 'current' ? '•' : ''}</span>
                      </div>
                      <div className="tracking-step-content">
                        <div className="tracking-step-topline">
                          <strong>{step.label}</strong>
                          <span className={`tracking-state ${state}`}>{state === 'completed' ? 'Completed' : state === 'current' ? 'Current' : 'Upcoming'}</span>
                        </div>
                        <small>{step.description}</small>
                        {state !== 'upcoming' && <time>{formatDate(timestamp)}</time>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <aside className="tracking-card tracking-side-card">
              <div className="tracking-card-header"><h2>Delivery information</h2></div>
              <dl className="tracking-detail-list">
                <div><dt>Tracking number</dt><dd>{order.trackingNumber || 'Not assigned yet'}</dd></div>
                <div><dt>Delivery company</dt><dd>{order.deliveryCompany || order.courierName || 'AllStore Delivery'}</dd></div>
                {order.deliveryPersonName && <div><dt>Delivery person</dt><dd>{order.deliveryPersonName}</dd></div>}
                {order.deliveryPersonPhone && <div><dt>Delivery phone</dt><dd>{order.deliveryPersonPhone}</dd></div>}
                <div><dt>Estimated delivery</dt><dd>{formatDate(order.estimatedDelivery)}</dd></div>
                <div><dt>Shipping date</dt><dd>{formatDate(order.shippingDate)}</dd></div>
                <div><dt>Delivered on</dt><dd>{formatDate(order.actualDeliveryDate || order.deliveredAt)}</dd></div>
              </dl>
              <div className="tracking-note-box">
                <strong>Latest delivery update</strong>
                <p>{latestUpdate?.message || 'No delivery updates have been provided yet.'}</p>
                {latestUpdate?.timestamp && <time>{formatDate(latestUpdate.timestamp)}</time>}
              </div>
              {order.deliveryNotes && (
                <div className="tracking-note-box">
                  <strong>Delivery notes</strong><p>{order.deliveryNotes}</p>
                </div>
              )}
            </aside>
          </div>
        )}

        {history.length > 0 && (
          <section className="tracking-card tracking-history-card">
            <div className="tracking-card-header"><h2>Status update history</h2></div>
            <div className="tracking-history-list">
              {[...history].reverse().map((entry, index) => (
                <article className="tracking-history-item" key={`${entry.status}-${entry.timestamp || index}`}>
                  <span className="tracking-history-marker" aria-hidden="true" />
                  <div><strong>{entry.previousStatus && entry.newStatus ? `${entry.previousStatus} → ${entry.newStatus}` : entry.status}</strong><p>{entry.message || 'Status updated'}{entry.adminNote ? ` ${entry.adminNote}` : ''}</p></div>
                  <time>{formatDate(entry.timestamp)}</time>
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="tracking-page-actions">
          <Link to={`/orders/${order._id}`} className="btn-secondary">View Order Details</Link>
          <Link to="/my-orders" className="btn-primary">Back to My Orders</Link>
        </div>
      </div>
    </div>
  );
};

export default OrderTrack;
