const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/mockNotifications');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Order = require('../models/Order');
const OrderCounter = require('../models/OrderCounter');
const Product = require('../models/Product');
const Refund = require('../models/Refund');
const ReturnRequest = require('../models/ReturnRequest');
const User = require('../models/User');
const orderRoutes = require('../routes/orderRoutes');
const {
  getMyOrders,
  getOrderById,
  cancelOrder,
  deleteOrder,
  updateOrderTracking,
} = require('../controllers/orderController');

const createResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const withServer = async (app, callback) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
};

test('order details are looked up only within the authenticated customer account', async () => {
  const originalFindOne = Order.findOne;
  const originalRefundFind = Refund.find;
  const originalReturnFind = ReturnRequest.find;
  const orderId = new mongoose.Types.ObjectId().toString();
  const customerId = new mongoose.Types.ObjectId().toString();
  const otherCustomerId = new mongoose.Types.ObjectId().toString();
  let capturedFilter;

  Order.findOne = (filter) => {
    capturedFilter = filter;
    return {
      populate: async () => filter.user.toString() === customerId
        ? {
            _id: new mongoose.Types.ObjectId(orderId),
            orderItems: [],
            items: [],
            totalPrice: 0,
            toObject: () => ({ _id: orderId, orderItems: [], items: [], totalPrice: 0 }),
          }
        : null,
    };
  };
  Refund.find = () => ({ sort() { return this; }, lean: async () => [] });
  ReturnRequest.find = () => ({ lean: async () => [] });

  try {
    const ownResponse = createResponse();
    await getOrderById(
      { params: { id: orderId }, user: { _id: customerId, role: 'customer' } },
      ownResponse,
      (error) => { throw error; }
    );
    assert.equal(ownResponse.statusCode, 200);
    assert.equal(capturedFilter.user.toString(), customerId);

    const otherResponse = createResponse();
    await getOrderById(
      { params: { id: orderId }, user: { _id: otherCustomerId, role: 'customer' } },
      otherResponse,
      (error) => { throw error; }
    );
    assert.equal(otherResponse.statusCode, 404);
    assert.equal(capturedFilter.user.toString(), otherCustomerId);
  } finally {
    Order.findOne = originalFindOne;
    Refund.find = originalRefundFind;
    ReturnRequest.find = originalReturnFind;
  }
});

test('cancellation is also scoped to the authenticated customer', async () => {
  const originalFindOne = Order.findOne;
  const originalStartSession = mongoose.startSession;
  const orderId = new mongoose.Types.ObjectId().toString();
  const customerId = new mongoose.Types.ObjectId().toString();
  let capturedFilter;
  let passedError;
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };

  Order.findOne = (filter) => {
    capturedFilter = filter;
    return { session: async () => null };
  };
  mongoose.startSession = async () => session;

  try {
    await cancelOrder(
      { params: { id: orderId }, body: { reason: 'Changed my mind' }, user: { _id: customerId, role: 'customer' } },
      createResponse(),
      (error) => { passedError = error; }
    );
    assert.equal(capturedFilter._id, orderId);
    assert.equal(capturedFilter.user.toString(), customerId);
    assert.equal(passedError.statusCode, 404);
  } finally {
    Order.findOne = originalFindOne;
    mongoose.startSession = originalStartSession;
  }
});

