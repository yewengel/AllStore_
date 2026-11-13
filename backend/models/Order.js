const mongoose = require('mongoose');

/**
 * Order Item Sub-schema
 */
const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  qty: {
    type: Number,
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    enum: ['ETB', 'USD'],
  },
  image: {
    type: String,
    default: '',
  },
});

const trackingHistoryEntrySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      enum: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'],
    },
    message: {
      type: String,
      default: '',
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    previousStatus: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'],
    },
    newStatus: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'],
    },
    adminNote: {
      type: String,
      default: '',
      trim: true,
    },
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { _id: true }
);

const paymentReceiptSchema = new mongoose.Schema(
  {
    storageKey: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    originalName: { type: String, trim: true },
    uploadedAt: { type: Date },
  },
  { _id: false }
);

/**
 * Payment audit trail. Every payment status change or administrative action
 * is recorded here so administrators can review the full history of a payment.
 */
const paymentHistoryEntrySchema = new mongoose.Schema(
  {
    status: { type: String, required: true, trim: true },
    previousStatus: { type: String, default: '', trim: true },
    message: { type: String, default: '', trim: true },
    adminNote: { type: String, default: '', trim: true },
    amount: { type: Number },
    adminUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: true }
);

/**
 * Order Schema
 * References the customer User and records ordered products and status
 */
const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    orderNumber: {
      type: String,
      unique: true,
      trim: true,
    },
    customerName: {
      type: String,
      default: '',
      trim: true,
    },
    phoneNumber: {
      type: String,
      default: '',
      trim: true,
    },
    deliveryAddress: {
      type: String,
      default: '',
      trim: true,
    },
    orderItems: [orderItemSchema],
    items: [orderItemSchema],
    shippingAddress: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      region: { type: String, default: '', trim: true },
      subCity: { type: String, default: '', trim: true },
      postalCode: { type: String, required: true },
      country: { type: String, required: true },
    },
    recipientName: {
      type: String,
      default: '',
      trim: true,
    },
    deliveryPhoneNumber: {
      type: String,
      default: '',
      trim: true,
    },
    deliveryInstructions: {
      type: String,
      default: '',
      trim: true,
    },
    paymentMethod: {
      type: String,
      required: true,
      default: 'Credit Card',
    },
    totalPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    subtotal: {
      type: Number,
    },
    shippingCost: {
      type: Number,
    },
    discountAmount: {
      type: Number,
    },
    currency: {
      type: String,
      enum: ['ETB', 'USD'],
    },
    isPaid: {
      type: Boolean,
      required: true,
      default: false,
    },
    paymentStatus: {
      type: String,
      enum: [
        'Pending',
        'Processing',
        'Pending Verification',
        'Awaiting Verification',
        'Unpaid',
        'Paid',
        'Failed',
        'Cancelled',
        'Refunded',
        'Partially Refunded',
        'Rejected',
      ],
      default: 'Pending',
    },
    paymentAmount: {
      type: Number,
      min: 0,
    },
    paymentCurrency: {
      type: String,
      enum: ['ETB', 'USD'],
    },
    paymentDate: {
      type: Date,
    },
    paymentReceipt: {
      type: paymentReceiptSchema,
    },
    paymentGatewayReference: {
      type: String,
      trim: true,
    },
    paymentChannel: {
      type: String,
      trim: true,
    },
    paymentInitializedAt: {
      type: Date,
    },
    paymentCheckoutUrl: {
      type: String,
      select: false,
    },
    paymentReviewNote: {
      type: String,
      default: '',
      trim: true,
    },
    paymentReviewedAt: {
      type: Date,
    },
    paymentReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    paidAt: {
      type: Date,
    },
    paymentHistory: [paymentHistoryEntrySchema],
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    codCollectionStatus: {
      type: String,
      enum: ['Pending', 'Collected', 'Not Collected'],
      default: 'Pending',
    },
    codCollectedAmount: {
      type: Number,
      min: 0,
    },
    codCollectedAt: {
      type: Date,
    },
    codCollectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    codCollectionNote: {
      type: String,
      default: '',
      trim: true,
    },
    orderStatus: {
      type: String,
      required: true,
      enum: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'],
      default: 'Pending',
    },
    trackingNumber: {
      type: String,
      default: '',
      trim: true,
    },
    deliveryCompany: {
      type: String,
      default: 'AllStore Delivery',
      trim: true,
    },
    courierName: {
      type: String,
      default: '',
      trim: true,
    },
    deliveryPersonName: {
      type: String,
      default: '',
      trim: true,
    },
    deliveryPersonPhone: {
      type: String,
      default: '',
      trim: true,
    },
    estimatedDelivery: {
      type: Date,
    },
    shippingDate: {
      type: Date,
    },
    actualDeliveryDate: {
      type: Date,
    },
    deliveryNotes: {
      type: String,
      default: '',
      trim: true,
    },
    adminTrackingNote: {
      type: String,
      default: '',
      trim: true,
    },
    transactionReference: {
      type: String,
      default: '',
      trim: true,
    },
    trackingHistory: [trackingHistoryEntrySchema],
    deliveredAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    autoIndex: false,
  }
);

orderSchema.pre('save', function (next) {
  if (!this.customerName && this.user && typeof this.user === 'object' && this.user.name) {
    this.customerName = this.user.name;
  }

  if (!this.deliveryAddress && this.shippingAddress) {
    const addressParts = [
      this.shippingAddress.address,
      this.shippingAddress.city,
      this.shippingAddress.postalCode,
      this.shippingAddress.country,
    ].filter(Boolean);
    this.deliveryAddress = addressParts.join(', ');
  }

  if (!this.items && Array.isArray(this.orderItems) && this.orderItems.length) {
    this.items = this.orderItems;
  }

  if (!this.trackingHistory || !this.trackingHistory.length) {
    this.trackingHistory = [
      {
        status: this.orderStatus || 'Pending',
        message: 'Order placed successfully.',
        timestamp: new Date(),
      },
    ];
  }

  next();
});

module.exports = mongoose.model('Order', orderSchema);

