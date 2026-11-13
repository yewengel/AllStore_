const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const {
  getPaymentConfiguration,
  initializeChapaTransaction,
  verifyChapaTransaction,
} = require('../utils/chapa');
const { resolvePaymentConfiguration } = require('../utils/paymentSettings');
const { hasValidReceiptSignature } = require('../middleware/paymentReceiptUpload');

const receiptDirectory = path.join(__dirname, '..', 'private', 'payment-receipts');
const clientUrl = () => (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();

const paymentSummary = (order) => ({
  orderId: order._id,
  orderNumber: order.orderNumber,
  customerName: order.customerName || order.user?.name || 'Customer',
  customerEmail: order.user?.email || '',
  paymentMethod: order.paymentMethod,
  paymentStatus: order.isPaid ? 'Paid' : order.paymentStatus || 'Pending',
  paymentAmount: order.paymentAmount ?? order.totalPrice,
  paymentCurrency: order.paymentCurrency || order.currency || 'ETB',
  transactionReference: order.transactionReference || '',
  paymentDate: order.paymentDate || order.paidAt || null,
  paymentChannel: order.paymentChannel || '',
});

const toPaymentRecord = (order) => ({
  ...paymentSummary(order),
  orderStatus: order.orderStatus,
  createdAt: order.createdAt,
  paymentChannel: order.paymentChannel || '',
  paymentReceipt: order.paymentReceipt ? {
    mimeType: order.paymentReceipt.mimeType,
    originalName: order.paymentReceipt.originalName,
    uploadedAt: order.paymentReceipt.uploadedAt,
  } : null,
});

const getAllPayments = async (req, res, next) => {
  try {
    const orders = await Order.find({})
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    return res.json(orders.map(toPaymentRecord));
  } catch (error) {
    return next(error);
  }
};

// Customer-scoped payment history. Always filtered by the authenticated user.
const getMyPayments = async (req, res, next) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    return res.json(orders.map(toPaymentRecord));
  } catch (error) {
    return next(error);
  }
};

const paymentHistoryEntry = (status, options = {}) => ({
  status,
  previousStatus: options.previousStatus || '',
  message: options.message || '',
  adminNote: options.adminNote || '',
  ...(options.amount !== undefined ? { amount: options.amount } : {}),
  ...(options.adminUserId ? { adminUserId: options.adminUserId } : {}),
  timestamp: new Date(),
});

const getPaymentConfig = async (req, res, next) => {
  try {
    const config = await resolvePaymentConfiguration();
    return res.json({
      currency: 'ETB',
      gateway: config.gateway,
      chapa: {
        enabled: config.gateway.configured,
        mode: config.gateway.mode,
        message: config.gateway.message,
        availableMethods: config.gateway.availableMethods,
        disabledMethods: config.disabledMethods,
      },
      methods: config.methodEnabled,
      methodSupported: config.methodSupported,
      bankTransfer: {
        ...config.bankTransfer,
      },
      cashOnDelivery: { enabled: config.methodEnabled['Cash on Delivery'] },
    });
  } catch (error) {
    return next(error);
  }
};

const initializeChapaPayment = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user._id,
      paymentMethod: 'Chapa Checkout',
    }).select('+paymentCheckoutUrl');
    if (!order) return res.status(404).json({ status: 'error', message: 'Chapa order not found.' });
    if (order.orderStatus === 'Cancelled') {
      return res.status(409).json({ status: 'error', message: 'Payment cannot be started for a cancelled order.' });
    }
    if (order.isPaid || order.paymentStatus === 'Paid') {
      return res.status(409).json({ status: 'error', message: 'This order is already paid.' });
    }
    if (['Cancelled', 'Rejected'].includes(order.paymentStatus)) {
      return res.status(409).json({ status: 'error', message: `This payment is ${order.paymentStatus.toLowerCase()}.` });
    }
    if (order.paymentCheckoutUrl) {
      return res.json({ checkoutUrl: order.paymentCheckoutUrl, ...paymentSummary(order) });
    }

    const checkoutUrl = await initializeChapaTransaction({
      order,
      customer: req.user,
      clientUrl: clientUrl(),
    });
    order.paymentCheckoutUrl = checkoutUrl;
    order.paymentInitializedAt = new Date();
    await order.save();
    return res.json({ checkoutUrl, ...paymentSummary(order) });
  } catch (error) {
    return next(error);
  }
};

