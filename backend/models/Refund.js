const mongoose = require('mongoose');

const refundHistoryEntrySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    actorRole: {
      type: String,
      enum: ['customer', 'admin', 'system'],
      default: 'system',
    },
  },
  { _id: true }
);

/**
 * Refund record linked to an order and its original payment.
 * A refund is only marked as "Refunded" after it has actually been
 * processed or confirmed with the provider.
 */
const refundSchema = new mongoose.Schema(
  {
    refundNumber: {
      type: String,
      unique: true,
      trim: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    returnRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReturnRequest',
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    transactionReference: {
      type: String,
      default: '',
      trim: true,
    },
    paymentMethod: {
      type: String,
      default: '',
      trim: true,
    },
    paymentProvider: {
      type: String,
      default: '',
      trim: true,
    },
    originalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'ETB',
    },
    reason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: [
        'Not Required',
        'Refund Required',
        'Pending',
        'Requested',
        'Approved',
        'Rejected',
        'Processing',
        'Refunded',
        'Failed',
      ],
      default: 'Requested',
    },
    source: {
      type: String,
      enum: ['manual', 'order-cancellation', 'return'],
      default: 'manual',
    },
    customerMessage: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    history: {
      type: [refundHistoryEntrySchema],
      default: [],
    },
    provider: {
      type: String,
      default: '',
      trim: true,
    },
    providerRefundReference: {
      type: String,
      default: '',
      trim: true,
    },
    providerStatus: {
      type: String,
      default: '',
      trim: true,
    },
    providerResponse: {
      type: String,
      default: '',
      trim: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewNote: {
      type: String,
      default: '',
      trim: true,
    },
    processedAt: {
      type: Date,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    processingNote: {
      type: String,
      default: '',
      trim: true,
    },
    failedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Refund', refundSchema);
