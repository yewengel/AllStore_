const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const Refund = require('../models/Refund');
const ReturnRequest = require('../models/ReturnRequest');
const PaymentSetting = require('../models/PaymentSetting');
const { toEtb } = require('../utils/currency');
const { calculateFinancialMetrics } = require('../utils/financialAnalytics');
const { nextRefundNumber } = require('../utils/orderNumbers');
const { createNotification } = require('../utils/notifications');
const { paymentHistoryEntry } = require('./paymentController');
const {
  getPaymentSettings,
  isPaymentAccountComplete,
  legacyPaymentAccountDocuments,
  paymentAccountsFromSettings,
} = require('../utils/paymentSettings');

const ALL_METHODS = ['Telebirr', 'CBE Birr', 'Bank Transfer'];
const ONLINE_METHODS = [];
const PAYMENT_STATUSES = [
  'Pending',
  'Awaiting Payment',
  'Processing',
  'Paid',
  'Failed',
  'Cancelled',
  'Awaiting Verification',
  'Pending Verification',
  'Unpaid',
  'Refunded',
  'Partially Refunded',
  'Rejected',
];

const METHOD_KEYWORDS = {
  Telebirr: ['telebirr'],
  'CBE Birr': ['cbe birr', 'cbebirr'],
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
  if (['Pending Verification', 'Awaiting Verification'].includes(order.paymentStatus)) return 'Pending Verification';
  if (order.paymentStatus === 'Awaiting Payment') return 'Awaiting Payment';
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
  receiptHistory: (order.paymentReceiptHistory || []).map((receipt) => ({
    mimeType: receipt.mimeType,
    originalName: receipt.originalName,
    uploadedAt: receipt.uploadedAt,
  })),
  refundedAmount: Number(order.refundedAmount) || 0,
  codCollectionStatus: order.codCollectionStatus || 'Pending',
});

// ---------------------------------------------------------------------------
// Dashboard statistics
// ---------------------------------------------------------------------------

