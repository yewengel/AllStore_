const express = require('express');
const router = express.Router();
const {
  getProducts,
  getCategories,
  getProductFilters,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const { getProductReviews, createProductReview } = require('../controllers/reviewController');
const { protect, admin, customer } = require('../middleware/auth');
const { upload, validateImageSignature } = require('../middleware/upload');

// Public product routes
router.get('/', getProducts);
router.get('/categories', getCategories);
router.get('/filters', getProductFilters);
router.get('/:productId/reviews', getProductReviews);
router.post('/:productId/reviews', protect, customer, createProductReview);
router.get('/:id', getProductById);

// Protected Admin product management routes
const productImageFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'galleryImages', maxCount: 10 },
]);

router.post('/', protect, admin, productImageFields, validateImageSignature, createProduct);
router.put('/:id', protect, admin, productImageFields, validateImageSignature, updateProduct);
router.delete('/:id', protect, admin, deleteProduct);

module.exports = router;
