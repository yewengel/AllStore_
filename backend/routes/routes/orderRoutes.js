const express = require('express');
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  updateOrderTracking,
  cancelOrder,
} = require('../controllers/orderController');
const { protect, admin } = require('../middleware/auth');

// Customer routes
router.post('/', protect, createOrder);
router.get('/my-orders', protect, getMyOrders);
router.get('/myorders', protect, getMyOrders);

// Tracking lookup for a single order (customer-scoped). Declared before '/:id'
// so the more specific path always wins.
router.get('/track/:id', protect, getOrderById);

// Admin order listing
router.get('/', protect, admin, getAllOrders);

// Single order details & status update
router.get('/:id', protect, getOrderById);
router.patch('/:id/cancel', protect, cancelOrder);
router.put('/:id/status', protect, admin, updateOrderStatus);
router.patch('/:id/tracking', protect, admin, updateOrderTracking);

module.exports = router;
