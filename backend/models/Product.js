const mongoose = require('mongoose');

const productVariantSchema = new mongoose.Schema(
  {
    options: {
      type: Map,
      of: String,
      default: {},
    },
    price: {
      type: Number,
      min: [0, 'Variant price cannot be negative'],
    },
    stockQuantity: {
      type: Number,
      required: true,
      min: [0, 'Variant stock quantity cannot be negative'],
    },
    sku: {
      type: String,
      trim: true,
      default: '',
    },
    image: {
      type: String,
      trim: true,
      default: '',
    },
    colorValue: {
      type: String,
      trim: true,
      default: '',
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true }
);

/**
 * Product Schema
 * Defines products managed by store admins and browsed by customers
 */
const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a product name'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Please provide a product description'],
    },
    price: {
      type: Number,
      required: [true, 'Please provide a product price'],
      min: [0, 'Price cannot be negative'],
    },
    currency: {
      type: String,
      enum: ['ETB', 'USD'],
    },
    priceCurrency: {
      type: String,
      enum: ['ETB', 'USD'],
    },
    category: {
      type: String,
      required: [true, 'Please specify a category'],
      trim: true,
    },
    subcategory: {
      type: String,
      trim: true,
      default: '',
    },
    brand: {
      type: String,
      trim: true,
      default: '',
    },
    keywords: {
      type: [String],
      default: [],
    },
    stockQuantity: {
      type: Number,
      required: [true, 'Please specify stock quantity'],
      min: [0, 'Stock quantity cannot be negative'],
      default: 0,
    },
    image: {
      type: String,
      default: '/uploads/sample-product.png',
    },
    images: {
      type: [String],
      default: [],
    },
    variants: {
      type: [productVariantSchema],
      default: [],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Product', productSchema);