const getPaymentStats = async (req, res, next) => {
  try {
    const [orders, refunds, recentOrders] = await Promise.all([
      Order.aggregate([
        {
          $project: {
            _id: 1,
            paymentMethod: 1,
            paymentChannel: 1,
            paymentStatus: 1,
            isPaid: 1,
            paymentAmount: 1,
            paymentCurrency: 1,
            totalPrice: 1,
            currency: 1,
            paymentDate: 1,
            paidAt: 1,
            codCollectionStatus: 1,
            codCollectedAmount: 1,
            codCollectedAt: 1,
            orderStatus: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ]),
      Refund.aggregate([
        { $match: { status: 'Refunded' } },
        {
          $project: {
            _id: 1,
            order: 1,
            amount: 1,
            currency: 1,
            provider: 1,
            providerRefundReference: 1,
            processedAt: 1,
            status: 1,
          },
        },
      ]),
        Order.find({}).populate('user', 'name email').sort({ createdAt: -1 }).limit(8),
    ]);

    const metrics = calculateFinancialMetrics({
      orders,
      refunds,
      period: req.query.period,
    });

    const methodBreakdown = ALL_METHODS.map((method) => ({ method, count: 0, amount: 0 }));
    const methodIndex = new Map(methodBreakdown.map((entry) => [entry.method, entry]));
    let other = { method: 'Other', count: 0, amount: 0 };
    metrics.methodStats.forEach((row) => {
      const label = normalizeMethod({ paymentMethod: row.method, paymentChannel: row.channel });
      const target = methodIndex.get(label);
      if (target) {
        target.count += row.count;
        target.amount += row.amount;
      } else {
        other.count += row.count;
        other.amount += row.amount;
      }
    });
    methodIndex.forEach((entry) => { entry.amount = round2(entry.amount); });
    other = { ...other, amount: round2(other.amount) };
    const methodBreakdownWithOther = other.count > 0 ? [...methodBreakdown, other] : methodBreakdown;

    const methodStats = ALL_METHODS.map((method) => {
      const entry = methodIndex.get(method);
      return { method, count: entry.count, amount: round2(entry.amount) };
    });

    return res.json({
      currency: 'ETB',
      cards: metrics.cards,
      methodStats,
      methodBreakdown: methodBreakdownWithOther.map((entry) => ({ ...entry, amount: round2(entry.amount) })),
      trend: metrics.trend,
      period: metrics.period,
      previousRevenue: metrics.previousRevenue,
      change: metrics.change,
      ordersChange: metrics.ordersChange,
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
    case 'Pending Verification':
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
          ? 'Payment verified and confirmed'
          : ['Failed', 'Cancelled'].includes(order.paymentStatus)
            ? `Provider reported ${order.paymentStatus.toLowerCase()}`
            : 'Awaiting administrator verification',
        receipt: order.paymentReceipt && order.paymentReceipt.storageKey
          ? {
            mimeType: order.paymentReceipt.mimeType,
            originalName: order.paymentReceipt.originalName,
            uploadedAt: order.paymentReceipt.uploadedAt,
          }
          : null,
        receiptHistory: (order.paymentReceiptHistory || []).map((receipt) => ({
          mimeType: receipt.mimeType,
          originalName: receipt.originalName,
          uploadedAt: receipt.uploadedAt,
        })),
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
        : {
          paymentStatus: { $in: ['Pending Verification', 'Awaiting Verification'] },
          isPaid: { $ne: true },
        };

    const orders = await Order.find({
      $and: [
        {
          $or: [
            { paymentAccountId: { $exists: true, $ne: '' } },
            { paymentMethod: { $in: ['Bank Transfer', 'Telebirr', 'CBE Birr'] } },
          ],
        },
        statusFilter,
        { 'paymentReceipt.storageKey': { $exists: true, $ne: '' } },
      ],
    })
      .populate('user', 'name email')
      .sort({ 'paymentReceipt.uploadedAt': -1, createdAt: -1 });
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
    returnRequestId: refund.returnRequest || null,
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
    source: refund.source || 'manual',
    customerMessage: refund.customerMessage || '',
    providerRefundReference: refund.providerRefundReference || '',
    providerStatus: refund.providerStatus || '',
    requestedAt: refund.requestedAt || refund.createdAt,
    reviewedAt: refund.reviewedAt || null,
    reviewNote: refund.reviewNote || '',
    processedAt: refund.processedAt || null,
    processingNote: refund.processingNote || '',
    failedAt: refund.failedAt || null,
    history: (refund.history || []).map((entry) => ({
      status: entry.status,
      message: entry.message || '',
      timestamp: entry.timestamp,
      actorRole: entry.actorRole || 'system',
    })),
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
    const { orderId, amount, reason = '', returnRequestId } = req.body || {};
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ status: 'error', message: 'A valid order is required.' });
    }
    if (typeof reason !== 'string' || reason.length > 500) {
      return res.status(400).json({ status: 'error', message: 'Reason must be no longer than 500 characters.' });
    }
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ status: 'error', message: 'Order not found.' });
    let returnRequest;
    if (returnRequestId !== undefined) {
      if (!mongoose.isValidObjectId(returnRequestId)) {
        return res.status(400).json({ status: 'error', message: 'A valid return request is required.' });
      }
      returnRequest = await ReturnRequest.findOne({
        _id: returnRequestId,
        order: order._id,
        status: { $in: ['Item Received', 'Refund Processing'] },
      });
      if (!returnRequest) {
        return res.status(409).json({ status: 'error', message: 'The return must be received and inspected before a refund can be created.' });
      }
    }
    if (!order.isPaid || !['Paid', 'Partially Refunded'].includes(effectiveStatus(order))) {
      return res.status(409).json({ status: 'error', message: 'Only successfully paid orders can be refunded.' });
    }

    const originalAmount = orderAmountEtb(order);
    const alreadyRefunded = Number(order.refundedAmount) || 0;
    const activeRefund = await Refund.findOne({
      order: order._id,
      status: { $in: ['Refund Required', 'Pending', 'Requested', 'Approved', 'Processing'] },
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
      status: returnRequest ? 'Pending' : 'Requested',
      source: returnRequest ? 'return' : 'manual',
      returnRequest: returnRequest?._id,
      requestedAt: new Date(),
      history: [{
        status: returnRequest ? 'Pending' : 'Requested',
        message: reason.trim() || 'Refund request created by an administrator.',
        actor: req.user._id,
        actorRole: 'admin',
      }],
    });
    const populated = await Refund.findById(refund._id)
      .populate('order', 'orderNumber')
      .populate('user', 'name email');
    await createNotification(refund.user, {
      type: 'refund-update',
      title: 'Refund update',
      message: `A refund for order ${order.orderNumber} has been created and is awaiting review.`,
      link: `/orders/${order._id}`,
      relatedEntityType: 'refund',
      relatedEntityId: refund._id,
    });
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
    if (!note.trim()) {
      return res.status(400).json({ status: 'error', message: 'An explanation is required for this refund decision.' });
    }
    const pendingRefund = await Refund.findOne({
      _id: req.params.id,
      status: { $in: ['Requested', 'Refund Required'] },
    });
    if (!pendingRefund) {
      return res.status(409).json({ status: 'error', message: 'This refund is not awaiting review.' });
    }
    const nextStatus = decision === 'approve'
      ? pendingRefund.status === 'Refund Required' ? 'Pending' : 'Approved'
      : pendingRefund.status === 'Refund Required' ? 'Not Required' : 'Rejected';
    const refund = await Refund.findOneAndUpdate(
      { _id: req.params.id, status: pendingRefund.status },
      {
        $set: {
          status: nextStatus,
          reviewNote: note.trim(),
          customerMessage: note.trim(),
          reviewedAt: new Date(),
          reviewedBy: req.user._id,
        },
        $push: {
          history: {
            status: nextStatus,
            message: note.trim() || (decision === 'approve' ? 'Refund approved for processing.' : 'Refund request declined.'),
            actor: req.user._id,
            actorRole: 'admin',
          },
        },
      },
      { new: true }
    ).populate('order', 'orderNumber').populate('user', 'name email');
    if (!refund) return res.status(409).json({ status: 'error', message: 'This refund is not awaiting review.' });
    await createNotification(refund.user._id, {
      type: 'refund-update',
      title: `Refund ${nextStatus.toLowerCase()}`,
      message: note.trim(),
      link: `/orders/${refund.order?._id || refund.order}`,
      relatedEntityType: 'refund',
      relatedEntityId: refund._id,
    });
    return res.json(serializeRefund(refund));
  } catch (error) {
    return next(error);
  }
};

