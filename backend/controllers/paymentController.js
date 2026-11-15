const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { getPublicPaymentAccounts } = require('../utils/paymentSettings');
const { hasValidReceiptSignature } = require('../middleware/paymentReceiptUpload');
const { createNotification } = require('../utils/notifications');

const receiptDirectory = path.join(__dirname, '..', 'private', 'payment-receipts');
const LEGACY_MANUAL_METHODS = ['Bank Transfer', 'Telebirr', 'CBE Birr'];

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
  paymentReceipt: order.paymentReceipt ? {
    mimeType: order.paymentReceipt.mimeType,
    originalName: order.paymentReceipt.originalName,
    uploadedAt: order.paymentReceipt.uploadedAt,
  } : null,
  paymentReceiptHistory: (order.paymentReceiptHistory || []).map((receipt) => ({
    mimeType: receipt.mimeType,
    originalName: receipt.originalName,
    uploadedAt: receipt.uploadedAt,
  })),
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

const getPublicPaymentSettings = async (req, res, next) => {
  try {
    const accounts = await getPublicPaymentAccounts();
    res.set('Cache-Control', 'no-store');
    return res.json({ currency: 'ETB', accounts });
  } catch (error) {
    return next(error);
  }
};

const manualOrderFilter = {
  $or: [
    { paymentAccountId: { $exists: true, $ne: '' } },
    { paymentMethod: { $in: LEGACY_MANUAL_METHODS } },
  ],
};

const uploadBankTransferReceipt = async (req, res, next) => {
  let storedPath;
  try {
    if (!req.file || !hasValidReceiptSignature(req.file)) {
      return res.status(400).json({ status: 'error', message: 'Upload a valid JPG, JPEG, PNG, or PDF payment receipt.' });
    }
    const { transactionReference } = req.body || {};
    if (transactionReference !== undefined && (
      typeof transactionReference !== 'string' || transactionReference.trim().length > 200
    )) {
      return res.status(400).json({ status: 'error', message: 'Payment transaction reference must be no longer than 200 characters.' });
    }
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user._id,
      ...manualOrderFilter,
      paymentStatus: { $in: ['Awaiting Payment', 'Pending', 'Pending Verification', 'Rejected'] },
      orderStatus: { $ne: 'Cancelled' },
      isPaid: { $ne: true },
    });
    if (!order) return res.status(404).json({ status: 'error', message: 'An eligible manual payment order was not found.' });

    const storageKey = crypto.randomUUID();
    await fs.mkdir(receiptDirectory, { recursive: true });
    storedPath = path.join(receiptDirectory, storageKey);
    await fs.writeFile(storedPath, req.file.buffer, { flag: 'wx', mode: 0o600 });

    const previousStatus = order.paymentStatus;
    const receipt = {
      storageKey,
      mimeType: req.file.mimetype,
      originalName: path.basename(req.file.originalname).slice(0, 120),
      uploadedAt: new Date(),
    };
    order.paymentReceiptHistory = order.paymentReceiptHistory || [];
    if (order.paymentReceipt?.storageKey && !order.paymentReceiptHistory.some(
      (entry) => entry.storageKey === order.paymentReceipt.storageKey
    )) {
      order.paymentReceiptHistory.push(order.paymentReceipt);
    }
    order.paymentReceiptHistory.push(receipt);
    order.paymentReceipt = receipt;
    order.paymentAmount = Number(order.totalPrice);
    order.paymentCurrency = order.currency || 'ETB';
    if (transactionReference !== undefined) order.transactionReference = transactionReference.trim();
    order.paymentStatus = 'Pending Verification';
    order.paymentReviewNote = '';
    order.paymentReviewedAt = null;
    order.paymentReviewedBy = null;
    order.paymentHistory = order.paymentHistory || [];
    order.paymentHistory.push(paymentHistoryEntry('Pending Verification', {
      previousStatus,
      message: previousStatus === 'Rejected'
        ? 'Corrected payment proof submitted and awaiting administrator verification.'
        : 'Payment proof submitted and awaiting administrator verification.',
      amount: order.paymentAmount,
    }));
    await order.save();
    return res.json({
      orderId: order._id,
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentAmount: order.paymentAmount,
      paymentCurrency: order.paymentCurrency,
      transactionReference: order.transactionReference || '',
      paymentReceipt: {
        mimeType: order.paymentReceipt.mimeType,
        originalName: order.paymentReceipt.originalName,
        uploadedAt: order.paymentReceipt.uploadedAt,
      },
      paymentReceiptHistory: order.paymentReceiptHistory.map((entry) => ({
        mimeType: entry.mimeType,
        originalName: entry.originalName,
        uploadedAt: entry.uploadedAt,
      })),
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

const streamPaymentReceipt = (receipt, res, next) => {
  const storageKey = receipt?.storageKey;
  if (!storageKey || !/^[0-9a-f-]{36}$/i.test(storageKey)) {
    return res.status(404).json({ status: 'error', message: 'Payment receipt not found.' });
  }
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'attachment; filename="payment-receipt"',
    'Content-Type': receipt.mimeType || 'application/octet-stream',
  });
  return res.sendFile(path.join(receiptDirectory, storageKey), (error) => {
    if (error && !res.headersSent) next(error);
  });
};

