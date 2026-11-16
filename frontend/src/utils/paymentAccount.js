export const isUsablePaymentAccount = (account) => (
  account?.active !== false &&
  ['bank', 'mobile-money'].includes(account?.type) &&
  ['id', 'name', 'provider', 'accountHolder', 'accountDetails']
    .every((field) => typeof account[field] === 'string' && account[field].trim())
);

export const paymentAccountPayload = (account) => ({
  name: account.name,
  type: account.type,
  provider: account.provider,
  accountHolder: account.accountHolder,
  accountDetails: account.accountDetails,
  branch: account.branch || '',
  instructions: account.instructions || '',
  active: Boolean(account.active),
});
