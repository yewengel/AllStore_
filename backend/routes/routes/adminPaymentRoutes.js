const express = require('express');
const {
  getPaymentStats,
  getTransactions,
  getTransactionDetail,
  getBankTransfers,
  getCodOrders,
  collectCod,
  getRefunds,
  getRefundDetail,
  createRefund,
  reviewRefund,
  processRefund,
  completeRefund,
  getAdminPaymentSettings,
  updateAdminPaymentSettings,
} = require('../controllers/adminPaymentController');
const { reviewBankTransfer, getBankTransferReceipt } = require('../controllers/paymentController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

// Every admin payment endpoint requires an authenticated administrator.
router.use(protect, admin);

// Dashboard statistics
router.get('/stats', getPaymentStats);

// Transactions
router.get('/transactions', getTransactions);
router.get('/transactions/:id', getTransactionDetail);

// Bank transfer verification
router.get('/bank-transfers', getBankTransfers);
router.get('/bank-transfers/:id', getTransactionDetail);
router.get('/bank-transfers/:id/receipt', getBankTransferReceipt);
router.patch('/bank-transfers/:id/review', reviewBankTransfer);

// Cash on delivery
router.get('/cod', getCodOrders);
router.post('/cod/:id/collect', collectCod);

// Refund management
router.get('/refunds', getRefunds);
router.get('/refunds/:id', getRefundDetail);
router.post('/refunds', createRefund);
router.patch('/refunds/:id/review', reviewRefund);
router.post('/refunds/:id/process', processRefund);
router.post('/refunds/:id/complete', completeRefund);

// Payment settings
router.get('/settings', getAdminPaymentSettings);
router.put('/settings', updateAdminPaymentSettings);

module.exports = router;
