const express = require('express');
const {
  getWishlist,
  addWishlistItem,
  removeWishlistItem,
  getRecentlyViewed,
  addRecentlyViewed,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../controllers/customerController');
const { protect, customer } = require('../middleware/auth');

const router = express.Router();

router.use(protect, customer);
router.get('/wishlist', getWishlist);
router.post('/wishlist/:productId', addWishlistItem);
router.delete('/wishlist/:productId', removeWishlistItem);
router.get('/recently-viewed', getRecentlyViewed);
router.post('/recently-viewed/:productId', addRecentlyViewed);
router.get('/notifications', getNotifications);
router.patch('/notifications/read-all', markAllNotificationsRead);
router.patch('/notifications/:id/read', markNotificationRead);

module.exports = router;