const processRefund = async (req, res, next) => {
  try {
    const { note = '', customerMessage = '', providerReference = '' } = req.body || {};
    if (typeof note !== 'string' || typeof customerMessage !== 'string' || typeof providerReference !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Invalid refund processing payload.' });
    }
    if (note.length > 500 || customerMessage.length > 500 || providerReference.length > 200) {
      return res.status(400).json({ status: 'error', message: 'Refund message is too long.' });
    }

    const refund = await Refund.findOne({
      _id: req.params.id,
      status: { $in: ['Pending', 'Approved'] },
    });
    if (!refund) return res.status(409).json({ status: 'error', message: 'Only approved or pending refunds can be processed.' });

    const previousStatus = refund.status;
    const processingAt = new Date();
    const startedRefund = await Refund.findOneAndUpdate(
      { _id: refund._id, status: previousStatus },
      {
        $set: {
          status: 'Processing',
          provider: refund.provider || providerLabel({ paymentMethod: refund.paymentMethod }),
          processingNote: note.trim(),
          customerMessage: customerMessage.trim(),
          processedBy: req.user._id,
          ...(providerReference.trim() ? { providerRefundReference: providerReference.trim() } : {}),
        },
        $push: {
          history: {
            status: 'Processing',
            message: customerMessage.trim() || 'Refund processing has started.',
            timestamp: processingAt,
            actor: req.user._id,
            actorRole: 'admin',
          },
        },
      },
      { new: true }
    );
    if (!startedRefund) {
      return res.status(409).json({ status: 'error', message: 'This refund is already being processed.' });
    }
    await createNotification(startedRefund.user, {
      type: 'refund-update',
      title: 'Refund processing',
      message: customerMessage.trim() || `Your refund ${startedRefund.refundNumber} is being processed.`,
      link: `/orders/${startedRefund.order}`,
      relatedEntityType: 'refund',
      relatedEntityId: startedRefund._id,
    });

    const populated = await Refund.findById(startedRefund._id).populate('order', 'orderNumber').populate('user', 'name email');
    return res.json(serializeRefund(populated));
  } catch (error) {
    return next(error);
  }
};

