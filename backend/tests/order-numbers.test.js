const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const OrderCounter = require('../models/OrderCounter');
const Product = require('../models/Product');
const { createOrder } = require('../controllers/orderController');
const { initializeOrderNumbers, nextOrderNumber } = require('../utils/orderNumbers');

test('order number allocation formats atomic counter values and uses the order transaction', async () => {
  const originalFindOneAndUpdate = OrderCounter.findOneAndUpdate;
  const session = {};
  const sessions = [];
  let sequence = 124;
  OrderCounter.findOneAndUpdate = async (filter, update, options) => {
    assert.deepEqual(filter, { _id: 'order-number' });
    assert.deepEqual(update, { $inc: { sequence: 1 } });
    sessions.push(options.session);
    sequence += 1;
    return { sequence };
  };

  try {
    const orderNumbers = await Promise.all(
      Array.from({ length: 3 }, () => nextOrderNumber(session))
    );
    assert.deepEqual(orderNumbers.sort(), ['AS-00125', 'AS-00126', 'AS-00127']);
    assert.ok(sessions.every((usedSession) => usedSession === session));
  } finally {
    OrderCounter.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('startup migration seeds from existing IDs and assigns readable IDs to legacy orders', async () => {
  const originalAggregate = Order.aggregate;
  const originalFind = Order.find;
  const originalUpdateOne = Order.updateOne;
  const originalUpdateMany = Order.updateMany;
  const originalCreateIndexes = Order.createIndexes;
  const originalCounterUpdateOne = OrderCounter.updateOne;
  const originalCounterFindOneAndUpdate = OrderCounter.findOneAndUpdate;
  const updatedOrders = [];
  let sequence = 0;
  let legacyFilter;

  Order.aggregate = async () => [{ sequence: 124 }];
  Order.find = (filter) => {
    if (filter.orderNumber) legacyFilter = filter;
    return {
      select() { return this; },
      sort() { return this; },
      lean() { return this; },
      cursor: () => (async function* () {
        if (filter.orderNumber) {
          yield { _id: 'old-order-1', orderNumber: '#AS-20261113-1234' };
          yield { _id: 'old-order-2' };
        } else {
          yield { _id: 'old-order-3', orderStatus: 'Shipped', createdAt: new Date('2026-11-12T10:00:00Z') };
        }
      }()),
    };
  };
  OrderCounter.updateOne = async (filter, update, options) => {
    assert.deepEqual(filter, { _id: 'order-number' });
    assert.equal(options.upsert, true);
    sequence = Math.max(sequence, update.$max.sequence);
  };
  OrderCounter.findOneAndUpdate = async () => ({ sequence: ++sequence });
  Order.updateOne = async (filter, update) => {
    updatedOrders.push({ filter, update });
  };
  Order.updateMany = async () => {};
  Order.createIndexes = async () => {};

  try {
    await initializeOrderNumbers();
    assert.equal(legacyFilter.orderNumber.$not.test('AS-00124'), true);
    assert.equal(legacyFilter.orderNumber.$not.test('#AS-20261113-1234'), false);
    assert.equal(updatedOrders[0].update.$set.orderNumber, 'AS-00125');
    assert.deepEqual(updatedOrders[0].filter, { _id: 'old-order-1', orderNumber: '#AS-20261113-1234' });
    assert.equal(updatedOrders[1].update.$set.orderNumber, 'AS-00126');
    assert.deepEqual(updatedOrders[1].filter, { _id: 'old-order-2', orderNumber: { $exists: false } });
    assert.deepEqual(updatedOrders[2].update.$set.trackingHistory[0], {
      status: 'Shipped',
      message: 'Existing order status recorded during tracking setup.',
      timestamp: new Date('2026-11-12T10:00:00Z'),
    });
  } finally {
    Order.aggregate = originalAggregate;
    Order.find = originalFind;
    Order.updateOne = originalUpdateOne;
    Order.updateMany = originalUpdateMany;
    Order.createIndexes = originalCreateIndexes;
    OrderCounter.updateOne = originalCounterUpdateOne;
    OrderCounter.findOneAndUpdate = originalCounterFindOneAndUpdate;
  }
});

test('checkout assigns the backend-generated order number and ignores a client-supplied value', async () => {
  const originalStartSession = mongoose.startSession;
  const originalProductFind = Product.find;
  const originalProductUpdateOne = Product.updateOne;
  const originalCounterFindOneAndUpdate = OrderCounter.findOneAndUpdate;
  const originalOrderSave = Order.prototype.save;
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  const customerId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const product = {
    _id: productId,
    name: 'Test product',
    price: 10,
    currency: 'ETB',
    stockQuantity: 4,
    image: '',
  };
  let savedOrder;

  mongoose.startSession = async () => session;
  Product.find = () => ({
    session: async (usedSession) => {
      assert.equal(usedSession, session);
      return [product];
    },
  });
  Product.updateOne = async (_filter, _update, options) => {
    assert.equal(options.session, session);
    return { matchedCount: 1 };
  };
  OrderCounter.findOneAndUpdate = async (_filter, _update, options) => {
    assert.equal(options.session, session);
    return { sequence: 125 };
  };
  Order.prototype.save = async function save(options) {
    assert.equal(options.session, session);
    this._id = new mongoose.Types.ObjectId();
    savedOrder = this;
    return this;
  };

  try {
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    await createOrder(
      {
        user: { _id: customerId, name: 'Test customer' },
        body: {
          orderNumber: 'AS-99999',
          orderItems: [{ product: productId.toString(), qty: 1 }],
          shippingAddress: {
            address: '1 Test Street',
            city: 'Test City',
            postalCode: '12345',
            country: 'Test Country',
          },
        },
      },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.orderNumber, 'AS-00125');
    assert.equal(savedOrder.orderNumber, 'AS-00125');
    assert.equal(response.body.paymentMethod, 'Cash on Delivery');
    assert.equal(response.body.paymentStatus, 'Pending');
    assert.equal(response.body.paymentAmount, response.body.totalPrice);
    assert.equal(response.body.paymentCurrency, 'ETB');
    assert.equal(response.body.isPaid, false);
  } finally {
    mongoose.startSession = originalStartSession;
    Product.find = originalProductFind;
    Product.updateOne = originalProductUpdateOne;
    OrderCounter.findOneAndUpdate = originalCounterFindOneAndUpdate;
    Order.prototype.save = originalOrderSave;
  }
});
