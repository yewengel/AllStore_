const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const {
  getPaymentConfig,
  initializeChapaPayment,
  updateChapaPaymentFromProvider,
  handleChapaWebhook,
  uploadBankTransferReceipt,
  reviewBankTransfer,
} = require('../controllers/paymentController');
const { getPaymentConfiguration } = require('../utils/chapa');

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
  setHeader(name, value) {
    this.headers[name] = value;
  },
});

const setChapaEnvironment = () => {
  const keys = ['CHAPA_MODE', 'CHAPA_SECRET_KEY', 'CHAPA_WEBHOOK_SECRET', 'API_PUBLIC_URL', 'CLIENT_URL'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.CHAPA_MODE = 'test';
  process.env.CHAPA_SECRET_KEY = 'CHASECK_TEST-test-only-key';
  process.env.CHAPA_WEBHOOK_SECRET = 'test-only-webhook-secret';
  process.env.API_PUBLIC_URL = 'https://payments.example.test';
  process.env.CLIENT_URL = 'https://allstore.example.test';
  return () => keys.forEach((key) => {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  });
};

test('payment configuration never exposes secrets and disables incomplete gateway setup', async () => {
  const restore = setChapaEnvironment();
  const originalWebhookSecret = process.env.CHAPA_WEBHOOK_SECRET;
  try {
    delete process.env.CHAPA_WEBHOOK_SECRET;
    const config = getPaymentConfiguration();
    assert.equal(config.chapa.configured, false);
    assert.match(config.chapa.message, /CHAPA_WEBHOOK_SECRET/);
    const response = createResponse();
    await getPaymentConfig({}, response, (error) => { throw error; });
    assert.equal(Object.hasOwn(response.body.chapa, 'secretKey'), false);
    assert.equal(Object.hasOwn(response.body.chapa, 'webhookSecret'), false);
  } finally {
    if (originalWebhookSecret === undefined) delete process.env.CHAPA_WEBHOOK_SECRET;
    else process.env.CHAPA_WEBHOOK_SECRET = originalWebhookSecret;
    restore();
  }
});

test('Chapa initialization uses server-held credentials and returns only the secure checkout URL', async () => {
  const restore = setChapaEnvironment();
  const originalFindOne = Order.findOne;
  const originalFetch = global.fetch;
  const orderId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const order = {
    _id: orderId,
    orderNumber: 'AS-00125',
    paymentMethod: 'Chapa Checkout',
    paymentStatus: 'Pending',
    paymentAmount: 125.5,
    paymentCurrency: 'ETB',
    transactionReference: 'AS-PAY-test-ref',
    isPaid: false,
    save: async () => order,
  };
  let request;
  Order.findOne = () => ({ select: async () => order });
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ status: 'success', data: { checkout_url: 'https://checkout.chapa.co/checkout/payment/test' } }) };
  };

  try {
    const response = createResponse();
    await initializeChapaPayment(
      { params: { id: orderId.toString() }, user: { _id: customerId, name: 'Test Customer', email: 'customer@example.test' } },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.checkoutUrl, 'https://checkout.chapa.co/checkout/payment/test');
    assert.equal(request.url, 'https://api.chapa.co/v1/transaction/initialize');
    assert.equal(request.options.headers.Authorization, 'Bearer CHASECK_TEST-test-only-key');
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.amount, '125.50');
    assert.equal(payload.currency, 'ETB');
    assert.equal(payload.tx_ref, order.transactionReference);
    assert.equal(payload.callback_url, 'https://payments.example.test/api/payments/chapa/callback');
    assert.equal(order.paymentCheckoutUrl, response.body.checkoutUrl);
  } finally {
    Order.findOne = originalFindOne;
    global.fetch = originalFetch;
    restore();
  }
});

test('Chapa checkout cannot be initialized for a cancelled order', async () => {
  const restore = setChapaEnvironment();
  const originalFindOne = Order.findOne;
  const originalFetch = global.fetch;
  Order.findOne = () => ({
    select: async () => ({
      orderStatus: 'Cancelled',
      paymentStatus: 'Pending',
      isPaid: false,
    }),
  });
  global.fetch = async () => {
    throw new Error('Chapa must not be called for a cancelled order.');
  };

  try {
    const response = createResponse();
    await initializeChapaPayment(
      { params: { id: new mongoose.Types.ObjectId().toString() }, user: { _id: new mongoose.Types.ObjectId() } },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /cancelled order/);
  } finally {
    Order.findOne = originalFindOne;
    global.fetch = originalFetch;
    restore();
  }
});