const completeRefund = async (req, res, next) => {
  try {
    const { providerReference = '', note = '', confirmedPaid = false } = req.body || {};
    if (typeof providerReference !== 'string' || providerReference.length > 200 ||
      typeof note !== 'string' || note.length > 500) {
      return res.status(400).json({ status: 'error', message: 'Invalid refund completion details.' });
    }
    if (confirmedPaid !== true) {
      return res.status(400).json({ status: 'error', message: 'Confirm that the refund has actually been paid before completing it.' });
    }
    const session = await mongoose.startSession();
    let completedId;
    try {
      await session.withTransaction(async () => {
        const refund = await Refund.findOne({ _id: req.params.id, status: 'Processing' }).session(session);
        if (!refund) throw Object.assign(new Error('Only refunds in processing can be completed.'), { statusCode: 409 });
        const reference = providerReference.trim() || refund.providerRefundReference;
        if (!reference) {
          throw Object.assign(new Error('A refund transaction reference or receipt number is required.'), { statusCode: 400 });
        }
        const order = await Order.findById(refund.order).session(session);
        if (!order) throw Object.assign(new Error('The original order could not be found.'), { statusCode: 404 });
        const originalAmount = orderAmountEtb(order);
        const totalRefunded = round2((Number(order.refundedAmount) || 0) + refund.amount);
        if (totalRefunded > originalAmount + 0.005) {
          throw Object.assign(new Error('Refund amount exceeds the remaining amount paid.'), { statusCode: 409 });
        }
        const previousPaymentStatus = effectiveStatus(order);
        order.refundedAmount = totalRefunded;
        order.paymentStatus = totalRefunded >= originalAmount - 0.005 ? 'Refunded' : 'Partially Refunded';
        order.paymentHistory = order.paymentHistory || [];
        order.paymentHistory.push(paymentHistoryEntry(order.paymentStatus, {
          previousStatus: previousPaymentStatus,
          message: `Refund of ${refund.amount.toFixed(2)} ETB completed.`,
          amount: refund.amount,
          adminUserId: req.user._id,
        }));
        refund.status = 'Refunded';
        refund.providerRefundReference = reference;
        refund.providerStatus = 'refunded';
        refund.processingNote = note.trim();
        refund.customerMessage = note.trim();
        refund.processedAt = new Date();
        refund.processedBy = req.user._id;
        refund.history = refund.history || [];
        refund.history.push({
          status: 'Refunded',
          message: note.trim() || 'Refund has been completed.',
          timestamp: refund.processedAt,
          actor: req.user._id,
          actorRole: 'admin',
        });
        await order.save({ session });
        await refund.save({ session });
        if (refund.returnRequest) {
          const returnRequest = await ReturnRequest.findById(refund.returnRequest).session(session);
          if (returnRequest) {
            returnRequest.status = 'Refunded';
            returnRequest.adminResponse = note.trim() || 'The return refund has been completed.';
            returnRequest.history = returnRequest.history || [];
            returnRequest.history.push({
              status: 'Refunded',
              message: returnRequest.adminResponse,
              timestamp: refund.processedAt,
              actor: req.user._id,
              actorRole: 'admin',
            });
            await returnRequest.save({ session });
          }
        }
        completedId = refund._id;
      });
    } finally {
      await session.endSession();
    }
    if (!completedId) throw new Error('Refund completion completed without updating the record.');
    const populated = await Refund.findById(completedId).populate('order', 'orderNumber').populate('user', 'name email');
    await createNotification(populated.user._id, {
      type: 'refund-update',
      title: 'Refund completed',
      message: note.trim() || `Refund ${populated.refundNumber} has been marked complete after payment was returned.`,
      link: `/orders/${populated.order?._id || populated.order}`,
      relatedEntityType: 'refund',
      relatedEntityId: populated._id,
    });
    return res.json(serializeRefund(populated));
  } catch (error) {
    return next(error);
  }
};

