const test = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../models/Order');
const Refund = require('../models/Refund');
const { calculateFinancialMetrics, getPeriodRange } = require('../utils/financialAnalytics');
const { getPaymentStats } = require('../controllers/adminPaymentController');
const { toEtb } = require('../utils/currency');

const now = new Date('2025-03-19T15:00:00.000Z');
const paidOrder = (id, fields = {}) => ({
  _id: id,
  paymentMethod: 'Bank Transfer',
  paymentAmount: 3000,
  paymentCurrency: 'ETB',
  paymentStatus: 'Paid',
  isPaid: true,
  orderStatus: 'Confirmed',
  paymentDate: '2025-03-19T10:00:00.000Z',
  createdAt: '2025-03-19T09:00:00.000Z',
  ...fields,
});
const refund = (id, orderId, fields = {}) => ({
  _id: id,
  order: orderId,
  amount: 1000,
  currency: 'ETB',
  status: 'Refunded',
  providerRefundReference: id,
  processedAt: '2025-03-19T12:00:00.000Z',
  ...fields,
});

test('net revenue counts verified payments, includes cancelled paid orders, and subtracts completed refunds once', () => {
  const result = calculateFinancialMetrics({
    period: 'all',
    now,
    orders: [paidOrder('paid-cancelled', { orderStatus: 'Cancelled' })],
    refunds: [
      refund('refund-1', 'paid-cancelled'),
      refund('refund-duplicate', 'paid-cancelled', { providerRefundReference: 'refund-1' }),
      refund('pending', 'paid-cancelled', { status: 'Processing', providerRefundReference: 'pending' }),
      refund('failed', 'paid-cancelled', { status: 'Failed', providerRefundReference: 'failed' }),
    ],
  });

  assert.equal(result.cards.totalSales, 3000);
  assert.equal(result.cards.totalRefunds, 1000);
  assert.equal(result.cards.totalRevenue, 2000);
  assert.equal(result.cards.totalOrders, 1);
  assert.equal(result.cards.paidOrders, 1);
});

test('failed and unverified payments are excluded and pending amount remains separate', () => {
  const result = calculateFinancialMetrics({
    period: 'all',
    now,
    orders: [
      paidOrder('unverified', { isPaid: false, paymentStatus: 'Awaiting Verification', paymentAmount: 2000 }),
      paidOrder('failed', { isPaid: false, paymentStatus: 'Failed', paymentAmount: 1500 }),
      paidOrder('unpaid', { isPaid: false, paymentStatus: 'Pending', paymentAmount: 1000 }),
      paidOrder('cancelled-unpaid', {
        isPaid: false,
        paymentStatus: 'Pending',
        paymentAmount: 800,
        orderStatus: 'Cancelled',
      }),
    ],
    refunds: [],
  });

  assert.equal(result.cards.totalSales, 0);
  assert.equal(result.cards.totalRevenue, 0);
  assert.equal(result.cards.pendingPayments, 3000);
  assert.equal(result.cards.pendingPaymentOrders, 2);
  assert.equal(result.cards.failedPayments, 1);
  assert.equal(result.cards.totalOrders, 4);
});

test('partial COD collections count only received cash and leave the outstanding balance pending', () => {
  const result = calculateFinancialMetrics({
    period: 'all',
    now,
    orders: [
      paidOrder('cod-partial', {
        paymentMethod: 'Cash on Delivery',
        paymentStatus: 'Pending',
        isPaid: false,
        paymentAmount: 1000,
        codCollectionStatus: 'Collected',
        codCollectedAmount: 400,
        codCollectedAt: '2025-03-19T11:00:00.000Z',
      }),
    ],
    refunds: [],
  });

  assert.equal(result.cards.totalSales, 400);
  assert.equal(result.cards.paidOrders, 0);
  assert.equal(result.cards.successfulPayments, 1);
  assert.equal(result.cards.pendingPayments, 600);
  assert.equal(result.cards.codAwaitingCollection, 600);
});

test('date filters use payment and refund completion dates independently', () => {
  const result = calculateFinancialMetrics({
    period: 'today',
    now,
    orders: [
      paidOrder('older-payment', { paymentDate: '2025-03-01T10:00:00.000Z' }),
      paidOrder('missing-date', { paymentDate: undefined, paidAt: undefined }),
    ],
    refunds: [refund('refund-today', 'older-payment')],
  });

  assert.equal(result.cards.totalSales, 0);
  assert.equal(result.cards.totalRefunds, 1000);
  assert.equal(result.cards.totalRevenue, -1000);
});

