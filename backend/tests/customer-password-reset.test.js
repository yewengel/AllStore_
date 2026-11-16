const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const PasswordReset = require('../models/AdminPasswordReset');
const {
  requestCustomerPasswordReset,
  verifyCustomerPasswordResetCode,
  resetCustomerPassword,
} = require('../controllers/customerPasswordResetController');
const { loginUser } = require('../controllers/authController');

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

const setEnvironment = (values) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return () => Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
};

const codeHash = (userId, code) => crypto
  .createHmac('sha256', process.env.JWT_SECRET)
  .update(`allstore:verification-code:${userId}:${code}`)
  .digest('hex');

test('customer reset sends a generic request response and emails only a hashed six-digit code', async () => {
  const restoreEnvironment = setEnvironment({
    JWT_SECRET: 'customer-reset-test-secret',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'smtp-test-user',
    SMTP_PASS: 'smtp-test-password',
    SMTP_FROM: 'AllStore <no-reply@example.test>',
  });
  const originals = {
    findUser: User.findOne,
    findOneAndUpdate: PasswordReset.findOneAndUpdate,
    create: PasswordReset.create,
    updateOne: PasswordReset.updateOne,
    createTransport: nodemailer.createTransport,
  };
  const user = { _id: 'customer-user-id', email: 'customer@example.test', role: 'customer' };
  let userFilter;
  let mail;
  let savedUpdate;
  User.findOne = async (filter) => { userFilter = filter; return user; };
  PasswordReset.findOneAndUpdate = async () => null;
  PasswordReset.create = async (entry) => entry;
  PasswordReset.updateOne = async (_filter, update) => {
    savedUpdate = update;
    return { matchedCount: 1 };
  };
  nodemailer.createTransport = () => ({
    sendMail: async (message) => { mail = message; return { accepted: [message.to] }; },
  });

  try {
    const response = createResponse();
    await requestCustomerPasswordReset({
      body: { email: ' CUSTOMER@example.test ' },
    }, response, (error) => { throw error; });

    const issuedCode = mail.text.match(/code is: (\d{6})/)[1];
    assert.equal(response.statusCode, 200);
    assert.match(response.body.message, /If a customer account exists/);
    assert.deepEqual(userFilter, { email: 'customer@example.test', role: 'customer' });
    assert.match(mail.subject, /customer password reset/i);
    assert.match(mail.text, /expires in 10 minutes/i);
    assert.match(savedUpdate.$set.codeHash, /^[a-f0-9]{64}$/);
    assert.equal(savedUpdate.$set.codeHash, codeHash(user._id, issuedCode));
    assert.equal(JSON.stringify(response.body).includes(issuedCode), false);
  } finally {
    User.findOne = originals.findUser;
    PasswordReset.findOneAndUpdate = originals.findOneAndUpdate;
    PasswordReset.create = originals.create;
    PasswordReset.updateOne = originals.updateOne;
    nodemailer.createTransport = originals.createTransport;
    restoreEnvironment();
  }
});

test('admin and unknown accounts cannot use the customer reset flow', async () => {
  const originals = {
    findUser: User.findOne,
    findReset: PasswordReset.findOne,
    updateReset: PasswordReset.findOneAndUpdate,
  };
  let userFilter;
  User.findOne = async (filter) => { userFilter = filter; return null; };
  PasswordReset.findOne = () => { throw new Error('No reset record should be read for a non-customer.'); };
  PasswordReset.findOneAndUpdate = () => { throw new Error('No reset should be consumed for a non-customer.'); };

  try {
    const requestResponse = createResponse();
    await requestCustomerPasswordReset({
      body: { email: 'admin@example.test' },
    }, requestResponse, (error) => { throw error; });
    assert.equal(requestResponse.statusCode, 200);
    assert.match(requestResponse.body.message, /If a customer account exists/);
    assert.deepEqual(userFilter, { email: 'admin@example.test', role: 'customer' });

    const verifyResponse = createResponse();
    await verifyCustomerPasswordResetCode({
      body: { email: 'admin@example.test', code: '123456' },
    }, verifyResponse, (error) => { throw error; });
    assert.equal(verifyResponse.statusCode, 400);

    const resetResponse = createResponse();
    await resetCustomerPassword({
      body: {
        email: 'admin@example.test',
        resetToken: 'a'.repeat(64),
        newPassword: 'new-customer-password',
      },
    }, resetResponse, (error) => { throw error; });
    assert.equal(resetResponse.statusCode, 400);
  } finally {
    User.findOne = originals.findUser;
    PasswordReset.findOne = originals.findReset;
    PasswordReset.findOneAndUpdate = originals.updateReset;
  }
});

