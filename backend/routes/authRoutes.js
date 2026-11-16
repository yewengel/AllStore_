const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  getUserProfile,
} = require('../controllers/authController');
const {
  requestAdminPasswordReset,
  verifyAdminPasswordResetCode,
  resetAdminPassword,
} = require('../controllers/adminPasswordResetController');
const {
  requestCustomerPasswordReset,
  verifyCustomerPasswordResetCode,
  resetCustomerPassword,
} = require('../controllers/customerPasswordResetController');
const { createRateLimiter } = require('../middleware/rateLimit');
const { protect } = require('../middleware/auth');

const passwordResetRequestLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many password reset requests. Try again later.',
});
const passwordResetVerifyLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many verification attempts. Try again later.',
});
const passwordResetSubmitLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many password reset attempts. Try again later.',
});
const customerPasswordResetRequestLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many password reset requests. Try again later.',
});
const customerPasswordResetVerifyLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many verification attempts. Try again later.',
});
const customerPasswordResetSubmitLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many password reset attempts. Try again later.',
});

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/admin/password-reset/request', passwordResetRequestLimit, requestAdminPasswordReset);
router.post('/admin/password-reset/verify', passwordResetVerifyLimit, verifyAdminPasswordResetCode);
router.post('/admin/password-reset/reset', passwordResetSubmitLimit, resetAdminPassword);
router.post('/customer/password-reset/request', customerPasswordResetRequestLimit, requestCustomerPasswordReset);
router.post('/customer/password-reset/verify', customerPasswordResetVerifyLimit, verifyCustomerPasswordResetCode);
router.post('/customer/password-reset/reset', customerPasswordResetSubmitLimit, resetCustomerPassword);
router.get('/me', protect, getUserProfile);
router.get('/profile', protect, getUserProfile);

module.exports = router;
