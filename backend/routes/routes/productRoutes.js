const express = require('express');
const router = express.Router();
const {
  getProducts,
  getCategories,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const { protect, admin } = require('../middleware/auth');
const { upload, validateImageSignature } = require('../middleware/upload');

// Public product routes
router.get('/', getProducts);
router.get('/categories', getCategories);
router.get('/:id', getProductById);

// Protected Admin product management routes
router.post('/', protect, admin, upload.single('image'), validateImageSignature, createProduct);
router.put('/:id', protect, admin, upload.single('image'), validateImageSignature, updateProduct);
router.delete('/:id', protect, admin, deleteProduct);

module.exports = router;