test('period comparisons use payment and refund event dates rather than order creation dates', () => {
  const result = calculateFinancialMetrics({
    period: 'today',
    now,
    orders: [
      paidOrder('previous-day', { paymentAmount: 1000, paymentDate: '2025-03-18T10:00:00.000Z' }),
      paidOrder('today', { paymentAmount: 2000, createdAt: '2025-03-01T10:00:00.000Z' }),
    ],
    refunds: [],
  });

  assert.equal(result.cards.totalRevenue, 2000);
  assert.equal(result.previousRevenue, 1000);
  assert.equal(result.change, 100);
});

test('refund totals are capped at actual payments and support partial refunds', () => {
  const result = calculateFinancialMetrics({
    period: 'all',
    now,
    orders: [paidOrder('partial', { paymentAmount: 3000 })],
    refunds: [
      refund('refund-a', 'partial', { amount: 1000 }),
      refund('refund-b', 'partial', { amount: 2500 }),
    ],
  });

  assert.equal(result.cards.totalSales, 3000);
  assert.equal(result.cards.totalRefunds, 3000);
  assert.equal(result.cards.totalRevenue, 0);
});

test('all-time metrics include paid records without timestamps and normalize currencies to ETB', () => {
  const result = calculateFinancialMetrics({
    period: 'all',
    now,
    orders: [paidOrder('usd', { paymentAmount: 10, paymentCurrency: 'USD', paymentDate: undefined })],
    refunds: [],
  });

  assert.equal(result.cards.totalSales, toEtb(10, 'USD'));
  assert.equal(result.cards.paidOrders, 1);
});

test('period ranges cover UTC today, week, month, year, and all time', () => {
  assert.deepEqual(getPeriodRange('today', now), {
    start: Date.UTC(2025, 2, 19),
    end: Date.UTC(2025, 2, 20),
  });
  assert.deepEqual(getPeriodRange('week', now), {
    start: Date.UTC(2025, 2, 17),
    end: Date.UTC(2025, 2, 24),
  });
  assert.deepEqual(getPeriodRange('month', now), {
    start: Date.UTC(2025, 2, 1),
    end: Date.UTC(2025, 3, 1),
  });
  assert.deepEqual(getPeriodRange('year', now), {
    start: Date.UTC(2025, 0, 1),
    end: Date.UTC(2026, 0, 1),
  });
  assert.deepEqual(getPeriodRange('all', now), { start: null, end: null });
});

test('admin payment statistics endpoint returns backend sales, net revenue, refund, and pending totals', async () => {
  const originalOrderAggregate = Order.aggregate;
  const originalRefundAggregate = Refund.aggregate;
  const originalOrderFind = Order.find;
  const orders = [
    paidOrder('cancelled-paid', { orderStatus: 'Cancelled' }),
    paidOrder('pending', { isPaid: false, paymentStatus: 'Awaiting Verification', paymentAmount: 500 }),
  ];
  const refunds = [refund('completed', 'cancelled-paid', { amount: 1000 })];
  Order.aggregate = async () => orders;
  Refund.aggregate = async () => refunds;
  Order.find = () => ({
    populate() { return this; },
    sort() { return this; },
    limit() { return this; },
    then(resolve, reject) { return Promise.resolve([]).then(resolve, reject); },
  });

  try {
    const response = {
      body: undefined,
      json(body) {
        this.body = body;
        return this;
      },
    };
    await getPaymentStats({ query: { period: 'all' } }, response, (error) => { throw error; });
    assert.equal(response.body.currency, 'ETB');
    assert.equal(response.body.cards.totalSales, 3000);
    assert.equal(response.body.cards.totalRefunds, 1000);
    assert.equal(response.body.cards.totalRevenue, 2000);
    assert.equal(response.body.cards.pendingPayments, 500);
    assert.equal(response.body.cards.totalOrders, 2);
    assert.equal(response.body.cards.paidOrders, 1);
  } finally {
    Order.aggregate = originalOrderAggregate;
    Refund.aggregate = originalRefundAggregate;
    Order.find = originalOrderFind;
  }
});
