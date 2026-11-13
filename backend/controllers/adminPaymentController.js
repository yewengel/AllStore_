const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const Refund = require('../models/Refund');
const PaymentSetting = require('../models/PaymentSetting');
const { toEtb } = require('../utils/currency');
const { nextRefundNumber } = require('../utils/orderNumbers');
const { refundChapaTransaction } = require('../utils/chapa');
const { paymentHistoryEntry } = require('./paymentController');
const {
  PAYMENT_METHOD_KEYS,
  resolvePaymentConfiguration,
} = require('../utils/paymentSettings');

const ALL_METHODS = ['Telebirr', 'M-Pesa', 'Bank Transfer', 'Visa', 'Mastercard', 'Cash on Delivery'];
const ONLINE_METHODS = ['Telebirr', 'M-Pesa', 'Visa', 'Mastercard'];
const PAYMENT_STATUSES = [
  'Pending',
  'Processing',
  'Paid',
  'Failed',
  'Cancelled',
  'Awaiting Verification',
  'Unpaid',
  'Refunded',
  'Partially Refunded',
  'Rejected',
];

const METHOD_KEYWORDS = {
  Telebirr: ['telebirr'],
  'M-Pesa': ['m-pesa', 'mpesa', 'm_pesa', 'm pesa'],
  Visa: ['visa'],
  Mastercard: ['mastercard', 'master card', 'master-card'],
};

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const orderAmountEtb = (order) => {
  const amount = order.paymentAmount ?? order.totalPrice ?? 0;
  const currency = order.paymentCurrency || order.currency || 'ETB';
  try {
    return toEtb(amount, currency);
  } catch {
    return Number(amount) || 0;
  }
};

const normalizeMethod = (order) => {
  const method = order.paymentMethod || '';
  if (method === 'Bank Transfer' || method === 'Cash on Delivery') return method;
  const channel = String(order.paymentChannel || '').trim().toLowerCase();
  for (const [key, keywords] of Object.entries(METHOD_KEYWORDS)) {
    if (keywords.some((keyword) => channel.includes(keyword))) return key;
  }
  if (method === 'Chapa Checkout' || method === 'Credit Card') {
    if (!channel) return 'Online Payment';
    return channel.replace(/\b\w/g, (character) => character.toUpperCase());
  }
  return method || 'Unknown';
};

const effectiveStatus = (order) => {
  const refunded = Number(order.refundedAmount) || 0;
  if (order.paymentStatus === 'Refunded') return 'Refunded';
  if (order.paymentStatus === 'Partially Refunded') return 'Partially Refunded';
  if (order.isPaid && refunded > 0) return 'Partially Refunded';
  if (order.isPaid || order.paymentStatus === 'Paid') return 'Paid';
  if (['Pending Verification', 'Awaiting Verification'].includes(order.paymentStatus)) return 'Awaiting Verification';
  if (order.paymentMethod === 'Cash on Delivery' && (order.paymentStatus === 'Pending' || !order.paymentStatus)) return 'Unpaid';
  return order.paymentStatus || 'Pending';
};

const providerLabel = (order) => {
  if (order.paymentMethod === 'Bank Transfer') return 'Manual bank transfer';
  if (order.paymentMethod === 'Cash on Delivery') return 'Cash on Delivery';
  if (order.paymentMethod === 'Chapa Checkout' || order.paymentMethod === 'Credit Card') return 'Chapa';
  return order.paymentMethod || '—';
};

const serializeTransaction = (order) => ({
  id: order._id,
  orderNumber: order.orderNumber || '',
  transactionReference: order.transactionReference || '',
  customerName: order.customerName || order.user?.name || 'Customer',
  customerEmail: order.user?.email || '',
  customerPhone: order.phoneNumber || order.deliveryPhoneNumber || '',
  paymentMethod: order.paymentMethod,
  paymentChannel: order.paymentChannel || '',
  methodLabel: normalizeMethod(order),
  paymentProvider: providerLabel(order),
  amount: orderAmountEtb(order),
  currency: 'ETB',
  paymentDate: order.paymentDate || order.paidAt || null,
  paymentStatus: effectiveStatus(order),
  storedPaymentStatus: order.paymentStatus || 'Pending',
  isPaid: Boolean(order.isPaid),
  orderStatus: order.orderStatus,
  createdAt: order.createdAt,
  gatewayReference: order.paymentGatewayReference || '',
  receipt: order.paymentReceipt && order.paymentReceipt.storageKey
    ? {
      mimeType: order.paymentReceipt.mimeType,
      originalName: order.paymentReceipt.originalName,
      uploadedAt: order.paymentReceipt.uploadedAt,
    }
    : null,
  refundedAmount: Number(order.refundedAmount) || 0,
  codCollectionStatus: order.codCollectionStatus || 'Pending',
});

