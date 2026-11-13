const mongoose = require('mongoose');
const PaymentSetting = require('../models/PaymentSetting');
const { getPaymentConfiguration } = require('./chapa');

// Methods an administrator can enable/disable from the payment settings page.
const PAYMENT_METHOD_KEYS = ['Telebirr', 'M-Pesa', 'Visa', 'Mastercard', 'Bank Transfer', 'Cash on Delivery'];

// Keywords used to match gateway-advertised method labels to our display methods.
const GATEWAY_KEYWORDS = {
  Telebirr: ['telebirr'],
  'M-Pesa': ['m-pesa', 'mpesa', 'm_pesa', 'm pesa'],
  Visa: ['visa'],
  Mastercard: ['mastercard', 'master card', 'master-card'],
};

/**
 * Load the singleton payment settings document. Returns null when MongoDB is
 * not connected (for example, in isolated unit tests) so callers can safely
 * fall back to environment-only configuration.
 */
const getPaymentSettings = async () => {
  if (mongoose.connection.readyState !== 1) return null;
  return PaymentSetting.findOneAndUpdate(
    { key: 'payment' },
    { $setOnInsert: { key: 'payment' } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
};

/**
 * Merge environment gateway configuration with administrator settings.
 * methodSupported = configuration/gateway allows the method at all.
 * methodEnabled   = supported and not disabled by an administrator.
 */
const resolvePaymentConfiguration = async () => {
  const base = getPaymentConfiguration();
  const settings = await getPaymentSettings();
  const disabled = new Set(
    (settings?.disabledMethods || []).filter((method) => PAYMENT_METHOD_KEYS.includes(method))
  );

  const gatewaySupports = (method) => {
    if (!base.chapa.configured) return false;
    const available = base.chapa.availableMethods;
    if (!Array.isArray(available) || available.length === 0) return true;
    return available.some((label) => {
      const normalized = String(label).toLowerCase();
      return GATEWAY_KEYWORDS[method].some((keyword) => normalized.includes(keyword));
    });
  };

  const bankTransfer = {
    bankName: settings?.bankTransfer?.bankName?.trim() || base.bankTransfer.bankName,
    accountName: settings?.bankTransfer?.accountName?.trim() || base.bankTransfer.accountName,
    accountNumber: settings?.bankTransfer?.accountNumber?.trim() || base.bankTransfer.accountNumber,
    branch: settings?.bankTransfer?.branch?.trim() || base.bankTransfer.branch,
    instructions: settings?.bankTransfer?.instructions?.trim() || '',
  };
  const bankTransferConfigured = Boolean(
    bankTransfer.bankName && bankTransfer.accountName && bankTransfer.accountNumber
  );

  const methodSupported = {
    Telebirr: gatewaySupports('Telebirr'),
    'M-Pesa': gatewaySupports('M-Pesa'),
    Visa: gatewaySupports('Visa'),
    Mastercard: gatewaySupports('Mastercard'),
    'Bank Transfer': bankTransferConfigured,
    'Cash on Delivery': true,
  };

  const methodEnabled = Object.fromEntries(
    PAYMENT_METHOD_KEYS.map((method) => [
      method,
      methodSupported[method] && !disabled.has(method),
    ])
  );

  return {
    gateway: {
      provider: 'Chapa',
      configured: base.chapa.configured,
      mode: base.chapa.mode,
      message: base.chapa.message,
      availableMethods: base.chapa.configured ? base.chapa.availableMethods : [],
    },
    bankTransfer: { ...bankTransfer, configured: bankTransferConfigured },
    disabledMethods: [...disabled],
    methodSupported,
    methodEnabled,
  };
};

module.exports = {
  PAYMENT_METHOD_KEYS,
  getPaymentSettings,
  resolvePaymentConfiguration,
};
