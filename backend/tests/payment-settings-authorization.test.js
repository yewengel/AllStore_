const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const PaymentSetting = require('../models/PaymentSetting');
const paymentSettingsRoutes = require('../routes/paymentSettingsRoutes');

const request = async (baseUrl, method, route, token, body) => {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
};

test('payment account routes allow admins to manage accounts and reject customer tokens', async () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalFindById = User.findById;
  const originalFindOne = PaymentSetting.findOne;
  const originalReadyState = mongoose.connection.readyState;
  const adminId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const users = new Map([
    [adminId.toString(), { _id: adminId, role: 'admin' }],
    [customerId.toString(), { _id: customerId, role: 'customer' }],
  ]);
  const settings = new PaymentSetting({ key: 'payment', accountsMigrated: true });
  settings.save = async () => settings;
  settings.lean = async () => settings.toObject();
  const app = express();
  app.use(express.json());
  app.use('/api/payment-settings', paymentSettingsRoutes);
  const server = app.listen(0, '127.0.0.1');

  process.env.JWT_SECRET = 'payment-settings-route-test-secret';
  mongoose.connection.readyState = 1;
  User.findById = (id) => ({ select: async () => users.get(String(id)) || null });
  PaymentSetting.findOne = () => settings;

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/payment-settings`;
    const adminToken = jwt.sign({ id: adminId.toString() }, process.env.JWT_SECRET);
    const customerToken = jwt.sign({ id: customerId.toString() }, process.env.JWT_SECRET);

    assert.equal((await request(baseUrl, 'GET', '/', adminToken)).status, 200);

    const bank = await request(baseUrl, 'POST', '/accounts', adminToken, {
      name: 'CBE',
      type: 'bank',
      provider: 'Commercial Bank of Ethiopia',
      accountHolder: 'AllStore',
      accountDetails: 'test-bank-account',
      active: true,
    });
    assert.equal(bank.status, 201);
    const bankId = bank.body.accounts[0].id;

    const publicSettings = await request(baseUrl, 'GET', '/public');
    assert.equal(publicSettings.status, 200);
    assert.equal(publicSettings.body.accounts.length, 1);
    assert.equal(publicSettings.body.accounts[0].id, bankId);
    assert.equal(publicSettings.body.accounts[0].accountDetails, 'test-bank-account');
    assert.equal(publicSettings.body.accounts[0].active, true);

    const mobileMoney = await request(baseUrl, 'POST', '/accounts', adminToken, {
      name: 'Telebirr',
      type: 'mobile-money',
      provider: 'Telebirr',
      accountHolder: 'AllStore',
      accountDetails: 'test-mobile-number',
      active: false,
    });
    assert.equal(mobileMoney.status, 201);
    const mobileId = mobileMoney.body.accounts.find((account) => account.name === 'Telebirr').id;

    const deactivateBank = await request(baseUrl, 'PUT', `/accounts/${bankId}`, adminToken, { active: false });
    assert.equal(deactivateBank.status, 200);
    assert.equal(deactivateBank.body.accounts.find((account) => account.id === bankId).active, false);
    const activateBank = await request(baseUrl, 'PUT', `/accounts/${bankId}`, adminToken, { active: true });
    assert.equal(activateBank.status, 200);
    assert.equal(activateBank.body.accounts.find((account) => account.id === bankId).active, true);

    const activateMobile = await request(baseUrl, 'PUT', `/accounts/${mobileId}`, adminToken, { active: true });
    assert.equal(activateMobile.status, 200);
    assert.equal(activateMobile.body.accounts.find((account) => account.id === mobileId).active, true);
    const deactivateMobile = await request(baseUrl, 'PUT', `/accounts/${mobileId}`, adminToken, { active: false });
    assert.equal(deactivateMobile.status, 200);
    assert.equal(deactivateMobile.body.accounts.find((account) => account.id === mobileId).active, false);
    assert.equal((await request(baseUrl, 'DELETE', `/accounts/${mobileId}`, adminToken)).status, 200);

    for (const [method, route, body] of [
      ['GET', '/', undefined],
      ['POST', '/accounts', { name: 'Unauthorized', type: 'bank' }],
      ['PUT', `/accounts/${bankId}`, { active: false }],
      ['DELETE', `/accounts/${bankId}`, undefined],
    ]) {
      assert.equal((await request(baseUrl, method, route, customerToken, body)).status, 403);
    }

    const finalSettings = await request(baseUrl, 'GET', '/', adminToken);
    assert.equal(finalSettings.body.accounts.length, 1);
    assert.equal(finalSettings.body.accounts[0].name, 'CBE');
    assert.equal((await request(baseUrl, 'DELETE', `/accounts/${bankId}`, adminToken)).status, 200);
    const noActiveAccounts = await request(baseUrl, 'GET', '/public');
    assert.equal(noActiveAccounts.status, 200);
    assert.equal(noActiveAccounts.body.accounts.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    User.findById = originalFindById;
    PaymentSetting.findOne = originalFindOne;
    mongoose.connection.readyState = originalReadyState;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});