const updateChapaPaymentFromProvider = async (txRef) => {
  if (typeof txRef !== 'string' || !txRef.trim() || txRef.length > 200) {
    throw Object.assign(new Error('A valid Chapa transaction reference is required.'), { statusCode: 400 });
  }

  const order = await Order.findOne({
    transactionReference: txRef,
    paymentMethod: 'Chapa Checkout',
  });
  if (!order) throw Object.assign(new Error('Chapa transaction was not found.'), { statusCode: 404 });
  if (order.isPaid || order.paymentStatus === 'Paid') return { order, alreadyProcessed: true };

  const verified = await verifyChapaTransaction(txRef);
  if (verified.tx_ref !== txRef) {
    throw Object.assign(new Error('Chapa verification returned a different transaction reference.'), { statusCode: 409 });
  }

  const expectedAmount = Math.round(Number(order.paymentAmount ?? order.totalPrice) * 100);
  const verifiedAmount = Math.round(Number(verified.amount) * 100);
  if (!Number.isFinite(verifiedAmount) || verifiedAmount !== expectedAmount) {
    throw Object.assign(new Error('The verified payment amount does not match the order.'), { statusCode: 409 });
  }
  const expectedCurrency = order.paymentCurrency || order.currency || 'ETB';
  if (String(verified.currency || '').toUpperCase() !== expectedCurrency.toUpperCase()) {
    throw Object.assign(new Error('The verified payment currency does not match the order.'), { statusCode: 409 });
  }

  const providerStatus = String(verified.status || '').toLowerCase();
  if (!['success', 'failed', 'cancelled', 'canceled', 'pending'].includes(providerStatus)) {
    throw Object.assign(new Error('Chapa returned an unknown payment status.'), { statusCode: 502 });
  }
  if (providerStatus === 'pending') return { order, pending: true };

  const updateFields = {};
  let historyStatus;
  let historyMessage;
  if (providerStatus === 'success') {
    const paymentDate = verified.created_at ? new Date(verified.created_at) : new Date();
    updateFields.isPaid = true;
    updateFields.paymentStatus = 'Paid';
    updateFields.paidAt = Number.isNaN(paymentDate.getTime()) ? new Date() : paymentDate;
    updateFields.paymentDate = updateFields.paidAt;
    updateFields.paymentGatewayReference = verified.reference || verified.ref_id || '';
    updateFields.paymentChannel = typeof verified.payment_method === 'string'
      ? verified.payment_method
      : 'Chapa Checkout';
    historyStatus = 'Paid';
    historyMessage = 'Payment verified and confirmed by the payment gateway.';
  } else {
    const isCancelled = ['cancelled', 'canceled'].includes(providerStatus);
    updateFields.paymentStatus = isCancelled ? 'Cancelled' : 'Failed';
    historyStatus = isCancelled ? 'Cancelled' : 'Failed';
    historyMessage = `Payment gateway reported the transaction as ${providerStatus}.`;
  }

  const updatedOrder = await Order.findOneAndUpdate(
    {
      _id: order._id,
      isPaid: { $ne: true },
      paymentStatus: { $in: ['Pending', 'Failed', 'Processing'] },
      ...(providerStatus === 'success' ? { orderStatus: { $ne: 'Cancelled' } } : {}),
    },
    {
      $set: updateFields,
      $push: {
        paymentHistory: paymentHistoryEntry(historyStatus, {
          previousStatus: order.paymentStatus,
          message: historyMessage,
          amount: Number(order.paymentAmount ?? order.totalPrice),
        }),
      },
    },
    { new: true, runValidators: true }
  );
  if (updatedOrder) return { order: updatedOrder, alreadyProcessed: false };

  const currentOrder = await Order.findById(order._id);
  if (currentOrder?.isPaid || currentOrder?.paymentStatus === 'Paid') {
    return { order: currentOrder, alreadyProcessed: true };
  }
  if (providerStatus === 'success' && currentOrder?.orderStatus === 'Cancelled') {
    throw Object.assign(new Error('Payment was verified after the order was cancelled. Contact support for assistance.'), { statusCode: 409 });
  }
  if (currentOrder) return { order: currentOrder, alreadyProcessed: true };
  throw Object.assign(new Error('Order could not be updated after Chapa verification.'), { statusCode: 409 });
};

const verifyChapaPayment = async (req, res, next) => {
  try {
    const result = await updateChapaPaymentFromProviderForOrder(req.params.id, req.user._id);
    return res.json(paymentSummary(result.order));
  } catch (error) {
    return next(error);
  }
};

const updateChapaPaymentFromProviderForOrder = async (orderId, customerId) => {
  const order = await Order.findOne({
    _id: orderId,
    user: customerId,
    paymentMethod: 'Chapa Checkout',
  });
  if (!order) throw Object.assign(new Error('Chapa order not found.'), { statusCode: 404 });
  return updateChapaPaymentFromProvider(order.transactionReference);
};

