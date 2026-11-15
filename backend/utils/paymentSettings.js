const mongoose = require('mongoose');
const PaymentSetting = require('../models/PaymentSetting');

const LEGACY_METHODS = [
  {
    id: '000000000000000000000001',
    name: 'Bank Transfer',
    type: 'bank',
    provider: (settings) => settings.bankTransfer?.bankName,
    accountHolder: (settings) => settings.bankTransfer?.accountName,
    accountDetails: (settings) => settings.bankTransfer?.accountNumber,
    branch: (settings) => settings.bankTransfer?.branch,
    instructions: (settings) => settings.bankTransfer?.instructions,
    disabledKey: 'Bank Transfer',
  },
  {
    id: '000000000000000000000002',
    name: 'Telebirr',
    type: 'mobile-money',
    provider: () => 'Telebirr',
    accountHolder: (settings) => settings.telebirr?.businessName,
    accountDetails: (settings) => settings.telebirr?.accountDetails,
    instructions: (settings) => settings.telebirr?.instructions,
    disabledKey: 'Telebirr',
  },
  {
    id: '000000000000000000000003',
    name: 'CBE Birr',
    type: 'mobile-money',
    provider: () => 'CBE Birr',
    accountHolder: (settings) => settings.cbeBirr?.accountName,
    accountDetails: (settings) => settings.cbeBirr?.accountDetails,
    instructions: (settings) => settings.cbeBirr?.instructions,
    disabledKey: 'CBE Birr',
  },
];

const clean = (value) => typeof value === 'string' ? value.trim() : '';

const isPaymentAccountComplete = (account) => Boolean(
  clean(account?.name) &&
  ['bank', 'mobile-money'].includes(account?.type) &&
  clean(account?.provider) &&
  clean(account?.accountHolder) &&
  clean(account?.accountDetails)
);

const serializePaymentAccount = (account, fallbackId) => ({
  id: String(account?._id || account?.id || fallbackId || ''),
  name: clean(account?.name),
  type: account?.type === 'mobile-money' ? 'mobile-money' : 'bank',
  provider: clean(account?.provider),
  accountHolder: clean(account?.accountHolder),
  accountDetails: clean(account?.accountDetails),
  branch: clean(account?.branch),
  instructions: clean(account?.instructions),
  active: Boolean(account?.active),
});

const legacyPaymentAccounts = (settings) => {
  const disabled = new Set(settings?.disabledMethods || []);
  return LEGACY_METHODS.flatMap((method) => {
    const account = {
      id: method.id,
      name: method.name,
      type: method.type,
      provider: clean(method.provider(settings)),
      accountHolder: clean(method.accountHolder(settings)),
      accountDetails: clean(method.accountDetails(settings)),
      branch: clean(method.branch?.(settings)),
      instructions: clean(method.instructions(settings)),
      active: false,
    };
    const hasLegacyData = [
      account.provider,
      account.accountHolder,
      account.accountDetails,
      account.branch,
      account.instructions,
    ].some(Boolean);
    if (!hasLegacyData) return [];
    account.active = !disabled.has(method.disabledKey) && isPaymentAccountComplete(account);
    return [account];
  });
};

const paymentAccountsFromSettings = (settings) => {
  if (!settings) return [];
  const storedAccounts = settings.accounts || [];
  if (settings.accountsMigrated || storedAccounts.length > 0) {
    return storedAccounts.map((account) => serializePaymentAccount(account));
  }
  return legacyPaymentAccounts(settings);
};

const getPaymentSettings = async () => {
  if (mongoose.connection.readyState !== 1) return null;
  return PaymentSetting.findOne({ key: 'payment' }).lean();
};

const getPaymentAccounts = async () => paymentAccountsFromSettings(await getPaymentSettings());

const getPaymentAccount = async (accountId, { activeOnly = false } = {}) => {
  if (typeof accountId !== 'string' || !accountId.trim()) return null;
  const account = (await getPaymentAccounts()).find((entry) => entry.id === accountId.trim());
  if (!account || !isPaymentAccountComplete(account) || (activeOnly && !account.active)) return null;
  return account;
};

const getPublicPaymentAccounts = async () => (
  (await getPaymentAccounts())
    .filter((account) => account.active && isPaymentAccountComplete(account))
    .map(({ id, name, type, provider, accountHolder, accountDetails, branch, instructions }) => ({
      id,
      name,
      type,
      provider,
      accountHolder,
      accountDetails,
      branch,
      instructions,
    }))
);

const paymentAccountSnapshot = (account) => ({
  name: account.name,
  type: account.type,
  provider: account.provider,
  accountHolder: account.accountHolder,
  accountDetails: account.accountDetails,
  branch: account.branch,
  instructions: account.instructions,
});

const legacyPaymentAccountDocuments = (settings) => legacyPaymentAccounts(settings)
  .map(({ id, ...account }) => ({ _id: id, ...account }));

module.exports = {
  getPaymentAccounts,
  getPaymentAccount,
  getPaymentSettings,
  isPaymentAccountComplete,
  legacyPaymentAccountDocuments,
  paymentAccountSnapshot,
  paymentAccountsFromSettings,
  serializePaymentAccount,
  getPublicPaymentAccounts,
};
