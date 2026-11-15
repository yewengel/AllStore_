import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import OrderStatusBadge from '../components/OrderStatusBadge';
import OrderResolutionPanel from '../components/OrderResolutionPanel';
import { useCart } from '../context/CartContext';
import { useCurrency } from '../context/CurrencyContext';
import useOrderRefresh from '../hooks/useOrderRefresh';
import { paymentMethodLabel, paymentStatusLabel, paymentStatusClass } from '../utils/payment';

const ORDER_STATUSES = [
  'Pending',
  'Confirmed',
  'Processing',
  'Shipped',
  'Out for Delivery',
  'Delivered',
  'Cancelled',
];
const IN_PROGRESS_STATUSES = new Set(['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery']);
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@allstore.com';

const orderItems = (order) => order.orderItems?.length ? order.orderItems : order.items || [];
const orderLabel = (order) => order.orderNumber || `#${order._id.slice(-8).toUpperCase()}`;
const orderDate = (value) => new Date(value).toLocaleString('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const canCancelOrder = (order) => {
  return ['Pending', 'Confirmed'].includes(order.orderStatus) ||
    (order.orderStatus === 'Processing' && !order.shippingDate && !String(order.trackingNumber || '').trim());
};

const MyOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [sortOrder, setSortOrder] = useState('newest');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [workingOrderId, setWorkingOrderId] = useState('');
  const orderRequestInFlight = useRef(false);
  const hasLoadedOrders = useRef(false);
  const location = useLocation();
  const { addToCart } = useCart();
  const { formatPrice } = useCurrency();
  const justPlacedOrderNumber = location.state?.orderNumber;

  const loadOrders = useCallback(async (silent = false) => {
    if (orderRequestInFlight.current) return;
    orderRequestInFlight.current = true;
    if (!silent) {
      setLoading(true);
      setLoadError('');
    }

    try {
      const { data } = await api.get('/orders/my-orders');
      setOrders(Array.isArray(data) ? data : []);
      setLoadError('');
      hasLoadedOrders.current = true;
    } catch (error) {
      if (!silent || !hasLoadedOrders.current) {
        setLoadError(error.response?.data?.message || 'Your orders could not be loaded. Please try again.');
      }
    } finally {
      orderRequestInFlight.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadOrders());
  }, [loadOrders]);

  useOrderRefresh(() => loadOrders(true));

  const visibleOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...orders]
      .filter((order) => {
        const matchesId = !query ||
          orderLabel(order).toLowerCase().includes(query) ||
          order._id.toLowerCase().includes(query);
        const matchesStatus = statusFilter === 'All statuses' || order.orderStatus === statusFilter;
        return matchesId && matchesStatus;
      })
      .sort((a, b) => {
        const dateDifference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return sortOrder === 'newest' ? -dateDifference : dateDifference;
      });
  }, [orders, search, sortOrder, statusFilter]);

  const summary = useMemo(() => ({
    total: orders.length,
    inProgress: orders.filter((order) => IN_PROGRESS_STATUSES.has(order.orderStatus)).length,
    delivered: orders.filter((order) => order.orderStatus === 'Delivered').length,
  }), [orders]);

  const buyAgain = async (order) => {
    const items = orderItems(order);
    setWorkingOrderId(order._id);
    setActionError('');
    setActionMessage('');
    try {
      const results = await Promise.all(items.map(async (item) => {
        const productId = typeof item.product === 'string' ? item.product : item.product?._id;
        if (!productId) return { unavailable: true };
        try {
          const { data } = await api.get(`/products/${productId}`);
          return { item, product: data };
        } catch (error) {
          if (error.response?.status === 404) return { unavailable: true };
          throw error;
        }
      }));

      const available = results.filter(({ item, product, unavailable }) => {
        if (unavailable) return false;
        if (!item.variantId) return !product.variants?.length && product.stockQuantity > 0;
        return product.variants?.some((variant) =>
          String(variant._id) === String(item.variantId) && variant.stockQuantity >= item.qty
        );
      });
      available.forEach(({ item, product }) => {
        const variant = item.variantId
          ? product.variants.find((candidate) => String(candidate._id) === String(item.variantId))
          : null;
        addToCart(product, item.qty, variant);
      });
      const unavailableCount = results.length - available.length;
      setActionMessage(unavailableCount
        ? `${available.length} product${available.length === 1 ? '' : 's'} added. ${unavailableCount} item${unavailableCount === 1 ? ' is' : 's are'} no longer available.`
        : 'Your available products have been added to the cart.');
    } catch (error) {
      setActionError(error.response?.data?.message || 'Products could not be added to your cart. Please try again.');
    } finally {
      setWorkingOrderId('');
    }
  };

  const cancelOrder = async (order) => {
    const reason = window.prompt(`Why are you cancelling order ${orderLabel(order)}?`);
    if (reason === null) return;
    if (!reason.trim()) {
      setActionError('A cancellation reason is required.');
      return;
    }
    if (!window.confirm(`Cancel order ${orderLabel(order)}? Items will be returned to inventory.`)) return;
    setWorkingOrderId(order._id);
    setActionError('');
    setActionMessage('');
    try {
      const { data } = await api.patch(`/orders/${order._id}/cancel`, { reason: reason.trim() });
      setOrders((current) => current.map((item) => item._id === order._id ? data : item));
      setActionMessage('Your order has been cancelled.');
    } catch (error) {
      setActionError(error.response?.data?.message || 'This order could not be cancelled.');
    } finally {
      setWorkingOrderId('');
    }
  };

  return (
    <div className="orders-page customer-orders-page">
      <div className="container">
        <div className="page-header customer-orders-header">
          <div>
            <h1 className="page-title">My Orders</h1>
            <p className="page-description">View and track all your purchases.</p>
          </div>
          <Link to="/products" className="btn-secondary">Continue Shopping</Link>
        </div>

        {location.state?.newOrderPlaced && (
          <div className="alert-order-placed" role="status">
            <div className="alert-order-icon">✓</div>
            <div className="alert-order-text">
              <h3>Payment proof submitted</h3>
              <p>Your order has been submitted. Your payment proof is awaiting Admin verification. You will receive an update once your payment is confirmed.</p>
              {justPlacedOrderNumber && <p>Your Order ID is <strong>{justPlacedOrderNumber}</strong>.</p>}
            </div>
          </div>
        )}

        <section className="order-summary-grid" aria-label="Order summary">
          <article className="order-summary-card"><span>Total Orders</span><strong>{summary.total}</strong><small>All purchases</small></article>
          <article className="order-summary-card"><span>In Progress</span><strong>{summary.inProgress}</strong><small>Orders being fulfilled</small></article>
          <article className="order-summary-card"><span>Delivered</span><strong>{summary.delivered}</strong><small>Successfully received</small></article>
        </section>

        {actionError && <p className="orders-feedback error" role="alert">{actionError}</p>}
        {actionMessage && <p className="orders-feedback success" role="status">{actionMessage}</p>}

        <section className="orders-toolbar" aria-label="Search and filter orders">
          <label className="orders-search-field">
            <span>Search by order ID</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. AS-00125" />
          </label>
          <label className="orders-filter-field">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option>All statuses</option>
              {ORDER_STATUSES.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label className="orders-filter-field">
            <span>Sort by</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </section>

        {loading ? (
          <div className="orders-state-card" role="status"><span className="spinner" /><p>Loading your orders…</p></div>
        ) : loadError ? (
          <div className="orders-state-card orders-error-state" role="alert">
            <h2>Orders unavailable</h2><p>{loadError}</p>
            <button type="button" className="btn-primary" onClick={() => { setLoadError(''); setLoading(true); loadOrders(); }}>Try again</button>
          </div>
        ) : orders.length === 0 ? (
          <div className="orders-state-card">
            <span className="orders-empty-icon" aria-hidden="true">▧</span>
            <h2>No orders yet</h2>
            <p>Your purchases will appear here after you place an order.</p>
            <Link to="/products" className="btn-primary">Explore products</Link>
          </div>
        ) : visibleOrders.length === 0 ? (
          <div className="orders-state-card">
            <h2>No matching orders</h2><p>Try changing your search or status filter.</p>
            <button type="button" className="btn-secondary" onClick={() => { setSearch(''); setStatusFilter('All statuses'); }}>Clear filters</button>
          </div>
        ) : (
          <div className="orders-list customer-orders-list">
            {visibleOrders.map((order) => {
              const items = orderItems(order);
              const history = [...(order.trackingHistory || [])]
                .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
              const latestUpdate = history[history.length - 1];
              const paymentUpdate = order.paymentHistory?.[order.paymentHistory.length - 1];
              const cancellable = canCancelOrder(order);
              return (
                <article key={order._id} className="order-history-card customer-order-card">
                  <header className="customer-order-card-header">
                    <div className="customer-order-id-block">
                      <span className="order-id-label">Order ID</span>
                      <strong className="order-id-value">{orderLabel(order)}</strong>
                      <span className="order-date">Placed {orderDate(order.createdAt)}</span>
                    </div>
                    <OrderStatusBadge status={order.orderStatus} />
                  </header>

                  <section className="customer-order-update" aria-label="Latest order update">
                    <div className="customer-order-update-heading">
                      <strong>Latest update: {latestUpdate?.status || order.orderStatus || 'Pending'}</strong>
                      <time>{orderDate(latestUpdate?.timestamp || order.createdAt)}</time>
                    </div>
                    <p className="customer-order-system-update">{latestUpdate?.message || 'Your order has been received.'}</p>
                    {latestUpdate?.customerMessage ? (
                      <div className="customer-order-admin-message">
                        <strong>Message from AllStore</strong>
                        <p>{latestUpdate.customerMessage}</p>
                      </div>
                    ) : (
                      <p className="customer-order-no-message">No additional message from AllStore for this update.</p>
                    )}
                  </section>
                  <OrderResolutionPanel order={order} compact />

                  <div className="customer-order-items">
                    {items.map((item, index) => (
                      <div className="customer-order-item" key={`${item.product?._id || item.product || item.name}-${index}`}>
                        <img
                          src={getProductImageUrl(item.image)}
                          alt={item.name}
                          onError={(event) => { event.currentTarget.src = '/uploads/sample-product.svg'; }}
                        />
                        <div className="customer-order-item-info">
                          <strong>{item.name}</strong>
                          {Object.entries(item.options || {}).map(([name, value]) => (
                            <span key={name}>{name}: {value}</span>
                          ))}
                          <span>Qty {item.qty} · {formatPrice(item.price, item.currency || order.currency)} each</span>
                        </div>
                        <strong className="customer-order-item-total">{formatPrice(item.price * item.qty, item.currency || order.currency)}</strong>
                      </div>
                    ))}
                  </div>

                  <footer className="customer-order-card-footer">
                    <div className="customer-order-total">
                      <span>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
                      <span className="customer-order-payment">
                        {paymentMethodLabel(order.paymentMethod, order.paymentChannel)} ·{' '}
                        <strong className={`payment-state ${paymentStatusClass(order.paymentStatus, { isPaid: order.isPaid, paymentMethod: order.paymentMethod })}`}>
                          {paymentStatusLabel(order.paymentStatus, { isPaid: order.isPaid, paymentMethod: order.paymentMethod })}
                        </strong>
                      </span>
                      {order.paymentStatus === 'Rejected' && order.paymentReviewNote && (
                        <span className="payment-receipt-status">Payment rejected: {order.paymentReviewNote}</span>
                      )}
                      {paymentUpdate?.message && order.paymentStatus !== 'Rejected' && (
                        <span className="payment-receipt-status">{paymentUpdate.message}</span>
                      )}
                      <strong>Total <b>{formatPrice(order.totalPrice, order.currency)}</b></strong>
                    </div>
                    <div className="customer-order-actions">
                      <Link to={`/orders/track/${order._id}`} className="btn-secondary">Track Order</Link>
                      <Link to={`/orders/${order._id}`} className="btn-primary">View Order Details</Link>
                      {order.orderStatus === 'Delivered' && !order.returnRequest && (
                        <Link to={`/orders/${order._id}#returns`} className="btn-secondary">Request Return</Link>
                      )}
                      <button type="button" className="orders-text-button" onClick={() => buyAgain(order)} disabled={workingOrderId === order._id}>
                        {workingOrderId === order._id ? 'Adding…' : 'Buy Again'}
                      </button>
                      {cancellable && (
                        <button type="button" className="orders-text-button cancel-order-button" onClick={() => cancelOrder(order)} disabled={workingOrderId === order._id}>
                          Cancel Order
                        </button>
                      )}
                      <a className="orders-text-button support-order-button" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Help with order ${orderLabel(order)}`)}`}>
                        Contact Support
                      </a>
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyOrders;
