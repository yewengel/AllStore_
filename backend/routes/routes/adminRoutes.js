const express = require('express');
const { getOverview, getCustomers } = require('../controllers/adminController');
const { getAllOrders, updateOrderTracking } = require('../controllers/orderController');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

router.get('/overview', protect, admin, getOverview);
router.get('/customers', protect, admin, getCustomers);
router.get('/orders', protect, admin, getAllOrders);
router.patch('/orders/:id/tracking', protect, admin, updateOrderTracking);

module.exports = router;
