const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Refund = require('../models/Refund');
const ReturnRequest = require('../models/ReturnRequest');
const { hasValidPhotoSignature } = require('../middleware/returnPhotoUpload');
const { createNotification } = require('../utils/notifications');

const PRIVATE_PHOTO_DIRECTORY = path.join(__dirname, '..', 'private', 'return-photos');
const ALLOWED_STATUSES = [
  'Return Requested',
  'Under Review',
  'Approved',
  'Rejected',
  'Return in Progress',
  'Item Received',
  'Refund Processing',
  'Refunded',
  'Return Completed',
];
const ALLOWED_TRANSITIONS = {
  'Return Requested': ['Under Review'],
  'Under Review': ['Approved', 'Rejected'],
  Approved: ['Return in Progress'],
  Rejected: [],
  'Return in Progress': ['Item Received'],
  'Item Received': ['Refund Processing', 'Return Completed'],
  'Refund Processing': ['Refunded', 'Return Completed'],
  Refunded: ['Return Completed'],
  'Return Completed': [],
};
const ALLOWED_CONDITIONS = ['Unused', 'Like New', 'Damaged', 'Incomplete', 'Other'];

const requestError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const userId = (user) => user?._id?.toString?.() || user?._id;

const serializeReturn = (request, { adminView = false } = {}) => ({
  id: request._id,
  orderId: request.order?._id || request.order,
  orderNumber: request.order?.orderNumber || '',
  orderStatus: request.order?.orderStatus || '',
  orderTotal: request.order?.totalPrice,
  orderCurrency: request.order?.currency || 'ETB',
  paymentStatus: request.order?.isPaid ? 'Paid' : request.order?.paymentStatus || '',
  customer: request.user && typeof request.user === 'object'
    ? {
        id: request.user._id,
        name: request.user.name || '',
        email: request.user.email || '',
        phoneNumber: request.order?.phoneNumber || '',
      }
    : undefined,
  status: request.status,
  reason: request.reason,
  details: request.details || '',
  adminResponse: request.adminResponse || '',
  photos: (request.photos || []).map((photo) => ({
    id: photo._id,
    originalName: photo.originalName,
    url: `/api/returns/${request._id}/photos/${photo._id}`,
  })),
  items: (request.items || []).map((item) => ({
    product: item.product,
    name: item.name,
    qty: item.qty,
    variantId: item.variantId,
    variantSku: item.variantSku || '',
    image: item.image || '',
    options: item.options instanceof Map ? Object.fromEntries(item.options) : item.options || {},
  })),
  history: (request.history || []).map((entry) => ({
    status: entry.status,
    message: entry.message || '',
    timestamp: entry.timestamp,
  })),
  receivedCondition: adminView ? request.receivedCondition || '' : undefined,
  restockable: adminView ? request.restockable : undefined,
  stockRestoredAt: adminView ? request.stockRestoredAt || null : undefined,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
});

const cleanupFiles = async (files) => {
  await Promise.all(files.map((file) => fs.unlink(file).catch(() => {})));
};

