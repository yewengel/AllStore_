const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const AdminPasswordReset = require('../models/AdminPasswordReset');
const {
  requestAdminPasswordReset,
  verifyAdminPasswordResetCode,
  resetAdminPassword,
} = require('../controllers/adminPasswordResetController');
const { loginUser } = require('../controllers/authController');
const { createRateLimiter } = require('../middleware/rateLimit');

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
});

const setEnvironment = (values) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return () => Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
};

const codeHash = (userId, code, secret = process.env.JWT_SECRET) => crypto
  .createHmac('sha256', secret)
  .update(`allstore:verification-code:${userId}:${code}`)
  .digest('hex');

test('admin reset request sends a random code by SMTP and stores only its hash', async () => {
  const restoreEnvironment = setEnvironment({
    JWT_SECRET: 'test-password-reset-secret',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'smtp-test-user',
    SMTP_PASS: 'smtp-test-password',
    SMTP_FROM: 'AllStore <no-reply@example.test>',
  });
  const originals = {
    findUser: User.findOne,
    findOneAndUpdate: AdminPasswordReset.findOneAndUpdate,
    create: AdminPasswordReset.create,
    updateOne: AdminPasswordReset.updateOne,
    createTransport: nodemailer.createTransport,
  };
  const user = { _id: 'admin-user-id', email: 'admin@example.test', name: 'Store Admin' };
  let userFilter;
  let email;
  let savedUpdate;
  User.findOne = async (filter) => { userFilter = filter; return user; };
  AdminPasswordReset.findOneAndUpdate = async () => null;
  AdminPasswordReset.create = async (entry) => entry;
  AdminPasswordReset.updateOne = async (_filter, update) => {
    savedUpdate = update;
    return { matchedCount: 1 };
  };
  nodemailer.createTransport = (options) => ({
    sendMail: async (message) => {
      email = { options, message };
      return { accepted: [message.to] };
    },
  });

  try {
    const response = createResponse();
    await requestAdminPasswordReset({ body: { email: ' ADMIN@example.test ' } }, response, (error) => { throw error; });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(userFilter, { email: 'admin@example.test', role: 'admin' });
    assert.match(email.message.text, /Your verification code is: \d{6}/);
    assert.match(email.message.text, /expires in 10 minutes/i);
    assert.match(email.message.text, /ignore this email/i);
    assert.equal(email.options.host, 'smtp.example.test');
    assert.equal(email.options.secure, false);
    const issuedCode = email.message.text.match(/code is: (\d{6})/)[1];
    assert.match(savedUpdate.$set.codeHash, /^[a-f0-9]{64}$/);
    assert.equal(savedUpdate.$set.codeHash, codeHash(user._id, issuedCode));
    assert.equal(JSON.stringify(response.body).includes(issuedCode), false);
    assert.equal(JSON.stringify(response.body).includes(savedUpdate.$set.codeHash), false);
  } finally {
    User.findOne = originals.findUser;
    AdminPasswordReset.findOneAndUpdate = originals.findOneAndUpdate;
    AdminPasswordReset.create = originals.create;
    AdminPasswordReset.updateOne = originals.updateOne;
    nodemailer.createTransport = originals.createTransport;
    restoreEnvironment();
  }
});

