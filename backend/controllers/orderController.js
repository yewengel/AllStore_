const mongoose = require('mongoose');
const { createHash } = require('node:crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Refund = require('../models/Refund');
const ReturnRequest = require('../models/ReturnRequest');
const { nextOrderNumber, nextRefundNumber } = require('../utils/orderNumbers');
const { toEtb } = require('../utils/currency');
const {
  getPaymentAccount,
  getPaymentAccounts,
  isPaymentAccountComplete,
  paymentAccountSnapshot,
} = require('../utils/paymentSettings');
const { createNotification } = require('../utils/notifications');

const requestError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const FREE_SHIPPING_THRESHOLD_ETB = toEtb(100, 'USD');
const SHIPPING_COST_ETB = toEtb(9.99, 'USD');
const ORDER_STATUSES = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'];
const CANCELLABLE_ORDER_STATUSES = ['Pending', 'Confirmed', 'Processing'];
const ALLOWED_STATUS_TRANSITIONS = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['Processing', 'Cancelled'],
  Processing: ['Shipped', 'Cancelled'],
  Shipped: ['Out for Delivery'],
  'Out for Delivery': ['Delivered'],
  Delivered: [],
  Cancelled: [],
};
const DEFAULT_DELIVERY_COMPANY = 'AllStore Delivery';

const normalizeOptions = (options) => (
  options instanceof Map ? Object.fromEntries(options) :
    options && typeof options === 'object' ? { ...options } : {}
);

const serializeRefundForOrder = (refund) => ({
  id: refund._id,
  refundNumber: refund.refundNumber || '',
  status: refund.status,
  source: refund.source || 'manual',
  amount: refund.amount,
  originalAmount: refund.originalAmount,
  currency: refund.currency || 'ETB',
  paymentMethod: refund.paymentMethod || '',
  transactionReference: refund.transactionReference || '',
  providerRefundReference: refund.providerRefundReference || '',
  reason: refund.reason || '',
  customerMessage: refund.customerMessage || '',
  requestedAt: refund.requestedAt || refund.createdAt,
  reviewedAt: refund.reviewedAt || null,
  processedAt: refund.processedAt || null,
  updatedAt: refund.updatedAt || null,
  history: (refund.history || []).map((entry) => ({
    status: entry.status,
    message: entry.message || '',
    timestamp: entry.timestamp,
  })),
});

