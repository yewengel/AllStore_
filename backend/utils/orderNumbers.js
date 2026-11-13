const Order = require('../models/Order');
const OrderCounter = require('../models/OrderCounter');

const COUNTER_ID = 'order-number';
const REFUND_COUNTER_ID = 'refund-number';
const READABLE_ORDER_NUMBER = /^AS-\d{5,}$/;

const formatOrderNumber = (sequence) => `AS-${String(sequence).padStart(5, '0')}`;
const formatRefundNumber = (sequence) => `RF-${String(sequence).padStart(5, '0')}`;

const nextOrderNumber = async (session) => {
  const options = { new: true, upsert: true };
  if (session) options.session = session;

  const counter = await OrderCounter.findOneAndUpdate(
    { _id: COUNTER_ID },
    { $inc: { sequence: 1 } },
    options
  );
  if (!counter) throw new Error('Unable to allocate an order number.');

  return formatOrderNumber(counter.sequence);
};

const nextRefundNumber = async (session) => {
  const options = { new: true, upsert: true };
  if (session) options.session = session;

  const counter = await OrderCounter.findOneAndUpdate(
    { _id: REFUND_COUNTER_ID },
    { $inc: { sequence: 1 } },
    options
  );
  if (!counter) throw new Error('Unable to allocate a refund number.');

  return formatRefundNumber(counter.sequence);
};

const initializeOrderNumbers = async () => {
  const [highestOrderNumber] = await Order.aggregate([
    { $match: { orderNumber: { $regex: READABLE_ORDER_NUMBER } } },
    {
      $project: {
        sequence: {
          $convert: {
            input: { $arrayElemAt: [{ $split: ['$orderNumber', 'AS-'] }, 1] },
            to: 'long',
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    { $group: { _id: null, sequence: { $max: '$sequence' } } },
  ]);
  const currentSequence = Number(highestOrderNumber?.sequence) || 0;

  try {
    await OrderCounter.updateOne(
      { _id: COUNTER_ID },
      { $max: { sequence: currentSequence } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    await OrderCounter.updateOne(
      { _id: COUNTER_ID },
      { $max: { sequence: currentSequence } }
    );
  }

  const legacyOrders = Order.find({ orderNumber: { $not: READABLE_ORDER_NUMBER } })
    .select('_id orderNumber')
    .sort({ createdAt: 1, _id: 1 })
    .lean()
    .cursor();

  for await (const order of legacyOrders) {
    const filter = { _id: order._id };
    if (Object.prototype.hasOwnProperty.call(order, 'orderNumber')) {
      filter.orderNumber = order.orderNumber;
    } else {
      filter.orderNumber = { $exists: false };
    }

    await Order.updateOne(filter, { $set: { orderNumber: await nextOrderNumber() } });
  }

  const missingTrackingHistory = Order.find({
    $or: [{ trackingHistory: { $exists: false } }, { trackingHistory: { $size: 0 } }],
  })
    .select('_id orderStatus createdAt')
    .lean()
    .cursor();
  for await (const order of missingTrackingHistory) {
    await Order.updateOne(
      {
        _id: order._id,
        $or: [{ trackingHistory: { $exists: false } }, { trackingHistory: { $size: 0 } }],
      },
      {
        $set: {
          trackingHistory: [{
            status: order.orderStatus || 'Pending',
            message: 'Existing order status recorded during tracking setup.',
            timestamp: order.createdAt || new Date(),
          }],
        },
      }
    );
  }

  const trackingDefaults = {
    trackingNumber: '',
    courierName: '',
    deliveryCompany: 'AllStore Delivery',
    deliveryPersonName: '',
    deliveryPersonPhone: '',
    deliveryNotes: '',
    deliveryInstructions: '',
    adminTrackingNote: '',
    transactionReference: '',
    recipientName: '',
    deliveryPhoneNumber: '',
  };
  for (const [field, value] of Object.entries(trackingDefaults)) {
    await Order.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } });
  }

  await Order.createIndexes();
};

module.exports = { formatOrderNumber, nextOrderNumber, initializeOrderNumbers, nextRefundNumber };