// ---------------------------------------------------------------------------
// Dashboard statistics
// ---------------------------------------------------------------------------

const PERIODS = {
  daily: { count: 14, unit: 'day' },
  weekly: { count: 8, unit: 'week' },
  monthly: { count: 12, unit: 'month' },
  yearly: { count: 5, unit: 'year' },
};

const startOfUtcDay = (date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

const buildBuckets = (period) => {
  const now = new Date();
  const buckets = [];
  if (period === 'daily') {
    const today = startOfUtcDay(now);
    for (let i = 13; i >= 0; i -= 1) {
      const start = today - i * 86400000;
      buckets.push({
        start,
        end: start + 86400000,
        label: new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        revenue: 0,
        count: 0,
      });
    }
  } else if (period === 'weekly') {
    const today = startOfUtcDay(now);
    const weekday = new Date(today).getUTCDay();
    const mondayOffset = (weekday + 6) % 7;
    const weekStart = today - mondayOffset * 86400000;
    for (let i = 7; i >= 0; i -= 1) {
      const start = weekStart - i * 7 * 86400000;
      buckets.push({
        start,
        end: start + 7 * 86400000,
        label: new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        revenue: 0,
        count: 0,
      });
    }
  } else if (period === 'monthly') {
    for (let i = 11; i >= 0; i -= 1) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
      buckets.push({
        start: start.getTime(),
        end: end.getTime(),
        label: start.toLocaleDateString('en-US', {
          month: 'short',
          ...(start.getUTCFullYear() !== now.getUTCFullYear() ? { year: '2-digit' } : {}),
          timeZone: 'UTC',
        }),
        revenue: 0,
        count: 0,
      });
    }
  } else {
    for (let i = 4; i >= 0; i -= 1) {
      const start = Date.UTC(now.getUTCFullYear() - i, 0, 1);
      const end = Date.UTC(now.getUTCFullYear() - i + 1, 0, 1);
      buckets.push({ start, end, label: String(now.getUTCFullYear() - i), revenue: 0, count: 0 });
    }
  }
  return buckets;
};

