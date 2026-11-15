const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/mockNotifications');
const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const OrderCounter = require('../models/OrderCounter');
const Product = require('../models/Product');
const PaymentSetting = require('../models/PaymentSetting');
const { createOrder } = require('../controllers/orderController');
const { initializeOrderNumbers, nextOrderNumber } = require('../utils/orderNumbers');

const configureBankPaymentForTest = () => {
  const originalReadyState = mongoose.connection.readyState;
  const originalFindOne = PaymentSetting.findOne;
  mongoose.connection.readyState = 1;
  PaymentSetting.findOne = () => ({
    lean: async () => ({
      disabledMethods: [],
      bankTransfer: { bankName: 'Test Bank', accountName: 'Test Store', accountNumber: 'test-account' },
    }),
  });
  return () => {
    mongoose.connection.readyState = originalReadyState;
    PaymentSetting.findOne = originalFindOne;
  };
};

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
  const restorePaymentSettings = configureBankPaymentForTest();
  const mongoClient = {};
  mongoClient.s = { sessionPool: { client: mongoClient } };
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
    client: mongoClient,
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
    this.$session(options.session);
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
          paymentMethod: 'Bank Transfer',
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
    assert.equal(response.body.paymentMethod, 'Bank Transfer');
    assert.equal(response.body.paymentStatus, 'Awaiting Payment');
    assert.equal(response.body.paymentAmount, response.body.totalPrice);
    assert.equal(response.body.paymentCurrency, 'ETB');
    assert.equal(response.body.isPaid, false);
    assert.doesNotThrow(() => JSON.stringify(response.body));
    assert.equal(JSON.stringify(response.body).includes('sessionPool'), false);
  } finally {
    mongoose.startSession = originalStartSession;
    Product.find = originalProductFind;
    Product.updateOne = originalProductUpdateOne;
    OrderCounter.findOneAndUpdate = originalCounterFindOneAndUpdate;
    Order.prototype.save = originalOrderSave;
    restorePaymentSettings();
  }
});

test('checkout retries with the same request key return the existing order without reserving stock again', async () => {
  const originalFindOne = Order.findOne;
  const originalStartSession = mongoose.startSession;
  const customerId = new mongoose.Types.ObjectId();
  const requestKey = 'checkout-retry-123';
  const orderId = new mongoose.Types.ObjectId(
    createHash('sha256')
      .update(`allstore-order:${customerId}:${requestKey}`)
      .digest('hex')
      .slice(0, 24)
  );
  const existingOrder = {
    _id: orderId,
    user: customerId,
    orderNumber: 'AS-00125',
    orderItems: [],
    items: [],
    subtotal: 0,
    shippingCost: 0,
    discountAmount: 0,
    totalPrice: 0,
    paymentAmount: 0,
    paymentCurrency: 'ETB',
    paymentStatus: 'Pending',
    paymentMethod: 'Cash on Delivery',
    orderStatus: 'Pending',
    toObject: () => ({ _id: orderId, orderNumber: 'AS-00125' }),
  };
  let capturedFilter;
  Order.findOne = async (filter) => {
    capturedFilter = filter;
    return existingOrder;
  };
  mongoose.startSession = async () => {
    throw new Error('A retry must not start another order transaction.');
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
      { user: { _id: customerId }, body: { checkoutRequestKey: requestKey } },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.orderNumber, existingOrder.orderNumber);
    assert.equal(capturedFilter._id.toString(), orderId.toString());
    assert.equal(capturedFilter.user.toString(), customerId.toString());
  } finally {
    Order.findOne = originalFindOne;
    mongoose.startSession = originalStartSession;
  }
});

