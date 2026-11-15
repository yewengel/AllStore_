const express = require('express');
const {
  getPaymentConfig,
  getAllPayments,
  getMyPayments,
  initializeChapaPayment,
  verifyChapaPayment,
  handleChapaCallback,
  uploadBankTransferReceipt,
  getBankTransferReceipt,
  getCustomerPaymentReceipt,
  reviewBankTransfer,
} = require('../controllers/paymentController');
const { uploadPaymentReceipt } = require('../middleware/paymentReceiptUpload');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.get('/config', getPaymentConfig);
router.get('/chapa/callback', handleChapaCallback);
router.post('/chapa/initialize/:id', protect, initializeChapaPayment);
router.post('/chapa/verify/:id', protect, verifyChapaPayment);
router.post('/bank-transfer/:id/receipt', protect, uploadPaymentReceipt, uploadBankTransferReceipt);
// Customer-scoped payment history and receipt download (own records only).
router.get('/my-payments', protect, getMyPayments);
router.get('/bank-transfer/:id/receipt', protect, getCustomerPaymentReceipt);
router.get('/admin', protect, admin, getAllPayments);
router.get('/admin/:id/receipt', protect, admin, getBankTransferReceipt);
router.patch('/admin/:id/review', protect, admin, reviewBankTransfer);

module.exports = router;