const getPaymentStats = async (req, res, next) => {
  try {
    const period = PERIODS[req.query.period] ? req.query.period : 'monthly';

    const successfulFilter = { isPaid: true, orderStatus: { $ne: 'Cancelled' } };
    const amountExpr = {
      $let: {
        vars: {
          amount: { $ifNull: ['$paymentAmount', { $ifNull: ['$totalPrice', 0] }] },
          currency: { $ifNull: ['$paymentCurrency', { $ifNull: ['$currency', 'ETB'] }] },
        },
        in: {
          $cond: [
            { $eq: ['$$currency', 'ETB'] },
            '$$amount',
            { $multiply: ['$$amount', Number(process.env.ETB_PER_USD) || 164.62] },
          ],
        },
      },
    };

    const [revenueAgg, refundAgg, codAgg, methodAgg, failedCount, pendingCount, paidCount, dailyRevenue, recentOrders] =
      await Promise.all([
        Order.aggregate([
          { $match: successfulFilter },
          { $group: { _id: null, total: { $sum: amountExpr } } },
        ]),
        Refund.aggregate([
          { $match: { status: 'Refunded' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Order.aggregate([
          {
            $match: {
              paymentMethod: 'Cash on Delivery',
              isPaid: { $ne: true },
              orderStatus: { $ne: 'Cancelled' },
              codCollectionStatus: { $ne: 'Collected' },
            },
          },
          { $group: { _id: null, total: { $sum: amountExpr } } },
        ]),
        Order.aggregate([
          { $match: { orderStatus: { $ne: 'Cancelled' } } },
          {
            $group: {
              _id: {
                method: '$paymentMethod',
                channel: { $ifNull: ['$paymentChannel', ''] },
              },
              count: { $sum: 1 },
              amount: { $sum: amountExpr },
            },
          },
        ]),
        Order.countDocuments({ paymentStatus: 'Failed' }),
        Order.countDocuments({
          isPaid: { $ne: true },
          orderStatus: { $ne: 'Cancelled' },
          paymentStatus: { $in: ['Pending', 'Processing', 'Pending Verification', 'Awaiting Verification'] },
        }),
        Order.countDocuments(successfulFilter),
        Order.aggregate([
          { $match: successfulFilter },
          {
            $project: {
              amount: amountExpr,
              date: { $ifNull: ['$paymentDate', { $ifNull: ['$paidAt', '$createdAt'] }] },
            },
          },
          {
            $group: {
              _id: { $dateToString: { date: '$date', format: '%Y-%m-%d' } },
              revenue: { $sum: '$amount' },
              count: { $sum: 1 },
            },
          },
        ]),
        Order.find({}).populate('user', 'name email').sort({ createdAt: -1 }).limit(8),
      ]);

    const methodBreakdown = ALL_METHODS.map((method) => ({ method, count: 0, amount: 0 }));
    const methodIndex = new Map(methodBreakdown.map((entry) => [entry.method, entry]));
    let other = { method: 'Other', count: 0, amount: 0 };
    methodAgg.forEach((row) => {
      const label = normalizeMethod({ paymentMethod: row._id.method, paymentChannel: row._id.channel });
      const target = methodIndex.get(label);
      if (target) {
        target.count += row.count;
        target.amount += row.amount || 0;
      } else {
        other.count += row.count;
        other.amount += row.amount || 0;
      }
    });
    methodIndex.forEach((entry) => { entry.amount = round2(entry.amount); });
    other = { ...other, amount: round2(other.amount) };
    const methodBreakdownWithOther = other.count > 0 ? [...methodBreakdown, other] : methodBreakdown;

    const buckets = buildBuckets(period);
    dailyRevenue.forEach((row) => {
      if (!row._id) return;
      const [year, month, day] = row._id.split('-').map(Number);
      const timestamp = Date.UTC(year, month - 1, day);
      const bucket = buckets.find((item) => timestamp >= item.start && timestamp < item.end);
      if (bucket) {
        bucket.revenue += row.revenue || 0;
        bucket.count += row.count || 0;
      }
    });

    const methodStats = ALL_METHODS.map((method) => {
      const entry = methodIndex.get(method);
      return { method, count: entry.count, amount: round2(entry.amount) };
    });

    return res.json({
      currency: 'ETB',
      cards: {
        totalRevenue: round2(revenueAgg[0]?.total || 0),
        successfulPayments: paidCount,
        pendingPayments: pendingCount,
        failedPayments: failedCount,
        refundedAmount: round2(refundAgg[0]?.total || 0),
        codAwaitingCollection: round2(codAgg[0]?.total || 0),
      },
      methodStats,
      methodBreakdown: methodBreakdownWithOther.map((entry) => ({ ...entry, amount: round2(entry.amount) })),
      trend: buckets.map(({ label, revenue, count }) => ({ label, revenue: round2(revenue), count })),
      period,
      recentTransactions: recentOrders.map(serializeTransaction),
    });
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

const statusCondition = (status) => {
  switch (status) {
    case 'Paid':
      return { $or: [{ isPaid: true }, { paymentStatus: 'Paid' }] };
    case 'Awaiting Verification':
      return { paymentStatus: { $in: ['Pending Verification', 'Awaiting Verification'] } };
    case 'Unpaid':
      return {
        $or: [
          { paymentStatus: 'Unpaid' },
          { paymentMethod: 'Cash on Delivery', paymentStatus: 'Pending', isPaid: { $ne: true } },
        ],
      };
    default:
      return { paymentStatus: status };
  }
};

const buildTransactionFilter = async (query) => {
  const conditions = [];
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) {
    const regex = new RegExp(escapeRegExp(search), 'i');
    const users = await User.find({ $or: [{ name: regex }, { email: regex }] }).select('_id').lean();
    conditions.push({
      $or: [
        { orderNumber: regex },
        { transactionReference: regex },
        { customerName: regex },
        { user: { $in: users.map((user) => user._id) } },
      ],
    });
  }

  const method = typeof query.method === 'string' ? query.method.trim() : '';
  if (method && method !== 'all' && method !== 'All methods') {
    const keywords = METHOD_KEYWORDS[method];
    if (keywords) {
      const pattern = keywords.map(escapeRegExp).join('|');
      conditions.push({
        $or: [
          { paymentMethod: { $regex: `^${escapeRegExp(method)}$`, $options: 'i' } },
          { paymentChannel: { $regex: pattern, $options: 'i' } },
        ],
      });
    } else if (method === 'Bank Transfer' || method === 'Cash on Delivery') {
      conditions.push({ paymentMethod: method });
    }
  }

  const status = typeof query.status === 'string' ? query.status.trim() : '';
  if (status && status !== 'all' && status !== 'All statuses' && PAYMENT_STATUSES.includes(status)) {
    conditions.push(statusCondition(status));
  }

  const dateRange = {};
  if (query.from) {
    const from = new Date(query.from);
    if (!Number.isNaN(from.getTime())) dateRange.$gte = from;
  }
  if (query.to) {
    const to = new Date(query.to);
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      dateRange.$lte = to;
    }
  }
  if (Object.keys(dateRange).length) conditions.push({ createdAt: dateRange });

  return conditions.length ? { $and: conditions } : {};
};

const getTransactions = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const sort = req.query.sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
    const filter = await buildTransactionFilter(req.query);

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('user', 'name email')
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    return res.json({
      items: orders.map(serializeTransaction),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    return next(error);
  }
};

const getTransactionDetail = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ status: 'error', message: 'Transaction not found.' });
    }
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email')
      .populate('paymentReviewedBy', 'name email')
      .populate('paymentHistory.adminUserId', 'name')
      .lean();
    if (!order) return res.status(404).json({ status: 'error', message: 'Transaction not found.' });

    const items = order.orderItems?.length ? order.orderItems : order.items || [];
    const subtotal = Number.isFinite(order.subtotal)
      ? order.subtotal
      : items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0);
    const discount = Number(order.discountAmount) || 0;
    const shippingCost = Number.isFinite(order.shippingCost)
      ? order.shippingCost
      : Math.max(0, (Number(order.totalPrice) || 0) - subtotal + discount);
    const refunds = await Refund.find({ order: order._id }).sort({ createdAt: -1 }).lean();

    return res.json({
      transaction: serializeTransaction(order),
      customer: {
        name: order.customerName || order.user?.name || 'Customer',
        email: order.user?.email || '',
        phone: order.phoneNumber || order.deliveryPhoneNumber || '',
      },
      order: {
        orderStatus: order.orderStatus,
        items: items.map((item) => ({
          name: item.name,
          qty: item.qty,
          price: item.price,
          image: item.image,
          currency: item.currency || order.currency || 'ETB',
        })),
        subtotal: round2(subtotal),
        shippingCost: round2(shippingCost),
        discountAmount: round2(discount),
        totalPrice: round2(Number(order.totalPrice) || 0),
        currency: order.currency || 'ETB',
        deliveryAddress: order.deliveryAddress || [
          order.shippingAddress?.address,
          order.shippingAddress?.city,
          order.shippingAddress?.postalCode,
          order.shippingAddress?.country,
        ].filter(Boolean).join(', '),
      },
      verification: {
        providerReference: order.paymentGatewayReference || '',
        gatewayResult: order.isPaid
          ? 'Verified — payment confirmed by provider'
          : ['Failed', 'Cancelled'].includes(order.paymentStatus)
            ? `Provider reported ${order.paymentStatus.toLowerCase()}`
            : 'Not verified with the provider',
        receipt: order.paymentReceipt && order.paymentReceipt.storageKey
          ? {
            mimeType: order.paymentReceipt.mimeType,
            originalName: order.paymentReceipt.originalName,
            uploadedAt: order.paymentReceipt.uploadedAt,
          }
          : null,
        verifiedAt: order.paymentDate || order.paidAt || null,
        reviewedAt: order.paymentReviewedAt || null,
        reviewedBy: order.paymentReviewedBy || null,
        reviewNote: order.paymentReviewNote || '',
        cod: {
          status: order.codCollectionStatus || 'Pending',
          collectedAmount: order.codCollectedAmount ?? null,
          collectedAt: order.codCollectedAt || null,
          note: order.codCollectionNote || '',
        },
      },
      history: (order.paymentHistory || []).slice().sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      ),
      refunds: refunds.map(serializeRefund),
    });
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Bank transfer verification
// ---------------------------------------------------------------------------

