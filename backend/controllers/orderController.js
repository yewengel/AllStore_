const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { nextOrderNumber } = require('../utils/orderNumbers');
const { toEtb } = require('../utils/currency');
const { resolvePaymentConfiguration } = require('../utils/paymentSettings');

const requestError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const FREE_SHIPPING_THRESHOLD_ETB = toEtb(100, 'USD');
const SHIPPING_COST_ETB = toEtb(9.99, 'USD');
const ORDER_STATUSES = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'];
// Online methods are settled through the configured Chapa hosted checkout.
// The customer's specific choice is preserved on the order for display.
const ONLINE_PAYMENT_METHODS = ['Chapa Checkout', 'Credit Card', 'Telebirr', 'M-Pesa', 'Visa', 'Mastercard'];
const GENERIC_ONLINE_METHODS = ['Chapa Checkout', 'Credit Card'];
const SUPPORTED_PAYMENT_METHODS = [...ONLINE_PAYMENT_METHODS, 'Bank Transfer', 'Cash on Delivery'];
const CANCELLABLE_ORDER_STATUSES = ['Pending', 'Confirmed'];
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

const safeOrderSummary = (order) => {
  if (!order) return null;

  const orderItems = order.orderItems?.length ? order.orderItems : order.items || [];
  const calculatedSubtotal = orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discountAmount = Number.isFinite(order.discountAmount) ? order.discountAmount : 0;
  const subtotal = Number.isFinite(order.subtotal) ? order.subtotal : calculatedSubtotal;
  const shippingCost = Number.isFinite(order.shippingCost)
    ? order.shippingCost
    : Math.max(0, order.totalPrice - subtotal + discountAmount);

  const summary = {
    ...order.toObject(),
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
    items: (order.items && order.items.length ? order.items : order.orderItems || []).map((item) => ({
      name: item.name,
      qty: item.qty,
      price: item.price,
      image: item.image,
    })),
    trackingHistory: Array.isArray(order.trackingHistory) ? order.trackingHistory : [],
  };
  delete summary.paymentCheckoutUrl;
  if (summary.paymentReceipt) {
    summary.paymentReceipt = {
      mimeType: summary.paymentReceipt.mimeType,
      originalName: summary.paymentReceipt.originalName,
      uploadedAt: summary.paymentReceipt.uploadedAt,
    };
  }
  return summary;
};

