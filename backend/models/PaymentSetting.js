const mongoose = require('mongoose');

/**
 * Store-wide payment settings (singleton document keyed by "payment").
 * Stores administrator choices and customer-facing payment destinations.
 * Gateway credentials remain in backend environment variables only.
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