const getBankTransfers = async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'awaiting';
    const statusFilter = status === 'rejected'
      ? { paymentStatus: 'Rejected' }
      : status === 'reviewed'
        ? { paymentStatus: 'Paid' }
        : { paymentStatus: { $in: ['Pending Verification', 'Awaiting Verification'] }, isPaid: { $ne: true } };

    const orders = await Order.find({ paymentMethod: 'Bank Transfer', ...statusFilter })
      .populate('user', 'name email')
      .sort({ paymentReceiptUploadedAt: -1, createdAt: -1 });
    return res.json(orders.map(serializeTransaction));
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Cash on delivery
// ---------------------------------------------------------------------------

const getCodOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ paymentMethod: 'Cash on Delivery' })
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    return res.json(orders.map((order) => ({
      ...serializeTransaction(order),
      deliveryAddress: order.deliveryAddress || '',
      codCollectionStatus: order.codCollectionStatus || 'Pending',
      codCollectedAmount: order.codCollectedAmount ?? null,
      codCollectedAt: order.codCollectedAt || null,
      codCollectionNote: order.codCollectionNote || '',
    })));
  } catch (error) {
    return next(error);
  }
};

const collectCod = async (req, res, next) => {
  try {
    const { collected = true, amount, note = '' } = req.body || {};
    if (typeof collected !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'Collected must be true or false.' });
    }
    if (typeof note !== 'string' || note.length > 500) {
      return res.status(400).json({ status: 'error', message: 'Note must be no longer than 500 characters.' });
    }
    const order = await Order.findOne({ _id: req.params.id, paymentMethod: 'Cash on Delivery' });
    if (!order) return res.status(404).json({ status: 'error', message: 'Cash on delivery order not found.' });
    if (order.orderStatus === 'Cancelled') {
      return res.status(409).json({ status: 'error', message: 'A cancelled order cannot be collected.' });
    }
    if (order.codCollectionStatus === 'Collected' && collected) {
      return res.status(409).json({ status: 'error', message: 'This order has already been collected.' });
    }

    const timestamp = new Date();
    const expected = orderAmountEtb(order);
    if (collected) {
      const collectedAmount = amount === undefined || amount === null || amount === ''
        ? expected
        : Number(amount);
      if (!Number.isFinite(collectedAmount) || collectedAmount < 0) {
        return res.status(400).json({ status: 'error', message: 'Enter a valid collected amount.' });
      }
      if (collectedAmount > expected + 0.005) {
        return res.status(400).json({ status: 'error', message: 'Collected amount cannot exceed the amount due.' });
      }
      order.codCollectionStatus = 'Collected';
      order.codCollectedAmount = round2(collectedAmount);
      order.codCollectedAt = timestamp;
      order.codCollectedBy = req.user._id;
      order.codCollectionNote = note.trim();
      if (collectedAmount >= expected - 0.005) {
        order.isPaid = true;
        order.paymentStatus = 'Paid';
        order.paidAt = timestamp;
        order.paymentDate = timestamp;
        order.paymentHistory = order.paymentHistory || [];
        order.paymentHistory.push(paymentHistoryEntry('Paid', {
          previousStatus: 'Unpaid',
          message: 'Cash on delivery collected and confirmed by an administrator.',
          adminNote: note.trim(),
          adminUserId: req.user._id,
          amount: round2(collectedAmount),
        }));
      }
    } else {
      order.codCollectionStatus = 'Not Collected';
      order.codCollectedAmount = undefined;
      order.codCollectedAt = timestamp;
      order.codCollectedBy = req.user._id;
      order.codCollectionNote = note.trim();
      order.paymentStatus = 'Unpaid';
      order.paymentHistory = order.paymentHistory || [];
      order.paymentHistory.push(paymentHistoryEntry('Unpaid', {
        previousStatus: order.paymentStatus,
        message: 'Cash on delivery marked as not collected by an administrator.',
        adminNote: note.trim(),
        adminUserId: req.user._id,
      }));
    }
    await order.save();
    return res.json(serializeTransaction(order));
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

