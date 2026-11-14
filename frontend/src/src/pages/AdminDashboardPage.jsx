import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { formatDualCurrency, toEtb } from '../utils/currency';
import './AdminDashboard.css';

const AdminCharts = lazy(() => import('./AdminCharts'));
const AdminPayments = lazy(() => import('./AdminPayments'));

const navigation = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'products', label: 'Products', icon: 'products' },
  { id: 'categories', label: 'Categories', icon: 'categories' },
  { id: 'orders', label: 'Orders', icon: 'orders' },
  { id: 'customers', label: 'Customers', icon: 'customers' },
  { id: 'inventory', label: 'Inventory', icon: 'inventory' },
  { id: 'reviews', label: 'Reviews', icon: 'reviews' },
  { id: 'sales-reports', label: 'Sales reports', icon: 'reports' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const paymentsNavigation = [
  { id: 'payment-overview', label: 'Payment Overview', icon: 'reports' },
  { id: 'payment-transactions', label: 'All Transactions', icon: 'orders' },
  { id: 'payment-bank-transfers', label: 'Bank Transfer Verification', icon: 'inventory' },
  { id: 'payment-cod', label: 'Cash on Delivery', icon: 'customers' },
  { id: 'payment-refunds', label: 'Refund Management', icon: 'reports' },
  { id: 'payment-settings', label: 'Payment Settings', icon: 'settings' },
];

const pageTitles = {
  overview: 'Overview',
  products: 'Products',
  categories: 'Categories',
  orders: 'Orders',
  customers: 'Customers',
  inventory: 'Inventory',
  reviews: 'Reviews',
  'sales-reports': 'Sales reports',
  settings: 'Settings',
  'payment-overview': 'Payment Overview',
  'payment-transactions': 'All Transactions',
  'payment-bank-transfers': 'Bank Transfer Verification',
  'payment-cod': 'Cash on Delivery',
  'payment-refunds': 'Refund Management',
  'payment-settings': 'Payment Settings',
};

const periods = {
  daily: { label: 'Daily', count: 12, duration: 24 * 60 * 60 * 1000 },
  weekly: { label: 'Weekly', count: 7, duration: 7 * 24 * 60 * 60 * 1000 },
  monthly: { label: 'Monthly', count: 10, duration: 30 * 24 * 60 * 60 * 1000 },
  yearly: { label: 'Yearly', count: 12, duration: 365 * 24 * 60 * 60 * 1000 },
};

const ORDER_STATUS_OPTIONS = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'];

const formatDate = (date) =>
  date
    ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

const formatDateTime = (date) =>
  date
    ? new Date(date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';

const orderLabel = (order) => order.orderNumber || `#${order._id.slice(-8).toUpperCase()}`;

const makeAnalytics = (orders, periodKey) => {
  const period = periods[periodKey];
  const now = new Date();
  const start = new Date(now.getTime() - period.duration);
  const previousStart = new Date(start.getTime() - period.duration);
  const bucketDuration = period.duration / period.count;
  const labelOptions =
    periodKey === 'daily'
      ? { hour: 'numeric' }
      : periodKey === 'weekly'
        ? { weekday: 'short' }
        : { month: 'short', day: 'numeric' };
  const buckets = Array.from({ length: period.count }, (_, index) => {
    const date = new Date(start.getTime() + index * bucketDuration);
    return {
      label:
        periodKey === 'yearly'
          ? date.toLocaleDateString('en-US', { month: 'short' })
          : date.toLocaleDateString('en-US', labelOptions),
      revenue: 0,
      orders: 0,
    };
  });
  let revenue = 0;
  let previousRevenue = 0;
  let orderCount = 0;
  let previousOrderCount = 0;

  orders.forEach((order) => {
    const createdAt = new Date(order.createdAt).getTime();
    const orderTotal = toEtb(order.totalPrice, order.currency);
    const isCancelled = order.orderStatus === 'Cancelled';
    if (createdAt >= previousStart.getTime() && createdAt < start.getTime() && !isCancelled) {
      previousRevenue += orderTotal;
      previousOrderCount += 1;
    }
    if (createdAt < start.getTime() || createdAt > now.getTime() || isCancelled) return;

    const bucketIndex = Math.min(
      period.count - 1,
      Math.floor((createdAt - start.getTime()) / bucketDuration)
    );
    if (bucketIndex >= 0) {
      buckets[bucketIndex].revenue += orderTotal;
      buckets[bucketIndex].orders += 1;
      revenue += orderTotal;
      orderCount += 1;
    }
  });

  const percentChange = (current, previous) => previous === 0
    ? (current > 0 ? null : 0)
    : ((current - previous) / previous) * 100;
  return {
    buckets,
    revenue,
    previousRevenue,
    orderCount,
    change: percentChange(revenue, previousRevenue),
    ordersChange: percentChange(orderCount, previousOrderCount),
  };
};

const Icon = ({ name, size = 20 }) => {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    products: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    categories: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></>,
    orders: <><path d="M8 5h12M8 12h12M8 19h12" /><path d="M3 5h.01M3 12h.01M3 19h.01" /></>,
    customers: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    inventory: <><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z" /><path d="m3.3 7.8 8.7 5 8.7-5M12 22v-9" /></>,
    reviews: <><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></>,
    reports: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-5 5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4L7.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2Z" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
};

const StatusBadge = ({ status }) => (
  <span className={`admin-status status-${String(status || '').toLowerCase()}`}>
    <span className="admin-status-dot" />
    {status || 'Unknown'}
  </span>
);

const EmptyState = ({ title, detail }) => (
  <div className="admin-empty-state">
    <span className="admin-empty-mark">—</span>
    <strong>{title}</strong>
    <p>{detail}</p>
  </div>
);

const AdminDashboardPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const section = location.pathname.split('/')[2] || 'overview';
  const page = pageTitles[section] ? section : 'overview';
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [overview, setOverview] = useState({ products: 0, users: 0, orders: 0 });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('monthly');
  const [orderStatusFilter, setOrderStatusFilter] = useState('All statuses');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [orderDetails, setOrderDetails] = useState(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formStock, setFormStock] = useState('');
  const [formImageFile, setFormImageFile] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [trackingSaving, setTrackingSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [productsResponse, ordersResponse, overviewResponse, customersResponse, categoriesResponse] =
        await Promise.all([
          api.get('/products'),
          api.get('/orders'),
          api.get('/admin/overview'),
          api.get('/admin/customers'),
          api.get('/products/categories'),
        ]);
      setProducts(productsResponse.data.products || []);
      setOrders(ordersResponse.data);
      setOverview(overviewResponse.data);
      setCustomers(customersResponse.data);
      setCategories(categoriesResponse.data);
    } catch (error) {
      console.error('Failed to load administrator dashboard data:', error);
      setLoadError(error.response?.data?.message || 'Dashboard data could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const request = window.setTimeout(() => loadData(), 0);
    return () => window.clearTimeout(request);
  }, [loadData]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const analytics = useMemo(() => makeAnalytics(orders, period), [orders, period]);
  const totalRevenue = useMemo(
    () => orders.reduce(
      (sum, order) => sum + (order.orderStatus === 'Cancelled' ? 0 : toEtb(order.totalPrice, order.currency)),
      0
    ),
    [orders]
  );
  const inventory = useMemo(
    () => ({
      inStock: products.filter((product) => product.stockQuantity > 5).length,
      lowStock: products.filter((product) => product.stockQuantity > 0 && product.stockQuantity <= 5).length,
      outOfStock: products.filter((product) => product.stockQuantity <= 0).length,
    }),
    [products]
  );
  const topProducts = useMemo(() => {
    const sales = new Map();
    orders.forEach((order) => {
      if (order.orderStatus === 'Cancelled') return;
      (order.orderItems || []).forEach((item) => {
        const key = item.product || item.name;
        const existing = sales.get(String(key)) || {
          key: String(key),
          name: item.name,
          units: 0,
          revenue: 0,
          image: item.image,
        };
        existing.units += Number(item.qty) || 0;
        existing.revenue += toEtb(item.price, item.currency || order.currency) * (Number(item.qty) || 0);
        sales.set(String(key), existing);
      });
    });
    return [...sales.values()].sort((a, b) => b.units - a.units).slice(0, 5).map((sale) => {
      const product = products.find((item) => String(item._id) === sale.key);
      return { ...sale, category: product?.category || '—', image: product?.image || sale.image };
    });
  }, [orders, products]);
  const filteredTopProducts = useMemo(
    () => topProducts.filter((product) =>
      `${product.name} ${product.category}`.toLowerCase().includes(search.trim().toLowerCase())
    ),
    [topProducts, search]
  );

  const showToast = (message, type = 'success') => setFeedback({ message, type });
  const handleLogout = () => {
    logout();
    navigate('/');
  };
  const navigateSection = (nextSection) => {
    navigate(nextSection === 'overview' ? '/secure-admin-dashboard' : `/secure-admin-dashboard/${nextSection}`);
    setMobileMenuOpen(false);
    setSearch('');
  };

  const openAddProduct = () => {
    setEditingProduct(null);
    setFormName('');
    setFormDescription('');
    setFormPrice('');
    setFormCategory('');
    setFormStock('');
    setFormImageFile(null);
    setShowProductForm(true);
  };

  const openEditProduct = (product) => {
    setEditingProduct(product);
    setFormName(product.name);
    setFormDescription(product.description);
    setFormPrice(toEtb(product.price, product.currency).toFixed(2));
    setFormCategory(product.category);
    setFormStock(product.stockQuantity);
    setFormImageFile(null);
    setShowProductForm(true);
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    if (!formName.trim() || !formDescription.trim() || formPrice === '' || !formCategory.trim() || formStock === '') {
      showToast('Please complete all product details.', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('name', formName.trim());
    formData.append('description', formDescription.trim());
    formData.append('price', formPrice);
    formData.append('category', formCategory.trim());
    formData.append('stockQuantity', formStock);
    if (formImageFile) formData.append('image', formImageFile);

    setFormSubmitting(true);
    try {
      if (editingProduct) {
        await api.put(`/products/${editingProduct._id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        showToast('Product updated successfully.');
      } else {
        await api.post('/products', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        showToast('Product added successfully.');
      }
      setShowProductForm(false);
      setEditingProduct(null);
      await loadData();
    } catch (error) {
      showToast(error.response?.data?.message || 'Product could not be saved.', 'error');
    } finally {
      setFormSubmitting(false);
    }
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`Delete "${product.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/products/${product._id}`);
      showToast('Product deleted.');
      await loadData();
    } catch (error) {
      showToast(error.response?.data?.message || 'Product could not be deleted.', 'error');
    }
  };

  const updateTrackingDetails = async (orderId, trackingUpdate) => {
    setTrackingSaving(true);
    try {
      const payload = {
        status: trackingUpdate.status || orderDetails?.orderStatus,
        trackingNumber: trackingUpdate.trackingNumber ?? '',
        courierName: trackingUpdate.courierName ?? '',
        estimatedDelivery: trackingUpdate.estimatedDelivery || null,
        deliveryNotes: trackingUpdate.deliveryNotes ?? '',
        message: trackingUpdate.message || 'Tracking information updated by administrator.',
      };

      const { data } = await api.patch(`/orders/${orderId}/tracking`, payload);

      setOrders((current) =>
        current.map((order) => (order._id === orderId ? { ...order, ...data } : order))
      );
      setOrderDetails((current) => current?._id === orderId ? { ...current, ...data } : current);
      showToast('Order tracking updated successfully.');
    } catch (error) {
      showToast(error.response?.data?.message || 'Order tracking could not be updated.', 'error');
    } finally {
      setTrackingSaving(false);
    }
  };

  const updateOrderDetailField = (field, value) => {
    setOrderDetails((current) => (current ? { ...current, [field]: value } : current));
  };

  const filteredProducts = useMemo(
    () => products.filter((product) =>
      `${product.name} ${product.category}`.toLowerCase().includes(search.trim().toLowerCase())
    ),
    [products, search]
  );
  const filteredOrders = useMemo(
    () => orders.filter((order) => {
      const matchesSearch = `${order.orderNumber || ''} ${order._id} ${order.user?.name || ''} ${order.user?.email || ''} ${(order.orderItems || []).map((item) => item.name).join(' ')}`
        .toLowerCase()
        .includes(search.trim().toLowerCase());
      return matchesSearch && (orderStatusFilter === 'All statuses' || order.orderStatus === orderStatusFilter);
    }),
    [orders, orderStatusFilter, search]
  );
  const filteredCustomers = useMemo(
    () => customers.filter((customer) =>
      `${customer.name} ${customer.email}`.toLowerCase().includes(search.trim().toLowerCase())
    ),
    [customers, search]
  );

  const renderOrdersTable = (rows, compact = false) => (
    <div className="admin-table-scroll">
      <table className="admin-data-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            {!compact && <th>Products</th>}
            <th>Date</th>
            <th>Total</th>
            {!compact && <th>Payment</th>}
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((order) => (
            <tr key={order._id}>
              <td><span className="admin-order-id">{orderLabel(order)}</span></td>
              <td>
                <strong>{order.user?.name || 'Customer'}</strong>
                <span className="admin-cell-subtitle">{order.user?.email || '—'}</span>
              </td>
              {!compact && (
                <td>
                  <span className="admin-product-summary">
                    {(order.orderItems || []).slice(0, 2).map((item) => `${item.name} × ${item.qty}`).join(', ')}
                    {(order.orderItems || []).length > 2 ? ` +${order.orderItems.length - 2} more` : ''}
                  </span>
                </td>
              )}
              <td>{formatDate(order.createdAt)}</td>
              <td><strong>{formatDualCurrency(order.totalPrice, order.currency)}</strong></td>
              {!compact && <td>{order.isPaid ? <StatusBadge status="Paid" /> : <StatusBadge status="Unpaid" />}</td>}
              <td><StatusBadge status={order.orderStatus} /></td>
              <td>
                <button className="admin-icon-button" type="button" onClick={() => setOrderDetails(order)} aria-label={`View order ${orderLabel(order)}`} title="View order">
                  <Icon name="arrow" size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <EmptyState title="No orders found" detail="Orders matching your search will appear here." />}
    </div>
  );

  const renderProductsTable = (rows) => (
    <div className="admin-table-scroll">
      <table className="admin-data-table">
        <thead>
          <tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Availability</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map((product) => (
            <tr key={product._id}>
              <td>
                <div className="admin-product-cell">
                  <img src={getProductImageUrl(product.image)} alt="" onError={(event) => { event.currentTarget.src = '/uploads/sample-product.svg'; }} />
                  <div><strong>{product.name}</strong><span className="admin-cell-subtitle">{product.description}</span></div>
                </div>
              </td>
              <td><span className="admin-category-tag">{product.category}</span></td>
              <td><strong>{formatDualCurrency(product.price, product.currency)}</strong></td>
              <td>{product.stockQuantity}</td>
              <td><StatusBadge status={product.stockQuantity <= 0 ? 'Out of stock' : product.stockQuantity <= 5 ? 'Low stock' : 'In stock'} /></td>
              <td>
                <div className="admin-row-actions">
                  <button type="button" className="admin-text-button" onClick={() => openEditProduct(product)}>Edit</button>
                  <button type="button" className="admin-text-button danger" onClick={() => deleteProduct(product)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <EmptyState title="No products found" detail="Try adjusting the search or add your first product." />}
    </div>
  );

  const renderOverview = () => (
    <>
      <section className="admin-metric-grid" aria-label="Store statistics">
        <MetricCard title="Total revenue" value={formatDualCurrency(totalRevenue, 'ETB')} icon="revenue" note="Net of cancelled orders" change={analytics.change} changeLabel={`${periods[period].label.toLowerCase()} revenue`} />
        <MetricCard title="Total orders" value={overview.orders} icon="orders" note="All customer orders" change={analytics.ordersChange} changeLabel={`${periods[period].label.toLowerCase()} orders`} />
        <MetricCard title="Total products" value={overview.products} icon="products" note="Products in your catalog" />
        <MetricCard title="Total customers" value={overview.users} icon="customers" note="Registered customer accounts" />
      </section>

      <Suspense fallback={<div className="admin-loading"><span className="admin-spinner" /><p>Loading sales charts…</p></div>}>
        <AdminCharts analytics={analytics} period={period} onPeriodChange={setPeriod} />
      </Suspense>

      <div className="admin-overview-grid">
        <section className="admin-panel">
          <div className="admin-panel-heading"><div><h2>Recent orders</h2><p>The latest activity across your store</p></div><button className="admin-link-button" type="button" onClick={() => navigateSection('orders')}>View all <Icon name="arrow" size={15} /></button></div>
          {orders.length ? renderOrdersTable(filteredOrders.slice(0, 5), true) : <EmptyState title="No orders yet" detail="New customer orders will show up here." />}
        </section>
        <section className="admin-panel inventory-panel">
          <div className="admin-panel-heading"><div><h2>Inventory overview</h2><p>Stock status across your catalog</p></div></div>
          <div className="inventory-total"><strong>{products.length}</strong><span>Total products</span></div>
          <div className="inventory-breakdown">
            <InventoryRow label="In stock" count={inventory.inStock} kind="good" />
            <InventoryRow label="Low stock" count={inventory.lowStock} kind="warning" />
            <InventoryRow label="Out of stock" count={inventory.outOfStock} kind="error" />
          </div>
          <button type="button" className="admin-outline-button inventory-action" onClick={() => navigateSection('products')}>Manage products <Icon name="arrow" size={16} /></button>
        </section>
      </div>

      <section className="admin-panel top-products-panel">
        <div className="admin-panel-heading"><div><h2>Top-selling products</h2><p>Based on completed, non-cancelled order items</p></div></div>
        {filteredTopProducts.length ? (
          <div className="top-products-list">
            {filteredTopProducts.map((product) => (
              <div className="top-product-row" key={product.key}>
                <img src={getProductImageUrl(product.image)} alt="" onError={(event) => { event.currentTarget.src = '/uploads/sample-product.svg'; }} />
                <div className="top-product-name"><strong>{product.name}</strong><span>{product.category}</span></div>
                <span className="top-product-units">{product.units} units sold</span>
                <strong className="top-product-revenue">{formatDualCurrency(product.revenue, 'ETB')}</strong>
              </div>
            ))}
          </div>
        ) : <EmptyState title={topProducts.length ? 'No products match your search' : 'No sales data yet'} detail={topProducts.length ? 'Try another product or category.' : 'Top products will appear after customers place orders.'} />}
      </section>
    </>
  );

  const renderProducts = () => (
    <section className="admin-panel">
      <div className="admin-panel-heading"><div><h2>All products <span className="admin-count">{products.length}</span></h2><p>Manage your catalog, pricing, and stock</p></div><button type="button" className="admin-primary-button" onClick={openAddProduct}>+ Add product</button></div>
      {renderProductsTable(filteredProducts)}
    </section>
  );

  const renderOrders = () => (
    <section className="admin-panel">
      <div className="admin-panel-heading"><div><h2>All orders <span className="admin-count">{filteredOrders.length}</span></h2><p>Search orders, review details, and update fulfillment status</p></div>
        <select className="admin-filter-select" value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)} aria-label="Filter orders by status">
          {['All statuses', ...ORDER_STATUS_OPTIONS].map((status) => <option key={status}>{status}</option>)}
        </select>
      </div>
      {renderOrdersTable(filteredOrders)}
    </section>
  );

  const renderCustomers = () => (
    <section className="admin-panel">
      <div className="admin-panel-heading"><div><h2>Customers <span className="admin-count">{filteredCustomers.length}</span></h2><p>Customer accounts and their order history</p></div></div>
      <div className="admin-table-scroll">
        <table className="admin-data-table">
          <thead><tr><th>Customer</th><th>Email</th><th>Joined</th><th>Total orders</th><th>Total spending</th></tr></thead>
          <tbody>{filteredCustomers.map((customer) => (
            <tr key={customer._id}>
              <td><div className="admin-customer-cell"><span className="admin-avatar small">{customer.name?.[0]?.toUpperCase() || 'C'}</span><strong>{customer.name}</strong></div></td>
              <td>{customer.email}</td><td>{formatDate(customer.createdAt)}</td><td>{customer.totalOrders}</td><td><strong>{formatDualCurrency(customer.totalSpending, customer.currency || 'ETB')}</strong></td>
            </tr>
          ))}</tbody>
        </table>
        {!filteredCustomers.length && <EmptyState title="No customers found" detail="Customer accounts will appear here when registered." />}
      </div>
    </section>
  );

  const renderInventory = () => {
    const lowStockProducts = products.filter((product) => product.stockQuantity <= 5).sort((a, b) => a.stockQuantity - b.stockQuantity);
    return (
      <>
        <section className="admin-metric-grid inventory-metrics">
          <MetricCard title="Total products" value={products.length} icon="products" note="Catalog items" />
          <MetricCard title="In stock" value={inventory.inStock} icon="in-stock" note="More than 5 units" />
          <MetricCard title="Low stock" value={inventory.lowStock} icon="low-stock" note="5 units or fewer" />
          <MetricCard title="Out of stock" value={inventory.outOfStock} icon="out-stock" note="Needs replenishment" />
        </section>
        <section className="admin-panel">
          <div className="admin-panel-heading"><div><h2>Low-stock products</h2><p>Items that may need to be replenished</p></div><button type="button" className="admin-primary-button" onClick={() => navigateSection('products')}>Manage products</button></div>
          {renderProductsTable(lowStockProducts)}
        </section>
      </>
    );
  };

  const renderSection = () => {
    if (page.startsWith('payment-')) return <AdminPayments page={page} onToast={showToast} />;
    if (loading) return <div className="admin-loading"><span className="admin-spinner" /><p>Loading store data…</p></div>;
    if (loadError) return <div className="admin-load-error"><strong>We couldn’t load this dashboard.</strong><p>{loadError}</p><button type="button" className="admin-primary-button" onClick={loadData}>Try again</button></div>;
    if (page === 'overview') return renderOverview();
    if (page === 'products') return renderProducts();
    if (page === 'orders') return renderOrders();
    if (page === 'customers') return renderCustomers();
    if (page === 'inventory') return renderInventory();
    if (page === 'categories') return (
      <section className="admin-panel">
        <div className="admin-panel-heading"><div><h2>Product categories</h2><p>Categories currently used in your catalog</p></div><button className="admin-primary-button" type="button" onClick={() => navigateSection('products')}>Manage products</button></div>
        {categories.filter((category) => category.toLowerCase().includes(search.trim().toLowerCase())).length
          ? <div className="admin-category-grid">{categories.filter((category) => category.toLowerCase().includes(search.trim().toLowerCase())).map((category) => <button key={category} className="admin-category-card" type="button" onClick={() => { navigateSection('products'); setSearch(category); }}><span className="admin-category-icon"><Icon name="categories" /></span><strong>{category}</strong><span>{products.filter((product) => product.category === category).length} products</span></button>)}</div>
          : <EmptyState title={categories.length ? 'No categories found' : 'No categories yet'} detail={categories.length ? 'Try a different search term.' : 'Add a product to create your first category.'} />}
      </section>
    );
    if (page === 'sales-reports') return (
      <>
        <section className="admin-metric-grid"><MetricCard title="Revenue" value={formatDualCurrency(analytics.revenue, 'ETB')} icon="revenue" note={`${periods[period].label} period`} /><MetricCard title="Previous period" value={formatDualCurrency(analytics.previousRevenue, 'ETB')} icon="reports" note="Comparable time period" /><MetricCard title="Revenue change" value={analytics.change === null ? 'New' : `${analytics.change >= 0 ? '+' : ''}${analytics.change.toFixed(1)}%`} icon="growth" note="Versus previous period" /><MetricCard title="Orders" value={analytics.buckets.reduce((sum, bucket) => sum + bucket.orders, 0)} icon="orders" note={`${periods[period].label} period`} /></section>
        <Suspense fallback={<div className="admin-loading"><span className="admin-spinner" /><p>Loading sales charts…</p></div>}>
          <AdminCharts analytics={analytics} period={period} onPeriodChange={setPeriod} reportMode />
        </Suspense>
      </>
    );
    if (page === 'reviews') return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Reviews</h2><p>Product reviews and ratings</p></div></div><EmptyState title="Reviews are not available" detail="This store does not currently have a review system connected." /></section>;
    return <section className="admin-panel settings-panel"><div className="admin-panel-heading"><div><h2>Administrator profile</h2><p>Your signed-in account details</p></div></div><div className="settings-profile"><span className="admin-avatar large">{user?.name?.[0]?.toUpperCase() || 'A'}</span><div><strong>{user?.name}</strong><span>{user?.email}</span><span className="admin-role-chip">Administrator</span></div></div><div className="settings-note"><strong>Store settings</strong><p>Additional store configuration is not available in the current backend.</p></div></section>;
  };

  return (
    <div className="admin-workspace">
      {mobileMenuOpen && <button type="button" className="admin-mobile-backdrop" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation" />}
      <aside className={`admin-sidebar${mobileMenuOpen ? ' mobile-open' : ''}`}>
        <Link className="admin-brand" to="/secure-admin-dashboard" onClick={() => navigateSection('overview')} aria-label="AllStore dashboard">
          <img className="admin-brand-logo" src="/images/allstore-logo.png" alt="" />
          <span className="admin-brand-name">AllStore Admin</span>
        </Link>
        <span className="admin-nav-caption">WORKSPACE</span>
        <nav className="admin-side-nav" aria-label="Admin navigation">
          {navigation.map((item) => (
            <button type="button" key={item.id} className={`admin-nav-item${page === item.id ? ' active' : ''}`} onClick={() => navigateSection(item.id)}>
              <Icon name={item.icon} size={19} /><span>{item.label}</span>
              {item.id === 'orders' && orders.filter((order) => order.orderStatus === 'Pending').length > 0 && <span className="admin-nav-count">{orders.filter((order) => order.orderStatus === 'Pending').length}</span>}
            </button>
          ))}
        </nav>
        <span className="admin-nav-caption">PAYMENTS</span>
        <nav className="admin-side-nav" aria-label="Payment management navigation">
          {paymentsNavigation.map((item) => (
            <button type="button" key={item.id} className={`admin-nav-item${page === item.id ? ' active' : ''}`} onClick={() => navigateSection(item.id)}>
              <Icon name={item.icon} size={19} /><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-store-status"><span /><div><strong>Store status</strong><small>Connected and active</small></div></div>
          <button className="admin-nav-item admin-logout" type="button" onClick={handleLogout}><span className="admin-logout-icon">↪</span><span>Log out</span></button>
          <div className="admin-sidebar-footer">AllStore · Admin</div>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button type="button" className="admin-mobile-menu-button" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
          <div className="admin-topbar-title"><span>AllStore Admin</span><h1>{pageTitles[page]}</h1></div>
          <div className="admin-topbar-actions">
            <label className="admin-search"><Icon name="search" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${page === 'overview' ? 'dashboard' : pageTitles[page].toLowerCase()}…`} aria-label="Search current page" /></label>
            <button type="button" className="admin-notification" aria-label="Notifications" title="No new notifications"><Icon name="bell" size={19} /></button>
            <div className="admin-profile-wrap">
              <button type="button" className="admin-profile-button" onClick={() => setProfileOpen((open) => !open)} aria-expanded={profileOpen}>
                <span className="admin-avatar">{user?.name?.[0]?.toUpperCase() || 'A'}</span><span className="admin-profile-meta"><strong>{user?.name || 'Administrator'}</strong><small>Administrator</small></span><span className="admin-chevron">⌄</span>
              </button>
              {profileOpen && <div className="admin-profile-menu"><button type="button" onClick={() => { setProfileOpen(false); navigateSection('settings'); }}>Account settings</button><button type="button" onClick={handleLogout}>Log out</button></div>}
            </div>
          </div>
        </header>

        <main className="admin-content">
          <div className="admin-page-heading"><div><h2>{page === 'overview' ? 'Good to see you, ' + (user?.name?.split(' ')[0] || 'Admin') : pageTitles[page]}</h2><p>{page === 'overview' ? 'Here’s what’s happening with your store today.' : page.startsWith('payment-') ? 'Manage customer payments, verification, refunds and settings.' : `Manage your store ${page.replace('-', ' ')}.`}</p></div>
            {page === 'overview' && <button type="button" className="admin-primary-button" onClick={openAddProduct}>+ Add product</button>}
          </div>
          {feedback && <div className={`admin-toast ${feedback.type}`} role="status">{feedback.message}<button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss notification">×</button></div>}
          {renderSection()}
        </main>
      </div>

      {showProductForm && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowProductForm(false); }}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
            <div className="admin-modal-heading"><div><h2 id="product-modal-title">{editingProduct ? 'Edit product' : 'Add a product'}</h2><p>Product information and inventory</p></div><button type="button" className="admin-icon-button" onClick={() => setShowProductForm(false)} aria-label="Close">×</button></div>
            <form onSubmit={saveProduct} className="admin-product-form">
              <label>Product name<input required value={formName} onChange={(event) => setFormName(event.target.value)} /></label>
              <label>Description<textarea required rows="3" value={formDescription} onChange={(event) => setFormDescription(event.target.value)} /></label>
              <div className="admin-form-row"><label>Price (ETB)<input required type="number" min="0" step="0.01" value={formPrice} onChange={(event) => setFormPrice(event.target.value)} /></label><label>Stock quantity<input required type="number" min="0" step="1" value={formStock} onChange={(event) => setFormStock(event.target.value)} /></label></div>
              <label>Category<input required value={formCategory} onChange={(event) => setFormCategory(event.target.value)} /></label>
              <label>Product image<input type="file" accept="image/*" onChange={(event) => setFormImageFile(event.target.files?.[0] || null)} /><small>{editingProduct ? 'Choose a new image to replace the current one.' : 'Image upload is optional.'} Uploaded images are handled by the store server.</small></label>
              <div className="admin-modal-actions"><button type="button" className="admin-outline-button" onClick={() => setShowProductForm(false)}>Cancel</button><button type="submit" className="admin-primary-button" disabled={formSubmitting}>{formSubmitting ? 'Saving…' : editingProduct ? 'Save changes' : 'Create product'}</button></div>
            </form>
          </section>
        </div>
      )}

      {orderDetails && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOrderDetails(null); }}>
          <section className="admin-modal order-modal" role="dialog" aria-modal="true" aria-labelledby="order-modal-title">
            <div className="admin-modal-heading"><div><span className="admin-modal-eyebrow">ORDER {orderLabel(orderDetails)}</span><h2 id="order-modal-title">Order details</h2></div><button type="button" className="admin-icon-button" onClick={() => setOrderDetails(null)} aria-label="Close">×</button></div>
            <div className="order-detail-meta"><div><span>Customer</span><strong>{orderDetails.user?.name || 'Customer'}</strong><small>{orderDetails.user?.email || '—'}</small></div><div><span>Placed</span><strong>{formatDate(orderDetails.createdAt)}</strong></div><div><span>Total</span><strong>{formatDualCurrency(orderDetails.totalPrice, orderDetails.currency)}</strong></div><div><span>Payment</span><strong>{orderDetails.isPaid ? 'Paid' : 'Unpaid'} · {orderDetails.paymentMethod}</strong></div></div>
            <h3 className="order-detail-subhead">Items</h3>
            <div className="order-detail-items">{(orderDetails.orderItems || []).map((item, index) => <div className="order-detail-item" key={`${item.product}-${index}`}><img src={getProductImageUrl(item.image)} alt="" /><span><strong>{item.name}</strong><small>{item.qty} × {formatDualCurrency(item.price, item.currency || orderDetails.currency)}</small></span><strong>{formatDualCurrency(item.qty * item.price, item.currency || orderDetails.currency)}</strong></div>)}</div>

            <div className="admin-tracking-form">
              <label className="admin-status-control">Order status<select value={orderDetails.orderStatus || 'Pending'} onChange={(event) => updateOrderDetailField('orderStatus', event.target.value)}>{ORDER_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
              <label className="admin-status-control">Tracking number<input type="text" value={orderDetails.trackingNumber || ''} onChange={(event) => updateOrderDetailField('trackingNumber', event.target.value)} placeholder="e.g. AS123456789" /></label>
              <label className="admin-status-control">Courier name<input type="text" value={orderDetails.courierName || ''} onChange={(event) => updateOrderDetailField('courierName', event.target.value)} placeholder="e.g. DHL, FedEx, Aramex" /></label>
              <label className="admin-status-control">Estimated delivery<input type="date" value={orderDetails.estimatedDelivery ? new Date(orderDetails.estimatedDelivery).toISOString().split('T')[0] : ''} onChange={(event) => updateOrderDetailField('estimatedDelivery', event.target.value)} /></label>
              <label className="admin-status-control">Delivery notes<textarea rows="3" value={orderDetails.deliveryNotes || ''} onChange={(event) => updateOrderDetailField('deliveryNotes', event.target.value)} placeholder="Add delivery instructions or notes" /></label>
              <div className="admin-modal-actions">
                <button type="button" className="admin-outline-button" onClick={() => setOrderDetails(null)}>Close</button>
                <button type="button" className="admin-primary-button" disabled={trackingSaving} onClick={() => updateTrackingDetails(orderDetails._id, {
                  status: orderDetails.orderStatus,
                  trackingNumber: orderDetails.trackingNumber,
                  courierName: orderDetails.courierName,
                  estimatedDelivery: orderDetails.estimatedDelivery,
                  deliveryNotes: orderDetails.deliveryNotes,
                })}>
                  {trackingSaving ? 'Saving…' : 'Save tracking'}
                </button>
              </div>
            </div>
            <div className="admin-tracking-history">
              <h3>Status update history</h3>
              {orderDetails.trackingHistory?.length ? (
                <ol>
                  {[...orderDetails.trackingHistory].reverse().map((entry, index) => (
                    <li key={`${entry.status}-${entry.timestamp || index}`}>
                      <strong>{entry.status}</strong>
                      <span>{entry.message || 'Status updated'}</span>
                      <time>{formatDateTime(entry.timestamp)}</time>
                    </li>
                  ))}
                </ol>
              ) : <p>No tracking updates have been recorded.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const MetricCard = ({ title, value, icon, note, change, changeLabel }) => (
  <article className="admin-metric-card">
    <div className={`admin-metric-icon metric-${icon}`}><Icon name={icon === 'revenue' || icon === 'growth' ? 'reports' : icon === 'in-stock' || icon === 'low-stock' || icon === 'out-stock' ? 'inventory' : icon} size={20} /></div>
    <span className="admin-metric-label">{title}</span>
    <strong className="admin-metric-value">{value}</strong>
    {change !== undefined && <span className={`admin-metric-change${change !== null && change < 0 ? ' negative' : ''}`}>{change === null ? 'New' : `${change >= 0 ? '↑' : '↓'} ${Math.abs(change).toFixed(1)}%`} {changeLabel}</span>}
    <span className="admin-metric-note">{note}</span>
  </article>
);

const InventoryRow = ({ label, count, kind }) => (
  <div className="inventory-row"><span className={`inventory-indicator ${kind}`} /><span>{label}</span><strong>{count}</strong></div>
);

export default AdminDashboardPage;
