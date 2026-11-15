const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/mockNotifications');
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const PaymentSetting = require('../models/PaymentSetting');
const {
  getPublicPaymentSettings,
  uploadBankTransferReceipt,
  reviewBankTransfer,
} = require('../controllers/paymentController');
const {
  getAdminPaymentSettings,
  createPaymentAccount,
} = require('../controllers/adminPaymentController');

const receiptDirectory = path.join(__dirname, '..', 'private', 'payment-receipts');
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

test('public payment settings expose only complete active account details', async () => {
  const originalReadyState = mongoose.connection.readyState;
  const originalFindOne = PaymentSetting.findOne;
  try {
    mongoose.connection.readyState = 1;
    PaymentSetting.findOne = () => ({
      lean: async () => ({
        accountsMigrated: true,
        accounts: [
          {
            _id: new mongoose.Types.ObjectId(),
            name: 'Store Bank',
            type: 'bank',
            provider: 'Test Bank',
            accountHolder: 'Store Owner',
            accountDetails: 'test-account-123',
            instructions: 'Use order number as reference.',
            active: true,
          },
          {
            _id: new mongoose.Types.ObjectId(),
            name: 'Inactive account',
            type: 'mobile-money',
            provider: 'Provider',
            accountHolder: 'Store Owner',
            accountDetails: 'inactive-account',
            active: false,
          },
          {
            _id: new mongoose.Types.ObjectId(),
            name: 'Incomplete account',
            type: 'bank',
            provider: '',
            accountHolder: 'Store Owner',
            accountDetails: 'incomplete-account',
            active: true,
          },
        ],
      }),
    });

    const response = createResponse();
    await getPublicPaymentSettings({}, response, (error) => { throw error; });

    assert.equal(response.body.currency, 'ETB');
    assert.equal(response.body.accounts.length, 1);
    assert.equal(response.body.accounts[0].name, 'Store Bank');
    assert.equal(response.body.accounts[0].accountDetails, 'test-account-123');
    assert.equal(JSON.stringify(response.body).includes('inactive-account'), false);
    assert.equal(JSON.stringify(response.body).includes('incomplete-account'), false);
    assert.equal(response.headers['Cache-Control'], 'no-store');
  } finally {
    mongoose.connection.readyState = originalReadyState;
    PaymentSetting.findOne = originalFindOne;
  }
});

test('Admin settings load configured accounts and reject incomplete active accounts', async () => {
  const originalReadyState = mongoose.connection.readyState;
  const originalFindOne = PaymentSetting.findOne;
  const accountId = new mongoose.Types.ObjectId();
  try {
    mongoose.connection.readyState = 1;
    PaymentSetting.findOne = () => ({
      lean: async () => ({
        accountsMigrated: true,
        accounts: [{
          _id: accountId,
          name: 'Store Bank',
          type: 'bank',
          provider: 'Test Bank',
          accountHolder: 'Store Owner',
          accountDetails: 'test-account-123',
          active: true,
        }],
      }),
    });

    const readResponse = createResponse();
    await getAdminPaymentSettings({}, readResponse, (error) => { throw error; });
    assert.equal(readResponse.body.accounts[0].id, accountId.toString());

    const writeResponse = createResponse();
    await createPaymentAccount({
      body: { name: 'Incomplete', type: 'bank', provider: '', active: true },
      user: { _id: new mongoose.Types.ObjectId() },
    }, writeResponse, (error) => { throw error; });
    assert.equal(writeResponse.statusCode, 400);
  } finally {
    mongoose.connection.readyState = originalReadyState;
    PaymentSetting.findOne = originalFindOne;
  }
});

test('Admin can persist an active store-owned account without environment credentials', async () => {
  const originalFindOne = PaymentSetting.findOne;
  const originalSave = PaymentSetting.prototype.save;
  try {
    PaymentSetting.findOne = async () => null;
    PaymentSetting.prototype.save = async function save() { return this; };

    const response = createResponse();
    await createPaymentAccount({
      body: {
        name: 'Store Mobile Money',
        type: 'mobile-money',
        provider: 'Test Provider',
        accountHolder: 'Store Owner',
        accountDetails: 'test-merchant-account',
        instructions: 'Use the order number.',
        active: true,
      },
      user: { _id: new mongoose.Types.ObjectId() },
    }, response, (error) => { throw error; });

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.accounts.length, 1);
    assert.equal(response.body.accounts[0].name, 'Store Mobile Money');
    assert.equal(response.body.accounts[0].active, true);
    assert.equal(response.body.accounts[0].accountDetails, 'test-merchant-account');
  } finally {
    PaymentSetting.findOne = originalFindOne;
    PaymentSetting.prototype.save = originalSave;
  }
});

