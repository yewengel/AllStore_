const { toEtb, roundCurrency } = require('./currency');

const PERIOD_ALIASES = {
  daily: 'today',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
  'all-time': 'all',
};

const normalizePeriod = (period) => {
  const normalized = PERIOD_ALIASES[period] || period;
  return ['today', 'week', 'month', 'year', 'all'].includes(normalized) ? normalized : 'month';
};

const getPeriodRange = (period, now = new Date()) => {
  const key = normalizePeriod(period);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const dayStart = Date.UTC(year, month, now.getUTCDate());

  if (key === 'all') return { start: null, end: null };
  if (key === 'today') return { start: dayStart, end: dayStart + 86400000 };
  if (key === 'week') {
    const mondayOffset = (new Date(dayStart).getUTCDay() + 6) % 7;
    const start = dayStart - mondayOffset * 86400000;
    return { start, end: start + 7 * 86400000 };
  }
  if (key === 'month') {
    return { start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1) };
  }
  return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) };
};

const getPreviousPeriodRange = (period, now = new Date()) => {
  const key = normalizePeriod(period);
  const current = getPeriodRange(key, now);
  if (key === 'all') return null;
  if (key === 'today' || key === 'week') {
    const duration = current.end - current.start;
    return { start: current.start - duration, end: current.start };
  }
  if (key === 'month') {
    const previousStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    return { start: previousStart, end: current.start };
  }
  const previousStart = Date.UTC(now.getUTCFullYear() - 1, 0, 1);
  return { start: previousStart, end: current.start };
};

const toTimestamp = (value) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isInRange = (value, range) => {
  if (range.start === null && range.end === null) return true;
  const timestamp = toTimestamp(value);
  return timestamp !== null && (range.start === null || timestamp >= range.start) &&
    (range.end === null || timestamp < range.end);
};

const paymentDate = (order) => order.paymentDate || order.paidAt || order.codCollectedAt || null;

const paymentAmountEtb = (amount, currency) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return 0;
  return toEtb(numericAmount, currency || 'ETB');
};

const isSuccessfulPayment = (order) => {
  if (order.paymentMethod === 'Cash on Delivery' &&
      order.codCollectionStatus === 'Collected' &&
      Number(order.codCollectedAmount) > 0) {
    return true;
  }
  const status = String(order.paymentStatus || '').toLowerCase();
  if (['failed', 'rejected', 'cancelled', 'unpaid', 'pending', 'processing', 'pending verification', 'awaiting verification'].includes(status)) {
    return false;
  }
  if (order.isPaid === true) return true;
  return false;
};

const orderAmountEtb = (order) => paymentAmountEtb(
  order.paymentAmount ?? order.totalPrice,
  order.paymentCurrency || order.currency || 'ETB'
);

const receivedAmountEtb = (order) => {
  if (order.paymentMethod === 'Cash on Delivery' &&
      order.codCollectionStatus === 'Collected' &&
      order.codCollectedAmount !== undefined &&
      order.codCollectedAmount !== null) {
    return paymentAmountEtb(order.codCollectedAmount, order.paymentCurrency || order.currency || 'ETB');
  }
  return orderAmountEtb(order);
};

const pendingStatuses = new Set(['Pending', 'Awaiting Payment', 'Processing', 'Pending Verification', 'Awaiting Verification', 'Unpaid']);

const pendingAmountEtb = (order) => {
  const due = orderAmountEtb(order);
  const collected = order.paymentMethod === 'Cash on Delivery' &&
    order.codCollectionStatus === 'Collected'
    ? paymentAmountEtb(order.codCollectedAmount, order.paymentCurrency || order.currency || 'ETB')
    : 0;
  return roundCurrency(Math.max(0, due - collected));
};

