const statusClassNames = {
  Pending: 'badge-pending',
  Confirmed: 'badge-confirmed',
  Processing: 'badge-processing',
  Shipped: 'badge-shipped',
  'Out for Delivery': 'badge-shipped',
  Delivered: 'badge-delivered',
  Cancelled: 'badge-cancelled',
};

const OrderStatusBadge = ({ status }) => (
  <span className={`order-status-pill ${statusClassNames[status] || 'badge-pending'}`}>
    <span className="status-dot-pulse" />
    {status || 'Pending'}
  </span>
);

export default OrderStatusBadge;