const compareSignatures = (provided, expected) => {
  if (typeof provided !== 'string') return false;
  const normalized = provided.replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
  const left = Buffer.from(normalized, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const handleChapaWebhook = async (req, res) => {
  const config = getPaymentConfiguration().chapa;
  if (!config.webhookSecret) {
    return res.status(503).json({ status: 'error', message: 'Chapa webhook verification is not configured.' });
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ status: 'error', message: 'Invalid Chapa webhook payload.' });
  }

  const signature = req.get('x-chapa-signature');
  const chapaSignature = req.get('chapa-signature');
  const rawDigest = crypto.createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex');
  const canonicalDigest = crypto.createHmac('sha256', config.webhookSecret)
    .update(JSON.stringify(event))
    .digest('hex');
  const secretDigest = crypto.createHmac('sha256', config.webhookSecret)
    .update(config.webhookSecret)
    .digest('hex');
  if (
    !compareSignatures(signature, rawDigest) &&
    !compareSignatures(signature, canonicalDigest) &&
    !compareSignatures(chapaSignature, rawDigest) &&
    !compareSignatures(chapaSignature, canonicalDigest) &&
    !compareSignatures(chapaSignature, secretDigest)
  ) {
    return res.status(401).json({ status: 'error', message: 'Invalid Chapa webhook signature.' });
  }

  const txRef = event.tx_ref || event.trx_ref;
  if (!txRef) return res.status(400).json({ status: 'error', message: 'Webhook has no transaction reference.' });
  try {
    await updateChapaPaymentFromProvider(txRef);
    return res.status(200).json({ status: 'success' });
  } catch (error) {
    if (error.statusCode === 404) return res.status(200).json({ status: 'success' });
    console.error('Chapa webhook verification failed:', error.message);
    return res.status(503).json({ status: 'error', message: 'Chapa payment verification is temporarily unavailable.' });
  }
};

const handleChapaCallback = async (req, res) => {
  const txRef = req.query.tx_ref || req.query.trx_ref;
  if (typeof txRef !== 'string' || !txRef.trim()) {
    return res.redirect(`${clientUrl()}/my-orders?payment=verification-pending`);
  }

  try {
    const result = await updateChapaPaymentFromProvider(txRef);
    return res.redirect(`${clientUrl()}/payment/result/${result.order._id}?payment=chapa`);
  } catch (error) {
    console.error('Chapa callback verification failed:', error.message);
    const order = await Order.findOne({ transactionReference: txRef, paymentMethod: 'Chapa Checkout' })
      .select('_id');
    if (order) return res.redirect(`${clientUrl()}/payment/result/${order._id}?payment=chapa`);
    return res.redirect(`${clientUrl()}/my-orders?payment=verification-pending`);
  }
};

const uploadBankTransferReceipt = async (req, res, next) => {
  let storedPath;
  try {
    if (!req.file || !hasValidReceiptSignature(req.file)) {
      return res.status(400).json({ status: 'error', message: 'Upload a valid JPG, PNG, WebP, or PDF payment receipt.' });
    }
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user._id,
      paymentMethod: 'Bank Transfer',
      paymentStatus: { $in: ['Pending', 'Pending Verification', 'Rejected'] },
      orderStatus: { $ne: 'Cancelled' },
      isPaid: { $ne: true },
    });
    if (!order) return res.status(404).json({ status: 'error', message: 'An eligible bank transfer order was not found.' });

    const storageKey = `${crypto.randomUUID()}`;
    await fs.mkdir(receiptDirectory, { recursive: true });
    storedPath = path.join(receiptDirectory, storageKey);
    await fs.writeFile(storedPath, req.file.buffer, { flag: 'wx', mode: 0o600 });

    const previousStorageKey = order.paymentReceipt?.storageKey;
    order.paymentReceipt = {
      storageKey,
      mimeType: req.file.mimetype,
      originalName: path.basename(req.file.originalname).slice(0, 120),
      uploadedAt: new Date(),
    };
    order.paymentAmount = order.paymentAmount ?? order.totalPrice;
    order.paymentCurrency = order.paymentCurrency || order.currency || 'ETB';
    order.paymentStatus = 'Pending Verification';
    await order.save();
    if (previousStorageKey && /^[0-9a-f-]{36}$/i.test(previousStorageKey)) {
      await fs.unlink(path.join(receiptDirectory, previousStorageKey)).catch((error) => {
        if (error.code !== 'ENOENT') console.error('Could not replace the previous payment receipt.');
      });
    }
    return res.json({
      orderId: order._id,
      paymentStatus: order.paymentStatus,
      paymentReceipt: {
        mimeType: order.paymentReceipt.mimeType,
        originalName: order.paymentReceipt.originalName,
        uploadedAt: order.paymentReceipt.uploadedAt,
      },
    });
  } catch (error) {
    if (storedPath) {
      await fs.unlink(storedPath).catch((cleanupError) => {
        if (cleanupError.code !== 'ENOENT') console.error('Could not clean up an incomplete payment receipt.');
      });
    }
    return next(error);
  }
};