const failRefund = async (req, res, next) => {
  try {
    const { reason, customerMessage = '' } = req.body || {};
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500 ||
      typeof customerMessage !== 'string' || customerMessage.length > 500) {
      return res.status(400).json({ status: 'error', message: 'A failure explanation of up to 500 characters is required.' });
    }
    const refund = await Refund.findOneAndUpdate(
      { _id: req.params.id, status: 'Processing' },
      {
        $set: {
          status: 'Failed',
          processingNote: reason.trim(),
          customerMessage: customerMessage.trim() || reason.trim(),
          failedAt: new Date(),
        },
        $push: {
          history: {
            status: 'Failed',
            message: customerMessage.trim() || reason.trim(),
            actor: req.user._id,
            actorRole: 'admin',
          },
        },
      },
      { new: true }
    ).populate('order', 'orderNumber').populate('user', 'name email');
    if (!refund) return res.status(409).json({ status: 'error', message: 'Only refunds in processing can be marked failed.' });
    await createNotification(refund.user._id, {
      type: 'refund-update',
      title: 'Refund processing update',
      message: customerMessage.trim() || reason.trim(),
      link: `/orders/${refund.order?._id || refund.order}`,
      relatedEntityType: 'refund',
      relatedEntityId: refund._id,
    });
    return res.json(serializeRefund(refund));
  } catch (error) {
    return next(error);
  }
};

// ---------------------------------------------------------------------------
// Payment settings
// ---------------------------------------------------------------------------

const getAdminPaymentSettings = async (req, res, next) => {
  try {
    const settings = await getPaymentSettings();
    return res.json({
      accounts: paymentAccountsFromSettings(settings),
      updatedAt: settings?.updatedAt || null,
    });
  } catch (error) {
    return next(error);
  }
};

const PAYMENT_ACCOUNT_LIMITS = {
  name: 120,
  provider: 120,
  accountHolder: 120,
  accountDetails: 200,
  branch: 120,
  instructions: 1000,
};

const normalizePaymentAccount = (input, existing = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Payment account settings must be an object.' };
  }
  const allowedFields = new Set([...Object.keys(PAYMENT_ACCOUNT_LIMITS), 'type', 'active']);
  const unknownFields = Object.keys(input).filter((field) => !allowedFields.has(field));
  if (unknownFields.length) return { error: `Unknown payment account field: ${unknownFields.join(', ')}.` };

  const account = { ...existing };
  for (const [field, maxLength] of Object.entries(PAYMENT_ACCOUNT_LIMITS)) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== 'string' || input[field].length > maxLength) {
      return { error: `${field} must be a string no longer than ${maxLength} characters.` };
    }
    account[field] = input[field].trim();
  }
  if (input.type !== undefined) account.type = input.type;
  if (!['bank', 'mobile-money'].includes(account.type)) {
    return { error: 'Payment account type must be bank or mobile-money.' };
  }
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') return { error: 'Payment account active status must be true or false.' };
    account.active = input.active;
  } else {
    account.active = Boolean(account.active);
  }

  const requiredFields = ['name', 'provider', 'accountHolder', 'accountDetails'];
  const missingFields = requiredFields.filter((field) => !String(account[field] || '').trim());
  if (missingFields.length) return { error: `Complete these payment account fields: ${missingFields.join(', ')}.` };
  if (account.active && !isPaymentAccountComplete(account)) {
    return { error: 'Complete the payment account details before activating it.' };
  }

  return {
    account: {
      name: account.name.trim(),
      type: account.type,
      provider: account.provider.trim(),
      accountHolder: account.accountHolder.trim(),
      accountDetails: account.accountDetails.trim(),
      branch: String(account.branch || '').trim(),
      instructions: String(account.instructions || '').trim(),
      active: account.active,
    },
  };
};

