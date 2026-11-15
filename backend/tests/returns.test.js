const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/mockNotifications');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Refund = require('../models/Refund');
const ReturnRequest = require('../models/ReturnRequest');
const User = require('../models/User');
const returnRoutes = require('../routes/returnRoutes');
const {
  createReturnRequest,
  updateReturnRequest,
  getReturnPhoto,
} = require('../controllers/returnController');

const createResponse = () => ({
  statusCode: 200,
  body: undefined,
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  set(name, value) {
    this.headers[name] = value;
    return this;
  },
  sendFile() {},
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

test('customers can only request a return for their own delivered order', async () => {
  const originalFindOne = Order.findOne;
  const originalExists = ReturnRequest.exists;
  const originalCreate = ReturnRequest.create;
  const orderId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const order = {
    _id: orderId,
    user: customerId,
    orderStatus: 'Delivered',
    orderItems: [{ product: new mongoose.Types.ObjectId(), name: 'Desk lamp', qty: 1 }],
  };
  let capturedFilter;
  let created;
  Order.findOne = async (filter) => {
    capturedFilter = filter;
    return order;
  };
  ReturnRequest.exists = async () => false;
  ReturnRequest.create = async (document) => {
    created = document;
    return { ...document, _id: new mongoose.Types.ObjectId() };
  };

  try {
    const response = createResponse();
    await createReturnRequest(
      {
        body: { orderId: orderId.toString(), reason: 'Item arrived damaged', details: 'The outer box was torn.' },
        files: [],
        user: { _id: customerId, role: 'customer' },
      },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.statusCode, 201);
    assert.equal(capturedFilter._id, orderId.toString());
    assert.equal(capturedFilter.user, customerId);
    assert.equal(created.status, 'Return Requested');
    assert.equal(created.reason, 'Item arrived damaged');
    assert.equal(created.items[0].name, 'Desk lamp');
  } finally {
    Order.findOne = originalFindOne;
    ReturnRequest.exists = originalExists;
    ReturnRequest.create = originalCreate;
  }
});

test('return stock is restored once, only when an inspected item is marked resale-eligible', async () => {
  const originalStartSession = mongoose.startSession;
  const originalReturnFindById = ReturnRequest.findById;
  const originalProductFindById = Product.findById;
  const requestId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const request = {
    _id: requestId,
    order: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    status: 'Return in Progress',
    items: [{ product: productId, name: 'Desk lamp', qty: 2 }],
    history: [],
    save: async () => request,
  };
  const product = {
    _id: productId,
    stockQuantity: 3,
    save: async () => product,
  };
  let productLookups = 0;
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  ReturnRequest.findById = () => ({ session: async () => request });
  Product.findById = () => {
    productLookups += 1;
    return { session: async () => product };
  };
  mongoose.startSession = async () => session;

  try {
    const response = createResponse();
    await updateReturnRequest(
      {
        params: { id: requestId.toString() },
        body: { status: 'Item Received', receivedCondition: 'Like New', restockable: true, response: 'Inspected and resellable.' },
        user: { _id: new mongoose.Types.ObjectId(), role: 'admin' },
      },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(product.stockQuantity, 5);
    assert.equal(request.stockRestoredAt instanceof Date, true);

    await updateReturnRequest(
      {
        params: { id: requestId.toString() },
        body: { status: 'Item Received', receivedCondition: 'Like New', restockable: true, response: 'Inspected again.' },
        user: { _id: new mongoose.Types.ObjectId(), role: 'admin' },
      },
      createResponse(),
      (error) => { throw error; }
    );
    assert.equal(product.stockQuantity, 5);
    assert.equal(productLookups, 1);
  } finally {
    mongoose.startSession = originalStartSession;
    ReturnRequest.findById = originalReturnFindById;
    Product.findById = originalProductFindById;
  }
});

test('return photos are hidden from customers who do not own the order', async () => {
  const originalFindById = ReturnRequest.findById;
  const ownerId = new mongoose.Types.ObjectId();
  ReturnRequest.findById = () => ({ select: async () => ({
    user: ownerId,
    photos: { id: () => { throw new Error('Photo lookup must not run for another customer.'); } },
  }) });

  try {
    const response = createResponse();
    let passedError;
    await getReturnPhoto(
      {
        params: { id: new mongoose.Types.ObjectId().toString(), photoId: new mongoose.Types.ObjectId().toString() },
        user: { _id: new mongoose.Types.ObjectId(), role: 'customer' },
      },
      response,
      (error) => { passedError = error; }
    );
    assert.equal(response.statusCode, 404);
  } finally {
    ReturnRequest.findById = originalFindById;
  }
});

test('return refund processing requires a linked refund record', async () => {
  const originalStartSession = mongoose.startSession;
  const originalReturnFindById = ReturnRequest.findById;
  const originalRefundFindOne = Refund.findOne;
  const request = {
    _id: new mongoose.Types.ObjectId(),
    status: 'Item Received',
    history: [],
    save: async () => request,
  };
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  ReturnRequest.findById = () => ({ session: async () => request });
  Refund.findOne = () => ({ session: async () => null });
  mongoose.startSession = async () => session;

  try {
    const response = createResponse();
    let passedError;
    await updateReturnRequest(
      {
        params: { id: request._id.toString() },
        body: { status: 'Refund Processing', response: 'Refund started.' },
        user: { _id: new mongoose.Types.ObjectId(), role: 'admin' },
      },
      response,
      (error) => { passedError = error; }
    );
    assert.equal(passedError.statusCode, 409);
    assert.equal(request.status, 'Item Received');
  } finally {
    mongoose.startSession = originalStartSession;
    ReturnRequest.findById = originalReturnFindById;
    Refund.findOne = originalRefundFindOne;
  }
});

test('customers cannot access or mutate the admin return queue', async () => {
  const originalFindById = User.findById;
  const originalJwtSecret = process.env.JWT_SECRET;
  const userId = new mongoose.Types.ObjectId();
  const token = jwt.sign({ id: userId.toString() }, 'return-route-test-secret');
  const customer = { _id: userId, role: 'customer' };
  User.findById = () => ({ select: async () => customer });
  process.env.JWT_SECRET = 'return-route-test-secret';
  const app = express();
  app.use(express.json());
  app.use('/api/returns', returnRoutes);

  try {
    await withServer(app, async (baseUrl) => {
      const listResponse = await fetch(`${baseUrl}/api/returns`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(listResponse.status, 403);

      const updateResponse = await fetch(`${baseUrl}/api/returns/${new mongoose.Types.ObjectId()}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Approved' }),
      });
      assert.equal(updateResponse.status, 403);
    });
  } finally {
    User.findById = originalFindById;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});