test('checkout prices and reserves the selected variant from MongoDB data', async () => {
  const originalStartSession = mongoose.startSession;
  const originalProductFind = Product.find;
  const originalProductUpdateOne = Product.updateOne;
  const originalCounterFindOneAndUpdate = OrderCounter.findOneAndUpdate;
  const originalOrderSave = Order.prototype.save;
  const restorePaymentSettings = configureBankPaymentForTest();
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  const customerId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const variantId = new mongoose.Types.ObjectId();
  const product = {
    _id: productId,
    name: 'Canvas Backpack',
    price: 1200,
    currency: 'ETB',
    stockQuantity: 5,
    image: '/uploads/backpack.jpg',
    variants: [{
      _id: variantId,
      options: { Color: 'Navy', Size: 'Small' },
      price: 1300,
      stockQuantity: 2,
      sku: 'BAG-N-S',
      image: '/uploads/backpack-navy.jpg',
    }],
  };
  let savedOrder;
  let stockUpdate;
  let stockUpdateCount = 0;

  mongoose.startSession = async () => session;
  Product.find = () => ({
    session: async (usedSession) => {
      assert.equal(usedSession, session);
      return [product];
    },
  });
  Product.updateOne = async (filter, update, options) => {
    stockUpdate = { filter, update };
    stockUpdateCount += 1;
    assert.equal(options.session, session);
    return { matchedCount: 1 };
  };
  OrderCounter.findOneAndUpdate = async (_filter, _update, options) => {
    assert.equal(options.session, session);
    return { sequence: 126 };
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
          paymentMethod: 'Bank Transfer',
          orderItems: [{
            product: productId.toString(),
            variantId: variantId.toString(),
            options: { Color: 'Black', Size: 'Large' },
            price: 1,
            qty: 2,
          }],
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
    assert.equal(savedOrder.orderItems[0].price, 1300);
    assert.equal(savedOrder.orderItems[0].variantId.toString(), variantId.toString());
    assert.equal(savedOrder.orderItems[0].options.get('Color'), 'Navy');
    assert.equal(savedOrder.orderItems[0].variantSku, 'BAG-N-S');
    assert.equal(response.body.orderItems[0].options.Size, 'Small');
    assert.deepEqual(stockUpdate.update, {
      $inc: { 'variants.$.stockQuantity': -2, stockQuantity: -2 },
    });
    assert.equal(stockUpdate.filter.variants.$elemMatch._id, variantId.toString());
    assert.deepEqual(stockUpdate.filter.variants.$elemMatch, {
      _id: variantId.toString(),
      isAvailable: { $ne: false },
      stockQuantity: { $gte: 2 },
    });

    let missingVariantError;
    await createOrder(
      {
        user: { _id: customerId, name: 'Test customer' },
        body: {
          paymentMethod: 'Bank Transfer',
          orderItems: [{ product: productId.toString(), qty: 1 }],
          shippingAddress: {
            address: '1 Test Street',
            city: 'Test City',
            postalCode: '12345',
            country: 'Test Country',
          },
        },
      },
      {
        status() { return this; },
        json() { return this; },
      },
      (error) => { missingVariantError = error; }
    );
    assert.equal(missingVariantError.statusCode, 400);

    product.variants[0].isAvailable = false;
    let unavailableVariantError;
    await createOrder(
      {
        user: { _id: customerId, name: 'Test customer' },
        body: {
          paymentMethod: 'Bank Transfer',
          orderItems: [{ product: productId.toString(), variantId: variantId.toString(), qty: 1 }],
          shippingAddress: {
            address: '1 Test Street',
            city: 'Test City',
            postalCode: '12345',
            country: 'Test Country',
          },
        },
      },
      {
        status() { return this; },
        json() { return this; },
      },
      (error) => { unavailableVariantError = error; }
    );
    assert.equal(unavailableVariantError.statusCode, 400);
    assert.equal(stockUpdateCount, 1);
  } finally {
    mongoose.startSession = originalStartSession;
    Product.find = originalProductFind;
    Product.updateOne = originalProductUpdateOne;
    OrderCounter.findOneAndUpdate = originalCounterFindOneAndUpdate;
    Order.prototype.save = originalOrderSave;
    restorePaymentSettings();
  }
});

test('checkout rejects Cash on Delivery instead of creating an order', async () => {
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
    { user: { _id: new mongoose.Types.ObjectId() }, body: { paymentMethod: 'Cash on Delivery' } },
    response,
    (error) => { throw error; }
  );
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /supported payment method/);
});
