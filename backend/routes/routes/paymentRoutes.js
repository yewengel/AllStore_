const express = require('express');
const {
  getAllPayments,
  getMyPayments,
  uploadBankTransferReceipt,
  getBankTransferReceipt,
  getCustomerPaymentReceipt,
  reviewBankTransfer,
} = require('../controllers/paymentController');
const { uploadPaymentReceipt } = require('../middleware/paymentReceiptUpload');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.post('/bank-transfer/:id/receipt', protect, uploadPaymentReceipt, uploadBankTransferReceipt);
// Customer-scoped payment history and receipt download (own records only).
router.get('/my-payments', protect, getMyPayments);
router.get('/bank-transfer/:id/receipt', protect, getCustomerPaymentReceipt);
router.get('/admin', protect, admin, getAllPayments);
router.get('/admin/:id/receipt', protect, admin, getBankTransferReceipt);
router.patch('/admin/:id/review', protect, admin, reviewBankTransfer);

module.exports = router;