const serializeReturnForOrder = (request, includeAdminDetails = false) => {
  if (!request) return null;
  const result = {
    id: request._id,
    status: request.status,
    reason: request.reason,
    details: request.details || '',
    adminResponse: request.adminResponse || '',
    photos: (request.photos || []).map((photo) => ({
      id: photo._id,
      originalName: photo.originalName,
      url: `/api/returns/${request._id}/photos/${photo._id}`,
    })),
    history: (request.history || []).map((entry) => ({
      status: entry.status,
      message: entry.message || '',
      timestamp: entry.timestamp,
    })),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
  if (includeAdminDetails) {
    result.receivedCondition = request.receivedCondition || '';
    result.restockable = request.restockable;
    result.stockRestoredAt = request.stockRestoredAt || null;
    result.items = (request.items || []).map((item) => ({
      ...(typeof item.toObject === 'function' ? item.toObject() : item),
      options: normalizeOptions(item.options),
    }));
  }
  return result;
};

const attachOrderWorkflows = async (orders, { includeAdminDetails = false } = {}) => {
  if (!orders.length) return [];
  const orderIds = orders.map((order) => order._id);
  const [refunds, returns] = await Promise.all([
    Refund.find({ order: { $in: orderIds } }).sort({ createdAt: -1 }).lean(),
    ReturnRequest.find({ order: { $in: orderIds } }).lean(),
  ]);
  const refundsByOrder = new Map();
  refunds.forEach((refund) => {
    const key = refund.order.toString();
    const entries = refundsByOrder.get(key) || [];
    entries.push(serializeRefundForOrder(refund));
    refundsByOrder.set(key, entries);
  });
  const returnsByOrder = new Map(returns.map((request) => [request.order.toString(), request]));
  return orders.map((order) => {
    const id = order._id.toString();
    return {
      ...safeOrderSummary(order, { includeAdminNotes: includeAdminDetails }),
      refunds: refundsByOrder.get(id) || [],
      returnRequest: serializeReturnForOrder(returnsByOrder.get(id), includeAdminDetails),
    };
  });
};

const restoreInventory = async (items, session) => {
  for (const item of items) {
    const productId = item.product?._id?.toString?.() || item.product?.toString?.();
    if (!productId) continue;

    const variantId = item.variantId?.toString?.() || item.variantId;
    if (variantId) {
      const availableVariantResult = await Product.updateOne(
        {
          _id: productId,
          variants: { $elemMatch: { _id: variantId, isAvailable: { $ne: false } } },
        },
        { $inc: { 'variants.$.stockQuantity': item.qty, stockQuantity: item.qty } },
        { session }
      );
      if (availableVariantResult.matchedCount !== 1) {
        await Product.updateOne(
          { _id: productId, variants: { $elemMatch: { _id: variantId } } },
          { $inc: { 'variants.$.stockQuantity': item.qty } },
          { session }
        );
      }
    } else {
      await Product.updateOne(
        { _id: productId },
        { $inc: { stockQuantity: item.qty } },
        { session }
      );
    }
  }
};

const safeOrderSummary = (order, { includeAdminNotes = false } = {}) => {
  if (!order) return null;

  const orderData = typeof order.toObject === 'function' ? order.toObject() : order;
  const orderItems = order.orderItems?.length ? order.orderItems : order.items || [];
  const normalizedItems = orderItems.map((item) => {
    const itemData = typeof item.toObject === 'function' ? item.toObject() : item;
    return { ...itemData, options: normalizeOptions(item.options) };
  });
  const calculatedSubtotal = orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discountAmount = Number.isFinite(order.discountAmount) ? order.discountAmount : 0;
  const subtotal = Number.isFinite(order.subtotal) ? order.subtotal : calculatedSubtotal;
  const shippingCost = Number.isFinite(order.shippingCost)
    ? order.shippingCost
    : Math.max(0, order.totalPrice - subtotal + discountAmount);

  const summary = {
    ...orderData,
    orderItems: normalizedItems,
    orderNumber: order.orderNumber || `#${order._id.toString().slice(-8).toUpperCase()}`,
    deliveryCompany: order.deliveryCompany || order.courierName || DEFAULT_DELIVERY_COMPANY,
    subtotal,
    shippingCost,
    discountAmount,
    customerName: order.customerName || order.user?.name || 'Customer',
    phoneNumber: order.phoneNumber || '',
    paymentStatus: order.isPaid ? 'Paid' : order.paymentStatus || 'Pending',
    paymentAmount: Number.isFinite(order.paymentAmount) ? order.paymentAmount : order.totalPrice,
    paymentCurrency: order.paymentCurrency || order.currency || 'ETB',
    deliveryAddress: order.deliveryAddress || [
      order.shippingAddress?.address,
      order.shippingAddress?.city,
      order.shippingAddress?.postalCode,
      order.shippingAddress?.country,
    ].filter(Boolean).join(', '),
    items: normalizedItems.map((item) => ({
      product: item.product,
      variantId: item.variantId,
      variantSku: item.variantSku,
      image: item.image || '',
      options: item.options,
      name: item.name,
      qty: item.qty,
      price: item.price,
      currency: item.currency,
      image: item.image,
    })),
    trackingHistory: Array.isArray(orderData.trackingHistory) ? orderData.trackingHistory : [],
  };
  delete summary.paymentCheckoutUrl;
  if (summary.paymentReceipt) {
    summary.paymentReceipt = {
      mimeType: summary.paymentReceipt.mimeType,
      originalName: summary.paymentReceipt.originalName,
      uploadedAt: summary.paymentReceipt.uploadedAt,
    };
  }
  summary.paymentReceiptHistory = (summary.paymentReceiptHistory || []).map((receipt) => ({
    mimeType: receipt.mimeType,
    originalName: receipt.originalName,
    uploadedAt: receipt.uploadedAt,
  }));
  if (!includeAdminNotes) {
    delete summary.adminTrackingNote;
    summary.paymentHistory = (summary.paymentHistory || []).map((entry) => {
      const customerEntry = { ...entry };
      delete customerEntry.adminNote;
      delete customerEntry.adminUserId;
      return customerEntry;
    });
    summary.trackingHistory = summary.trackingHistory.map((entry) => {
      const customerEntry = { ...entry };
      delete customerEntry.adminNote;
      delete customerEntry.adminUserId;
      return customerEntry;
    });
  }
  return summary;
};

const createOrder = async (req, res, next) => {
  const {
    orderItems,
    shippingAddress,
    paymentMethod,
    paymentAccountId,
    transactionReference,
    checkoutRequestKey,
    phoneNumber,
    deliveryDetails = {},
  } = req.body || {};

  const requestedPaymentMethod = typeof paymentMethod === 'string' ? paymentMethod.trim() : '';
  let idempotentOrderId;
  if (checkoutRequestKey !== undefined) {
    if (
      typeof checkoutRequestKey !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(checkoutRequestKey.trim())
    ) {
      return res.status(400).json({ status: 'error', message: 'A valid checkout request key is required.' });
    }
    idempotentOrderId = new mongoose.Types.ObjectId(
      createHash('sha256')
        .update(`allstore-order:${req.user._id}:${checkoutRequestKey.trim()}`)
        .digest('hex')
        .slice(0, 24)
    );
    try {
      const existingOrder = await Order.findOne({ _id: idempotentOrderId, user: req.user._id });
      if (existingOrder) return res.status(200).json(safeOrderSummary(existingOrder));
    } catch (error) {
      return next(error);
    }
  }
  if (paymentAccountId !== undefined && (
    typeof paymentAccountId !== 'string' || paymentAccountId.trim().length > 100
  )) {
    return res.status(400).json({ status: 'error', message: 'Select a valid payment account.' });
  }
  let selectedPaymentAccount = paymentAccountId
    ? await getPaymentAccount(paymentAccountId, { activeOnly: true })
    : null;
  if (!selectedPaymentAccount && !paymentAccountId && requestedPaymentMethod) {
    selectedPaymentAccount = (await getPaymentAccounts()).find(
      (account) => account.active && isPaymentAccountComplete(account) && account.name === requestedPaymentMethod
    );
  }
  if (!selectedPaymentAccount) {
    return res.status(400).json({
      status: 'error',
      message: 'Select a supported payment method using an active account configured by the store.',
    });
  }
  if (transactionReference !== undefined && (
    typeof transactionReference !== 'string' || transactionReference.trim().length > 200
  )) {
    return res.status(400).json({ status: 'error', message: 'Payment transaction reference must be no longer than 200 characters.' });
  }

  if (!Array.isArray(orderItems) || orderItems.length === 0 || orderItems.length > 50) {
    return res.status(400).json({ status: 'error', message: 'Provide between 1 and 50 order items.' });
  }

  const shippingFields = ['address', 'city', 'postalCode', 'country'];
  if (
    !shippingAddress ||
    shippingFields.some((field) => typeof shippingAddress[field] !== 'string' || !shippingAddress[field].trim())
  ) {
    return res.status(400).json({ status: 'error', message: 'Please provide a complete shipping address.' });
  }
  if (phoneNumber !== undefined && (
    typeof phoneNumber !== 'string' ||
    !phoneNumber.trim() ||
    phoneNumber.trim().length > 50
  )) {
    return res.status(400).json({ status: 'error', message: 'Please provide a valid phone number no longer than 50 characters.' });
  }
  if (!deliveryDetails || typeof deliveryDetails !== 'object' || Array.isArray(deliveryDetails)) {
    return res.status(400).json({ status: 'error', message: 'Delivery details must be an object.' });
  }
  const optionalDeliveryFields = {
    recipientName: 120,
    deliveryPhoneNumber: 50,
    region: 120,
    subCity: 120,
    deliveryInstructions: 1000,
  };
  for (const [field, maxLength] of Object.entries(optionalDeliveryFields)) {
    const value = deliveryDetails[field];
    if (value !== undefined && (typeof value !== 'string' || value.length > maxLength)) {
      return res.status(400).json({ status: 'error', message: `${field} must be a string no longer than ${maxLength} characters.` });
    }
  }

  const requestedItems = new Map();
  for (const item of orderItems) {
    if (
      !item ||
      typeof item.product !== 'string' ||
      !mongoose.isValidObjectId(item.product) ||
      !Number.isSafeInteger(item.qty) ||
      item.qty < 1
    ) {
      return res.status(400).json({ status: 'error', message: 'Each order item must include a valid product ID and positive integer quantity.' });
    }

    if (item.variantId !== undefined && item.variantId !== null && (
      typeof item.variantId !== 'string' || !mongoose.isValidObjectId(item.variantId)
    )) {
      return res.status(400).json({ status: 'error', message: 'Each selected product variant must be valid.' });
    }

    const productId = new mongoose.Types.ObjectId(item.product).toString();
    const variantId = item.variantId ? new mongoose.Types.ObjectId(item.variantId).toString() : '';
    const key = `${productId}:${variantId || 'base'}`;
    const requested = requestedItems.get(key) || { productId, variantId, qty: 0 };
    requested.qty += item.qty;
    requestedItems.set(key, requested);
    if (!Number.isSafeInteger(requested.qty)) {
      return res.status(400).json({ status: 'error', message: 'Requested quantity is too large.' });
    }
  }

  const session = await mongoose.startSession();
  try {
    let createdOrder;
    await session.withTransaction(async () => {
      const productIds = [...new Set([...requestedItems.values()].map(({ productId }) => productId))]
        .map((id) => new mongoose.Types.ObjectId(id));
      const products = await Product.find({ _id: { $in: productIds } }).session(session);
      const productsById = new Map(products.map((product) => [product._id.toString(), product]));

      const verifiedItems = [];
      let subtotal = 0;
      for (const { productId, variantId, qty } of requestedItems.values()) {
        const product = productsById.get(productId);
        if (!product) throw requestError(404, 'One or more requested products were not found.');
        const productVariants = product.variants || [];
        const variant = variantId
          ? typeof productVariants.id === 'function'
            ? productVariants.id(variantId)
            : productVariants.find((candidate) => candidate._id?.toString() === variantId)
          : null;
        if (productVariants.length && !variant) {
          throw requestError(400, `Select an available option for "${product.name}".`);
        }
        if (variantId && !variant) {
          throw requestError(400, `The selected option for "${product.name}" is no longer available.`);
        }
        if (variant && variant.isAvailable === false) {
          throw requestError(400, `The selected option for "${product.name}" is no longer available.`);
        }

        const availableStock = variant ? variant.stockQuantity : product.stockQuantity;
        if (availableStock < qty) {
          throw requestError(
            400,
            `Insufficient stock for "${product.name}". Available: ${availableStock}, requested: ${qty}`
          );
        }

        const variantOptions = variant ? normalizeOptions(variant.options) : {};
        const priceEtb = toEtb(variant?.price ?? product.price, product.currency || product.priceCurrency);
        subtotal += priceEtb * qty;
        verifiedItems.push({
          product: product._id,
          ...(variant ? { variantId: variant._id } : {}),
          ...(variant?.sku ? { variantSku: variant.sku } : {}),
          options: variantOptions,
          name: product.name,
          qty,
          price: priceEtb,
          currency: 'ETB',
          image: variant?.image || product.image,
        });
      }

      for (const { productId, variantId, qty } of requestedItems.values()) {
        const filter = variantId
          ? {
              _id: productId,
              stockQuantity: { $gte: qty },
              variants: {
                $elemMatch: {
                  _id: variantId,
                  isAvailable: { $ne: false },
                  stockQuantity: { $gte: qty },
                },
              },
            }
          : {
              _id: productId,
              stockQuantity: { $gte: qty },
              $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }],
            };
        const update = variantId
          ? { $inc: { 'variants.$.stockQuantity': -qty, stockQuantity: -qty } }
          : { $inc: { stockQuantity: -qty } };
        const result = await Product.updateOne(filter, update, { session });
        if (result.matchedCount !== 1) {
          const product = productsById.get(productId);
          throw requestError(
            400,
            `The selected option for "${product.name}" is no longer available. Please refresh and try again.`
          );
        }
      }

      const shippingCost = subtotal >= FREE_SHIPPING_THRESHOLD_ETB ? 0 : SHIPPING_COST_ETB;
      const totalPrice = Math.round((subtotal + shippingCost + Number.EPSILON) * 100) / 100;
      const orderNumber = await nextOrderNumber(session);
      const normalizedShippingAddress = {
        ...Object.fromEntries(shippingFields.map((field) => [field, shippingAddress[field].trim()])),
        region: deliveryDetails.region?.trim() || '',
        subCity: deliveryDetails.subCity?.trim() || '',
      };
      const order = new Order({
        ...(idempotentOrderId ? { _id: idempotentOrderId } : {}),
        user: req.user._id,
        orderNumber,
        transactionReference: transactionReference?.trim() || '',
        orderItems: verifiedItems,
        items: verifiedItems,
        customerName: req.user?.name || '',
        recipientName: deliveryDetails.recipientName?.trim() || req.user?.name || '',
        deliveryAddress: [shippingAddress.address.trim(), shippingAddress.city.trim(), shippingAddress.postalCode.trim(), shippingAddress.country.trim()].join(', '),
        phoneNumber: typeof phoneNumber === 'string' ? phoneNumber.trim() : req.user?.phoneNumber || '',
        deliveryPhoneNumber: deliveryDetails.deliveryPhoneNumber?.trim() ||
          (typeof phoneNumber === 'string' ? phoneNumber.trim() : req.user?.phoneNumber || ''),
        deliveryInstructions: deliveryDetails.deliveryInstructions?.trim() || '',
        deliveryCompany: DEFAULT_DELIVERY_COMPANY,
        currency: 'ETB',
        shippingAddress: normalizedShippingAddress,
        paymentMethod: selectedPaymentAccount.name,
        paymentAccountId: selectedPaymentAccount.id,
        paymentAccountSnapshot: paymentAccountSnapshot(selectedPaymentAccount),
        paymentAmount: totalPrice,
        paymentCurrency: 'ETB',
        paymentStatus: 'Awaiting Payment',
        paymentHistory: [{
          status: 'Awaiting Payment',
          message: 'Order created. Waiting for the customer to submit payment proof.',
          timestamp: new Date(),
        }],
        paymentChannel: selectedPaymentAccount.provider,
        subtotal: Math.round((subtotal + Number.EPSILON) * 100) / 100,
        shippingCost,
        discountAmount: 0,
        totalPrice,
        orderStatus: 'Pending',
        trackingHistory: [{ status: 'Pending', message: 'Order placed successfully.', timestamp: new Date() }],
      });

      createdOrder = await order.save({ session });
    });

    if (!createdOrder) throw new Error('Order transaction completed without creating an order.');
    await createNotification(createdOrder.user, {
      type: 'order-confirmation',
      title: 'Order received',
      message: `Order ${createdOrder.orderNumber} has been received and is awaiting payment verification.`,
      link: `/orders/${createdOrder._id}`,
      relatedEntityType: 'order',
      relatedEntityId: createdOrder._id,
    });
    return res.status(201).json(safeOrderSummary(createdOrder));
  } catch (error) {
    if (idempotentOrderId && error.code === 11000) {
      try {
        const existingOrder = await Order.findOne({ _id: idempotentOrderId, user: req.user._id });
        if (existingOrder) return res.status(200).json(safeOrderSummary(existingOrder));
      } catch (lookupError) {
        return next(lookupError);
      }
    }
    return next(error);
  } finally {
    await session.endSession();
  }
};

const getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    return res.json(await attachOrderWorkflows(orders));
  } catch (error) {
    return next(error);
  }
};

const getOrderById = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ status: 'error', message: 'Invalid order ID.' });
    }

    const filter = { _id: req.params.id };
    if (req.user.role !== 'admin') filter.user = req.user._id;
    const order = await Order.findOne(filter).populate('user', 'name email');
    if (!order) return res.status(404).json({ status: 'error', message: 'Order not found' });
    const [summary] = await attachOrderWorkflows([order], { includeAdminDetails: req.user.role === 'admin' });
    return res.json(summary);
  } catch (error) {
    return next(error);
  }
};

const getAllOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({})
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    return res.json(orders.map((order) => safeOrderSummary(order, { includeAdminNotes: true })));
  } catch (error) {
    return next(error);
  }
};

const deleteOrder = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid order ID.' });
  }

  const session = await mongoose.startSession();
  try {
    let deletedOrder;
    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session);
      if (!order) throw requestError(404, 'Order not found.');
      if (
        order.orderStatus !== 'Pending' ||
        order.isPaid ||
        order.paymentStatus === 'Paid' ||
        order.paymentInitializedAt ||
        order.paymentGatewayReference ||
        order.paymentReceipt
      ) {
        throw requestError(409, 'Only pending orders without payment activity can be deleted.');
      }

      const items = order.orderItems?.length ? order.orderItems : order.items || [];
      await restoreInventory(items, session);

      const result = await Order.deleteOne({ _id: order._id }, { session });
      if (result.deletedCount !== 1) {
        throw requestError(409, 'This order changed before it could be deleted. Reload and try again.');
      }
      deletedOrder = { id: order._id.toString(), orderNumber: order.orderNumber };
    });

    if (!deletedOrder) throw new Error('Order deletion completed without deleting an order.');
    return res.json({ message: 'Order deleted successfully.', ...deletedOrder });
  } catch (error) {
    return next(error);
  } finally {
    await session.endSession();
  }
};