test('cancelling an eligible order restores inventory and appends tracking history', async () => {
  const originalFindOne = Order.findOne;
  const originalStartSession = mongoose.startSession;
  const originalProductUpdateOne = Product.updateOne;
  const originalRefundFindOne = Refund.findOne;
  const originalRefundFind = Refund.find;
  const originalRefundSave = Refund.prototype.save;
  const originalReturnFind = ReturnRequest.find;
  const originalCounterUpdate = OrderCounter.findOneAndUpdate;
  const orderId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId().toString();
  const productId = new mongoose.Types.ObjectId();
  const order = {
    _id: orderId,
    orderStatus: 'Pending',
    orderItems: [{ product: productId, name: 'Test item', qty: 2, price: 10 }],
    trackingHistory: [{ status: 'Pending', message: 'Order placed', timestamp: new Date() }],
    totalPrice: 20,
    currency: 'ETB',
    shippingAddress: {},
    save: async () => order,
    toObject: () => ({
      _id: orderId.toString(),
      orderStatus: order.orderStatus,
      orderItems: order.orderItems,
      trackingHistory: order.trackingHistory,
      totalPrice: order.totalPrice,
      currency: order.currency,
      shippingAddress: order.shippingAddress,
    }),
  };
  const stockUpdates = [];
  const savedRefunds = [];
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  Order.findOne = () => ({ session: async () => order });
  Refund.findOne = () => ({ session: async () => null });
  Refund.find = () => ({ sort() { return this; }, lean: async () => [] });
  ReturnRequest.find = () => ({ lean: async () => [] });
  Refund.prototype.save = async function save() {
    savedRefunds.push(this);
    return this;
  };
  OrderCounter.findOneAndUpdate = async () => ({ sequence: 1 });
  mongoose.startSession = async () => session;
  Product.updateOne = async (...args) => {
    stockUpdates.push(args);
    return { matchedCount: 1 };
  };

  try {
    const response = createResponse();
    await cancelOrder(
      {
        params: { id: orderId.toString() },
        body: { reason: 'Changed my mind' },
        user: { _id: customerId, role: 'customer' },
      },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(order.orderStatus, 'Cancelled');
    assert.equal(order.trackingHistory.at(-1).status, 'Cancelled');
    assert.equal(order.trackingHistory.at(-1).previousStatus, 'Pending');
    assert.equal(order.trackingHistory.at(-1).newStatus, 'Cancelled');
    assert.equal(order.cancellationReason, 'Changed my mind');
    assert.ok(order.cancelledAt instanceof Date);
    assert.equal(savedRefunds.length, 1);
    assert.equal(savedRefunds[0].status, 'Not Required');
    assert.equal(savedRefunds[0].source, 'order-cancellation');
    assert.equal(stockUpdates.length, 1);
    assert.deepEqual(stockUpdates[0][1], { $inc: { stockQuantity: 2 } });
  } finally {
    Order.findOne = originalFindOne;
    mongoose.startSession = originalStartSession;
    Product.updateOne = originalProductUpdateOne;
    Refund.findOne = originalRefundFindOne;
    Refund.find = originalRefundFind;
    Refund.prototype.save = originalRefundSave;
    ReturnRequest.find = originalReturnFind;
    OrderCounter.findOneAndUpdate = originalCounterUpdate;
  }
});

test('a paid undispatched Processing order can be cancelled with a linked refund for the unpaid balance', async () => {
  const originalFindOne = Order.findOne;
  const originalStartSession = mongoose.startSession;
  const originalRefundFindOne = Refund.findOne;
  const originalRefundFind = Refund.find;
  const originalRefundSave = Refund.prototype.save;
  const originalCounterUpdate = OrderCounter.findOneAndUpdate;
  const originalReturnFind = ReturnRequest.find;
  const customerId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();
  const savedRefunds = [];
  const order = {
    _id: orderId,
    user: customerId,
    orderStatus: 'Processing',
    isPaid: true,
    paymentStatus: 'Paid',
    paymentAmount: 125,
    totalPrice: 125,
    currency: 'ETB',
    refundedAmount: 25,
    paymentMethod: 'Bank Transfer',
    transactionReference: 'BANK-TX-123',
    orderItems: [],
    trackingHistory: [],
    save: async () => order,
    toObject: () => ({
      _id: orderId.toString(),
      user: customerId,
      orderStatus: order.orderStatus,
      isPaid: order.isPaid,
      paymentStatus: order.paymentStatus,
      paymentAmount: order.paymentAmount,
      totalPrice: order.totalPrice,
      currency: order.currency,
      orderItems: [],
      trackingHistory: order.trackingHistory,
    }),
  };
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  Order.findOne = () => ({ session: async () => order });
  Refund.findOne = () => ({ session: async () => null });
  Refund.find = () => ({ sort() { return this; }, lean: async () => [] });
  ReturnRequest.find = () => ({ lean: async () => [] });
  Refund.prototype.save = async function save() {
    savedRefunds.push(this);
    return this;
  };
  OrderCounter.findOneAndUpdate = async () => ({ sequence: 2 });
  mongoose.startSession = async () => session;

  try {
    const response = createResponse();
    await cancelOrder(
      {
        params: { id: orderId.toString() },
        body: { reason: 'Delivery is no longer needed' },
        user: { _id: customerId, role: 'customer' },
      },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(order.orderStatus, 'Cancelled');
    assert.equal(savedRefunds.length, 1);
    assert.equal(savedRefunds[0].status, 'Refund Required');
    assert.equal(savedRefunds[0].amount, 100);
    assert.equal(savedRefunds[0].originalAmount, 125);
    assert.equal(savedRefunds[0].transactionReference, 'BANK-TX-123');
  } finally {
    Order.findOne = originalFindOne;
    mongoose.startSession = originalStartSession;
    Refund.findOne = originalRefundFindOne;
    Refund.find = originalRefundFind;
    Refund.prototype.save = originalRefundSave;
    OrderCounter.findOneAndUpdate = originalCounterUpdate;
    ReturnRequest.find = originalReturnFind;
  }
});

test('a Processing order with dispatch information cannot be cancelled', async () => {
  const originalFindOne = Order.findOne;
  const originalStartSession = mongoose.startSession;
  const orderId = new mongoose.Types.ObjectId();
  const order = {
    orderStatus: 'Processing',
    shippingDate: new Date(),
    trackingNumber: 'AS-TRACK-1',
  };
  let passedError;
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  Order.findOne = () => ({ session: async () => order });
  mongoose.startSession = async () => session;

  try {
    const response = createResponse();
    await cancelOrder(
      {
        params: { id: orderId.toString() },
        body: { reason: 'Changed my mind' },
        user: { _id: new mongoose.Types.ObjectId(), role: 'customer' },
      },
      response,
      (error) => { passedError = error; }
    );
    assert.equal(passedError.statusCode, 409);
    assert.match(passedError.message, /can no longer be cancelled/i);
  } finally {
    Order.findOne = originalFindOne;
    mongoose.startSession = originalStartSession;
  }
});

test('deleting a pending unpaid order restores inventory and removes the order', async () => {
  const originalFindById = Order.findById;
  const originalDeleteOne = Order.deleteOne;
  const originalStartSession = mongoose.startSession;
  const originalProductUpdateOne = Product.updateOne;
  const orderId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const order = {
    _id: orderId,
    orderNumber: 'AS-TEST',
    orderStatus: 'Pending',
    isPaid: false,
    paymentStatus: 'Pending',
    orderItems: [{ product: productId, qty: 2 }],
  };
  const stockUpdates = [];
  let deletedFilter;
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  Order.findById = () => ({ session: async () => order });
  Order.deleteOne = async (filter) => {
    deletedFilter = filter;
    return { deletedCount: 1 };
  };
  Product.updateOne = async (...args) => {
    stockUpdates.push(args);
    return { matchedCount: 1 };
  };
  mongoose.startSession = async () => session;

  try {
    const response = createResponse();
    let passedError;
    await deleteOrder(
      { params: { id: orderId.toString() } },
      response,
      (error) => { passedError = error; }
    );

    assert.equal(passedError, undefined);
    assert.deepEqual(response.body, {
      message: 'Order deleted successfully.',
      id: orderId.toString(),
      orderNumber: 'AS-TEST',
    });
    assert.equal(deletedFilter._id, orderId);
    assert.deepEqual(stockUpdates[0][1], { $inc: { stockQuantity: 2 } });
  } finally {
    Order.findById = originalFindById;
    Order.deleteOne = originalDeleteOne;
    Product.updateOne = originalProductUpdateOne;
    mongoose.startSession = originalStartSession;
  }
});

test('paid orders cannot be permanently deleted', async () => {
  const originalFindById = Order.findById;
  const originalDeleteOne = Order.deleteOne;
  const originalStartSession = mongoose.startSession;
  const originalProductUpdateOne = Product.updateOne;
  const orderId = new mongoose.Types.ObjectId();
  const order = {
    _id: orderId,
    orderStatus: 'Pending',
    isPaid: true,
    paymentStatus: 'Paid',
    orderItems: [],
  };
  let deleteCalled = false;
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  Order.findById = () => ({ session: async () => order });
  Order.deleteOne = async () => {
    deleteCalled = true;
    return { deletedCount: 1 };
  };
  Product.updateOne = async () => {
    throw new Error('Inventory must not change for a rejected deletion.');
  };
  mongoose.startSession = async () => session;

  try {
    let passedError;
    await deleteOrder(
      { params: { id: orderId.toString() } },
      createResponse(),
      (error) => { passedError = error; }
    );
    assert.equal(passedError.statusCode, 409);
    assert.equal(deleteCalled, false);
  } finally {
    Order.findById = originalFindById;
    Order.deleteOne = originalDeleteOne;
    Product.updateOne = originalProductUpdateOne;
    mongoose.startSession = originalStartSession;
  }
});

test('order endpoints reject requests without authentication', async () => {
  const app = express();
  app.use('/api/orders', orderRoutes);
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/orders/${new mongoose.Types.ObjectId()}`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).status, 'error');
  });
});

test('protected routes reject invalid and expired JWTs', async () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-order-token-secret';
  const app = express();
  app.use('/api/orders', orderRoutes);

  try {
    await withServer(app, async (baseUrl) => {
      const userId = new mongoose.Types.ObjectId().toString();
      const invalidResponse = await fetch(`${baseUrl}/api/orders/my-orders`, {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      const expiredToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: -1 });
      const expiredResponse = await fetch(`${baseUrl}/api/orders/my-orders`, {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });

      assert.equal(invalidResponse.status, 401);
      assert.equal(expiredResponse.status, 401);
    });
  } finally {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});

test('admins can access protected order listings with a valid JWT', async () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  const originalOrderFind = Order.find;
  const adminId = new mongoose.Types.ObjectId().toString();
  process.env.JWT_SECRET = 'test-admin-token-secret';
  User.findById = () => ({
    select: async () => ({ _id: adminId, role: 'admin' }),
  });
  Order.find = () => ({
    populate: () => ({
      sort: async () => [],
    }),
  });
  const app = express();
  app.use('/api/orders', orderRoutes);

  try {
    await withServer(app, async (baseUrl) => {
      const token = jwt.sign({ id: adminId }, process.env.JWT_SECRET);
      const response = await fetch(`${baseUrl}/api/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), []);
    });
  } finally {
    User.findById = originalFindById;
    Order.find = originalOrderFind;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});