const requestedReceipt = (order, historyIndex) => {
  if (historyIndex === undefined) return order?.paymentReceipt;
  const index = Number(historyIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  return order?.paymentReceiptHistory?.[index] || null;
};

const getBankTransferReceipt = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).select('paymentReceipt paymentReceiptHistory orderNumber');
    return streamPaymentReceipt(requestedReceipt(order, req.query.historyIndex), res, next);
  } catch (error) {
    return next(error);
  }
};

const getCustomerPaymentReceipt = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ status: 'error', message: 'Payment receipt not found.' });
    }
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id })
      .select('paymentReceipt paymentReceiptHistory orderNumber');
    return streamPaymentReceipt(requestedReceipt(order, req.query.historyIndex), res, next);
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
      paymentStatus: { $in: ['Pending Verification', 'Awaiting Verification'] },
      isPaid: { $ne: true },
      'paymentReceipt.storageKey': { $exists: true, $ne: '' },
      ...(decision === 'approve' ? { orderStatus: { $ne: 'Cancelled' } } : {}),
    };
    const reviewFilter = { $and: [manualOrderFilter, paymentFilter, { _id: req.params.id }] };
    const order = await Order.findOne(reviewFilter);
    if (!order) return res.status(409).json({ status: 'error', message: 'This payment is not awaiting review or has already been reviewed.' });
    const expectedAmount = Number(order.totalPrice);
    const submittedAmount = Number(order.paymentAmount);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 || submittedAmount !== expectedAmount) {
      return res.status(409).json({ status: 'error', message: 'The submitted payment amount does not match the order total.' });
    }

    const approved = decision === 'approve';
    const timestamp = new Date();
    const update = {
      paymentStatus: approved ? 'Paid' : 'Rejected',
      isPaid: approved,
      paymentReviewNote: note.trim(),
      paymentReviewedAt: timestamp,
      paymentReviewedBy: req.user._id,
      paymentDate: approved ? timestamp : null,
      paidAt: approved ? timestamp : null,
    };
    const updatedOrder = await Order.findOneAndUpdate(
      reviewFilter,
      {
        $set: update,
        $push: {
          paymentHistory: paymentHistoryEntry(approved ? 'Paid' : 'Rejected', {
            previousStatus: order.paymentStatus,
            message: approved
              ? 'Payment verified against the merchant account and approved by an administrator.'
              : `Payment proof rejected: ${note.trim()}`,
            adminNote: note.trim(),
            adminUserId: req.user._id,
            amount: expectedAmount,
          }),
        },
      },
      { new: true, runValidators: true }
    );
    if (!updatedOrder) {
      return res.status(409).json({ status: 'error', message: 'This payment was already reviewed.' });
    }
    await createNotification(updatedOrder.user, {
      type: approved ? 'payment-confirmation' : 'payment-rejected',
      title: approved ? 'Payment confirmed' : 'Payment proof needs correction',
      message: approved
        ? `Payment for order ${updatedOrder.orderNumber} has been verified.`
        : `Payment proof for order ${updatedOrder.orderNumber} was rejected: ${note.trim()}`,
      link: `/orders/${updatedOrder._id}`,
      relatedEntityType: 'order',
      relatedEntityId: updatedOrder._id,
    });
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
  getPublicPaymentSettings,
  getAllPayments,
  getMyPayments,
  uploadBankTransferReceipt,
  getBankTransferReceipt,
  getCustomerPaymentReceipt,
  reviewBankTransfer,
};
