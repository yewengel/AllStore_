import assert from 'node:assert/strict';
import test from 'node:test';
import { isUsablePaymentAccount, paymentAccountPayload } from '../src/utils/paymentAccount.js';
import { getApiBaseUrl } from '../src/api/apiBaseUrl.js';

test('checkout accepts complete account records from the public endpoint without requiring an active field', () => {
  assert.equal(isUsablePaymentAccount({
    id: 'public-id',
    name: 'Configured account',
    type: 'bank',
    provider: 'Configured provider',
    accountHolder: 'Store account',
    accountDetails: 'redacted-account-detail',
  }), true);
  assert.equal(isUsablePaymentAccount({
    id: 'incomplete-id',
    name: 'Incomplete account',
    type: 'mobile-money',
    provider: 'Configured provider',
    accountHolder: 'Store account',
    accountDetails: '',
  }), false);
  assert.equal(isUsablePaymentAccount({
    id: 'inactive-id',
    name: 'Inactive account',
    type: 'bank',
    provider: 'Configured provider',
    accountHolder: 'Store account',
    accountDetails: 'redacted-account-detail',
    active: false,
  }), false);
});

test('API base URL uses local development and Render production defaults, with environment override', () => {
  assert.equal(getApiBaseUrl('', false), 'http://localhost:5000/api');
  assert.equal(getApiBaseUrl('', true), 'https://allstore-backend.onrender.com/api');
  assert.equal(getApiBaseUrl('https://api.example.test/api/', true), 'https://api.example.test/api');
});

test('payment account requests send the backend field names for bank and mobile-money accounts', () => {
  for (const account of [
    {
      name: 'CBE',
      type: 'bank',
      provider: 'Commercial Bank of Ethiopia',
      accountHolder: 'AllStore',
      accountDetails: '1234567890',
      active: true,
    },
    {
      name: 'Telebirr',
      type: 'mobile-money',
      provider: 'Telebirr',
      accountHolder: 'AllStore',
      accountDetails: '+251900000000',
      active: false,
    },
  ]) {
    assert.deepEqual(paymentAccountPayload(account), {
      ...account,
      branch: '',
      instructions: '',
      active: Boolean(account.active),
    });
  }
});