function serializeRefund(refund) {
  const orderRef = refund.order;
  const populatedOrder = orderRef && typeof orderRef === 'object' && orderRef.orderNumber
    ? orderRef
    : null;
  const userRef = refund.user;
  const populatedUser = userRef && typeof userRef === 'object' && userRef.name ? userRef : null;
  return {
    id: refund._id,
    refundNumber: refund.refundNumber,
    orderId: populatedOrder ? populatedOrder._id : refund.order,
    orderNumber: populatedOrder?.orderNumber || '',
    transactionReference: refund.transactionReference || '',
    customerName: populatedUser?.name || '',
    customerEmail: populatedUser?.email || '',
    paymentMethod: refund.paymentMethod,
    paymentProvider: refund.paymentProvider,
    originalAmount: refund.originalAmount,
    amount: refund.amount,
    currency: refund.currency || 'ETB',
    reason: refund.reason,
    status: refund.status,
    providerRefundReference: refund.providerRefundReference || '',
    providerStatus: refund.providerStatus || '',
    requestedAt: refund.requestedAt || refund.createdAt,
    reviewedAt: refund.reviewedAt || null,
    reviewNote: refund.reviewNote || '',
    processedAt: refund.processedAt || null,
    processingNote: refund.processingNote || '',
  };
}

