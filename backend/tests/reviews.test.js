const test = require('node:test');
const assert = require('node:assert/strict');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Review = require('../models/Review');
const {
  createProductReview,
  getProductReviews,
} = require('../controllers/reviewController');
const { getProductById: fetchProduct } = require('../controllers/productController');

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

test('review submission requires a delivered order belonging to the customer and containing the product', async () => {
  const originalProductExists = Product.exists;
  const originalOrderExists = Order.exists;
  const originalCreate = Review.create;
  let capturedOrderFilter;
  let created = false;
  Product.exists = async () => ({ _id: validId });
  Order.exists = async (filter) => {
    capturedOrderFilter = filter;
    return null;
  };
  Review.create = async () => {
    created = true;
  };

  try {
    const response = createResponse();
    await createProductReview(
      {
        params: { productId: validId },
        user: { _id: validId },
        body: { orderId: validId, rating: 5, body: 'Excellent quality' },
      },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 403);
    assert.equal(created, false);
    assert.equal(capturedOrderFilter.user, validId);
    assert.equal(capturedOrderFilter.orderStatus, 'Delivered');
    assert.equal(capturedOrderFilter.$or.length, 2);
  } finally {
    Product.exists = originalProductExists;
    Order.exists = originalOrderExists;
    Review.create = originalCreate;
  }
});

test('review submission rejects a duplicate review for the same purchase', async () => {
  const originalProductExists = Product.exists;
  const originalOrderExists = Order.exists;
  const originalCreate = Review.create;
  Product.exists = async () => ({ _id: validId });
  Order.exists = async () => ({ _id: validId });
  Review.create = async () => {
    const error = new Error('duplicate');
    error.code = 11000;
    throw error;
  };

  try {
    const response = createResponse();
    await createProductReview(
      {
        params: { productId: validId },
        user: { _id: validId },
        body: { orderId: validId, rating: 4, body: 'Good product' },
      },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /already reviewed/i);
  } finally {
    Product.exists = originalProductExists;
    Order.exists = originalOrderExists;
    Review.create = originalCreate;
  }
});

test('public product review summary includes approved review text and aggregate counts', async () => {
  const originalExists = Product.exists;
  const originalFind = Review.find;
  const originalAggregate = Review.aggregate;
  Product.exists = async () => ({ _id: validId });
  Review.find = () => ({
    populate() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean: async () => [{
      _id: 'review-id',
      rating: 4,
      body: 'Works well',
      user: { name: 'Customer' },
      createdAt: new Date('2026-10-01T00:00:00Z'),
    }],
  });
  Review.aggregate = async () => [{ count: 1, averageRating: 4 }];

  try {
    const response = createResponse();
    await getProductReviews({ params: { productId: validId } }, response, (error) => { throw error; });
    assert.equal(response.body.reviewCount, 1);
    assert.equal(response.body.averageRating, 4);
    assert.equal(response.body.reviews[0].body, 'Works well');
    assert.equal(response.body.reviews[0].customerName, 'Customer');
  } finally {
    Product.exists = originalExists;
    Review.find = originalFind;
    Review.aggregate = originalAggregate;
  }
});

test('invalid product IDs resolve to a not-found response', async () => {
  const originalFindById = Product.findById;
  Product.findById = () => {
    throw new Error('Should not query MongoDB with an invalid ID');
  };
  try {
    const response = createResponse();
    await fetchProduct({ params: { id: 'not-an-object-id' } }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.message, 'Product not found');
  } finally {
    Product.findById = originalFindById;
  }
});