const createReturnRequest = async (req, res, next) => {
  const files = req.files || [];
  const storedPaths = [];
  try {
    const { orderId, reason, details = '' } = req.body || {};
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ status: 'error', message: 'A valid order is required.' });
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
      return res.status(400).json({ status: 'error', message: 'A return reason of up to 500 characters is required.' });
    }
    if (typeof details !== 'string' || details.length > 2000) {
      return res.status(400).json({ status: 'error', message: 'Additional details must be no longer than 2,000 characters.' });
    }
    if (files.some((file) => !hasValidPhotoSignature(file))) {
      return res.status(400).json({ status: 'error', message: 'One or more uploaded files are not valid images.' });
    }

    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) return res.status(404).json({ status: 'error', message: 'Order not found.' });
    if (order.orderStatus !== 'Delivered') {
      return res.status(409).json({ status: 'error', message: 'A return can only be requested for a delivered order.' });
    }
    if (await ReturnRequest.exists({ order: order._id })) {
      return res.status(409).json({ status: 'error', message: 'A return request already exists for this order.' });
    }

    await fs.mkdir(PRIVATE_PHOTO_DIRECTORY, { recursive: true });
    const photos = [];
    for (const file of files) {
      const extension = path.extname(file.originalname).toLowerCase();
      const fileName = `${randomUUID()}${extension}`;
      const filePath = path.join(PRIVATE_PHOTO_DIRECTORY, fileName);
      await fs.writeFile(filePath, file.buffer, { flag: 'wx' });
      storedPaths.push(filePath);
      photos.push({
        fileName,
        originalName: path.basename(file.originalname).slice(0, 255),
        mimeType: file.mimetype,
        size: file.size,
      });
    }

    const orderItems = order.orderItems?.length ? order.orderItems : order.items || [];
    const request = await ReturnRequest.create({
      order: order._id,
      user: order.user,
      items: orderItems.map((item) => ({
        product: item.product,
        name: item.name,
        qty: item.qty,
        variantId: item.variantId,
        variantSku: item.variantSku || '',
        image: item.image || '',
        options: item.options || {},
      })),
      reason: reason.trim(),
      details: details.trim(),
      photos,
      status: 'Return Requested',
      history: [{
        status: 'Return Requested',
        message: 'Customer submitted a return request.',
        actor: req.user._id,
        actorRole: 'customer',
      }],
    });
    await createNotification(request.user, {
      type: 'return-update',
      title: 'Return request received',
      message: `Your return request for order ${order.orderNumber} has been submitted.`,
      link: `/orders/${order._id}`,
      relatedEntityType: 'return',
      relatedEntityId: request._id,
    });
    return res.status(201).json(serializeReturn(request));
  } catch (error) {
    await cleanupFiles(storedPaths);
    if (error.code === 11000) {
      return res.status(409).json({ status: 'error', message: 'A return request already exists for this order.' });
    }
    return next(error);
  }
};

const getMyReturnRequests = async (req, res, next) => {
  try {
    const requests = await ReturnRequest.find({ user: req.user._id })
      .populate('order', 'orderNumber orderStatus totalPrice currency paymentStatus isPaid phoneNumber')
      .sort({ createdAt: -1 });
    return res.json(requests.map((request) => serializeReturn(request)));
  } catch (error) {
    return next(error);
  }
};

const getReturnRequests = async (req, res, next) => {
  try {
    const requests = await ReturnRequest.find({})
      .populate('order', 'orderNumber orderStatus totalPrice currency paymentStatus isPaid phoneNumber')
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    return res.json(requests.map((request) => serializeReturn(request, { adminView: true })));
  } catch (error) {
    return next(error);
  }
};

const restoreReturnedInventory = async (request, session) => {
  for (const item of request.items) {
    if (!item.product) throw requestError(409, `Product for "${item.name}" no longer exists.`);
    const product = await Product.findById(item.product).session(session);
    if (!product) throw requestError(409, `Product for "${item.name}" no longer exists.`);

    if (item.variantId) {
      const variant = product.variants.id(item.variantId);
      if (!variant) throw requestError(409, `The returned variant for "${item.name}" no longer exists.`);
      variant.stockQuantity += item.qty;
      if (variant.isAvailable) product.stockQuantity += item.qty;
    } else {
      product.stockQuantity += item.qty;
    }
    await product.save({ session });
  }
};