const createTrendBuckets = (period, now = new Date(), orders = [], refunds = []) => {
  const key = normalizePeriod(period);
  const buckets = [];
  const add = (start, end, label) => buckets.push({ start, end, label, revenue: 0, count: 0, orders: 0 });

  if (key === 'today') {
    const dayStart = getPeriodRange(key, now).start;
    for (let hour = 0; hour < 24; hour += 1) {
      const start = dayStart + hour * 3600000;
      add(start, start + 3600000, new Date(start).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' }));
    }
  } else if (key === 'week') {
    const { start } = getPeriodRange(key, now);
    for (let day = 0; day < 7; day += 1) {
      const bucketStart = start + day * 86400000;
      add(bucketStart, bucketStart + 86400000, new Date(bucketStart).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }));
    }
  } else if (key === 'month') {
    const { start, end } = getPeriodRange(key, now);
    for (let bucketStart = start; bucketStart < end; bucketStart += 86400000) {
      add(bucketStart, Math.min(bucketStart + 86400000, end), new Date(bucketStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
    }
  } else if (key === 'year') {
    for (let month = 0; month < 12; month += 1) {
      const bucketStart = Date.UTC(now.getUTCFullYear(), month, 1);
      add(bucketStart, Date.UTC(now.getUTCFullYear(), month + 1, 1), new Date(bucketStart).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }));
    }
  } else {
    const eventYears = [
      ...orders.flatMap((order) => [paymentDate(order), order.createdAt]),
      ...refunds.map((refund) => refund.processedAt),
    ]
      .map(toTimestamp)
      .filter((timestamp) => timestamp !== null)
      .map((timestamp) => new Date(timestamp).getUTCFullYear());
    const firstYear = eventYears.reduce((earliest, year) => Math.min(earliest, year), now.getUTCFullYear());
    for (let year = firstYear; year <= now.getUTCFullYear(); year += 1) {
      add(
        Date.UTC(year, 0, 1),
        Date.UTC(year + 1, 0, 1),
        String(year)
      );
    }
  }
  return buckets;
};

