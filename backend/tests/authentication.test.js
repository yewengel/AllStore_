const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { customer } = require('../middleware/auth');
const { registerUser, loginUser } = require('../controllers/authController');

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

test('customer-only middleware rejects administrators and allows customer accounts', () => {
  const adminResponse = createResponse();
  let adminNextCalled = false;
  customer({ user: { role: 'admin' } }, adminResponse, () => { adminNextCalled = true; });
  assert.equal(adminResponse.statusCode, 403);
  assert.equal(adminNextCalled, false);

  const customerResponse = createResponse();
  let customerNextCalled = false;
  customer({ user: { role: 'customer' } }, customerResponse, () => { customerNextCalled = true; });
  assert.equal(customerNextCalled, true);
});

test('public registration creates customer-only accounts and never returns the password', async () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  const userId = '507f1f77bcf86cd799439011';
  let createdUser;
  process.env.JWT_SECRET = 'test-authentication-secret';
  User.findOne = async () => null;
  User.create = async (user) => {
    createdUser = user;
    return { ...user, _id: userId };
  };

  try {
    const response = createResponse();
    await registerUser(
      { body: { name: 'Test Customer', email: 'TEST@example.com', password: 'a-secure-test-password' } },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 201);
    assert.equal(createdUser.role, 'customer');
    assert.equal(createdUser.email, 'test@example.com');
    assert.equal(response.body.role, 'customer');
    assert.equal(Object.hasOwn(response.body, 'password'), false);
    assert.equal(jwt.verify(response.body.token, process.env.JWT_SECRET).id, userId);

    const adminRoleResponse = createResponse();
    await registerUser(
      {
        body: {
          name: 'Unauthorized Admin',
          email: 'admin@example.com',
          password: 'a-secure-test-password',
          role: 'admin',
        },
      },
      adminRoleResponse,
      (error) => { throw error; }
    );
    assert.equal(adminRoleResponse.statusCode, 400);
    assert.equal(createdUser.email, 'test@example.com');
  } finally {
    User.findOne = originalFindOne;
    User.create = originalCreate;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});

test('login normalizes email, compares the password, and returns no password field', async () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalFindOne = User.findOne;
  const userId = '507f1f77bcf86cd799439012';
  let capturedFilter;
  let comparedPassword;
  process.env.JWT_SECRET = 'test-authentication-secret';
  User.findOne = async (filter) => {
    capturedFilter = filter;
    return {
      _id: userId,
      name: 'Test Admin',
      email: 'admin@example.com',
      role: 'admin',
      password: 'stored-hash',
      matchPassword: async (password) => {
        comparedPassword = password;
        return password === 'a-secure-test-password';
      },
    };
  };

  try {
    const response = createResponse();
    await loginUser(
      { body: { email: ' ADMIN@example.com ', password: 'a-secure-test-password' } },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(capturedFilter, { email: 'admin@example.com' });
    assert.equal(comparedPassword, 'a-secure-test-password');
    assert.equal(response.body.role, 'admin');
    assert.equal(Object.hasOwn(response.body, 'password'), false);
    assert.equal(jwt.verify(response.body.token, process.env.JWT_SECRET).id, userId);

    const failedLoginResponse = createResponse();
    await loginUser(
      { body: { email: 'admin@example.com', password: 'wrong-password' } },
      failedLoginResponse,
      (error) => { throw error; }
    );
    assert.equal(failedLoginResponse.statusCode, 401);
  } finally {
    User.findOne = originalFindOne;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});
