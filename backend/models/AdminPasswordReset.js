const mongoose = require('mongoose');

const adminPasswordResetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    codeHash: {
      type: String,
      select: false,
    },
    expiresAt: {
      type: Date,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    state: {
      type: String,
      enum: ['issuing', 'pending', 'verified', 'locked', 'consuming'],
      default: 'issuing',
    },
    resendAllowedAt: {
      type: Date,
    },
    issuanceId: {
      type: String,
      select: false,
    },
    resetTokenHash: {
      type: String,
      select: false,
    },
    resetExpiresAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

adminPasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AdminPasswordReset', adminPasswordResetSchema);
