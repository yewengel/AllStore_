const mongoose = require('mongoose');
const PaymentSetting = require('../models/PaymentSetting');
const { getPaymentConfiguration } = require('./chapa');

// Methods an administrator can enable/disable from the payment settings page.
const PAYMENT_METHOD_KEYS = ['Bank Transfer', 'Telebirr', 'CBE Birr'];

/**
 * Read the singleton payment settings document without making public checkout
 * requests create or modify settings.
 */
const getPaymentSettings = async () => {
  if (mongoose.connection.readyState !== 1) return null;
  return PaymentSetting.findOne({ key: 'payment' }).lean();
};

/**
 * Resolve only payment methods with complete administrator-entered details.
 */
const resolvePaymentConfiguration = async () => {
  const base = getPaymentConfiguration();
  const settings = await getPaymentSettings();
  const disabled = new Set(
    (settings?.disabledMethods || []).filter((method) => PAYMENT_METHOD_KEYS.includes(method))
  );

  const bankTransfer = {
    bankName: settings?.bankTransfer?.bankName?.trim() || '',
    accountName: settings?.bankTransfer?.accountName?.trim() || '',
    accountNumber: settings?.bankTransfer?.accountNumber?.trim() || '',
    branch: settings?.bankTransfer?.branch?.trim() || '',
    instructions: settings?.bankTransfer?.instructions?.trim() || '',
  };
  const bankTransferConfigured = Boolean(
    bankTransfer.bankName && bankTransfer.accountName && bankTransfer.accountNumber
  );
  const telebirr = {
    businessName: settings?.telebirr?.businessName?.trim() || '',
    accountDetails: settings?.telebirr?.accountDetails?.trim() || '',
    instructions: settings?.telebirr?.instructions?.trim() || '',
  };
  const cbeBirr = {
    accountName: settings?.cbeBirr?.accountName?.trim() || '',
    accountDetails: settings?.cbeBirr?.accountDetails?.trim() || '',
    instructions: settings?.cbeBirr?.instructions?.trim() || '',
  };

  const methodSupported = {
    Telebirr: Boolean(telebirr.businessName && telebirr.accountDetails),
    'CBE Birr': Boolean(cbeBirr.accountName && cbeBirr.accountDetails),
    'Bank Transfer': bankTransferConfigured,
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
    telebirr: { ...telebirr, configured: methodSupported.Telebirr },
    cbeBirr: { ...cbeBirr, configured: methodSupported['CBE Birr'] },
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