const getEditablePaymentSettings = async () => {
  let settings = await PaymentSetting.findOne({ key: 'payment' });
  if (!settings) {
    settings = new PaymentSetting({ key: 'payment', accountsMigrated: true });
  } else if (!settings.accountsMigrated) {
    if (!settings.accounts?.length) {
      settings.accounts = legacyPaymentAccountDocuments(settings);
    }
    settings.accountsMigrated = true;
  }
  return settings;
};

const paymentSettingsResponse = (settings) => ({
  accounts: paymentAccountsFromSettings(settings),
  updatedAt: settings.updatedAt || null,
});

const createPaymentAccount = async (req, res, next) => {
  try {
    const result = normalizePaymentAccount(req.body);
    if (result.error) return res.status(400).json({ status: 'error', message: result.error });

    const settings = await getEditablePaymentSettings();
    settings.accounts.push(result.account);
    settings.accountsMigrated = true;
    settings.updatedBy = req.user._id;
    await settings.save();
    return res.status(201).json(paymentSettingsResponse(settings));
  } catch (error) {
    return next(error);
  }
};

const updatePaymentAccount = async (req, res, next) => {
  try {
    const settings = await getEditablePaymentSettings();
    const account = settings.accounts.id(req.params.id);
    if (!account) return res.status(404).json({ status: 'error', message: 'Payment account not found.' });

    const result = normalizePaymentAccount(req.body, account.toObject());
    if (result.error) return res.status(400).json({ status: 'error', message: result.error });
    Object.assign(account, result.account);
    settings.updatedBy = req.user._id;
    await settings.save();
    return res.json(paymentSettingsResponse(settings));
  } catch (error) {
    return next(error);
  }
};

const deletePaymentAccount = async (req, res, next) => {
  try {
    const settings = await getEditablePaymentSettings();
    const account = settings.accounts.id(req.params.id);
    if (!account) return res.status(404).json({ status: 'error', message: 'Payment account not found.' });

    account.deleteOne();
    settings.updatedBy = req.user._id;
    await settings.save();
    return res.json(paymentSettingsResponse(settings));
  } catch (error) {
    return next(error);
  }
};

const updateAdminPaymentSettings = async (req, res, next) => {
  try {
    const { accounts } = req.body || {};
    if (!Array.isArray(accounts) || accounts.length > 50) {
      return res.status(400).json({ status: 'error', message: 'Provide up to 50 payment accounts.' });
    }

    const settings = await getEditablePaymentSettings();
    const existing = new Map(settings.accounts.map((account) => [account._id.toString(), account]));
    const replacement = [];
    for (const entry of accounts) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return res.status(400).json({ status: 'error', message: 'Each payment account must be an object.' });
      }
      const { id, ...input } = entry;
      const current = id ? existing.get(String(id)) : null;
      if (id && !current) {
        return res.status(400).json({ status: 'error', message: 'A payment account ID does not belong to this store.' });
      }
      const result = normalizePaymentAccount(input, current?.toObject() || {});
      if (result.error) return res.status(400).json({ status: 'error', message: result.error });
      replacement.push({
        ...(current ? { _id: current._id } : {}),
        ...result.account,
      });
    }

    settings.accounts = replacement;
    settings.accountsMigrated = true;
    settings.updatedBy = req.user._id;
    await settings.save();
    return res.json(paymentSettingsResponse(settings));
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
  failRefund,
  getAdminPaymentSettings,
  updateAdminPaymentSettings,
  createPaymentAccount,
  updatePaymentAccount,
  deletePaymentAccount,
};
