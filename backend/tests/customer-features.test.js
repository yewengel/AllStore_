const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Product = require('../models/Product');
const Notification = require('../models/Notification');
const {
  addWishlistItem,
  addRecentlyViewed,
  markNotificationRead,
} = require('../controllers/customerController');

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

const validId = '0123456789abcdef01234567';

test('wishlist additions verify the product and persist it using an idempotent add-to-set', async () => {
  const originalFindById = Product.findById;
  const originalUpdateOne = User.updateOne;
  let update;
  Product.findById = () => ({ select: async () => ({ _id: validId }) });
  User.updateOne = async (...args) => { update = args; };

  try {
    const response = createResponse();
    await addWishlistItem(
      { params: { productId: validId }, user: { _id: 'customer-id' } },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(update, [{ _id: 'customer-id' }, { $addToSet: { wishlist: validId } }]);
  } finally {
    Product.findById = originalFindById;
    User.updateOne = originalUpdateOne;
  }
});

test('recently viewed products are deduplicated and capped at twelve records', async () => {
  const originalFindById = Product.findById;
  const originalUserFindById = User.findById;
  Product.findById = () => ({ select: async () => ({ _id: validId }) });
  const viewed = Array.from({ length: 13 }, (_, index) => `product-${index}`);
  const user = {
    recentlyViewed: [validId, ...viewed],
    async save() {},
  };
  User.findById = async () => user;

  try {
    const response = createResponse();
    await addRecentlyViewed(
      { params: { productId: validId }, user: { _id: 'customer-id' } },
      response,
      (error) => { throw error; }
    );
    assert.equal(user.recentlyViewed.length, 12);
    assert.equal(String(user.recentlyViewed[0]), validId);
    assert.equal(user.recentlyViewed.filter((id) => String(id) === validId).length, 1);
  } finally {
    Product.findById = originalFindById;
    User.findById = originalUserFindById;
  }
});

test('notification reads are scoped to the requesting customer', async () => {
  const originalFindOneAndUpdate = Notification.findOneAndUpdate;
  let filter;
  Notification.findOneAndUpdate = async (value) => {
    filter = value;
    return null;
  };

  try {
    const response = createResponse();
    await markNotificationRead(
      { params: { id: validId }, user: { _id: 'customer-id' } },
      response,
      (error) => { throw error; }
    );
    assert.deepEqual(filter, { _id: validId, user: 'customer-id' });
    assert.equal(response.statusCode, 404);
  } finally {
    Notification.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
