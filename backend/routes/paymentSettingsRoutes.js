const express = require('express');
const { getPublicPaymentSettings } = require('../controllers/paymentController');
const {
  getAdminPaymentSettings,
  updateAdminPaymentSettings,
} = require('../controllers/adminPaymentController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.get('/public', getPublicPaymentSettings);
router.get('/', protect, admin, getAdminPaymentSettings);
router.put('/', protect, admin, updateAdminPaymentSettings);

module.exports = router;
