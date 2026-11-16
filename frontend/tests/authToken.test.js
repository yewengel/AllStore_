import test from 'node:test';
import assert from 'node:assert/strict';
import { getRequestToken } from '../src/api/authToken.js';

const createStorage = (entries) => ({
  getItem(key) {
    return entries[key] ?? null;
  },
});

test('admin payment settings requests use the administrator token, not the shared customer token', () => {
  const storage = createStorage({
    token: 'customer-token',
    adminToken: 'admin-token',
    user: JSON.stringify({ role: 'admin' }),
  });

  assert.equal(getRequestToken('/payment-settings/accounts', storage), 'admin-token');
  assert.equal(getRequestToken('/admin/payments/settings', storage), 'admin-token');
  assert.equal(getRequestToken('/payment-settings/public', storage), 'customer-token');
  assert.equal(getRequestToken('/orders/my-orders', storage), 'customer-token');
});

test('customer sessions never reuse a previously stored administrator token', () => {
  const storage = createStorage({
    token: 'customer-token',
    adminToken: 'old-admin-token',
    user: JSON.stringify({ role: 'customer' }),
  });

  assert.equal(getRequestToken('/payment-settings/accounts', storage), 'customer-token');
});

test('malformed stored user data does not prevent normal authenticated requests', () => {
  const storage = createStorage({ token: 'current-token', user: '{' });

  assert.equal(getRequestToken('/payment-settings/accounts', storage), 'current-token');
});