test('customers cannot delete orders through the admin-only endpoint', async () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  const customerId = new mongoose.Types.ObjectId().toString();
  process.env.JWT_SECRET = 'test-order-delete-secret';
  User.findById = () => ({
    select: async () => ({ _id: customerId, role: 'customer' }),
  });
  const app = express();
  app.use('/api/orders', orderRoutes);

  try {
    await withServer(app, async (baseUrl) => {
      const token = jwt.sign({ id: customerId }, process.env.JWT_SECRET);
      const response = await fetch(`${baseUrl}/api/orders/${new mongoose.Types.ObjectId()}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 403);
    });
  } finally {
    User.findById = originalFindById;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});

test('customers cannot update tracking fields through administrator routes', async () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  const customerId = new mongoose.Types.ObjectId().toString();
  process.env.JWT_SECRET = 'test-order-ownership-secret';
  User.findById = () => ({
    select: async () => ({ _id: customerId, role: 'customer' }),
  });
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRoutes);

  try {
    await withServer(app, async (baseUrl) => {
      const token = jwt.sign({ id: customerId }, process.env.JWT_SECRET);
      const response = await fetch(`${baseUrl}/api/orders/${new mongoose.Types.ObjectId()}/tracking`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trackingNumber: 'test-tracking-number' }),
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).message, 'Forbidden: Admin access required');
    });
  } finally {
    User.findById = originalFindById;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});

test('admin status changes appear in the customer order list with history and without changing payment status', async () => {
  const originalFindById = Order.findById;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const originalFind = Order.find;
  const originalRefundFind = Refund.find;
  const originalReturnFind = ReturnRequest.find;
  const adminId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  let capturedFilter;
  let capturedUpdate;
  let customerOrderFilter;
  const currentOrder = {
    _id: orderId,
    user: customerId,
    orderStatus: 'Pending',
    orderItems: [],
    items: [],
    trackingHistory: [],
    totalPrice: 0,
    isPaid: false,
    paymentStatus: 'Failed',
    adminTrackingNote: '',
  };
  const updatedOrder = {
    ...currentOrder,
    orderStatus: 'Confirmed',
    trackingHistory: [],
    toObject() {
      return this;
    },
  };
  Order.findById = async () => currentOrder;
  Order.findOneAndUpdate = async (filter, update, options) => {
    capturedFilter = filter;
    capturedUpdate = update;
    assert.equal(options.runValidators, true);
    updatedOrder.trackingHistory = update.$push.trackingHistory
      ? [update.$push.trackingHistory]
      : [];
    return updatedOrder;
  };
  Order.find = (filter) => {
    customerOrderFilter = filter;
    return {
      populate: () => ({
        sort: async () => [updatedOrder],
      }),
    };
  };
  Refund.find = () => ({ sort() { return this; }, lean: async () => [] });
  ReturnRequest.find = () => ({ lean: async () => [] });

  try {
    const response = createResponse();
    await updateOrderTracking(
      {
        params: { id: orderId.toString() },
        user: { _id: adminId, role: 'admin' },
        body: {
          status: 'Confirmed',
          customerMessage: 'Your delivery address has been verified.',
          adminNote: 'Customer requested a call before delivery.',
        },
      },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(capturedFilter, { _id: orderId, orderStatus: 'Pending' });
    assert.equal(capturedUpdate.$set.orderStatus, 'Confirmed');
    assert.equal(capturedUpdate.$push.trackingHistory.previousStatus, 'Pending');
    assert.equal(capturedUpdate.$push.trackingHistory.newStatus, 'Confirmed');
    assert.equal(capturedUpdate.$push.trackingHistory.customerMessage, 'Your delivery address has been verified.');
    assert.equal(capturedUpdate.$push.trackingHistory.adminNote, 'Customer requested a call before delivery.');
    assert.equal(capturedUpdate.$push.trackingHistory.adminUserId, adminId);
    assert.ok(capturedUpdate.$push.trackingHistory.timestamp instanceof Date);
    assert.equal(response.body.trackingHistory[0].adminNote, 'Customer requested a call before delivery.');
    assert.equal(Object.hasOwn(capturedUpdate.$set, 'isPaid'), false);
    assert.equal(response.body.isPaid, false);
    assert.equal(response.body.paymentStatus, 'Failed');

    const customerOrdersResponse = createResponse();
    await getMyOrders(
      { user: { _id: customerId, role: 'customer' } },
      customerOrdersResponse,
      (error) => { throw error; }
    );
    assert.equal(customerOrderFilter.user, customerId);
    assert.equal(customerOrdersResponse.body[0].orderStatus, 'Confirmed');
    assert.equal(customerOrdersResponse.body[0].trackingHistory[0].previousStatus, 'Pending');
    assert.equal(customerOrdersResponse.body[0].trackingHistory[0].newStatus, 'Confirmed');
    assert.equal(customerOrdersResponse.body[0].trackingHistory[0].customerMessage, 'Your delivery address has been verified.');
    assert.equal(Object.hasOwn(customerOrdersResponse.body[0].trackingHistory[0], 'adminNote'), false);
    assert.equal(Object.hasOwn(customerOrdersResponse.body[0], 'adminTrackingNote'), false);
    assert.ok(customerOrdersResponse.body[0].trackingHistory[0].timestamp instanceof Date);
  } finally {
    Order.findById = originalFindById;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
    Order.find = originalFind;
    Refund.find = originalRefundFind;
    ReturnRequest.find = originalReturnFind;
  }
});

test('message-only admin updates append customer-visible history without exposing internal notes', async () => {
  const originalFindById = Order.findById;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const originalFind = Order.find;
  const originalRefundFind = Refund.find;
  const originalReturnFind = ReturnRequest.find;
  const orderId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const previousEntry = {
    status: 'Pending',
    message: 'Order received.',
    customerMessage: '',
    adminNote: 'Legacy internal note.',
    timestamp: new Date('2026-11-13T10:00:00.000Z'),
  };
  const order = {
    _id: orderId,
    user: customerId,
    orderStatus: 'Processing',
    orderItems: [],
    items: [],
    trackingHistory: [previousEntry],
    adminTrackingNote: 'Previously stored internal note.',
    totalPrice: 0,
    isPaid: false,
    paymentStatus: 'Pending',
    toObject() {
      return this;
    },
  };
  let capturedUpdate;
  Order.findById = async () => order;
  Order.findOneAndUpdate = async (_filter, update) => {
    capturedUpdate = update;
    Object.assign(order, update.$set);
    order.trackingHistory.push(update.$push.trackingHistory);
    return order;
  };
  Order.find = () => ({
    populate: () => ({
      sort: async () => [order],
    }),
  });
  Refund.find = () => ({ sort() { return this; }, lean: async () => [] });
  ReturnRequest.find = () => ({ lean: async () => [] });

  try {
    const adminResponse = createResponse();
    await updateOrderTracking(
      {
        params: { id: orderId.toString() },
        user: { _id: adminId, role: 'admin' },
        body: {
          status: 'Processing',
          customerMessage: 'Your items are being packed for dispatch.',
          adminNote: 'Confirm the fragile-item packaging before dispatch.',
        },
      },
      adminResponse,
      (error) => { throw error; }
    );

    assert.equal(capturedUpdate.$set.orderStatus, undefined);
    assert.equal(capturedUpdate.$push.trackingHistory.previousStatus, 'Processing');
    assert.equal(capturedUpdate.$push.trackingHistory.newStatus, 'Processing');
    assert.equal(capturedUpdate.$push.trackingHistory.customerMessage, 'Your items are being packed for dispatch.');
    assert.equal(adminResponse.body.trackingHistory.length, 2);
    assert.equal(adminResponse.body.trackingHistory[1].adminNote, 'Confirm the fragile-item packaging before dispatch.');

    const customerResponse = createResponse();
    await getMyOrders(
      { user: { _id: customerId, role: 'customer' } },
      customerResponse,
      (error) => { throw error; }
    );
    const customerOrder = customerResponse.body[0];
    assert.equal(customerOrder.trackingHistory.length, 2);
    assert.equal(customerOrder.trackingHistory[1].customerMessage, 'Your items are being packed for dispatch.');
    assert.equal(Object.hasOwn(customerOrder.trackingHistory[0], 'adminNote'), false);
    assert.equal(Object.hasOwn(customerOrder.trackingHistory[1], 'adminNote'), false);
    assert.equal(Object.hasOwn(customerOrder, 'adminTrackingNote'), false);
  } finally {
    Order.findById = originalFindById;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
    Order.find = originalFind;
    Refund.find = originalRefundFind;
    ReturnRequest.find = originalReturnFind;
  }
});

test('unpaid or unverified orders cannot move to processing or shipping', async (t) => {
  const originalFindById = Order.findById;
  try {
    for (const [orderStatus, nextStatus] of [['Confirmed', 'Processing'], ['Processing', 'Shipped']]) {
      await t.test(`${orderStatus} to ${nextStatus}`, async () => {
        Order.findById = async () => ({
          orderStatus,
          paymentStatus: 'Pending Verification',
          isPaid: false,
        });
        const response = createResponse();
        await updateOrderTracking(
          { params: { id: new mongoose.Types.ObjectId().toString() }, body: { status: nextStatus }, user: { _id: new mongoose.Types.ObjectId(), role: 'admin' } },
          response,
          (error) => { throw error; }
        );
        assert.equal(response.statusCode, 409);
        assert.match(response.body.message, /Payment must be verified/);
      });
    }
  } finally {
    Order.findById = originalFindById;
  }
});

test('admin cannot regress terminal statuses and can save delivery fields independently', async () => {
  const originalFindById = Order.findById;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const orderId = new mongoose.Types.ObjectId();
  let updateCalls = 0;
  let capturedUpdate;
  const order = {
    _id: orderId,
    orderStatus: 'Delivered',
    orderItems: [],
    items: [],
    trackingHistory: [],
    totalPrice: 0,
    isPaid: true,
    toObject() {
      return this;
    },
  };
  Order.findById = async () => order;
  Order.findOneAndUpdate = async (_filter, update) => {
    updateCalls += 1;
    capturedUpdate = update;
    Object.assign(order, update.$set);
    return order;
  };

  try {
    const invalidResponse = createResponse();
    await updateOrderTracking(
      { params: { id: orderId.toString() }, user: { _id: new mongoose.Types.ObjectId() }, body: { status: 'Pending' } },
      invalidResponse,
      (error) => { throw error; }
    );
    assert.equal(invalidResponse.statusCode, 409);
    assert.equal(updateCalls, 0);

    const infoResponse = createResponse();
    await updateOrderTracking(
      {
        params: { id: orderId.toString() },
        user: { _id: new mongoose.Types.ObjectId(), role: 'admin' },
        body: { deliveryCompany: 'AllStore Delivery', trackingNumber: 'AS12345' },
      },
      infoResponse,
      (error) => { throw error; }
    );
    assert.equal(infoResponse.statusCode, 200);
    assert.equal(capturedUpdate.$set.deliveryCompany, 'AllStore Delivery');
    assert.equal(capturedUpdate.$set.trackingNumber, 'AS12345');
    assert.equal(capturedUpdate.$set.orderStatus, undefined);
    assert.equal(capturedUpdate.$push, undefined);
    assert.equal(infoResponse.body.isPaid, true);
    assert.equal(infoResponse.body.paymentStatus, 'Paid');
  } finally {
    Order.findById = originalFindById;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