test('customer and unknown accounts receive the same generic request response and cannot verify/reset', async () => {
  const originalFindUser = User.findOne;
  const originalResetFind = AdminPasswordReset.findOne;
  const originalResetUpdate = AdminPasswordReset.findOneAndUpdate;
  let filter;
  User.findOne = async (query) => { filter = query; return null; };
  AdminPasswordReset.findOne = () => { throw new Error('No reset record should be read for a non-admin.'); };
  AdminPasswordReset.findOneAndUpdate = () => { throw new Error('No reset should be consumed for a non-admin.'); };
  try {
    const requestResponse = createResponse();
    await requestAdminPasswordReset({ body: { email: 'customer@example.test' } }, requestResponse, (error) => { throw error; });
    assert.equal(requestResponse.statusCode, 200);
    assert.match(requestResponse.body.message, /If an administrator account exists/);
    assert.deepEqual(filter, { email: 'customer@example.test', role: 'admin' });

    const verifyResponse = createResponse();
    await verifyAdminPasswordResetCode({
      body: { email: 'customer@example.test', code: '123456' },
    }, verifyResponse, (error) => { throw error; });
    assert.equal(verifyResponse.statusCode, 400);

    const resetResponse = createResponse();
    await resetAdminPassword({
      body: {
        email: 'customer@example.test',
        resetToken: 'a'.repeat(64),
        newPassword: 'new-secure-password',
      },
    }, resetResponse, (error) => { throw error; });
    assert.equal(resetResponse.statusCode, 400);
  } finally {
    User.findOne = originalFindUser;
    AdminPasswordReset.findOne = originalResetFind;
    AdminPasswordReset.findOneAndUpdate = originalResetUpdate;
  }
});

test('incorrect codes lock after five attempts and expired codes cannot be verified', async () => {
  const restoreEnvironment = setEnvironment({ JWT_SECRET: 'test-password-reset-secret' });
  const originalFindUser = User.findOne;
  const originalResetFind = AdminPasswordReset.findOne;
  const originalResetUpdate = AdminPasswordReset.findOneAndUpdate;
  const originalUpdateOne = AdminPasswordReset.updateOne;
  const user = { _id: 'reset-admin-id' };
  const reset = {
    _id: 'reset-document-id',
    state: 'pending',
    codeHash: '0'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    attempts: 0,
  };
  User.findOne = async () => user;
  AdminPasswordReset.findOne = () => ({ select: async () => reset });
  AdminPasswordReset.findOneAndUpdate = async (_filter, update) => {
    reset.attempts += update.$inc.attempts;
    return reset;
  };
  AdminPasswordReset.updateOne = async (_filter, update) => {
    Object.assign(reset, update.$set);
    return { matchedCount: 1 };
  };

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = createResponse();
      await verifyAdminPasswordResetCode({
        body: { email: 'admin@example.test', code: '123456' },
      }, response, (error) => { throw error; });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(reset.attempts, 5);
    assert.equal(reset.state, 'locked');
    assert.equal(reset.codeHash, null);

    const expired = { ...reset, state: 'pending', codeHash: '0'.repeat(64), expiresAt: new Date(Date.now() - 1), attempts: 0 };
    AdminPasswordReset.findOne = () => ({ select: async () => expired });
    const expiredResponse = createResponse();
    await verifyAdminPasswordResetCode({
      body: { email: 'admin@example.test', code: '123456' },
    }, expiredResponse, (error) => { throw error; });
    assert.equal(expiredResponse.statusCode, 400);
  } finally {
    User.findOne = originalFindUser;
    AdminPasswordReset.findOne = originalResetFind;
    AdminPasswordReset.findOneAndUpdate = originalResetUpdate;
    AdminPasswordReset.updateOne = originalUpdateOne;
    restoreEnvironment();
  }
});

test('resend cooldown prevents a second email from being sent', async () => {
  const restoreEnvironment = setEnvironment({
    JWT_SECRET: 'test-password-reset-secret',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'smtp-test-user',
    SMTP_PASS: 'smtp-test-password',
    SMTP_FROM: 'AllStore <no-reply@example.test>',
  });
  const originalFindUser = User.findOne;
  const originalFindOneAndUpdate = AdminPasswordReset.findOneAndUpdate;
  const originalCreate = AdminPasswordReset.create;
  const originalTransport = nodemailer.createTransport;
  User.findOne = async () => ({ _id: 'admin-user-id', email: 'admin@example.test' });
  AdminPasswordReset.findOneAndUpdate = async () => null;
  AdminPasswordReset.create = async () => { throw Object.assign(new Error('duplicate key'), { code: 11000 }); };
  nodemailer.createTransport = () => { throw new Error('SMTP should not be called during cooldown.'); };
  try {
    const response = createResponse();
    await requestAdminPasswordReset({ body: { email: 'admin@example.test' } }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 200);
    assert.match(response.body.message, /If an administrator account exists/);
  } finally {
    User.findOne = originalFindUser;
    AdminPasswordReset.findOneAndUpdate = originalFindOneAndUpdate;
    AdminPasswordReset.create = originalCreate;
    nodemailer.createTransport = originalTransport;
    restoreEnvironment();
  }
});

