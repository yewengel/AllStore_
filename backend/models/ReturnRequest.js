const mongoose = require('mongoose');

const returnHistoryEntrySchema = new mongoose.Schema(
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
      maxlength: 1000,
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

const returnPhotoSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    size: { type: Number, required: true, min: 0 },
  },
  { _id: true }
);

const returnItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, min: 1 },
    variantId: { type: mongoose.Schema.Types.ObjectId },
    variantSku: { type: String, default: '', trim: true },
    image: { type: String, default: '', trim: true },
    options: { type: Map, of: String, default: {} },
  },
  { _id: false }
);

const returnRequestSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: {
      type: [returnItemSchema],
      default: [],
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    details: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: [
        'Return Requested',
        'Under Review',
        'Approved',
        'Rejected',
        'Return in Progress',
        'Item Received',
        'Refund Processing',
        'Refunded',
        'Return Completed',
      ],
      default: 'Return Requested',
      index: true,
    },
    adminResponse: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },
    photos: {
      type: [returnPhotoSchema],
      default: [],
    },
    history: {
      type: [returnHistoryEntrySchema],
      default: [],
    },
    receivedCondition: {
      type: String,
      enum: ['Unused', 'Like New', 'Damaged', 'Incomplete', 'Other'],
    },
    restockable: {
      type: Boolean,
    },
    stockRestoredAt: {
      type: Date,
    },
    stockRestoredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReturnRequest', returnRequestSchema);