const getRefunds = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const conditions = [];
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      const regex = new RegExp(escapeRegExp(search), 'i');
      const orders = await Order.find({ orderNumber: regex }).select('_id').lean();
      conditions.push({
        $or: [
          { refundNumber: regex },
          { order: { $in: orders.map((order) => order._id) } },
        ],
      });
    }
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    if (status && status !== 'all' && status !== 'All statuses') {
      conditions.push({ status });
    }
    const filter = conditions.length ? { $and: conditions } : {};

    const [refunds, total] = await Promise.all([
      Refund.find(filter)
        .populate('order', 'orderNumber')
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Refund.countDocuments(filter),
    ]);

    return res.json({
      items: refunds.map(serializeRefund),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    return next(error);
  }
};

const getRefundDetail = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ status: 'error', message: 'Refund not found.' });
    }
    const refund = await Refund.findById(req.params.id)
      .populate('order', 'orderNumber totalPrice')
      .populate('user', 'name email');
    if (!refund) return res.status(404).json({ status: 'error', message: 'Refund not found.' });
    return res.json(serializeRefund(refund));
  } catch (error) {
    return next(error);
  }
};

const createRefund = async (req, res, next) => {
  try {
    const { orderId, amount, reason = '' } = req.body || {};
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ status: 'error', message: 'A valid order is required.' });
    }
    if (typeof reason !== 'string' || reason.length > 500) {
      return res.status(400).json({ status: 'error', message: 'Reason must be no longer than 500 characters.' });
    }
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ status: 'error', message: 'Order not found.' });
    if (!order.isPaid || !['Paid', 'Partially Refunded'].includes(effectiveStatus(order))) {
      return res.status(409).json({ status: 'error', message: 'Only successfully paid orders can be refunded.' });
    }

    const originalAmount = orderAmountEtb(order);
    const alreadyRefunded = Number(order.refundedAmount) || 0;
    const activeRefund = await Refund.findOne({
      order: order._id,
      status: { $in: ['Requested', 'Approved', 'Processing'] },
    });
    if (activeRefund) {
      return res.status(409).json({ status: 'error', message: 'This order already has a refund in progress.' });
    }

    const refundAmount = amount === undefined || amount === '' ? round2(originalAmount - alreadyRefunded) : round2(Number(amount));
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Enter a valid refund amount.' });
    }
    if (refundAmount > round2(originalAmount - alreadyRefunded) + 0.005) {
      return res.status(400).json({ status: 'error', message: 'Refund amount cannot exceed the refundable balance.' });
    }

    const refund = await Refund.create({
      refundNumber: await nextRefundNumber(),
      order: order._id,
      user: order.user,
      transactionReference: order.transactionReference || '',
      paymentMethod: order.paymentMethod,
      paymentProvider: providerLabel(order),
      originalAmount: round2(originalAmount),
      amount: refundAmount,
      currency: 'ETB',
      reason: reason.trim(),
      status: 'Requested',
      requestedAt: new Date(),
    });
    const populated = await Refund.findById(refund._id)
      .populate('order', 'orderNumber')
      .populate('user', 'name email');
    return res.status(201).json(serializeRefund(populated));
  } catch (error) {
    return next(error);
  }
};