const calculateFinancialMetrics = ({ orders, refunds, period = 'month', now = new Date() }) => {
  const selectedPeriod = normalizePeriod(period);
  const range = getPeriodRange(selectedPeriod, now);
  const previousRange = getPreviousPeriodRange(selectedPeriod, now);
  const receivedOrders = orders.filter(isSuccessfulPayment);
  const paidByOrder = new Map();
  const methodTotals = new Map();
  const buckets = createTrendBuckets(selectedPeriod, now, orders, refunds);
  let periodSales = 0;
  let previousSales = 0;
  let successfulPaymentCount = 0;
  let paidOrders = 0;

  receivedOrders.forEach((order) => {
    const amount = receivedAmountEtb(order);
    if (amount <= 0) return;
    const id = String(order._id);
    paidByOrder.set(id, (paidByOrder.get(id) || 0) + amount);

    const date = paymentDate(order);
    if (isInRange(date, range)) {
      periodSales += amount;
      successfulPaymentCount += 1;
      if (order.isPaid === true) paidOrders += 1;

      const methodKey = `${order.paymentMethod || 'Unknown'}\u0000${order.paymentChannel || ''}`;
      const method = methodTotals.get(methodKey) || {
        method: order.paymentMethod || 'Unknown',
        channel: order.paymentChannel || '',
        count: 0,
        amount: 0,
      };
      method.count += 1;
      method.amount += amount;
      methodTotals.set(methodKey, method);

      const timestamp = toTimestamp(date);
      const bucket = buckets.find((item) => timestamp >= item.start && timestamp < item.end);
      if (bucket) {
        bucket.revenue += amount;
        bucket.count += 1;
      }
    }
    if (previousRange && isInRange(date, previousRange)) {
      previousSales += amount;
    }
  });

  const uniqueRefunds = new Map();
  refunds
    .filter((refund) => refund.status === 'Refunded' && refund.order)
    .slice()
    .sort((left, right) => (toTimestamp(left.processedAt) ?? -Infinity) - (toTimestamp(right.processedAt) ?? -Infinity))
    .forEach((refund) => {
      const orderId = String(refund.order);
      const reference = String(refund.providerRefundReference || '').trim().toLowerCase();
      const key = `${orderId}\u0000${reference || String(refund._id)}`;
      if (!uniqueRefunds.has(key)) uniqueRefunds.set(key, refund);
    });

  const refundedByOrder = new Map();
  let periodRefunds = 0;
  let previousRefunds = 0;
  uniqueRefunds.forEach((refund) => {
    const orderId = String(refund.order);
    const remaining = Math.max(0, (paidByOrder.get(orderId) || 0) - (refundedByOrder.get(orderId) || 0));
    const amount = Math.min(
      remaining,
      paymentAmountEtb(refund.amount, refund.currency || 'ETB')
    );
    if (amount <= 0) return;
    refundedByOrder.set(orderId, (refundedByOrder.get(orderId) || 0) + amount);
    if (isInRange(refund.processedAt, range)) periodRefunds += amount;
    if (previousRange && isInRange(refund.processedAt, previousRange)) previousRefunds += amount;

    const timestamp = toTimestamp(refund.processedAt);
    if (timestamp !== null) {
      const bucket = buckets.find((item) => timestamp >= item.start && timestamp < item.end);
      if (bucket) bucket.revenue -= amount;
    }
  });

  let totalOrders = 0;
  let previousTotalOrders = 0;
  let pendingPayments = 0;
  let pendingPaymentOrders = 0;
  let codAwaitingCollection = 0;
  let failedPayments = 0;
  orders.forEach((order) => {
    if (previousRange && isInRange(order.createdAt, previousRange)) previousTotalOrders += 1;
    if (isInRange(order.createdAt, range)) {
      totalOrders += 1;
      if (order.isPaid !== true && order.orderStatus !== 'Cancelled' && pendingStatuses.has(order.paymentStatus || 'Pending')) {
        const due = pendingAmountEtb(order);
        pendingPayments += due;
        pendingPaymentOrders += due > 0 ? 1 : 0;
      }
      if (order.paymentMethod === 'Cash on Delivery' && order.orderStatus !== 'Cancelled' && !order.isPaid) {
        codAwaitingCollection += pendingAmountEtb(order);
      }
    }

    const status = String(order.paymentStatus || '').toLowerCase();
    if (['failed', 'rejected'].includes(status) &&
        isInRange(order.paymentDate || order.updatedAt || order.createdAt, range)) {
      failedPayments += 1;
    }

    const timestamp = toTimestamp(order.createdAt);
    if (timestamp !== null) {
      const bucket = buckets.find((item) => timestamp >= item.start && timestamp < item.end);
      if (bucket) bucket.orders += 1;
    }
  });

  const round = (value) => roundCurrency(value);
  const revenue = round(periodSales - periodRefunds);
  const previousRevenue = previousRange ? round(previousSales - previousRefunds) : null;
  const percentChange = (current, previous) => previous === 0
    ? (current > 0 ? null : 0)
    : ((current - previous) / Math.abs(previous)) * 100;
  return {
    cards: {
      totalSales: round(periodSales),
      totalRevenue: revenue,
      totalRefunds: round(periodRefunds),
      pendingPayments: round(pendingPayments),
      pendingPaymentOrders,
      totalOrders,
      paidOrders,
      successfulPayments: successfulPaymentCount,
      failedPayments,
      codAwaitingCollection: round(codAwaitingCollection),
    },
    methodStats: [...methodTotals.values()].map((item) => ({ ...item, amount: round(item.amount) })),
    trend: buckets.map(({ label, revenue, count, orders: orderCount }) => ({
      label,
      revenue: round(revenue),
      count,
      orders: orderCount,
    })),
    period: selectedPeriod,
    previousRevenue,
    change: previousRevenue === null ? undefined : percentChange(revenue, previousRevenue),
    ordersChange: previousRange
      ? percentChange(totalOrders, previousTotalOrders)
      : undefined,
  };
};

module.exports = {
  calculateFinancialMetrics,
  getPeriodRange,
  getPreviousPeriodRange,
  normalizePeriod,
};
