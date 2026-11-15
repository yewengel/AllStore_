// Shared labels for customer payment history and order tracking.

export const ONLINE_PAYMENT_OPTIONS = [
  {
    value: 'Telebirr',
    label: 'Telebirr',
    icon: '📱',
    description: 'Pay to the store’s Telebirr account and submit your receipt',
  },
  {
    value: 'CBE Birr',
    label: 'CBE Birr',
    icon: '📱',
    description: 'Pay to the store’s CBE Birr account and submit your receipt',
  },
];

export const paymentMethodLabel = (method) => method || 'Online Payment';

// Human-readable payment status.
export const paymentStatusLabel = (status, { isPaid = false } = {}) => {
  if (isPaid) return 'Paid';
  switch (status) {
    case 'Paid':
      return 'Paid';
    case 'Pending Verification':
      return 'Pending Verification';
    case 'Awaiting Verification':
      return 'Pending Verification';
    case 'Awaiting Payment':
    case 'Unpaid':
      return 'Awaiting Payment';
    case 'Pending':
      return 'Awaiting Payment';
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

export const paymentStatusClass = (status, { isPaid = false } = {}) => {
  if (isPaid || status === 'Paid') return 'paid';
  if (['Pending Verification', 'Awaiting Verification'].includes(status)) return 'pending-verification';
  if (status === 'Failed') return 'failed';
  if (status === 'Cancelled') return 'cancelled';
  if (status === 'Rejected') return 'rejected';
  if (['Pending', 'Awaiting Payment', 'Unpaid'].includes(status)) return 'unpaid';
  return 'pending';
};