const reviewRefund = async (req, res, next) => {
  try {
    const { decision, note = '' } = req.body || {};
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ status: 'error', message: 'Choose approve or reject.' });
    }
    if (typeof note !== 'string' || note.length > 500) {
      return res.status(400).json({ status: 'error', message: 'Note must be no longer than 500 characters.' });
    }
    if (decision === 'reject' && !note.trim()) {
      return res.status(400).json({ status: 'error', message: 'A rejection reason is required.' });
    }
    const refund = await Refund.findOneAndUpdate(
      { _id: req.params.id, status: 'Requested' },
      {
        $set: {
          status: decision === 'approve' ? 'Approved' : 'Rejected',
          reviewNote: note.trim(),
          reviewedAt: new Date(),
          reviewedBy: req.user._id,
        },
      },
      { new: true }
    ).populate('order', 'orderNumber').populate('user', 'name email');
    if (!refund) return res.status(409).json({ status: 'error', message: 'This refund is not awaiting review.' });
    return res.json(serializeRefund(refund));
  } catch (error) {
    return next(error);
  }
};

const applyRefundToOrder = async (orderId, amount) => {
  const order = await Order.findById(orderId);
  if (!order) return null;
  const originalAmount = orderAmountEtb(order);
  const totalRefunded = round2((Number(order.refundedAmount) || 0) + amount);
  order.refundedAmount = totalRefunded;
  order.paymentStatus = totalRefunded >= originalAmount - 0.005 ? 'Refunded' : 'Partially Refunded';
  order.paymentHistory = order.paymentHistory || [];
  order.paymentHistory.push(paymentHistoryEntry(order.paymentStatus, {
    previousStatus: 'Paid',
    message: `Refund of ${amount.toFixed(2)} ETB completed.`,
    amount,
  }));
  await order.save();
  return order;
};

const processRefund = async (req, res, next) => {
  try {
    const { providerReference = '', note = '' } = req.body || {};
    if (typeof providerReference !== 'string' || typeof note !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Invalid refund processing payload.' });
    }
    if (providerReference.length > 200 || note.length > 500) {
      return res.status(400).json({ status: 'error', message: 'Refund reference or note is too long.' });
    }

    const refund = await Refund.findOne({ _id: req.params.id, status: 'Approved' });
    if (!refund) return res.status(409).json({ status: 'error', message: 'Only approved refunds can be processed.' });

    const config = await resolvePaymentConfiguration();
    const isOnline = refund.paymentMethod === 'Chapa Checkout' || refund.paymentMethod === 'Credit Card';
    const canUseGateway = isOnline && config.gateway.configured && Boolean(refund.transactionReference);

    if (canUseGateway) {
      const isFull = Math.abs(refund.amount - refund.originalAmount) < 0.005;
      let providerData;
      try {
        providerData = await refundChapaTransaction({
          txRef: refund.transactionReference,
          amount: isFull ? undefined : refund.amount.toFixed(2),
          reason: refund.reason,
          reference: refund.refundNumber,
        });
      } catch (error) {
        return res.status(502).json({ status: 'error', message: `The payment provider could not start this refund: ${error.message}` });
      }
      refund.status = 'Processing';
      refund.provider = 'Chapa';
      refund.providerRefundReference = providerData.ref || providerData.ref_id || providerData.chapa_reference || '';
      refund.providerStatus = String(providerData.status || 'initiated');
      refund.providerResponse = JSON.stringify(providerData).slice(0, 2000);
      refund.processingNote = note.trim();
      await refund.save();
      const populated = await Refund.findById(refund._id).populate('order', 'orderNumber').populate('user', 'name email');
      return res.json(serializeRefund(populated));
    }

    // Manual completion (bank transfer, cash on delivery, or gateway not configured).
    if (!providerReference.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Enter the refund reference confirming the refund was completed outside the gateway.',
      });
    }
    refund.status = 'Refunded';
    refund.provider = refund.provider || providerLabel(refund);
    refund.providerRefundReference = providerReference.trim();
    refund.providerStatus = 'refunded';
    refund.processingNote = note.trim();
    refund.processedAt = new Date();
    refund.processedBy = req.user._id;
    await refund.save();
    await applyRefundToOrder(refund.order, refund.amount);
    const populated = await Refund.findById(refund._id).populate('order', 'orderNumber').populate('user', 'name email');
    return res.json(serializeRefund(populated));
  } catch (error) {
    return next(error);
  }
};