const streamPaymentReceipt = (order, res, next) => {
  const storageKey = order?.paymentReceipt?.storageKey;
  if (!storageKey || !/^[0-9a-f-]{36}$/i.test(storageKey)) {
    return res.status(404).json({ status: 'error', message: 'Payment receipt not found.' });
  }
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'attachment; filename="payment-receipt"',
    'Content-Type': order.paymentReceipt.mimeType || 'application/octet-stream',
  });
  return res.sendFile(path.join(receiptDirectory, storageKey), (error) => {
    if (error && !res.headersSent) next(error);
  });
};

const getBankTransferReceipt = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).select('paymentReceipt orderNumber');
    return streamPaymentReceipt(order, res, next);
  } catch (error) {
    return next(error);
  }
};

// Customer-scoped receipt download. A customer can only fetch their own receipt.
const getCustomerPaymentReceipt = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ status: 'error', message: 'Payment receipt not found.' });
    }
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id })
      .select('paymentReceipt orderNumber');
    return streamPaymentReceipt(order, res, next);
  } catch (error) {
    return next(error);
  }
};

const reviewBankTransfer = async (req, res, next) => {
  try {
    const { decision, note = '' } = req.body || {};
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ status: 'error', message: 'Choose approve or reject.' });
    }
    if (typeof note !== 'string' || note.length > 1000) {
      return res.status(400).json({ status: 'error', message: 'Review note must be no longer than 1000 characters.' });
    }
    if (decision === 'reject' && !note.trim()) {
      return res.status(400).json({ status: 'error', message: 'A rejection reason is required.' });
    }

    const paymentFilter = {
      _id: req.params.id,
      paymentMethod: 'Bank Transfer',
      paymentStatus: { $in: ['Pending Verification', 'Awaiting Verification'] },
      isPaid: { $ne: true },
      'paymentReceipt.storageKey': { $exists: true, $ne: '' },
      transactionReference: { $exists: true, $ne: '' },
      ...(decision === 'approve' ? { orderStatus: { $ne: 'Cancelled' } } : {}),
    };
    const order = await Order.findOne(paymentFilter);
    if (!order) return res.status(409).json({ status: 'error', message: 'This bank transfer is not awaiting review.' });

    const approved = decision === 'approve';
    const timestamp = new Date();
    const update = {
      paymentStatus: approved ? 'Paid' : 'Rejected',
      isPaid: approved,
      paymentReviewNote: note.trim(),
      paymentReviewedAt: timestamp,
      paymentReviewedBy: req.user._id,
      paymentDate: approved ? timestamp : undefined,
      paidAt: approved ? timestamp : undefined,
    };
    if (!approved) {
      update.paymentDate = null;
      update.paidAt = null;
    }
    const updatedOrder = await Order.findOneAndUpdate(
      { ...paymentFilter, _id: order._id },
      {
        $set: update,
        $push: {
          paymentHistory: paymentHistoryEntry(approved ? 'Paid' : 'Rejected', {
            previousStatus: order.paymentStatus,
            message: approved
              ? 'Bank transfer verified and approved by an administrator.'
              : 'Bank transfer rejected by an administrator.',
            adminNote: note.trim(),
            adminUserId: req.user._id,
            amount: Number(order.paymentAmount ?? order.totalPrice),
          }),
        },
      },
      { new: true, runValidators: true }
    );
    if (!updatedOrder) {
      return res.status(409).json({ status: 'error', message: 'This payment was already reviewed.' });
    }
    return res.json({
      orderId: updatedOrder._id,
      orderNumber: updatedOrder.orderNumber,
      paymentStatus: updatedOrder.paymentStatus,
      isPaid: updatedOrder.isPaid,
      paymentReviewNote: updatedOrder.paymentReviewNote,
      paymentDate: updatedOrder.paymentDate,
      paymentReviewedAt: updatedOrder.paymentReviewedAt,
      paymentReviewedBy: updatedOrder.paymentReviewedBy,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  paymentHistoryEntry,
  getPaymentConfig,
  getAllPayments,
  getMyPayments,
  initializeChapaPayment,
  verifyChapaPayment,
  handleChapaWebhook,
  handleChapaCallback,
  uploadBankTransferReceipt,
  getBankTransferReceipt,
  getCustomerPaymentReceipt,
  reviewBankTransfer,
  updateChapaPaymentFromProvider,
};
