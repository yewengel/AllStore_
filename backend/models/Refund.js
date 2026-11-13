const mongoose = require('mongoose');

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
    },
    status: {
      type: String,
      enum: ['Requested', 'Approved', 'Rejected', 'Processing', 'Refunded', 'Failed'],
      default: 'Requested',
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
  },
  { timestamps: true }
);

module.exports = mongoose.model('Refund', refundSchema);