const updateOrderStatus = async (req, res, next) => {
  return updateOrderTracking(req, res, next);
};

const updateOrderTracking = async (req, res, next) => {
  try {
    const {
      status,
      trackingNumber,
      courierName,
      deliveryCompany,
      deliveryPersonName,
      deliveryPersonPhone,
      estimatedDelivery,
      shippingDate,
      actualDeliveryDate,
      deliveryNotes,
      deliveryInstructions,
      adminTrackingNote,
      message,
      adminNote,
      customerMessage,
    } = req.body || {};

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ status: 'error', message: 'Order not found' });

    if (status !== undefined && !ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ status: 'error', message: `Invalid status. Must be one of: ${ORDER_STATUSES.join(', ')}` });
    }
    if (message !== undefined && (typeof message !== 'string' || message.length > 500)) {
      return res.status(400).json({ status: 'error', message: 'Status message must be a string no longer than 500 characters.' });
    }
    if (customerMessage !== undefined && (typeof customerMessage !== 'string' || customerMessage.length > 1000)) {
      return res.status(400).json({ status: 'error', message: 'Customer message must be a string no longer than 1000 characters.' });
    }
    if (req.body?.transactionReference !== undefined) {
      return res.status(400).json({ status: 'error', message: 'Payment references cannot be changed through delivery tracking.' });
    }
    const textFields = {
      trackingNumber: 200,
      courierName: 200,
      deliveryCompany: 200,
      deliveryPersonName: 120,
      deliveryPersonPhone: 50,
      deliveryNotes: 2000,
      deliveryInstructions: 1000,
      adminTrackingNote: 1000,
      adminNote: 1000,
      customerMessage: 1000,
    };
    for (const [field, maxLength] of Object.entries(textFields)) {
      const value = req.body?.[field];
      if (value !== undefined && (typeof value !== 'string' || value.length > maxLength)) {
        return res.status(400).json({ status: 'error', message: `${field} must be a string no longer than ${maxLength} characters.` });
      }
    }

    const nextStatus = status || order.orderStatus || 'Pending';
    const previousStatus = order.orderStatus || 'Pending';
    const statusChanged = nextStatus !== previousStatus;

    if (statusChanged && !ALLOWED_STATUS_TRANSITIONS[previousStatus]?.includes(nextStatus)) {
      return res.status(409).json({
        status: 'error',
        message: `Order status cannot move from ${previousStatus} to ${nextStatus}.`,
      });
    }
    if (
      statusChanged &&
      ['Processing', 'Shipped', 'Out for Delivery', 'Delivered'].includes(nextStatus) &&
      (!order.isPaid || order.paymentStatus !== 'Paid')
    ) {
      return res.status(409).json({
        status: 'error',
        message: 'Payment must be verified and marked Paid before this order can be processed or shipped.',
      });
    }
    const updates = {};
    const updateTimestamp = new Date();
    for (const field of Object.keys(textFields)) {
      if (field === 'adminNote' || field === 'customerMessage') continue;
      const value = req.body?.[field];
      if (value !== undefined) updates[field] = value.trim();
    }
    if (adminNote?.trim()) updates.adminTrackingNote = adminNote.trim();
    if (trackingNumber !== undefined) updates.trackingNumber = trackingNumber.trim();
    if (deliveryCompany !== undefined || courierName !== undefined) {
      updates.deliveryCompany = (deliveryCompany ?? courierName).trim() || DEFAULT_DELIVERY_COMPANY;
      updates.courierName = updates.deliveryCompany;
    }

    for (const [field, value] of Object.entries({ estimatedDelivery, shippingDate, actualDeliveryDate })) {
      if (value === undefined) continue;
      const parsedDate = value ? new Date(value) : null;
      if (value && Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ status: 'error', message: `${field} must be a valid date.` });
      }
      updates[field] = parsedDate;
    }
    if (actualDeliveryDate !== undefined) updates.deliveredAt = updates.actualDeliveryDate;

    if (statusChanged) {
      updates.orderStatus = nextStatus;
      if (nextStatus === 'Shipped') {
        updates.shippingDate = updateTimestamp;
      }
      if (nextStatus === 'Delivered') {
        updates.actualDeliveryDate = actualDeliveryDate ? updates.actualDeliveryDate : updateTimestamp;
        updates.deliveredAt = updates.actualDeliveryDate;
      }
    }

    const update = { $set: updates };
    const customerMessageText = customerMessage?.trim() || '';
    const adminNoteText = adminNote?.trim() || '';
    const shouldRecordUpdate = statusChanged || Boolean(customerMessageText) || Boolean(adminNoteText);
    if (shouldRecordUpdate) {
      update.$push = {
        trackingHistory: {
          status: nextStatus,
          previousStatus,
          newStatus: nextStatus,
          message: message?.trim() || (statusChanged
            ? `Status changed from ${previousStatus} to ${nextStatus}.`
            : 'Order update recorded.'),
          customerMessage: customerMessageText,
          adminNote: adminNoteText,
          adminUserId: req.user._id,
          timestamp: updateTimestamp,
        },
      };
    }

    const updatedOrder = await Order.findOneAndUpdate(
      { _id: order._id, orderStatus: previousStatus },
      update,
      { new: true, runValidators: true }
    );
    if (!updatedOrder) {
      return res.status(409).json({ status: 'error', message: 'This order was updated by another administrator. Reload it and try again.' });
    }
    if (statusChanged) {
      const notificationText = {
        Confirmed: 'Your order has been confirmed.',
        Processing: 'Your paid order is being prepared.',
        Shipped: 'Your order has shipped.',
        'Out for Delivery': 'Your order is out for delivery.',
        Delivered: 'Your order has been delivered.',
        Cancelled: 'Your order has been cancelled.',
      }[nextStatus];
      if (notificationText) {
        await createNotification(updatedOrder.user, {
          type: nextStatus === 'Cancelled' ? 'cancellation' : 'order-status',
          title: nextStatus === 'Cancelled' ? 'Order cancelled' : `Order ${nextStatus.toLowerCase()}`,
          message: `${notificationText} Order ${updatedOrder.orderNumber}.`,
          link: `/orders/${updatedOrder._id}`,
          relatedEntityType: 'order',
          relatedEntityId: updatedOrder._id,
        });
      }
    }
    return res.json(safeOrderSummary(updatedOrder, { includeAdminNotes: req.user.role === 'admin' }));
  } catch (error) {
    return next(error);
  }
};

