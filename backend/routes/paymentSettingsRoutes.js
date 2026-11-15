const express = require('express');
const { getPublicPaymentSettings } = require('../controllers/paymentController');
const {
  getAdminPaymentSettings,
  updateAdminPaymentSettings,
  createPaymentAccount,
  updatePaymentAccount,
  deletePaymentAccount,
} = require('../controllers/adminPaymentController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.get('/public', getPublicPaymentSettings);
router.get('/', protect, admin, getAdminPaymentSettings);
router.put('/', protect, admin, updateAdminPaymentSettings);
router.post('/accounts', protect, admin, createPaymentAccount);
router.put('/accounts/:id', protect, admin, updatePaymentAccount);
router.delete('/accounts/:id', protect, admin, deletePaymentAccount);

module.exports = router;
