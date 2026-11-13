const mongoose = require('mongoose');

/**
 * Store-wide payment settings (singleton document keyed by "payment").
 * Stores administrator choices that are not sensitive: which methods are
 * disabled, and the manual bank transfer details shown to customers.
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
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentSetting', paymentSettingSchema);