test('Chapa verification marks a matching payment paid exactly once', async () => {
  const restore = setChapaEnvironment();
  const originalFindOne = Order.findOne;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const originalFindById = Order.findById;
  const originalFetch = global.fetch;
  const orderId = new mongoose.Types.ObjectId();
  const order = {
    _id: orderId,
    orderNumber: 'AS-00126',
    paymentMethod: 'Chapa Checkout',
    paymentStatus: 'Pending',
    paymentAmount: 50,
    paymentCurrency: 'ETB',
    transactionReference: 'AS-PAY-success',
    orderStatus: 'Processing',
    isPaid: false,
  };
  let calls = 0;
  Order.findOne = async () => order;
  Order.findOneAndUpdate = async (_filter, update) => {
    calls += 1;
    Object.assign(order, update.$set);
    return order;
  };
  Order.findById = async () => order;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      status: 'success',
      data: {
        tx_ref: order.transactionReference,
        status: 'success',
        amount: '50.00',
        currency: 'ETB',
        reference: 'CHAPA-REF-1',
        payment_method: 'telebirr',
      },
    }),
  });

  try {
    const result = await updateChapaPaymentFromProvider(order.transactionReference);
    assert.equal(result.order.isPaid, true);
    assert.equal(order.paymentStatus, 'Paid');
    assert.equal(order.paymentGatewayReference, 'CHAPA-REF-1');
    assert.equal(order.paymentChannel, 'telebirr');
    const duplicate = await updateChapaPaymentFromProvider(order.transactionReference);
    assert.equal(duplicate.alreadyProcessed, true);
    assert.equal(calls, 1);
  } finally {
    Order.findOne = originalFindOne;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
    Order.findById = originalFindById;
    global.fetch = originalFetch;
    restore();
  }
});

test('failed and cancelled Chapa transactions do not mark orders paid', async (t) => {
  for (const [providerStatus, expectedStatus] of [['failed', 'Failed'], ['cancelled', 'Cancelled']]) {
    await t.test(providerStatus, async () => {
      const restore = setChapaEnvironment();
      const originalFindOne = Order.findOne;
      const originalFindOneAndUpdate = Order.findOneAndUpdate;
      const originalFetch = global.fetch;
      const order = {
        _id: new mongoose.Types.ObjectId(),
        paymentMethod: 'Chapa Checkout',
        paymentStatus: 'Pending',
        paymentAmount: 75,
        paymentCurrency: 'ETB',
        transactionReference: `AS-PAY-${providerStatus}`,
        orderStatus: 'Pending',
        isPaid: false,
      };
      Order.findOne = async () => order;
      Order.findOneAndUpdate = async (_filter, update) => {
        Object.assign(order, update.$set);
        return order;
      };
      global.fetch = async () => ({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            tx_ref: order.transactionReference,
            status: providerStatus,
            amount: '75.00',
            currency: 'ETB',
          },
        }),
      });

      try {
        const result = await updateChapaPaymentFromProvider(order.transactionReference);
        assert.equal(result.order.isPaid, false);
        assert.equal(order.paymentStatus, expectedStatus);
      } finally {
        Order.findOne = originalFindOne;
        Order.findOneAndUpdate = originalFindOneAndUpdate;
        global.fetch = originalFetch;
        restore();
      }
    });
  }
});

test('a mismatched verified amount cannot mark a Chapa order paid', async () => {
  const restore = setChapaEnvironment();
  const originalFindOne = Order.findOne;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const originalFetch = global.fetch;
  const order = {
    _id: new mongoose.Types.ObjectId(),
    paymentMethod: 'Chapa Checkout',
    paymentStatus: 'Pending',
    paymentAmount: 125,
    paymentCurrency: 'ETB',
    transactionReference: 'AS-PAY-wrong-amount',
    isPaid: false,
  };
  let updates = 0;
  Order.findOne = async () => order;
  Order.findOneAndUpdate = async () => {
    updates += 1;
    return order;
  };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      status: 'success',
      data: { tx_ref: order.transactionReference, status: 'success', amount: '124.00', currency: 'ETB' },
    }),
  });

  try {
    await assert.rejects(updateChapaPaymentFromProvider(order.transactionReference), /amount does not match/);
    assert.equal(updates, 0);
    assert.equal(order.isPaid, false);
  } finally {
    Order.findOne = originalFindOne;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
    global.fetch = originalFetch;
    restore();
  }
});

test('pending Chapa verification remains pending and does not change paid state', async () => {
  const restore = setChapaEnvironment();
  const originalFindOne = Order.findOne;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const originalFetch = global.fetch;
  const order = {
    _id: new mongoose.Types.ObjectId(),
    paymentMethod: 'Chapa Checkout',
    paymentStatus: 'Pending',
    paymentAmount: 18,
    paymentCurrency: 'ETB',
    transactionReference: 'AS-PAY-pending',
    isPaid: false,
  };
  let updates = 0;
  Order.findOne = async () => order;
  Order.findOneAndUpdate = async () => {
    updates += 1;
    return order;
  };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      status: 'success',
      data: { tx_ref: order.transactionReference, status: 'pending', amount: '18.00', currency: 'ETB' },
    }),
  });

  try {
    const result = await updateChapaPaymentFromProvider(order.transactionReference);
    assert.equal(result.pending, true);
    assert.equal(order.paymentStatus, 'Pending');
    assert.equal(order.isPaid, false);
    assert.equal(updates, 0);
  } finally {
    Order.findOne = originalFindOne;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
    global.fetch = originalFetch;
    restore();
  }
});