test('receipt submission waits for verification and Admin approval is single-use', async () => {
  const originalFindOne = Order.findOne;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const orderId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const order = {
    _id: orderId,
    user: customerId,
    orderNumber: 'AS-00999',
    paymentAccountId: 'configured-account-id',
    paymentMethod: 'Store Bank',
    paymentStatus: 'Awaiting Payment',
    totalPrice: 42,
    paymentCurrency: 'ETB',
    isPaid: false,
    orderStatus: 'Pending',
    paymentHistory: [],
    save: async () => order,
  };
  Order.findOne = async () => order;
  Order.findOneAndUpdate = async (_filter, update) => {
    if (order.paymentStatus !== 'Pending Verification') return null;
    Object.assign(order, update.$set);
    order.paymentHistory.push(update.$push.paymentHistory);
    return order;
  };

  const receiptPaths = [];
  try {
    const uploadResponse = createResponse();
    await uploadBankTransferReceipt({
      params: { id: orderId.toString() },
      user: { _id: customerId },
      body: { transactionReference: 'TX-123' },
      file: {
        originalname: 'payment.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 manual payment proof'),
      },
    }, uploadResponse, (error) => { throw error; });

    assert.equal(uploadResponse.statusCode, 200);
    assert.equal(order.paymentStatus, 'Pending Verification');
    assert.equal(order.isPaid, false);
    assert.equal(order.paymentAmount, order.totalPrice);
    assert.equal(order.transactionReference, 'TX-123');
    const firstReceiptPath = path.join(receiptDirectory, order.paymentReceipt.storageKey);
    receiptPaths.push(firstReceiptPath);
    assert.equal((await fs.readFile(firstReceiptPath)).toString('ascii', 0, 4), '%PDF');
    assert.equal(order.paymentReceiptHistory.length, 1);

    order.paymentStatus = 'Rejected';
    const correctedUploadResponse = createResponse();
    await uploadBankTransferReceipt({
      params: { id: orderId.toString() },
      user: { _id: customerId },
      body: { transactionReference: 'TX-124' },
      file: {
        originalname: 'corrected-payment.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 corrected payment proof'),
      },
    }, correctedUploadResponse, (error) => { throw error; });
    const correctedReceiptPath = path.join(receiptDirectory, order.paymentReceipt.storageKey);
    receiptPaths.push(correctedReceiptPath);
    assert.equal(correctedUploadResponse.body.paymentStatus, 'Pending Verification');
    assert.equal(order.paymentReceiptHistory.length, 2);
    assert.equal((await fs.readFile(firstReceiptPath)).toString('ascii', 0, 4), '%PDF');

    const approvalResponse = createResponse();
    await reviewBankTransfer({
      params: { id: orderId.toString() },
      user: { _id: adminId },
      body: { decision: 'approve', note: 'Verified funds in merchant account.' },
    }, approvalResponse, (error) => { throw error; });

    assert.equal(approvalResponse.body.paymentStatus, 'Paid');
    assert.equal(approvalResponse.body.isPaid, true);
    assert.equal(order.paymentReviewedBy, adminId);
    assert.equal(order.orderStatus, 'Pending');

    const duplicateResponse = createResponse();
    await reviewBankTransfer({
      params: { id: orderId.toString() },
      user: { _id: adminId },
      body: { decision: 'approve', note: 'Duplicate confirmation.' },
    }, duplicateResponse, (error) => { throw error; });
    assert.equal(duplicateResponse.statusCode, 409);
  } finally {
    Order.findOne = originalFindOne;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
    await Promise.all(receiptPaths.map((receiptPath) => fs.unlink(receiptPath).catch(() => {})));
  }
});

test('Admin must provide a rejection reason and rejected orders retain proof eligibility', async () => {
  const originalFindOne = Order.findOne;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const orderId = new mongoose.Types.ObjectId();
  const order = {
    _id: orderId,
    user: new mongoose.Types.ObjectId(),
    paymentAccountId: 'configured-account-id',
    paymentStatus: 'Pending Verification',
    totalPrice: 42,
    paymentAmount: 42,
    paymentReceipt: { storageKey: 'receipt-key' },
    isPaid: false,
  };
  Order.findOne = async () => order;
  Order.findOneAndUpdate = async (_filter, update) => {
    Object.assign(order, update.$set);
    return order;
  };

  try {
    const missingReason = createResponse();
    await reviewBankTransfer({
      params: { id: orderId.toString() },
      body: { decision: 'reject', note: '  ' },
      user: { _id: new mongoose.Types.ObjectId() },
    }, missingReason, (error) => { throw error; });
    assert.equal(missingReason.statusCode, 400);

    const rejection = createResponse();
    await reviewBankTransfer({
      params: { id: orderId.toString() },
      body: { decision: 'reject', note: 'Amount is short.' },
      user: { _id: new mongoose.Types.ObjectId() },
    }, rejection, (error) => { throw error; });
    assert.equal(rejection.statusCode, 200);
    assert.equal(rejection.body.paymentStatus, 'Rejected');
    assert.equal(rejection.body.paymentReviewNote, 'Amount is short.');
  } finally {
    Order.findOne = originalFindOne;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