const cancelOrder = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid order ID.' });
  }

  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason || reason.length > 500) {
    return res.status(400).json({ status: 'error', message: 'A cancellation reason of up to 500 characters is required.' });
  }

  const session = await mongoose.startSession();
  try {
    let updatedOrder;
    let cancellationRefund;
    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: req.params.id,
        user: req.user._id,
      }).session(session);

      if (!order) throw requestError(404, 'Order not found.');
      const isUndispatchedProcessing = order.orderStatus === 'Processing' &&
        !order.shippingDate &&
        !String(order.trackingNumber || '').trim();
      if (
        !CANCELLABLE_ORDER_STATUSES.includes(order.orderStatus) ||
        (order.orderStatus === 'Processing' && !isUndispatchedProcessing)
      ) {
        throw requestError(409, 'This order can no longer be cancelled online. Please contact support for help.');
      }
      const items = order.orderItems?.length ? order.orderItems : order.items || [];
      await restoreInventory(items, session);

      const previousStatus = order.orderStatus;
      const cancelledAt = new Date();
      order.orderStatus = 'Cancelled';
      order.cancellationReason = reason;
      order.cancelledAt = cancelledAt;
      order.cancelledBy = req.user._id;
      order.trackingHistory = order.trackingHistory || [];
      order.trackingHistory.push({
        status: 'Cancelled',
        previousStatus,
        newStatus: 'Cancelled',
        message: 'Order cancelled by customer.',
        timestamp: new Date(),
      });
      updatedOrder = await order.save({ session });

      const alreadyCreated = await Refund.findOne({
        order: order._id,
        source: 'order-cancellation',
      }).session(session);
      if (alreadyCreated) {
        throw requestError(409, 'A cancellation refund record already exists for this order.');
      }

      const codPaid = order.paymentMethod === 'Cash on Delivery' &&
        order.codCollectionStatus === 'Collected';
      const wasPaid = Boolean(order.isPaid) ||
        ['Paid', 'Partially Refunded'].includes(order.paymentStatus) ||
        codPaid;
      const amountPaid = codPaid && Number.isFinite(Number(order.codCollectedAmount))
        ? toEtb(Number(order.codCollectedAmount), order.paymentCurrency || order.currency || 'ETB')
        : toEtb(Number(order.paymentAmount ?? order.totalPrice) || 0, order.paymentCurrency || order.currency || 'ETB');
      const refundableAmount = wasPaid
        ? Math.max(0, Math.round((amountPaid - (Number(order.refundedAmount) || 0) + Number.EPSILON) * 100) / 100)
        : 0;
      const refundStatus = refundableAmount > 0 ? 'Refund Required' : 'Not Required';
      const refund = new Refund({
        refundNumber: await nextRefundNumber(session),
        order: order._id,
        user: order.user,
        transactionReference: order.transactionReference || order.paymentGatewayReference || '',
        paymentMethod: order.paymentMethod || '',
        paymentProvider: order.paymentMethod === 'Cash on Delivery'
          ? 'Cash on Delivery'
          : order.paymentMethod === 'Bank Transfer'
            ? 'Manual bank transfer'
            : order.paymentMethod === 'Chapa Checkout' || order.paymentMethod === 'Credit Card'
              ? 'Chapa'
              : order.paymentMethod || '—',
        originalAmount: wasPaid ? amountPaid : 0,
        amount: refundableAmount,
        currency: 'ETB',
        reason,
        source: 'order-cancellation',
        status: refundStatus,
        requestedAt: cancelledAt,
        customerMessage: '',
        history: [{
          status: refundStatus,
          message: refundStatus === 'Refund Required'
            ? 'The cancellation was recorded. An administrator will review and process the refund.'
            : 'No payment was received, so no refund is required.',
          timestamp: cancelledAt,
          actorRole: 'system',
        }],
      });
      await refund.save({ session });
      cancellationRefund = refund;
    });

    if (!updatedOrder) throw new Error('Order cancellation completed without updating an order.');
    await createNotification(updatedOrder.user, {
      type: 'cancellation',
      title: 'Order cancelled',
      message: `Order ${updatedOrder.orderNumber} was cancelled. Any applicable refund will be reviewed separately.`,
      link: `/orders/${updatedOrder._id}`,
      relatedEntityType: 'order',
      relatedEntityId: updatedOrder._id,
    });
    if (cancellationRefund?.status === 'Refund Required') {
      await createNotification(updatedOrder.user, {
        type: 'refund-update',
        title: 'Refund review required',
        message: `A refund for order ${updatedOrder.orderNumber} is awaiting Admin review.`,
        link: `/orders/${updatedOrder._id}`,
        relatedEntityType: 'refund',
        relatedEntityId: cancellationRefund._id,
      });
    }
    const [summary] = await attachOrderWorkflows([updatedOrder]);
    return res.json(summary);
  } catch (error) {
    return next(error);
  } finally {
    await session.endSession();
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrderById,
  getAllOrders,
  deleteOrder,
  updateOrderStatus,
  updateOrderTracking,
  cancelOrder,
};
