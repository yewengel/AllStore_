import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api, { getProductImageUrl } from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useCurrency } from '../context/CurrencyContext';
import CurrencyDropdown from '../components/CurrencyDropdown';
import { convertCurrency, toEtb } from '../utils/currency';
import useOrderRefresh from '../hooks/useOrderRefresh';
import './AdminDashboard.css';

const AdminCharts = lazy(() => import('./AdminCharts'));
const AdminPayments = lazy(() => import('./AdminPayments'));
const AdminReturns = lazy(() => import('./AdminReturns'));
const AdminReviews = lazy(() => import('./AdminReviews'));

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
  { id: 'payment-bank-transfers', label: 'Payment Verification', icon: 'inventory' },
  { id: 'payment-refunds', label: 'Refund Management', icon: 'reports' },
  { id: 'return-management', label: 'Returns', icon: 'inventory' },
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
  'payment-bank-transfers': 'Payment Verification',
  'payment-refunds': 'Refund Management',
  'return-management': 'Return Management',
  'payment-settings': 'Payment Settings',
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
const isPaidOrder = (order) => order.isPaid === true || order.paymentStatus === 'Paid';
const isRevenueOrder = (order) => order.orderStatus !== 'Cancelled' && isPaidOrder(order);

const toFinancialAnalytics = (data) => ({
  buckets: data.trend.map(({ label, revenue, orders }) => ({ label, revenue, orders })),
  revenue: data.cards.totalRevenue,
  totalSales: data.cards.totalSales,
  totalRefunds: data.cards.totalRefunds,
  totalOrders: data.cards.totalOrders,
  previousRevenue: data.previousRevenue,
  change: data.change,
  ordersChange: data.ordersChange,
});

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
  const { currency, formatPrice } = useCurrency();
  const navigate = useNavigate();
  const location = useLocation();
  const section = location.pathname.split('/')[2] || 'overview';
  const page = pageTitles[section] ? section : 'overview';
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [financialStats, setFinancialStats] = useState(null);
  const [dashboardAnalytics, setDashboardAnalytics] = useState(null);
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
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [orderDetails, setOrderDetails] = useState(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formPriceDraft, setFormPriceDraft] = useState('');
  const [formPriceDraftCurrency, setFormPriceDraftCurrency] = useState('ETB');
  const [formPriceEdited, setFormPriceEdited] = useState(false);
  const [formCategory, setFormCategory] = useState('');
  const [formSubcategory, setFormSubcategory] = useState('');
  const [formBrand, setFormBrand] = useState('');
  const [formKeywords, setFormKeywords] = useState('');
  const [formStock, setFormStock] = useState('');
  const [formGallery, setFormGallery] = useState([]);
  const [primaryImageId, setPrimaryImageId] = useState('');
  const [formVariants, setFormVariants] = useState([]);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [trackingSaving, setTrackingSaving] = useState(false);
  const [paymentReviewSaving, setPaymentReviewSaving] = useState(false);
  const [customerMessageDraft, setCustomerMessageDraft] = useState('');
  const [adminNoteDraft, setAdminNoteDraft] = useState('');
  const galleryPreviewUrls = useRef(new Set());
  const cancellationNotifications = orders
    .filter((order) => order.orderStatus === 'Cancelled' && order.cancellationReason)
    .sort((left, right) => new Date(right.cancelledAt || 0) - new Date(left.cancelledAt || 0));

  useEffect(() => () => {
    galleryPreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    galleryPreviewUrls.current.clear();
  }, []);

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

  const refreshOrderData = useCallback(async () => {
    try {
      const periodKey = { daily: 'today', weekly: 'week', monthly: 'month', yearly: 'year' }[period];
      const [ordersResponse, overviewResponse, customersResponse, financialResponse, trendsResponse] = await Promise.all([
        api.get('/orders'),
        api.get('/admin/overview'),
        api.get('/admin/customers'),
        api.get('/admin/payments/stats', { params: { period: 'all' } }),
        api.get('/admin/payments/stats', { params: { period: periodKey } }),
      ]);
      setOrders(ordersResponse.data);
      setOverview(overviewResponse.data);
      setCustomers(customersResponse.data);
      setFinancialStats(financialResponse.data.cards);
      setDashboardAnalytics(toFinancialAnalytics(trendsResponse.data));
      setLoadError('');
      return true;
    } catch (error) {
      console.error('Failed to refresh administrator order data:', error);
      setLoadError(error.response?.data?.message || 'Order data could not be refreshed. Please try again.');
      return false;
    }
  }, [period]);

  useOrderRefresh(refreshOrderData);

  useEffect(() => {
    const request = window.setTimeout(() => loadData(), 0);
    return () => window.clearTimeout(request);
  }, [loadData]);

  useEffect(() => {
    if (page !== 'overview') return undefined;
    let active = true;
    api.get('/admin/payments/stats', { params: { period: 'all' } })
      .then(({ data }) => {
        if (active) setFinancialStats(data.cards);
      })
      .catch((error) => {
        console.error('Failed to load administrator financial statistics:', error);
        if (active) setLoadError(error.response?.data?.message || 'Financial statistics could not be loaded. Please try again.');
      });
    return () => { active = false; };
  }, [page]);

  useEffect(() => {
    if (!['overview', 'sales-reports'].includes(page)) return undefined;
    let active = true;
    const periodKey = { daily: 'today', weekly: 'week', monthly: 'month', yearly: 'year' }[period];
    api.get('/admin/payments/stats', { params: { period: periodKey } })
      .then(({ data }) => {
        if (active) setDashboardAnalytics(toFinancialAnalytics(data));
      })
      .catch((error) => {
        console.error('Failed to load administrator financial trends:', error);
        if (active) setLoadError(error.response?.data?.message || 'Financial trends could not be loaded. Please try again.');
      });
    return () => { active = false; };
  }, [page, period]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

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
      if (!isRevenueOrder(order)) return;
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
  const displayedFormPrice = formPriceEdited
    ? formPriceDraft === ''
      ? ''
      : formPriceDraftCurrency === currency
        ? formPriceDraft
        : convertCurrency(Number(formPriceDraft), formPriceDraftCurrency, currency).toFixed(2)
    : formPrice === ''
      ? ''
      : convertCurrency(Number(formPrice), 'ETB', currency).toFixed(2);

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

  const releaseGalleryPreviewUrls = () => {
    galleryPreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    galleryPreviewUrls.current.clear();
  };

  const closeProductForm = () => {
    releaseGalleryPreviewUrls();
    setFormGallery([]);
    setPrimaryImageId('');
    setShowProductForm(false);
    setEditingProduct(null);
  };

  const addProductImages = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (formGallery.length + files.length > 21) {
      showToast('A product can have up to 21 images.', 'error');
      return;
    }
    const currentUploads = formGallery.filter((image) => image.file).length;
    if (currentUploads + files.length > 11) {
      showToast('Upload up to 11 images per product.', 'error');
      return;
    }
    const newImages = files.map((file) => {
      const preview = URL.createObjectURL(file);
      galleryPreviewUrls.current.add(preview);
      return { id: `upload-${Date.now()}-${Math.random()}`, file, path: '', preview };
    });
    setFormGallery((current) => [...current, ...newImages]);
    setPrimaryImageId((current) => current || newImages[0]?.id || '');
  };

  const removeProductImage = (imageId) => {
    const removed = formGallery.find((image) => image.id === imageId);
    if (removed?.file) {
      URL.revokeObjectURL(removed.preview);
      galleryPreviewUrls.current.delete(removed.preview);
    }
    const next = formGallery.filter((image) => image.id !== imageId);
    setFormGallery(next);
    if (primaryImageId === imageId) setPrimaryImageId(next[0]?.id || '');
  };

  const openAddProduct = () => {
    releaseGalleryPreviewUrls();
    setEditingProduct(null);
    setFormName('');
    setFormDescription('');
    setFormPrice('');
    setFormPriceDraft('');
    setFormPriceDraftCurrency(currency);
    setFormPriceEdited(false);
    setFormCategory('');
    setFormSubcategory('');
    setFormBrand('');
    setFormKeywords('');
    setFormStock('');
    setFormGallery([]);
    setPrimaryImageId('');
    setFormVariants([]);
    setShowProductForm(true);
  };

  const openEditProduct = (product) => {
    releaseGalleryPreviewUrls();
    setEditingProduct(product);
    setFormName(product.name);
    setFormDescription(product.description);
    setFormPrice(toEtb(product.price, product.currency).toFixed(2));
    setFormPriceDraft(convertCurrency(toEtb(product.price, product.currency), 'ETB', currency).toFixed(2));
    setFormPriceDraftCurrency(currency);
    setFormPriceEdited(false);
    setFormCategory(product.category);
    setFormSubcategory(product.subcategory || '');
    setFormBrand(product.brand || '');
    setFormKeywords((product.keywords || []).join(', '));
    setFormStock(product.stockQuantity);
    const existingImages = [...new Set([product.image, ...(product.images || [])].filter(Boolean))];
    const gallery = existingImages.map((path, index) => ({
      id: `existing-${index}`,
      path,
      file: null,
      preview: getProductImageUrl(path),
    }));
    setFormGallery(gallery);
    setPrimaryImageId(gallery[0]?.id || '');
    setFormVariants((product.variants || []).map((variant) => ({
      variantId: variant._id,
      optionsText: Object.entries(variant.options || {}).map(([name, value]) => `${name}=${value}`).join('; '),
      price: variant.price === undefined || variant.price === null
        ? ''
        : convertCurrency(toEtb(variant.price, product.currency || product.priceCurrency), 'ETB', currency).toFixed(2),
      priceCurrency: currency,
      stockQuantity: String(variant.stockQuantity ?? ''),
      sku: variant.sku || '',
      image: variant.image || '',
      colorValue: variant.colorValue || '',
      isAvailable: variant.isAvailable !== false,
    })));
    setShowProductForm(true);
  };

  const updateFormVariant = (index, field, value) => {
    setFormVariants((current) => current.map((variant, variantIndex) =>
      variantIndex === index
        ? { ...variant, [field]: value, ...(field === 'price' ? { priceCurrency: currency } : {}) }
        : variant
    ));
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    const enteredPrice = formPriceEdited ? formPriceDraft : formPrice;
    if (!formName.trim() || !formDescription.trim() || enteredPrice === '' || !formCategory.trim() || (!formVariants.length && formStock === '')) {
      showToast('Please complete all product details.', 'error');
      return;
    }
    const priceInEtb = formPriceEdited
      ? convertCurrency(Number(formPriceDraft), formPriceDraftCurrency, 'ETB')
      : Number(formPrice);
    if (!Number.isFinite(priceInEtb) || priceInEtb < 0) {
      showToast('Enter a valid product price.', 'error');
      return;
    }
    const parsedVariants = [];
    for (const [index, variant] of formVariants.entries()) {
      const options = {};
      const optionParts = variant.optionsText.split(';').map((part) => part.trim()).filter(Boolean);
      if (!optionParts.length) {
        showToast(`Enter at least one option for variant ${index + 1}.`, 'error');
        return;
      }
      for (const part of optionParts) {
        const separator = part.indexOf('=');
        const name = separator < 0 ? '' : part.slice(0, separator).trim();
        const value = separator < 0 ? '' : part.slice(separator + 1).trim();
        if (
          !/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,59}$/.test(name) ||
          ['__proto__', 'constructor', 'prototype'].includes(name.toLowerCase()) ||
          !value ||
          Object.keys(options).some((key) => key.toLowerCase() === name.toLowerCase())
        ) {
          showToast(`Use unique option names and values for variant ${index + 1} (for example, Color=Blue).`, 'error');
          return;
        }
        options[name] = value;
      }
      const stockQuantity = Number(variant.stockQuantity);
      if (variant.stockQuantity === '' || !Number.isSafeInteger(stockQuantity) || stockQuantity < 0) {
        showToast(`Enter a whole, non-negative stock quantity for variant ${index + 1}.`, 'error');
        return;
      }
      let variantPrice;
      if (variant.price !== '') {
        const enteredVariantPrice = Number(variant.price);
        if (!Number.isFinite(enteredVariantPrice) || enteredVariantPrice < 0) {
          showToast(`Enter a valid price for variant ${index + 1}.`, 'error');
          return;
        }
        variantPrice = convertCurrency(enteredVariantPrice, variant.priceCurrency || currency, 'ETB');
      }
      const colorValue = variant.colorValue.trim();
      if (
        colorValue.length > 50 ||
        (colorValue && !/^(#[\da-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%\s+-]+\))$/i.test(colorValue))
      ) {
        showToast(`Enter a valid CSS color value for variant ${index + 1}.`, 'error');
        return;
      }
      parsedVariants.push({
        ...(variant.variantId ? { _id: variant.variantId } : {}),
        options,
        ...(variantPrice === undefined ? {} : { price: variantPrice }),
        stockQuantity,
        sku: variant.sku.trim(),
        image: variant.image.trim(),
        colorValue,
        isAvailable: variant.isAvailable !== false,
      });
    }
    const totalStock = parsedVariants.length
      ? parsedVariants.reduce((sum, variant) => sum + (variant.isAvailable ? variant.stockQuantity : 0), 0)
      : Number(formStock);
    if (formGallery.length > 21) {
      showToast('A product can have up to 21 images.', 'error');
      return;
    }
    const primaryImage = formGallery.find((image) => image.id === primaryImageId);

    const formData = new FormData();
    formData.append('name', formName.trim());
    formData.append('description', formDescription.trim());
    formData.append('price', String(priceInEtb));
    formData.append('category', formCategory.trim());
    formData.append('subcategory', formSubcategory.trim());
    formData.append('brand', formBrand.trim());
    formData.append('keywords', formKeywords);
    formData.append('stockQuantity', String(totalStock));
    formData.append('variants', JSON.stringify(parsedVariants));
    if (primaryImage?.file) formData.append('image', primaryImage.file);
    else formData.append('image', primaryImage?.path || '/uploads/sample-product.png');
    let uploadIndex = 0;
    const imageManifest = formGallery
      .filter((image) => image.id !== primaryImageId)
      .map((image) => {
        if (image.file) {
          formData.append('galleryImages', image.file);
          return { uploadIndex: uploadIndex++ };
        }
        return { path: image.path };
      });
    formData.append('imageManifest', JSON.stringify(imageManifest));

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
      closeProductForm();
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

  const deleteOrder = async (order) => {
    if (!window.confirm(`Delete pending order ${orderLabel(order)}? Its stock will be restored. This cannot be undone.`)) return;
    try {
      await api.delete(`/orders/${order._id}`);
      setOrders((current) => current.filter((item) => item._id !== order._id));
      setOrderDetails((current) => current?._id === order._id ? null : current);
      const refreshed = await refreshOrderData();
      showToast(
        refreshed
          ? `Order ${orderLabel(order)} deleted and stock restored.`
          : `Order ${orderLabel(order)} was deleted, but dashboard data could not be refreshed.`,
        refreshed ? 'success' : 'error'
      );
    } catch (error) {
      showToast(error.response?.data?.message || 'Order could not be deleted.', 'error');
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
        customerMessage: trackingUpdate.customerMessage ?? '',
        adminNote: trackingUpdate.adminNote ?? '',
      };

      const { data } = await api.patch(`/orders/${orderId}/tracking`, payload);

      setOrders((current) =>
        current.map((order) => (order._id === orderId ? { ...order, ...data } : order))
      );
      setOrderDetails((current) => current?._id === orderId ? { ...current, ...data } : current);
      setCustomerMessageDraft('');
      setAdminNoteDraft('');
      showToast('Order status and communication saved.');
    } catch (error) {
      showToast(error.response?.data?.message || 'Order tracking could not be updated.', 'error');
    } finally {
      setTrackingSaving(false);
    }
  };

  const updateOrderDetailField = (field, value) => {
    setOrderDetails((current) => (current ? { ...current, [field]: value } : current));
  };

  const reviewOrderPayment = async (decision) => {
    if (!orderDetails) return;
    let note;
    if (decision === 'approve') {
      if (!window.confirm(`Confirm that ${orderDetails.paymentMethod} payment for ${orderLabel(orderDetails)} has cleared the merchant account?`)) return;
      note = 'Verified against the merchant account.';
    } else {
      note = window.prompt(`Enter the reason for rejecting payment for ${orderLabel(orderDetails)}. This will be shown to the customer.`);
      if (note === null) return;
      if (!note.trim()) {
        showToast('A rejection reason is required.', 'error');
        return;
      }
    }
    setPaymentReviewSaving(true);
    try {
      await api.patch(`/admin/payments/bank-transfers/${orderDetails._id}/review`, { decision, note });
      const { data } = await api.get(`/orders/${orderDetails._id}`);
      setOrderDetails(data);
      setOrders((current) => current.map((order) => order._id === data._id ? { ...order, ...data } : order));
      showToast(decision === 'approve' ? 'Payment confirmed and marked Paid.' : 'Payment rejected; the customer can submit corrected proof.');
    } catch (error) {
      showToast(error.response?.data?.message || 'Payment verification could not be updated.', 'error');
    } finally {
      setPaymentReviewSaving(false);
    }
  };

  const openOrderPaymentReceipt = async (order) => {
    try {
      const { data } = await api.get(`/admin/payments/bank-transfers/${order._id}/receipt`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      showToast(error.response?.data?.message || 'Payment receipt could not be opened.', 'error');
    }
  };

  const openOrderDetails = async (order) => {
    setCustomerMessageDraft('');
    setAdminNoteDraft('');
    try {
      const { data } = await api.get(`/orders/${order._id}`);
      setOrderDetails(data);
    } catch (error) {
      showToast(error.response?.data?.message || 'Order details could not be loaded.', 'error');
      setOrderDetails(order);
    }
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
              <td><strong>{formatPrice(order.totalPrice, order.currency)}</strong></td>
              {!compact && <td><StatusBadge status={isPaidOrder(order) ? 'Paid' : order.paymentStatus || 'Awaiting Payment'} /></td>}
              <td><StatusBadge status={order.orderStatus} /></td>
              <td>
                <button className="admin-icon-button" type="button" onClick={() => openOrderDetails(order)} aria-label={`View order ${orderLabel(order)}`} title="View order">
                  <Icon name="arrow" size={17} />
                </button>
                {!compact && order.orderStatus === 'Pending' && !isPaidOrder(order) && (
                  <button
                    className="admin-text-button danger"
                    type="button"
                    onClick={() => deleteOrder(order)}
                    aria-label={`Delete order ${orderLabel(order)}`}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <EmptyState
          title={orders.length ? 'No orders found' : 'No orders yet'}
          detail={orders.length ? 'Orders matching your search will appear here.' : 'New customer orders will appear here.'}
        />
      )}
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
              <td><strong>{formatPrice(product.price, product.currency)}</strong></td>
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
        <MetricCard title="Total sales" value={formatPrice(financialStats?.totalSales ?? 0, 'ETB')} icon="revenue" note="All verified payments received" />
        <MetricCard title="Total revenue" value={formatPrice(financialStats?.totalRevenue ?? 0, 'ETB')} icon="revenue" note="Sales less completed refunds" />
        <MetricCard title="Total refunds" value={formatPrice(financialStats?.totalRefunds ?? 0, 'ETB')} icon="reports" note="Refunds actually completed" />
        <MetricCard title="Pending payments" value={formatPrice(financialStats?.pendingPayments ?? 0, 'ETB')} icon="inventory" note={`${financialStats?.pendingPaymentOrders ?? 0} orders outstanding or awaiting verification`} />
        <MetricCard title="Total orders" value={financialStats?.totalOrders ?? overview.orders} icon="orders" note="All customer orders, including cancelled" />
        <MetricCard title="Paid orders" value={financialStats?.paidOrders ?? 0} icon="orders" note="Successful verified payments" />
        <MetricCard title="Total products" value={overview.products} icon="products" note="Products in your catalog" />
        <MetricCard title="Total customers" value={overview.users} icon="customers" note="Registered customer accounts" />
      </section>

      <Suspense fallback={<div className="admin-loading"><span className="admin-spinner" /><p>Loading sales charts…</p></div>}>
        <AdminCharts
          analytics={dashboardAnalytics || { buckets: [], revenue: 0 }}
          period={period}
          onPeriodChange={setPeriod}
        />
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
        <div className="admin-panel-heading"><div><h2>Top-selling products</h2><p>Based on paid, non-cancelled order items</p></div></div>
        {filteredTopProducts.length ? (
          <div className="top-products-list">
            {filteredTopProducts.map((product) => (
              <div className="top-product-row" key={product.key}>
                <img src={getProductImageUrl(product.image)} alt="" onError={(event) => { event.currentTarget.src = '/uploads/sample-product.svg'; }} />
                <div className="top-product-name"><strong>{product.name}</strong><span>{product.category}</span></div>
                <span className="top-product-units">{product.units} units sold</span>
                <strong className="top-product-revenue">{formatPrice(product.revenue, 'ETB')}</strong>
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
              <td>{customer.email}</td><td>{formatDate(customer.createdAt)}</td><td>{customer.totalOrders}</td><td><strong>{formatPrice(customer.totalSpending, customer.currency || 'ETB')}</strong></td>
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
    if (page === 'return-management') return <Suspense fallback={<div className="admin-loading"><span className="admin-spinner" /><p>Loading return management…</p></div>}><AdminReturns onToast={showToast} onViewOrder={(orderId) => openOrderDetails({ _id: orderId })} /></Suspense>;
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
        <section className="admin-metric-grid">
          <MetricCard title="Revenue" value={formatPrice(dashboardAnalytics?.revenue ?? 0, 'ETB')} icon="revenue" note="Sales less completed refunds" />
          <MetricCard title="Total sales" value={formatPrice(dashboardAnalytics?.totalSales ?? 0, 'ETB')} icon="reports" note="Verified payments received" />
          <MetricCard title="Total refunds" value={formatPrice(dashboardAnalytics?.totalRefunds ?? 0, 'ETB')} icon="reports" note="Refunds actually completed" />
          <MetricCard title="Previous period" value={formatPrice(dashboardAnalytics?.previousRevenue, 'ETB')} icon="reports" note="Comparable net revenue" />
          <MetricCard
            title="Revenue change"
            value={dashboardAnalytics?.change == null
              ? 'New'
              : `${dashboardAnalytics.change >= 0 ? '+' : ''}${dashboardAnalytics.change.toFixed(1)}%`}
            icon="growth"
            note="Versus previous period"
          />
          <MetricCard title="Orders" value={dashboardAnalytics?.totalOrders ?? 0} icon="orders" note="All orders created in this period" />
        </section>
        <Suspense fallback={<div className="admin-loading"><span className="admin-spinner" /><p>Loading sales charts…</p></div>}>
          <AdminCharts analytics={dashboardAnalytics || { buckets: [], revenue: 0 }} period={period} onPeriodChange={setPeriod} reportMode />
        </Suspense>
      </>
    );
    if (page === 'reviews') return <Suspense fallback={<div className="admin-loading"><span className="admin-spinner" /><p>Loading review moderation…</p></div>}><AdminReviews onToast={showToast} /></Suspense>;
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
            <CurrencyDropdown />
            <div className="admin-notification-wrap">
              <button
                type="button"
                className="admin-notification"
                aria-label={`Order notifications${cancellationNotifications.length ? `, ${cancellationNotifications.length} cancellations` : ''}`}
                title="Order notifications"
                aria-expanded={notificationOpen}
                onClick={() => setNotificationOpen((open) => !open)}
              >
                <Icon name="bell" size={19} />
                {cancellationNotifications.length > 0 && (
                  <span className="admin-notification-count">{cancellationNotifications.length > 9 ? '9+' : cancellationNotifications.length}</span>
                )}
              </button>
              {notificationOpen && (
                <div className="admin-notification-menu" role="region" aria-label="Order notifications">
                  <strong>Customer cancellations</strong>
                  {cancellationNotifications.length ? cancellationNotifications.slice(0, 8).map((order) => (
                    <button
                      type="button"
                      key={order._id}
                      className="admin-notification-item"
                      onClick={() => {
                        setNotificationOpen(false);
                        navigateSection('orders');
                        void openOrderDetails(order._id);
                      }}
                    >
                      <span>{order.orderNumber || order._id}</span>
                      <small>{order.cancellationReason}</small>
                      <time>{order.cancelledAt ? new Date(order.cancelledAt).toLocaleString() : 'Recently cancelled'}</time>
                    </button>
                  )) : <p>No customer cancellations.</p>}
                </div>
              )}
            </div>
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
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProductForm(); }}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
            <div className="admin-modal-heading"><div><h2 id="product-modal-title">{editingProduct ? 'Edit product' : 'Add a product'}</h2><p>Product information and inventory</p></div><button type="button" className="admin-icon-button" onClick={closeProductForm} aria-label="Close">×</button></div>
            <form onSubmit={saveProduct} className="admin-product-form">
              <label>Product name<input required value={formName} onChange={(event) => setFormName(event.target.value)} /></label>
              <label>Description<textarea required rows="3" value={formDescription} onChange={(event) => setFormDescription(event.target.value)} /></label>
              <div className="admin-form-row"><label>Price ({currency})<input required type="number" min="0" step="0.01" value={displayedFormPrice} onChange={(event) => { setFormPriceDraft(event.target.value); setFormPriceDraftCurrency(currency); setFormPriceEdited(true); }} /><small>Display preference changes do not alter saved product prices.</small></label><label>{formVariants.length ? 'Total available variant stock' : 'Stock quantity'}<input required type="number" min="0" step="1" value={formVariants.length ? formVariants.reduce((sum, variant) => sum + (variant.isAvailable === false ? 0 : Number(variant.stockQuantity) || 0), 0) : formStock} onChange={(event) => setFormStock(event.target.value)} readOnly={formVariants.length > 0} /><small>{formVariants.length ? 'Unavailable variants are excluded from available stock.' : 'Enter available inventory.'}</small></label></div>
              <label>Category<input required value={formCategory} onChange={(event) => setFormCategory(event.target.value)} /></label>
              <label>Subcategory<input value={formSubcategory} onChange={(event) => setFormSubcategory(event.target.value)} /></label>
              <label>Brand<input value={formBrand} onChange={(event) => setFormBrand(event.target.value)} /></label>
              <label>Search keywords<input value={formKeywords} onChange={(event) => setFormKeywords(event.target.value)} placeholder="Separate keywords with commas" /><small>Optional terms customers can use to find this product.</small></label>
              <div className="admin-product-images">
                <label>Product images<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addProductImages} /><small>Upload up to 11 images. Choose a primary image; saved images are kept until removed.</small></label>
                {formGallery.length > 0 && (
                  <div className="admin-product-image-grid">
                    {formGallery.map((image, index) => (
                      <article className={`admin-product-image-card${primaryImageId === image.id ? ' primary' : ''}`} key={image.id}>
                        <img src={image.preview} alt={`Product image ${index + 1} preview`} />
                        <div className="admin-product-image-actions">
                          <label className="admin-primary-image-choice">
                            <input
                              type="radio"
                              name="primaryProductImage"
                              checked={primaryImageId === image.id}
                              onChange={() => setPrimaryImageId(image.id)}
                            />
                            Primary
                          </label>
                          <button type="button" className="admin-text-button danger" onClick={() => removeProductImage(image.id)}>Remove</button>
                        </div>
                        <small>{image.file ? image.file.name : 'Saved image'}</small>
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div className="admin-variant-editor">
                <div className="admin-variant-editor-heading"><div><strong>Product options and variants</strong><small>Add one row per available combination, using shared option names (for example, Color=Blue; Size=M). Set a CSS color value to display a named color as a swatch.</small></div><button type="button" className="admin-outline-button" onClick={() => setFormVariants((current) => [...current, { optionsText: '', price: '', stockQuantity: '', sku: '', image: '', colorValue: '', isAvailable: true }])}>+ Add variant</button></div>
                {formVariants.map((variant, index) => (
                  <div className="admin-variant-row" key={`variant-${index}`}>
                    <div className="admin-variant-row-heading">
                      <strong>Variant {index + 1}</strong>
                      <span className={`admin-status ${
                        variant.isAvailable === false || Number(variant.stockQuantity) === 0
                          ? 'status-out-of-stock'
                          : Number(variant.stockQuantity) < 5
                            ? 'status-low-stock'
                            : 'status-in-stock'
                      }`}>
                        <span className="admin-status-dot"></span>
                        {variant.isAvailable === false ? 'Unavailable' : Number(variant.stockQuantity) === 0 ? 'Out of stock' : Number(variant.stockQuantity) < 5 ? 'Low stock' : 'In stock'}
                      </span>
                    </div>
                    <div className="admin-form-row">
                      <label>Option values<input value={variant.optionsText} onChange={(event) => updateFormVariant(index, 'optionsText', event.target.value)} placeholder="Color=Blue; Size=M" /><small>Separate option pairs with semicolons.</small></label>
                      <label>Price ({variant.priceCurrency || currency}, optional)<input type="number" min="0" step="0.01" value={variant.price} onChange={(event) => updateFormVariant(index, 'price', event.target.value)} placeholder="Use base price" /></label>
                    </div>
                    <div className="admin-form-row">
                      <label>Variant stock<input type="number" min="0" step="1" value={variant.stockQuantity} onChange={(event) => updateFormVariant(index, 'stockQuantity', event.target.value)} /></label>
                      <label>SKU (optional)<input value={variant.sku} onChange={(event) => updateFormVariant(index, 'sku', event.target.value)} /></label>
                    </div>
                    <div className="admin-form-row">
                      <label>Color value (optional)<input value={variant.colorValue} onChange={(event) => updateFormVariant(index, 'colorValue', event.target.value)} placeholder="#1f2937 or navy" /><small>Used for color swatches when an option is named Color or Colour.</small></label>
                      <label className="admin-variant-availability"><input type="checkbox" checked={variant.isAvailable !== false} onChange={(event) => updateFormVariant(index, 'isAvailable', event.target.checked)} /> Available for purchase</label>
                    </div>
                    <label>Variant image URL (optional)<input type="url" value={variant.image} onChange={(event) => updateFormVariant(index, 'image', event.target.value)} /></label>
                    <button type="button" className="admin-text-button danger" onClick={() => setFormVariants((current) => current.filter((_, variantIndex) => variantIndex !== index))}>Remove variant</button>
                  </div>
                ))}
              </div>
              <div className="admin-modal-actions"><button type="button" className="admin-outline-button" onClick={closeProductForm}>Cancel</button><button type="submit" className="admin-primary-button" disabled={formSubmitting}>{formSubmitting ? 'Saving…' : editingProduct ? 'Save changes' : 'Create product'}</button></div>
            </form>
          </section>
        </div>
      )}

      {orderDetails && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOrderDetails(null); }}>
          <section className="admin-modal order-modal" role="dialog" aria-modal="true" aria-labelledby="order-modal-title">
            <div className="admin-modal-heading"><div><span className="admin-modal-eyebrow">ORDER {orderLabel(orderDetails)}</span><h2 id="order-modal-title">Order details</h2></div><button type="button" className="admin-icon-button" onClick={() => setOrderDetails(null)} aria-label="Close">×</button></div>
            <div className="order-detail-meta"><div><span>Customer</span><strong>{orderDetails.user?.name || 'Customer'}</strong><small>{orderDetails.user?.email || '—'} · {orderDetails.phoneNumber || 'No phone'}</small></div><div><span>Placed</span><strong>{formatDate(orderDetails.createdAt)}</strong></div><div><span>Order total</span><strong>{formatPrice(orderDetails.totalPrice, orderDetails.currency)}</strong></div><div><span>Amount paid</span><strong>{formatPrice(orderDetails.paymentAmount ?? orderDetails.totalPrice, orderDetails.paymentCurrency || orderDetails.currency)}</strong><small>{orderDetails.isPaid ? 'Paid' : orderDetails.paymentStatus || 'Unpaid'} · {orderDetails.paymentMethod}</small></div></div>
            <div className="admin-order-resolution-block">
              <h3>Payment Verification</h3>
              <p><strong>Order ID:</strong> {orderLabel(orderDetails)}</p>
              <p><strong>Customer:</strong> {orderDetails.user?.name || orderDetails.customerName || 'Customer'}</p>
              <p><strong>Amount expected:</strong> {formatPrice(orderDetails.totalPrice, orderDetails.currency)}</p>
              <p><strong>Payment method:</strong> {orderDetails.paymentMethod || '—'}</p>
              <p><strong>Transaction reference:</strong> {orderDetails.transactionReference || '—'}</p>
              <p><strong>Payment submission date:</strong> {formatDateTime(orderDetails.paymentReceipt?.uploadedAt)}</p>
              <p><strong>Verification status:</strong> {orderDetails.isPaid ? 'Paid' : orderDetails.paymentStatus || 'Awaiting Payment'}</p>
              {orderDetails.paymentReviewNote && <p><strong>Review note:</strong> {orderDetails.paymentReviewNote}</p>}
              {orderDetails.paymentReviewedAt && <p><strong>Verified date:</strong> {formatDateTime(orderDetails.paymentReviewedAt)}</p>}
              {orderDetails.paymentReceipt && (
                <button type="button" className="admin-outline-button" onClick={() => openOrderPaymentReceipt(orderDetails)}>View uploaded screenshot / receipt</button>
              )}
              {orderDetails.paymentStatus === 'Pending Verification' && !orderDetails.isPaid && (
                <div className="admin-modal-actions">
                  <button type="button" className="admin-primary-button" disabled={paymentReviewSaving} onClick={() => reviewOrderPayment('approve')}>{paymentReviewSaving ? 'Saving…' : 'Confirm Payment'}</button>
                  <button type="button" className="admin-outline-button danger" disabled={paymentReviewSaving} onClick={() => reviewOrderPayment('reject')}>Reject Payment</button>
                </div>
              )}
              {orderDetails.isPaid && <p>Payment Status: Paid · Amount Paid: {formatPrice(orderDetails.paymentAmount ?? orderDetails.totalPrice, orderDetails.paymentCurrency || orderDetails.currency)}</p>}
            </div>
            {orderDetails.cancellationReason && <div className="admin-order-resolution-block"><strong>Customer cancellation reason</strong><p>{orderDetails.cancellationReason}</p><time>{formatDateTime(orderDetails.cancelledAt)}</time></div>}
            <h3 className="order-detail-subhead">Items</h3>
            <div className="order-detail-items">{(orderDetails.orderItems || []).map((item, index) => <div className="order-detail-item" key={`${item.product}-${index}`}><img src={getProductImageUrl(item.image)} alt="" /><span><strong>{item.name}</strong>{Object.entries(item.options || {}).map(([name, value]) => <small key={name}>{name}: {value}</small>)}<small>{item.qty} × {formatPrice(item.price, item.currency || orderDetails.currency)}</small></span><strong>{formatPrice(item.qty * item.price, item.currency || orderDetails.currency)}</strong></div>)}</div>

            <div className="admin-tracking-form">
              <label className="admin-status-control">Order status<select value={orderDetails.orderStatus || 'Pending'} onChange={(event) => updateOrderDetailField('orderStatus', event.target.value)}>{ORDER_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
              <label className="admin-status-control">Tracking number<input type="text" value={orderDetails.trackingNumber || ''} onChange={(event) => updateOrderDetailField('trackingNumber', event.target.value)} placeholder="e.g. AS123456789" /></label>
              <label className="admin-status-control">Courier name<input type="text" value={orderDetails.courierName || ''} onChange={(event) => updateOrderDetailField('courierName', event.target.value)} placeholder="e.g. DHL, FedEx, Aramex" /></label>
              <label className="admin-status-control">Estimated delivery<input type="date" value={orderDetails.estimatedDelivery ? new Date(orderDetails.estimatedDelivery).toISOString().split('T')[0] : ''} onChange={(event) => updateOrderDetailField('estimatedDelivery', event.target.value)} /></label>
              <label className="admin-status-control">Delivery notes<textarea rows="3" value={orderDetails.deliveryNotes || ''} onChange={(event) => updateOrderDetailField('deliveryNotes', event.target.value)} placeholder="Add delivery instructions or notes" /></label>
              <label className="admin-status-control">Message for customer<textarea rows="3" maxLength={1000} value={customerMessageDraft} onChange={(event) => setCustomerMessageDraft(event.target.value)} placeholder="Explain this update, shipping progress, a delay, or next steps" /></label>
              <label className="admin-status-control">Internal admin note (not shown to customer)<textarea rows="2" maxLength={1000} value={adminNoteDraft} onChange={(event) => setAdminNoteDraft(event.target.value)} placeholder="Optional internal context for administrators" /></label>
              <div className="admin-modal-actions">
                <button type="button" className="admin-outline-button" onClick={() => setOrderDetails(null)}>Close</button>
                <button type="button" className="admin-primary-button" disabled={trackingSaving} onClick={() => updateTrackingDetails(orderDetails._id, {
                  status: orderDetails.orderStatus,
                  trackingNumber: orderDetails.trackingNumber,
                  courierName: orderDetails.courierName,
                  estimatedDelivery: orderDetails.estimatedDelivery,
                  deliveryNotes: orderDetails.deliveryNotes,
                  customerMessage: customerMessageDraft,
                  adminNote: adminNoteDraft,
                })}>
                  {trackingSaving ? 'Saving…' : 'Save order update'}
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
                      <span className="admin-history-system-message">Status update: {entry.message || 'Status updated'}</span>
                      {entry.customerMessage && <span className="admin-history-customer-message">Customer message: {entry.customerMessage}</span>}
                      {entry.adminNote && <span className="admin-history-internal-note">Internal note: {entry.adminNote}</span>}
                      <time>{formatDateTime(entry.timestamp)}</time>
                    </li>
                  ))}
                </ol>
              ) : <p>No tracking updates have been recorded.</p>}
            </div>
            <div className="admin-order-resolution-block">
              <h3>Refund management</h3>
              {orderDetails.refunds?.length ? orderDetails.refunds.map((refund) => (
                <article key={refund.id}>
                  <strong>{refund.status} · Refund {formatPrice(refund.amount, refund.currency)}</strong>
                  <span>Paid: {formatPrice(refund.originalAmount, refund.currency)} · {refund.paymentMethod || orderDetails.paymentMethod}</span>
                  <span>Original transaction: {refund.transactionReference || 'Not recorded'}</span>
                  {refund.reason && <span>Reason: {refund.reason}</span>}
                  {refund.providerRefundReference && <span>Refund reference: {refund.providerRefundReference}</span>}
                  {refund.customerMessage && <p>Customer message: {refund.customerMessage}</p>}
                  {refund.history?.map((entry, index) => <small key={`${entry.status}-${entry.timestamp || index}`}>{entry.status} · {formatDateTime(entry.timestamp)}{entry.message ? ` — ${entry.message}` : ''}</small>)}
                </article>
              )) : <p>{orderDetails.isPaid ? 'No refund record exists for this order.' : 'No payment was received; a refund is not required.'}</p>}
              <button type="button" className="admin-text-button" onClick={() => { setOrderDetails(null); navigateSection('payment-refunds'); }}>Open Refund Management</button>
            </div>
            {orderDetails.returnRequest && (
              <div className="admin-order-resolution-block">
                <h3>Return request · {orderDetails.returnRequest.status}</h3>
                <p>{orderDetails.returnRequest.reason}</p>
                {orderDetails.returnRequest.adminResponse && <p>Customer message: {orderDetails.returnRequest.adminResponse}</p>}
                <button type="button" className="admin-text-button" onClick={() => { setOrderDetails(null); navigateSection('return-management'); }}>Manage return and customer photos</button>
              </div>
            )}
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
