const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Product = require('../models/Product');
const User = require('../models/User');

const getWishlist = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('wishlist').lean();
    return res.json((user?.wishlist || []).filter(Boolean));
  } catch (error) {
    return next(error);
  }
};

const addWishlistItem = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.productId)) {
      return res.status(400).json({ status: 'error', message: 'Invalid product ID.' });
    }
    const product = await Product.findById(req.params.productId).select('_id');
    if (!product) return res.status(404).json({ status: 'error', message: 'Product not found.' });
    await User.updateOne({ _id: req.user._id }, { $addToSet: { wishlist: product._id } });
    return res.status(200).json({ productId: product._id, saved: true });
  } catch (error) {
    return next(error);
  }
};

const removeWishlistItem = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.productId)) {
      return res.status(400).json({ status: 'error', message: 'Invalid product ID.' });
    }
    await User.updateOne({ _id: req.user._id }, { $pull: { wishlist: req.params.productId } });
    return res.json({ productId: req.params.productId, saved: false });
  } catch (error) {
    return next(error);
  }
};

const getRecentlyViewed = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('recentlyViewed').lean();
    return res.json((user?.recentlyViewed || []).filter(Boolean));
  } catch (error) {
    return next(error);
  }
};

const addRecentlyViewed = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.productId)) {
      return res.status(400).json({ status: 'error', message: 'Invalid product ID.' });
    }
    const product = await Product.findById(req.params.productId).select('_id');
    if (!product) return res.status(404).json({ status: 'error', message: 'Product not found.' });
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ status: 'error', message: 'Customer account not found.' });
    user.recentlyViewed = [
      product._id,
      ...(user.recentlyViewed || []).filter((id) => String(id) !== String(product._id)),
    ].slice(0, 12);
    await user.save();
    return res.json({ productId: product._id, tracked: true });
  } catch (error) {
    return next(error);
  }
};

const getNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json(notifications);
  } catch (error) {
    return next(error);
  }
};

const markNotificationRead = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ status: 'error', message: 'Notification not found.' });
    }
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ status: 'error', message: 'Notification not found.' });
    return res.json(notification);
  } catch (error) {
    return next(error);
  }
};

const markAllNotificationsRead = async (req, res, next) => {
  try {
    const readAt = new Date();
    const result = await Notification.updateMany(
      { user: req.user._id, readAt: null },
      { $set: { readAt } }
    );
    return res.json({ modifiedCount: result.modifiedCount });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getWishlist,
  addWishlistItem,
  removeWishlistItem,
  getRecentlyViewed,
  addRecentlyViewed,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