test('customer verification rejects expired codes and locks after five incorrect attempts', async () => {
  const restoreEnvironment = setEnvironment({ JWT_SECRET: 'customer-reset-test-secret' });
  const originals = {
    findUser: User.findOne,
    findReset: PasswordReset.findOne,
    findOneAndUpdate: PasswordReset.findOneAndUpdate,
    updateOne: PasswordReset.updateOne,
  };
  const user = { _id: 'customer-user-id' };
  const reset = {
    _id: 'customer-reset-id',
    state: 'pending',
    codeHash: '0'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    attempts: 0,
  };
  User.findOne = async () => user;
  PasswordReset.findOne = () => ({ select: async () => reset });
  PasswordReset.findOneAndUpdate = async (_filter, update) => {
    reset.attempts += update.$inc.attempts;
    return reset;
  };
  PasswordReset.updateOne = async (_filter, update) => {
    Object.assign(reset, update.$set);
    return { matchedCount: 1 };
  };

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = createResponse();
      await verifyCustomerPasswordResetCode({
        body: { email: 'customer@example.test', code: '123456' },
      }, response, (error) => { throw error; });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(reset.attempts, 5);
    assert.equal(reset.state, 'locked');

    const expiredReset = {
      ...reset,
      state: 'pending',
      codeHash: '0'.repeat(64),
      expiresAt: new Date(Date.now() - 1),
      attempts: 0,
    };
    PasswordReset.findOne = () => ({ select: async () => expiredReset });
    const expiredResponse = createResponse();
    await verifyCustomerPasswordResetCode({
      body: { email: 'customer@example.test', code: '123456' },
    }, expiredResponse, (error) => { throw error; });
    assert.equal(expiredResponse.statusCode, 400);
  } finally {
    User.findOne = originals.findUser;
    PasswordReset.findOne = originals.findReset;
    PasswordReset.findOneAndUpdate = originals.findOneAndUpdate;
    PasswordReset.updateOne = originals.updateOne;
    restoreEnvironment();
  }
});

test('customer resend cooldown suppresses a duplicate code email', async () => {
  const restoreEnvironment = setEnvironment({ JWT_SECRET: 'customer-reset-test-secret' });
  const originals = {
    findUser: User.findOne,
    findOneAndUpdate: PasswordReset.findOneAndUpdate,
    create: PasswordReset.create,
    createTransport: nodemailer.createTransport,
  };
  User.findOne = async () => ({ _id: 'customer-user-id', role: 'customer' });
  PasswordReset.findOneAndUpdate = async () => null;
  PasswordReset.create = async () => { throw Object.assign(new Error('duplicate key'), { code: 11000 }); };
  nodemailer.createTransport = () => { throw new Error('SMTP should not be called during cooldown.'); };

  try {
    const response = createResponse();
    await requestCustomerPasswordReset({
      body: { email: 'customer@example.test' },
    }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 200);
    assert.match(response.body.message, /If a customer account exists/);
  } finally {
    User.findOne = originals.findUser;
    PasswordReset.findOneAndUpdate = originals.findOneAndUpdate;
    PasswordReset.create = originals.create;
    nodemailer.createTransport = originals.createTransport;
    restoreEnvironment();
  }
});

test('customer can reset password once and sign in with the new password', async () => {
  const restoreEnvironment = setEnvironment({ JWT_SECRET: 'customer-reset-test-secret' });
  const originals = {
    findUser: User.findOne,
    findReset: PasswordReset.findOne,
    findOneAndUpdate: PasswordReset.findOneAndUpdate,
    deleteOne: PasswordReset.deleteOne,
  };
  const user = {
    _id: 'customer-user-id',
    name: 'Test Customer',
    email: 'customer@example.test',
    role: 'customer',
    password: 'old-password-hash',
    async save() { this.password = await bcrypt.hash(this.password, 10); },
    async matchPassword(value) { return bcrypt.compare(value, this.password); },
  };
  const reset = {
    _id: 'customer-reset-id',
    state: 'pending',
    codeHash: codeHash(user._id, '084215'),
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
  };
  let deleteCount = 0;
  User.findOne = async () => user;
  PasswordReset.findOne = () => ({ select: async () => reset });
  PasswordReset.findOneAndUpdate = async (_filter, update) => {
    Object.assign(reset, update.$set);
    return reset;
  };
  PasswordReset.deleteOne = async () => { deleteCount += 1; return { deletedCount: 1 }; };

  try {
    const verifyResponse = createResponse();
    await verifyCustomerPasswordResetCode({
      body: { email: user.email, code: '084215' },
    }, verifyResponse, (error) => { throw error; });
    assert.equal(verifyResponse.statusCode, 200);
    assert.equal(reset.state, 'verified');
    assert.equal(reset.codeHash, null);

    const reuseResponse = createResponse();
    await verifyCustomerPasswordResetCode({
      body: { email: user.email, code: '084215' },
    }, reuseResponse, (error) => { throw error; });
    assert.equal(reuseResponse.statusCode, 400);

    const resetResponse = createResponse();
    await resetCustomerPassword({
      body: {
        email: user.email,
        resetToken: verifyResponse.body.resetToken,
        newPassword: 'customer-new-password',
      },
    }, resetResponse, (error) => { throw error; });
    assert.equal(resetResponse.statusCode, 200);
    assert.equal(deleteCount, 1);
    assert.equal(await user.matchPassword('customer-new-password'), true);

    const loginResponse = createResponse();
    await loginUser({
      body: { email: user.email, password: 'customer-new-password' },
    }, loginResponse, (error) => { throw error; });
    assert.equal(loginResponse.statusCode, 200);
    assert.equal(loginResponse.body.role, 'customer');
    assert.equal(Object.hasOwn(loginResponse.body, 'password'), false);
  } finally {
    User.findOne = originals.findUser;
    PasswordReset.findOne = originals.findReset;
    PasswordReset.findOneAndUpdate = originals.findOneAndUpdate;
    PasswordReset.deleteOne = originals.deleteOne;
    restoreEnvironment();
  }
});