test('verified code resets the admin password once and the new password authenticates', async () => {
  const restoreEnvironment = setEnvironment({ JWT_SECRET: 'test-password-reset-secret' });
  const originals = {
    findUser: User.findOne,
    resetFind: AdminPasswordReset.findOne,
    resetFindOneAndUpdate: AdminPasswordReset.findOneAndUpdate,
    deleteOne: AdminPasswordReset.deleteOne,
  };
  const user = {
    _id: 'admin-user-id',
    name: 'Store Admin',
    email: 'admin@example.test',
    role: 'admin',
    password: 'old-password-hash',
    async save() { this.password = await bcrypt.hash(this.password, 10); },
    async matchPassword(password) { return bcrypt.compare(password, this.password); },
  };
  const reset = {
    _id: 'reset-document-id',
    state: 'pending',
    codeHash: codeHash(user._id, '032941'),
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
    resetTokenHash: null,
  };
  let deleteCount = 0;
  User.findOne = async () => user;
  AdminPasswordReset.findOne = () => ({ select: async () => reset });
  AdminPasswordReset.findOneAndUpdate = async (_filter, update) => {
    Object.assign(reset, update.$set);
    return reset;
  };
  AdminPasswordReset.deleteOne = async () => { deleteCount += 1; return { deletedCount: 1 }; };

  try {
    const verifyResponse = createResponse();
    await verifyAdminPasswordResetCode({
      body: { email: user.email, code: '032941' },
    }, verifyResponse, (error) => { throw error; });
    assert.equal(verifyResponse.statusCode, 200);
    assert.equal(reset.state, 'verified');
    assert.equal(reset.codeHash, null);
    assert.equal(typeof verifyResponse.body.resetToken, 'string');

    const resetResponse = createResponse();
    await resetAdminPassword({
      body: {
        email: user.email,
        resetToken: verifyResponse.body.resetToken,
        newPassword: 'new-admin-password',
      },
    }, resetResponse, (error) => { throw error; });
    assert.equal(resetResponse.statusCode, 200);
    assert.equal(deleteCount, 1);
    assert.equal(await user.matchPassword('new-admin-password'), true);

    const loginResponse = createResponse();
    await loginUser({
      body: { email: user.email, password: 'new-admin-password' },
    }, loginResponse, (error) => { throw error; });
    assert.equal(loginResponse.statusCode, 200);
    assert.equal(loginResponse.body.role, 'admin');
    assert.equal(Object.hasOwn(loginResponse.body, 'password'), false);
  } finally {
    User.findOne = originals.findUser;
    AdminPasswordReset.findOne = originals.resetFind;
    AdminPasswordReset.findOneAndUpdate = originals.resetFindOneAndUpdate;
    AdminPasswordReset.deleteOne = originals.deleteOne;
    restoreEnvironment();
  }
});

test('rate limiter rejects requests after the configured limit', () => {
  const limit = createRateLimiter({ windowMs: 60_000, max: 1, message: 'Too many requests.' });
  let nextCalled = 0;
  const req = { ip: '192.0.2.10', socket: { remoteAddress: '192.0.2.10' } };
  limit(req, createResponse(), () => { nextCalled += 1; });

  const response = createResponse();
  limit(req, response, () => { nextCalled += 1; });
  assert.equal(nextCalled, 1);
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['Retry-After'] !== undefined, true);
});