const completeRefund = async (req, res, next) => {
  try {
    const { providerReference = '', note = '' } = req.body || {};
    const refund = await Refund.findOne({ _id: req.params.id, status: 'Processing' });
    if (!refund) return res.status(409).json({ status: 'error', message: 'Only refunds in processing can be completed.' });
    if (typeof providerReference === 'string' && providerReference.trim()) {
      refund.providerRefundReference = providerReference.trim();
    }
    refund.status = 'Refunded';
    refund.providerStatus = 'refunded';
    refund.processingNote = typeof note === 'string' ? note.trim() : '';
    refund.processedAt = new Date();
    refund.processedBy = req.user._id;
    await refund.save();
    await applyRefundToOrder(refund.order, refund.amount);
    const populated = await Refund.findById(refund._id).populate('order', 'orderNumber').populate('user', 'name email');
    return res.json(serializeRefund(populated));
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Payment settings
// ---------------------------------------------------------------------------

const getAdminPaymentSettings = async (req, res, next) => {
  try {
    const config = await resolvePaymentConfiguration();
    const settings = await PaymentSetting.findOne({ key: 'payment' }).lean();
    return res.json({
      gateway: config.gateway,
      methods: PAYMENT_METHOD_KEYS.map((method) => ({
        method,
        enabled: config.methodEnabled[method],
        supported: config.methodSupported[method],
        requiresGateway: ONLINE_METHODS.includes(method),
      })),
      disabledMethods: config.disabledMethods,
      bankTransfer: {
        bankName: config.bankTransfer.bankName,
        accountName: config.bankTransfer.accountName,
        accountNumber: config.bankTransfer.accountNumber,
        branch: config.bankTransfer.branch,
        instructions: settings?.bankTransfer?.instructions || '',
        configured: config.bankTransfer.configured,
      },
      updatedAt: settings?.updatedAt || null,
    });
  } catch (error) {
    return next(error);
  }
};

const updateAdminPaymentSettings = async (req, res, next) => {
  try {
    const { disabledMethods, bankTransfer } = req.body || {};
    const update = { updatedBy: req.user._id };

    if (disabledMethods !== undefined) {
      if (!Array.isArray(disabledMethods)) {
        return res.status(400).json({ status: 'error', message: 'Disabled methods must be an array.' });
      }
      const invalid = disabledMethods.filter((method) => !PAYMENT_METHOD_KEYS.includes(method));
      if (invalid.length) {
        return res.status(400).json({ status: 'error', message: `Unknown payment method: ${invalid.join(', ')}.` });
      }
      update.disabledMethods = [...new Set(disabledMethods)];
    }

    if (bankTransfer !== undefined) {
      if (!bankTransfer || typeof bankTransfer !== 'object' || Array.isArray(bankTransfer)) {
        return res.status(400).json({ status: 'error', message: 'Bank transfer settings must be an object.' });
      }
      const fields = ['bankName', 'accountName', 'accountNumber', 'branch', 'instructions'];
      const limits = { bankName: 120, accountName: 120, accountNumber: 60, branch: 120, instructions: 1000 };
      const bankTransferUpdate = {};
      for (const field of fields) {
        if (bankTransfer[field] === undefined) continue;
        const value = bankTransfer[field];
        if (typeof value !== 'string' || value.length > limits[field]) {
          return res.status(400).json({ status: 'error', message: `${field} must be a string no longer than ${limits[field]} characters.` });
        }
        bankTransferUpdate[field] = value.trim();
      }
      update.bankTransfer = bankTransferUpdate;
    }

    await PaymentSetting.findOneAndUpdate(
      { key: 'payment' },
      { $set: update, $setOnInsert: { key: 'payment' } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Return the freshly resolved configuration.
    return getAdminPaymentSettings(req, res, next);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getPaymentStats,
  getTransactions,
  getTransactionDetail,
  getBankTransfers,
  getCodOrders,
  collectCod,
  getRefunds,
  getRefundDetail,
  createRefund,
  reviewRefund,
  processRefund,
  completeRefund,
  getAdminPaymentSettings,
  updateAdminPaymentSettings,
};
