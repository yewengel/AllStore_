const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/mockNotifications');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Refund = require('../models/Refund');
const {
  reviewRefund,
  processRefund,
  completeRefund,
} = require('../controllers/adminPaymentController');

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

const populateQuery = (value) => ({
  populate() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

test('approving an automatic cancellation refund moves it to Pending and saves the admin explanation', async () => {
  const originalFindOne = Refund.findOne;
  const originalFindOneAndUpdate = Refund.findOneAndUpdate;
  const refund = {
    _id: new mongoose.Types.ObjectId(),
    order: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    status: 'Refund Required',
    refundNumber: 'RF-00001',
    amount: 25,
    originalAmount: 25,
    currency: 'ETB',
    history: [],
  };
  let capturedFilter;
  let capturedUpdate;
  Refund.findOne = async () => refund;
  Refund.findOneAndUpdate = (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    Object.assign(refund, update.$set);
    refund.history.push(update.$push.history);
    return populateQuery(refund);
  };

  try {
    const response = createResponse();
    await reviewRefund(
      {
        params: { id: refund._id.toString() },
        body: { decision: 'approve', note: 'Verified payment and cancellation.' },
        user: { _id: new mongoose.Types.ObjectId(), role: 'admin' },
      },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.body.status, 'Pending');
    assert.equal(capturedFilter.status, 'Refund Required');
    assert.equal(capturedUpdate.$set.customerMessage, 'Verified payment and cancellation.');
    assert.equal(refund.history.at(-1).status, 'Pending');
  } finally {
    Refund.findOne = originalFindOne;
    Refund.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('manual refund processing remains Processing and does not change order payment until completion', async () => {
  const originalFindOne = Refund.findOne;
  const originalFindOneAndUpdate = Refund.findOneAndUpdate;
  const originalFindById = Refund.findById;
  const originalOrderFindById = Order.findById;
  const refund = {
    _id: new mongoose.Types.ObjectId(),
    order: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    status: 'Pending',
    refundNumber: 'RF-00002',
    amount: 45,
    originalAmount: 45,
    currency: 'ETB',
    paymentMethod: 'Bank Transfer',
    history: [],
  };
  Refund.findOne = async () => refund;
  Refund.findOneAndUpdate = async (_filter, update) => {
    Object.assign(refund, update.$set);
    refund.history.push(update.$push.history);
    return refund;
  };
  Refund.findById = () => populateQuery(refund);
  Order.findById = () => { throw new Error('Manual processing must not mark the original order as refunded.'); };

  try {
    const response = createResponse();
    await processRefund(
      {
        params: { id: refund._id.toString() },
        body: { providerReference: 'BANK-RETURN-REF-2', customerMessage: 'We are processing your bank transfer.' },
        user: { _id: new mongoose.Types.ObjectId(), role: 'admin' },
      },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.body.status, 'Processing');
    assert.equal(response.body.providerRefundReference, 'BANK-RETURN-REF-2');
    assert.equal(refund.status, 'Processing');
    assert.equal(refund.order, response.body.orderId);

    const invalidCompletion = createResponse();
    await completeRefund(
      { params: { id: refund._id.toString() }, body: { providerReference: 'BANK-RETURN-REF-2' } },
      invalidCompletion,
      (error) => { throw error; }
    );
    assert.equal(invalidCompletion.statusCode, 400);
    assert.equal(refund.status, 'Processing');
  } finally {
    Refund.findOne = originalFindOne;
    Refund.findOneAndUpdate = originalFindOneAndUpdate;
    Refund.findById = originalFindById;
    Order.findById = originalOrderFindById;
  }
});

test('refund completion updates order payment once and requires actual payout confirmation', async () => {
  const originalStartSession = mongoose.startSession;
  const originalRefundFindOne = Refund.findOne;
  const originalRefundFindById = Refund.findById;
  const originalRefundSave = Refund.prototype.save;
  const originalOrderFindById = Order.findById;
  const refund = {
    _id: new mongoose.Types.ObjectId(),
    order: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    status: 'Processing',
    refundNumber: 'RF-00003',
    amount: 50,
    originalAmount: 50,
    currency: 'ETB',
    paymentMethod: 'Bank Transfer',
    history: [],
    save: async () => refund,
  };
  const order = {
    _id: refund.order,
    isPaid: true,
    paymentStatus: 'Paid',
    paymentAmount: 50,
    totalPrice: 50,
    currency: 'ETB',
    refundedAmount: 0,
    paymentHistory: [],
    save: async () => order,
  };
  const session = {
    withTransaction: async (operation) => operation(),
    endSession: async () => {},
  };
  mongoose.startSession = async () => session;
  Refund.findOne = (filter) => ({
    session: async () => filter.status === refund.status ? refund : null,
  });
  Refund.findById = () => populateQuery(refund);
  Refund.prototype.save = async function save() { return this; };
  Order.findById = () => ({ session: async () => order });

  try {
    const response = createResponse();
    await completeRefund(
      {
        params: { id: refund._id.toString() },
        body: { providerReference: 'BANK-SETTLED-3', note: 'Transfer completed.', confirmedPaid: true },
        user: { _id: new mongoose.Types.ObjectId(), role: 'admin' },
      },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.body.status, 'Refunded');
    assert.equal(order.refundedAmount, 50);
    assert.equal(order.paymentStatus, 'Refunded');
    assert.equal(refund.providerRefundReference, 'BANK-SETTLED-3');

    let duplicateError;
    await completeRefund(
      {
        params: { id: refund._id.toString() },
        body: { providerReference: 'BANK-SETTLED-3', confirmedPaid: true },
        user: { _id: new mongoose.Types.ObjectId(), role: 'admin' },
      },
      createResponse(),
      (error) => { duplicateError = error; }
    );
    assert.equal(duplicateError.statusCode, 409);
    assert.equal(order.refundedAmount, 50);
  } finally {
    mongoose.startSession = originalStartSession;
    Refund.findOne = originalRefundFindOne;
    Refund.findById = originalRefundFindById;
    Refund.prototype.save = originalRefundSave;
    Order.findById = originalOrderFindById;
  }
});