const createOrder = async (req, res, next) => {
  const {
    orderItems,
    shippingAddress,
    paymentMethod,
    transactionReference,
    phoneNumber,
    deliveryDetails = {},
  } = req.body || {};

  const requestedPaymentMethod = typeof paymentMethod === 'string' && paymentMethod.trim()
    ? paymentMethod.trim()
    : 'Cash on Delivery';
  const normalizedPaymentMethod = ONLINE_PAYMENT_METHODS.includes(requestedPaymentMethod)
    ? 'Chapa Checkout'
    : requestedPaymentMethod;
  const paymentConfiguration = await resolvePaymentConfiguration();
  if (!SUPPORTED_PAYMENT_METHODS.includes(requestedPaymentMethod)) {
    return res.status(400).json({ status: 'error', message: 'Select a supported payment method.' });
  }
  // Enforce administrator payment method settings (methods disabled in the admin dashboard).
  const requestedMethodKey = normalizedPaymentMethod === 'Chapa Checkout'
    ? (GENERIC_ONLINE_METHODS.includes(requestedPaymentMethod) ? null : requestedPaymentMethod)
    : normalizedPaymentMethod;
  if (requestedMethodKey && paymentConfiguration.methodEnabled[requestedMethodKey] === false) {
    return res.status(400).json({
      status: 'error',
      message: `The ${requestedMethodKey} payment method is currently unavailable.`,
    });
  }
  if (normalizedPaymentMethod === 'Chapa Checkout' && !paymentConfiguration.gateway.configured) {
    return res.status(503).json({
      status: 'error',
      message: paymentConfiguration.gateway.message || 'Chapa checkout is not configured.',
    });
  }
  if (normalizedPaymentMethod === 'Bank Transfer' && !paymentConfiguration.bankTransfer.configured) {
    return res.status(503).json({ status: 'error', message: 'Bank transfer is not configured for this store.' });
  }
  if (normalizedPaymentMethod === 'Cash on Delivery' && paymentConfiguration.methodEnabled['Cash on Delivery'] === false) {
    return res.status(400).json({ status: 'error', message: 'Cash on delivery is currently unavailable.' });
  }
  if (
    normalizedPaymentMethod === 'Bank Transfer' &&
    (typeof transactionReference !== 'string' || !transactionReference.trim() || transactionReference.trim().length > 200)
  ) {
    return res.status(400).json({ status: 'error', message: 'Enter a valid bank transfer transaction reference.' });
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

  const quantities = new Map();
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

    const productId = new mongoose.Types.ObjectId(item.product).toString();
    quantities.set(productId, (quantities.get(productId) || 0) + item.qty);
    if (!Number.isSafeInteger(quantities.get(productId))) {
      return res.status(400).json({ status: 'error', message: 'Requested quantity is too large.' });
    }
  }

  const session = await mongoose.startSession();
  try {
    let createdOrder;
    await session.withTransaction(async () => {
      const productIds = [...quantities.keys()].map((id) => new mongoose.Types.ObjectId(id));
      const products = await Product.find({ _id: { $in: productIds } }).session(session);
      const productsById = new Map(products.map((product) => [product._id.toString(), product]));

      const verifiedItems = [];
      let subtotal = 0;
      for (const [productId, qty] of quantities) {
        const product = productsById.get(productId);
        if (!product) throw requestError(404, 'One or more requested products were not found.');
        if (product.stockQuantity < qty) {
          throw requestError(
            400,
            `Insufficient stock for "${product.name}". Available: ${product.stockQuantity}, requested: ${qty}`
          );
        }

        const priceEtb = toEtb(product.price, product.currency);
        subtotal += priceEtb * qty;
        verifiedItems.push({
          product: product._id,
          name: product.name,
          qty,
          price: priceEtb,
          currency: 'ETB',
          image: product.image,
        });
      }

      for (const [productId, qty] of quantities) {
        const result = await Product.updateOne(
          { _id: productId, stockQuantity: { $gte: qty } },
          { $inc: { stockQuantity: -qty } },
          { session }
        );
        if (result.matchedCount !== 1) {
          const product = productsById.get(productId);
          throw requestError(
            400,
            `Insufficient stock for "${product.name}". Please refresh the product and try again.`
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
        user: req.user._id,
        orderNumber,
        transactionReference: normalizedPaymentMethod === 'Chapa Checkout'
          ? `AS-PAY-${randomUUID()}`
          : normalizedPaymentMethod === 'Bank Transfer'
            ? transactionReference.trim()
            : '',
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
        paymentMethod: normalizedPaymentMethod,
        paymentAmount: totalPrice,
        paymentCurrency: 'ETB',
        paymentStatus: 'Pending',
        paymentChannel: ONLINE_PAYMENT_METHODS.includes(requestedPaymentMethod) &&
          !GENERIC_ONLINE_METHODS.includes(requestedPaymentMethod)
          ? requestedPaymentMethod
          : '',
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
    return res.status(201).json(safeOrderSummary(createdOrder));
  } catch (error) {
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
    return res.json(orders.map((order) => safeOrderSummary(order)));
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
    return res.json(safeOrderSummary(order));
  } catch (error) {
    return next(error);
  }
};

const getAllOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({})
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    return res.json(orders.map((order) => safeOrderSummary(order)));
  } catch (error) {
    return next(error);
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
    } = req.body || {};

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ status: 'error', message: 'Order not found' });

    if (status !== undefined && !ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ status: 'error', message: `Invalid status. Must be one of: ${ORDER_STATUSES.join(', ')}` });
    }
    if (message !== undefined && (typeof message !== 'string' || message.length > 500)) {
      return res.status(400).json({ status: 'error', message: 'Status message must be a string no longer than 500 characters.' });
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
      nextStatus === 'Cancelled' &&
      order.paymentMethod === 'Chapa Checkout' &&
      order.paymentStatus === 'Pending' &&
      order.paymentInitializedAt
    ) {
      return res.status(409).json({
        status: 'error',
        message: 'This order has an active Chapa checkout. Verify or cancel the payment before cancelling the order.',
      });
    }

    const updates = {};
    for (const field of Object.keys(textFields)) {
      if (field === 'adminNote') continue;
      const value = req.body?.[field];
      if (value !== undefined) updates[field] = value.trim();
    }
    if (adminNote !== undefined) updates.adminTrackingNote = adminNote.trim();
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
      const timestamp = new Date();
      updates.orderStatus = nextStatus;
      if (nextStatus === 'Shipped' && !order.shippingDate && shippingDate === undefined) {
        updates.shippingDate = timestamp;
      }
      if (nextStatus === 'Delivered') {
        updates.actualDeliveryDate = actualDeliveryDate ? updates.actualDeliveryDate : timestamp;
        updates.deliveredAt = updates.actualDeliveryDate;
      }
    }

    const update = { $set: updates };
    if (statusChanged) {
      update.$push = {
        trackingHistory: {
        status: nextStatus,
        previousStatus,
        newStatus: nextStatus,
        message: message || `Status changed from ${previousStatus} to ${nextStatus}.`,
        adminNote: adminNote?.trim() || '',
        adminUserId: req.user._id,
        timestamp: new Date(),
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
    return res.json(safeOrderSummary(updatedOrder));
  } catch (error) {
    return next(error);
  }
};

const cancelOrder = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid order ID.' });
  }

  const session = await mongoose.startSession();
  try {
    let updatedOrder;
    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: req.params.id,
        user: req.user._id,
      }).session(session);

      if (!order) throw requestError(404, 'Order not found.');
      if (!CANCELLABLE_ORDER_STATUSES.includes(order.orderStatus) || order.isPaid) {
        throw requestError(409, 'This order can no longer be cancelled online. Please contact support for help.');
      }
      if (
        order.paymentMethod === 'Chapa Checkout' &&
        order.paymentStatus === 'Pending' &&
        order.paymentInitializedAt
      ) {
        throw requestError(409, 'This order has an active Chapa checkout. Verify or cancel the payment before cancelling the order.');
      }

      const quantities = new Map();
      const items = order.orderItems?.length ? order.orderItems : order.items || [];
      items.forEach((item) => {
        const productId = item.product?.toString();
        if (productId) quantities.set(productId, (quantities.get(productId) || 0) + item.qty);
      });

      for (const [productId, qty] of quantities) {
        await Product.updateOne(
          { _id: productId },
          { $inc: { stockQuantity: qty } },
          { session }
        );
      }

      const previousStatus = order.orderStatus;
      order.orderStatus = 'Cancelled';
      order.trackingHistory = order.trackingHistory || [];
      order.trackingHistory.push({
        status: 'Cancelled',
        previousStatus,
        newStatus: 'Cancelled',
        message: 'Order cancelled by customer.',
        timestamp: new Date(),
      });
      updatedOrder = await order.save({ session });
    });

    if (!updatedOrder) throw new Error('Order cancellation completed without updating an order.');
    return res.json(safeOrderSummary(updatedOrder));
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
  updateOrderStatus,
  updateOrderTracking,
  cancelOrder,
};