test('signed Chapa webhook is verified through the API and duplicate delivery is idempotent', async () => {
  const restore = setChapaEnvironment();
  const originalFindOne = Order.findOne;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const originalFindById = Order.findById;
  const originalFetch = global.fetch;
  const order = {
    _id: new mongoose.Types.ObjectId(),
    orderNumber: 'AS-00128',
    paymentMethod: 'Chapa Checkout',
    paymentStatus: 'Pending',
    paymentAmount: 24,
    paymentCurrency: 'ETB',
    transactionReference: 'AS-PAY-webhook',
    orderStatus: 'Pending',
    isPaid: false,
  };
  const event = { event: 'charge.success', tx_ref: order.transactionReference, status: 'success' };
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = crypto.createHmac('sha256', process.env.CHAPA_WEBHOOK_SECRET).update(rawBody).digest('hex');
  let providerCalls = 0;
  Order.findOne = async () => order;
  Order.findOneAndUpdate = async (_filter, update) => {
    Object.assign(order, update.$set);
    return order;
  };
  Order.findById = async () => order;
  global.fetch = async () => {
    providerCalls += 1;
    return {
      ok: true,
      json: async () => ({
        status: 'success',
        data: { tx_ref: order.transactionReference, status: 'success', amount: '24.00', currency: 'ETB' },
      }),
    };
  };

  try {
    const invokeWebhook = async () => {
      const response = createResponse();
      await handleChapaWebhook(
        {
          body: rawBody,
          get: (name) => name.toLowerCase() === 'x-chapa-signature' ? signature : undefined,
        },
        response
      );
      return response;
    };
    const first = await invokeWebhook();
    const duplicate = await invokeWebhook();
    assert.equal(first.statusCode, 200);
    assert.equal(duplicate.statusCode, 200);
    assert.equal(order.paymentStatus, 'Paid');
    assert.equal(providerCalls, 1);
  } finally {
    Order.findOne = originalFindOne;
    Order.findOneAndUpdate = originalFindOneAndUpdate;
    Order.findById = originalFindById;
    global.fetch = originalFetch;
    restore();
  }
});

test('bank transfer receipt upload stores a private verified file and enters pending verification', async () => {
  const originalFindOne = Order.findOne;
  const order = {
    _id: new mongoose.Types.ObjectId(),
    totalPrice: 42,
    paymentMethod: 'Bank Transfer',
    paymentStatus: 'Pending',
    paymentCurrency: 'ETB',
    isPaid: false,
    save: async () => order,
  };
  Order.findOne = async () => order;
  const response = createResponse();

  try {
    await uploadBankTransferReceipt(
      {
        params: { id: order._id.toString() },
        user: { _id: new mongoose.Types.ObjectId() },
        file: {
          originalname: 'transfer.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 test receipt'),
        },
      },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(order.paymentStatus, 'Pending Verification');
    assert.equal(order.paymentAmount, 42);
    assert.equal(response.body.paymentReceipt.originalName, 'transfer.pdf');
    const savedPath = path.join(receiptDirectory, order.paymentReceipt.storageKey);
    assert.equal((await fs.readFile(savedPath)).toString('ascii', 0, 4), '%PDF');
    await fs.unlink(savedPath);
  } finally {
    Order.findOne = originalFindOne;
  }
});

test('admin approval and rejection update bank transfer payment without changing order status', async (t) => {
  for (const [decision, expectedStatus, expectedPaid] of [
    ['approve', 'Paid', true],
    ['reject', 'Rejected', false],
  ]) {
    await t.test(decision, async () => {
      const originalFindOne = Order.findOne;
      const originalFindOneAndUpdate = Order.findOneAndUpdate;
      const order = {
        _id: new mongoose.Types.ObjectId(),
        orderNumber: 'AS-00127',
        paymentMethod: 'Bank Transfer',
        paymentStatus: 'Pending Verification',
        paymentReceipt: { storageKey: 'receipt-key' },
        orderStatus: 'Processing',
        isPaid: false,
      };
      let capturedUpdate;
      Order.findOne = async () => order;
      Order.findOneAndUpdate = async (_filter, update) => {
        capturedUpdate = update;
        Object.assign(order, update.$set);
        return order;
      };

      try {
        const response = createResponse();
        await reviewBankTransfer(
          {
            params: { id: order._id.toString() },
            user: { _id: new mongoose.Types.ObjectId() },
            body: { decision, note: 'Reviewed receipt.' },
          },
          response,
          (error) => { throw error; }
        );
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.paymentStatus, expectedStatus);
        assert.equal(response.body.isPaid, expectedPaid);
        assert.equal(order.orderStatus, 'Processing');
        assert.equal(capturedUpdate.$set.paymentReviewNote, 'Reviewed receipt.');
      } finally {
        Order.findOne = originalFindOne;
        Order.findOneAndUpdate = originalFindOneAndUpdate;
      }
    });
  }
});
