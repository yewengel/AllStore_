const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Review = require('../models/Review');

const getProductReviews = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.productId)) {
      return res.status(404).json({ status: 'error', message: 'Product not found.' });
    }
    if (!(await Product.exists({ _id: req.params.productId }))) {
      return res.status(404).json({ status: 'error', message: 'Product not found.' });
    }

    const [reviews, stats] = await Promise.all([
      Review.find({ product: req.params.productId, status: 'Approved' })
        .populate('user', 'name')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Review.aggregate([
        { $match: { product: new mongoose.Types.ObjectId(req.params.productId), status: 'Approved' } },
        { $group: { _id: null, count: { $sum: 1 }, averageRating: { $avg: '$rating' } } },
      ]),
    ]);

    return res.json({
      reviews: reviews.map((review) => ({
        id: review._id,
        rating: review.rating,
        body: review.body,
        customerName: review.user?.name || 'Customer',
        createdAt: review.createdAt,
      })),
      reviewCount: stats[0]?.count || 0,
      averageRating: stats[0]?.averageRating || 0,
    });
  } catch (error) {
    return next(error);
  }
};

const createProductReview = async (req, res, next) => {
  try {
    const { rating, body, orderId } = req.body || {};
    if (!mongoose.isValidObjectId(req.params.productId) ||
      !mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ status: 'error', message: 'A valid product and delivered order are required.' });
    }
    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ status: 'error', message: 'Rating must be a whole number from 1 to 5.' });
    }
    if (typeof body !== 'string' || body.trim().length < 3 || body.trim().length > 2000) {
      return res.status(400).json({ status: 'error', message: 'Review text must be between 3 and 2,000 characters.' });
    }
    if (!(await Product.exists({ _id: req.params.productId }))) {
      return res.status(404).json({ status: 'error', message: 'Product not found.' });
    }

    const purchasedOrder = await Order.exists({
      _id: orderId,
      user: req.user._id,
      orderStatus: 'Delivered',
      $or: [
        { orderItems: { $elemMatch: { product: req.params.productId } } },
        { items: { $elemMatch: { product: req.params.productId } } },
      ],
    });
    if (!purchasedOrder) {
      return res.status(403).json({ status: 'error', message: 'A delivered purchase of this product is required to review it.' });
    }

    try {
      const review = await Review.create({
        product: req.params.productId,
        user: req.user._id,
        order: orderId,
        rating: numericRating,
        body: body.trim(),
      });
      return res.status(201).json({
        id: review._id,
        rating: review.rating,
        body: review.body,
        status: review.status,
        createdAt: review.createdAt,
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ status: 'error', message: 'You have already reviewed this product for that purchase.' });
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
};

const getPendingReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find({ status: 'Pending' })
      .populate('product', 'name')
      .populate('user', 'name email')
      .populate('order', 'orderNumber')
      .sort({ createdAt: 1 });
    return res.json(reviews);
  } catch (error) {
    return next(error);
  }
};

const moderateReview = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ status: 'error', message: 'Pending review not found.' });
    }
    const { status, moderationNote = '' } = req.body || {};
    if (!['Approved', 'Rejected'].includes(status) ||
      typeof moderationNote !== 'string' ||
      moderationNote.length > 500) {
      return res.status(400).json({ status: 'error', message: 'Choose Approved or Rejected and provide a moderation note of at most 500 characters.' });
    }
    const review = await Review.findOneAndUpdate(
      { _id: req.params.id, status: 'Pending' },
      { $set: { status, moderationNote: moderationNote.trim() } },
      { new: true, runValidators: true }
    );
    if (!review) {
      return res.status(404).json({ status: 'error', message: 'Pending review not found.' });
    }
    return res.json(review);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getProductReviews,
  createProductReview,
  getPendingReviews,
  moderateReview,
};