const updateReturnRequest = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ status: 'error', message: 'Return request not found.' });
  }
  const { status, response = '', receivedCondition, restockable } = req.body || {};
  if (!ALLOWED_STATUSES.includes(status) || typeof response !== 'string' || response.length > 1000) {
    return res.status(400).json({ status: 'error', message: 'Invalid return update.' });
  }
  if (status === 'Rejected' && !response.trim()) {
    return res.status(400).json({ status: 'error', message: 'An explanation is required when rejecting a return.' });
  }
  if (status === 'Item Received' &&
    (!ALLOWED_CONDITIONS.includes(receivedCondition) || typeof restockable !== 'boolean')) {
    return res.status(400).json({ status: 'error', message: 'Record the item condition and whether it can be returned to stock.' });
  }

  const session = await mongoose.startSession();
  try {
    let updatedRequest;
    let statusChanged = false;
    await session.withTransaction(async () => {
      const request = await ReturnRequest.findById(req.params.id).session(session);
      if (!request) throw requestError(404, 'Return request not found.');
      const isStatusChange = request.status !== status;
      statusChanged = isStatusChange;
      if (isStatusChange && !ALLOWED_TRANSITIONS[request.status]?.includes(status)) {
        throw requestError(409, `Return status cannot be changed from ${request.status} to ${status}.`);
      }
      if (status === 'Refund Processing') {
        const refund = await Refund.findOne({
          returnRequest: request._id,
          status: { $in: ['Pending', 'Requested', 'Approved', 'Processing'] },
        }).session(session);
        if (!refund) throw requestError(409, 'Create a linked refund request before moving this return to refund processing.');
      }
      if (status === 'Refunded') {
        const refund = await Refund.findOne({
          returnRequest: request._id,
          status: 'Refunded',
        }).session(session);
        if (!refund) throw requestError(409, 'The linked refund must be completed before the return can be marked refunded.');
      }

      const receivedNow = isStatusChange && status === 'Item Received';
      if (receivedNow && restockable) {
        if (request.stockRestoredAt) throw requestError(409, 'Inventory has already been restored for this return.');
        await restoreReturnedInventory(request, session);
        request.stockRestoredAt = new Date();
        request.stockRestoredBy = req.user._id;
      }
      if (receivedNow) {
        request.receivedCondition = receivedCondition;
        request.restockable = restockable;
      }
      request.status = status;
      request.adminResponse = response.trim();
      request.history = request.history || [];
      request.history.push({
        status,
        message: response.trim(),
        timestamp: new Date(),
        actor: req.user._id,
        actorRole: 'admin',
      });
      updatedRequest = await request.save({ session });
    });
    if (statusChanged) {
      await createNotification(updatedRequest.user, {
        type: 'return-update',
        title: `Return ${updatedRequest.status.toLowerCase()}`,
        message: updatedRequest.adminResponse || `Your return request is now ${updatedRequest.status.toLowerCase()}.`,
        link: `/orders/${updatedRequest.order}`,
        relatedEntityType: 'return',
        relatedEntityId: updatedRequest._id,
      });
    }
    return res.json(serializeReturn(updatedRequest, { adminView: true }));
  } catch (error) {
    return next(error);
  } finally {
    await session.endSession();
  }
};

const getReturnPhoto = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.photoId)) {
      return res.status(404).json({ status: 'error', message: 'Return photo not found.' });
    }
    const request = await ReturnRequest.findById(req.params.id).select('user photos');
    if (!request) return res.status(404).json({ status: 'error', message: 'Return photo not found.' });
    if (req.user.role !== 'admin' && userId(request.user) !== userId(req.user)) {
      return res.status(404).json({ status: 'error', message: 'Return photo not found.' });
    }
    const photo = request.photos.id(req.params.photoId);
    if (!photo || path.basename(photo.fileName) !== photo.fileName) {
      return res.status(404).json({ status: 'error', message: 'Return photo not found.' });
    }
    res.set('Content-Type', photo.mimeType);
    res.set('Content-Disposition', 'inline');
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.sendFile(path.join(PRIVATE_PHOTO_DIRECTORY, photo.fileName), (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createReturnRequest,
  getMyReturnRequests,
  getReturnRequests,
  updateReturnRequest,
  getReturnPhoto,
};
