const CHAPA_API_BASE_URL = 'https://api.chapa.co/v1';

const getConfiguredMethods = () => (process.env.CHAPA_AVAILABLE_METHODS || '')
  .split(',')
  .map((method) => method.trim())
  .filter((method) => method && method.length <= 80);

const getPaymentConfiguration = () => {
  const mode = (process.env.CHAPA_MODE || 'test').trim().toLowerCase();
  const secretKey = (process.env.CHAPA_SECRET_KEY || '').trim();
  const webhookSecret = (process.env.CHAPA_WEBHOOK_SECRET || '').trim();
  const apiPublicUrl = (process.env.API_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  const testKey = secretKey.startsWith('CHASECK_TEST-');
  let chapaMessage = '';

  if (!secretKey) {
    chapaMessage = 'Chapa is not configured. Add CHAPA_SECRET_KEY on the backend.';
  } else if (!['test', 'live'].includes(mode)) {
    chapaMessage = 'CHAPA_MODE must be set to test or live.';
  } else if (mode === 'test' && !testKey) {
    chapaMessage = 'Test mode requires a Chapa test secret key.';
  } else if (mode === 'live' && (testKey || !secretKey.startsWith('CHASECK-'))) {
    chapaMessage = 'Live mode requires a live Chapa secret key.';
  } else if (!webhookSecret) {
    chapaMessage = 'Add CHAPA_WEBHOOK_SECRET from the Chapa webhook settings.';
  } else if (!apiPublicUrl) {
    chapaMessage = 'Set API_PUBLIC_URL to the public backend URL for payment callbacks.';
  } else {
    try {
      const callbackUrl = new URL(apiPublicUrl);
      if (process.env.NODE_ENV === 'production' && callbackUrl.protocol !== 'https:') {
        chapaMessage = 'API_PUBLIC_URL must use HTTPS in production.';
      }
    } catch {
      chapaMessage = 'API_PUBLIC_URL must be a valid public URL.';
    }
  }

  const bankTransfer = {
    bankName: (process.env.BANK_TRANSFER_BANK_NAME || '').trim(),
    accountName: (process.env.BANK_TRANSFER_ACCOUNT_NAME || '').trim(),
    accountNumber: (process.env.BANK_TRANSFER_ACCOUNT_NUMBER || '').trim(),
    branch: (process.env.BANK_TRANSFER_BRANCH || '').trim(),
  };

  return {
    chapa: {
      configured: !chapaMessage,
      mode,
      message: chapaMessage,
      secretKey,
      webhookSecret,
      apiPublicUrl,
      availableMethods: getConfiguredMethods(),
    },
    bankTransfer: {
      ...bankTransfer,
      configured: Boolean(bankTransfer.bankName && bankTransfer.accountName && bankTransfer.accountNumber),
    },
  };
};

const chapaRequest = async (path, { secretKey, method = 'GET', body } = {}) => {
  let response;
  try {
    response = await fetch(`${CHAPA_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw Object.assign(new Error('Could not reach Chapa. Check the connection and try again.'), {
      statusCode: 502,
      cause: error,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error('Chapa returned an unreadable response.'), { statusCode: 502 });
  }

  if (!response.ok || payload.status !== 'success') {
    throw Object.assign(
      new Error('Chapa could not complete the payment request. Check the merchant configuration and try again.'),
      { statusCode: 502 }
    );
  }

  return payload;
};

const initializeChapaTransaction = async ({ order, customer, clientUrl }) => {
  const config = getPaymentConfiguration().chapa;
  if (!config.configured) {
    throw Object.assign(new Error(config.message), { statusCode: 503 });
  }
  if (!customer.email) {
    throw Object.assign(new Error('A customer email is required to initialize Chapa checkout.'), { statusCode: 400 });
  }
  try {
    const returnUrl = new URL(clientUrl);
    if (process.env.NODE_ENV === 'production' && returnUrl.protocol !== 'https:') {
      throw new Error('insecure URL');
    }
  } catch {
    throw Object.assign(new Error('CLIENT_URL must be a valid HTTPS URL for Chapa checkout.'), { statusCode: 503 });
  }

  const customerName = (customer.name || order.customerName || 'AllStore Customer').trim().split(/\s+/);
  const payload = await chapaRequest('/transaction/initialize', {
    secretKey: config.secretKey,
    method: 'POST',
    body: {
      amount: Number(order.paymentAmount ?? order.totalPrice).toFixed(2),
      currency: order.paymentCurrency || 'ETB',
      email: customer.email,
      first_name: customerName[0],
      last_name: customerName.slice(1).join(' ') || customerName[0],
      tx_ref: order.transactionReference,
      callback_url: `${config.apiPublicUrl}/api/payments/chapa/callback`,
      return_url: `${clientUrl.replace(/\/+$/, '')}/payment/result/${order._id}?payment=chapa`,
      customization: {
        title: 'AllStore',
        description: `Payment for order ${order.orderNumber}`,
      },
      meta: {
        order_id: order._id.toString(),
        order_number: order.orderNumber,
      },
    },
  });

  const checkoutUrl = payload.data?.checkout_url;
  if (typeof checkoutUrl !== 'string' || !checkoutUrl.startsWith('https://')) {
    throw Object.assign(new Error('Chapa did not return a secure checkout URL.'), { statusCode: 502 });
  }
  return checkoutUrl;
};

const verifyChapaTransaction = async (txRef) => {
  const config = getPaymentConfiguration().chapa;
  if (!config.configured) {
    throw Object.assign(new Error(config.message), { statusCode: 503 });
  }
  const payload = await chapaRequest(`/transaction/verify/${encodeURIComponent(txRef)}`, {
    secretKey: config.secretKey,
  });
  return payload.data || {};
};

/**
 * Initiate a refund for a successful Chapa transaction.
 * Amount is the refund amount in the transaction currency (a string); omit it
 * for a full refund. Returns the provider refund record.
 */
const refundChapaTransaction = async ({ txRef, amount, reason, reference }) => {
  const config = getPaymentConfiguration().chapa;
  if (!config.configured) {
    throw Object.assign(new Error(config.message), { statusCode: 503 });
  }
  const body = {};
  if (amount !== undefined && amount !== null && amount !== '') body.amount = String(amount);
  if (reason) body.reason = String(reason).slice(0, 400);
  if (reference) body.reference = String(reference).slice(0, 60);

  const payload = await chapaRequest(`/refund/${encodeURIComponent(txRef)}`, {
    secretKey: config.secretKey,
    method: 'POST',
    body,
  });
  return payload.data || {};
};

module.exports = {
  getPaymentConfiguration,
  initializeChapaTransaction,
  verifyChapaTransaction,
  refundChapaTransaction,
};
