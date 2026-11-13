const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const orderRoutes = require('../routes/orderRoutes');
const { getOrderById, cancelOrder, updateOrderTracking } = require('../controllers/orderController');

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
      { params: { id: orderId }, user: { _id: customerId, role: 'customer' } },
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
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  Order.findOne = () => ({ session: async () => order });
  mongoose.startSession = async () => session;
  Product.updateOne = async (...args) => {
    stockUpdates.push(args);
    return { matchedCount: 1 };
  };

  try {
    const response = createResponse();
    await cancelOrder(
      { params: { id: orderId.toString() }, user: { _id: customerId, role: 'customer' } },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(order.orderStatus, 'Cancelled');
    assert.equal(order.trackingHistory.at(-1).status, 'Cancelled');
    assert.equal(order.trackingHistory.at(-1).previousStatus, 'Pending');
    assert.equal(order.trackingHistory.at(-1).newStatus, 'Cancelled');
    assert.equal(stockUpdates.length, 1);
    assert.deepEqual(stockUpdates[0][1], { $inc: { stockQuantity: 2 } });
  } finally {
    Order.findOne = originalFindOne;
    mongoose.startSession = originalStartSession;
    Product.updateOne = originalProductUpdateOne;
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

test('admin status changes append an auditable history entry without changing payment status', async () => {
  const originalFindById = Order.findById;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const adminId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();
  let capturedFilter;
  let capturedUpdate;
  const currentOrder = {
    _id: orderId,
    orderStatus: 'Pending',
    orderItems: [],
    items: [],
    trackingHistory: [],
    totalPrice: 0,
    isPaid: false,
    paymentStatus: 'Failed',
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

  try {
    const response = createResponse();
    await updateOrderTracking(
      {
        params: { id: orderId.toString() },
        user: { _id: adminId, role: 'admin' },
        body: { status: 'Confirmed', adminNote: 'Address verified.' },
      },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(capturedFilter, { _id: orderId, orderStatus: 'Pending' });
    assert.equal(capturedUpdate.$set.orderStatus, 'Confirmed');
    assert.equal(capturedUpdate.$push.trackingHistory.previousStatus, 'Pending');
    assert.equal(capturedUpdate.$push.trackingHistory.newStatus, 'Confirmed');
    assert.equal(capturedUpdate.$push.trackingHistory.adminNote, 'Address verified.');
    assert.equal(capturedUpdate.$push.trackingHistory.adminUserId, adminId);
    assert.ok(capturedUpdate.$push.trackingHistory.timestamp instanceof Date);
    assert.equal(Object.hasOwn(capturedUpdate.$set, 'isPaid'), false);
    assert.equal(response.body.isPaid, false);
    assert.equal(response.body.paymentStatus, 'Failed');
  } finally {
    Order.findById = originalFindById;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
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
