// Shared payment helpers for the customer payment experience.
// Online methods are all settled through the configured Chapa hosted checkout;
// the customer's specific choice is recorded on the order for display.

export const ONLINE_PAYMENT_OPTIONS = [
  {
    value: 'Telebirr',
    label: 'Telebirr',
    icon: '📱',
    description: 'Pay with your Telebirr mobile wallet',
    keywords: ['telebirr'],
  },
  {
    value: 'M-Pesa',
    label: 'M-Pesa',
    icon: '📲',
    description: 'Pay with M-Pesa mobile money',
    keywords: ['m-pesa', 'mpesa', 'm_pesa', 'm pesa'],
  },
  {
    value: 'Visa',
    label: 'Visa',
    icon: '💳',
    description: 'Pay securely with a Visa debit or credit card',
    keywords: ['visa'],
  },
  {
    value: 'Mastercard',
    label: 'Mastercard',
    icon: '💳',
    description: 'Pay securely with a Mastercard',
    keywords: ['mastercard', 'master card', 'master-card'],
  },
];

export const ONLINE_PAYMENT_METHODS = new Set(ONLINE_PAYMENT_OPTIONS.map((option) => option.value));

const GENERIC_ONLINE_METHODS = new Set(['', 'Chapa Checkout', 'Credit Card']);

const CHANNEL_LABELS = {
  telebirr: 'Telebirr',
  mpesa: 'M-Pesa',
  'm-pesa': 'M-Pesa',
  'm_pesa': 'M-Pesa',
  cbe: 'CBE',
  cbebirr: 'CBE Birr',
  amole: 'Amole',
  ebirr: 'Ebirr',
  visa: 'Visa',
  mastercard: 'Mastercard',
  card: 'Card',
};

const titleCase = (value) => value.replace(/\b\w/g, (character) => character.toUpperCase());

const formatChannel = (channel) => {
  const key = String(channel).trim().toLowerCase();
  if (CHANNEL_LABELS[key]) return CHANNEL_LABELS[key];
  return titleCase(String(channel).trim());
};

// Friendly label for the payment method, using the recorded channel when the
// stored method is a generic gateway value (e.g. "Chapa Checkout").
export const paymentMethodLabel = (method, channel) => {
  if (method === 'Chapa Checkout' || method === 'Credit Card') {
    const safeChannel = typeof channel === 'string' ? channel.trim() : '';
    if (safeChannel && !GENERIC_ONLINE_METHODS.has(safeChannel)) return formatChannel(safeChannel);
    return 'Online Payment';
  }
  return method || 'Online Payment';
};

export const isOnlinePaymentMethod = (method) => ONLINE_PAYMENT_METHODS.has(method)
  || method === 'Chapa Checkout'
  || method === 'Credit Card';

export const isMethodEnabled = (option, chapaConfig) => {
  if (!chapaConfig?.enabled) return false;
  const configured = Array.isArray(chapaConfig.availableMethods) ? chapaConfig.availableMethods : [];
  if (configured.length === 0) return true;
  return configured.some((method) => {
    const normalized = String(method).trim().toLowerCase();
    return option.keywords.some((keyword) => normalized.includes(keyword));
  });
};

// Human-readable payment status. The stored enum is unchanged; this only changes display.
export const paymentStatusLabel = (status, { isPaid = false, paymentMethod } = {}) => {
  if (isPaid) return 'Paid';
  switch (status) {
    case 'Paid':
      return 'Paid';
    case 'Pending Verification':
      return 'Awaiting Verification';
    case 'Pending':
      return paymentMethod === 'Cash on Delivery' ? 'Unpaid · Pay on Delivery' : 'Pending';
    case 'Failed':
      return 'Failed';
    case 'Cancelled':
      return 'Cancelled';
    case 'Rejected':
      return 'Rejected';
    default:
      return status || 'Pending';
  }
};

export const paymentStatusClass = (status, { isPaid = false, paymentMethod } = {}) => {
  if (isPaid || status === 'Paid') return 'paid';
  if (status === 'Pending Verification') return 'pending-verification';
  if (status === 'Failed') return 'failed';
  if (status === 'Cancelled') return 'cancelled';
  if (status === 'Rejected') return 'rejected';
  if (status === 'Pending' && paymentMethod === 'Cash on Delivery') return 'unpaid';
  return 'pending';
};
