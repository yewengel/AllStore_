const mongoose = require('mongoose');

const paymentAccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, required: true, enum: ['bank', 'mobile-money'] },
    provider: { type: String, required: true, trim: true, maxlength: 120 },
    accountHolder: { type: String, required: true, trim: true, maxlength: 120 },
    accountDetails: { type: String, required: true, trim: true, maxlength: 200 },
    branch: { type: String, default: '', trim: true, maxlength: 120 },
    instructions: { type: String, default: '', trim: true, maxlength: 1000 },
    active: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/**
 * Store-wide payment settings (singleton document keyed by "payment").
 * Stores administrator choices and customer-facing payment destinations.
 * Payment destinations are entered and managed by an administrator.
 */
const paymentSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'payment',
    },
    disabledMethods: {
      type: [String],
      default: [],
    },
    accounts: {
      type: [paymentAccountSchema],
      default: [],
    },
    accountsMigrated: {
      type: Boolean,
      default: false,
    },
    bankTransfer: {
      bankName: { type: String, default: '', trim: true },
      accountName: { type: String, default: '', trim: true },
      accountNumber: { type: String, default: '', trim: true },
      branch: { type: String, default: '', trim: true },
      instructions: { type: String, default: '', trim: true },
    },
    telebirr: {
      businessName: { type: String, default: '', trim: true },
      accountDetails: { type: String, default: '', trim: true },
      instructions: { type: String, default: '', trim: true },
    },
    cbeBirr: {
      accountName: { type: String, default: '', trim: true },
      accountDetails: { type: String, default: '', trim: true },
      instructions: { type: String, default: '', trim: true },
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentSetting', paymentSettingSchema);
