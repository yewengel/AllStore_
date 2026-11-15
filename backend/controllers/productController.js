const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const {
  discardUploadedFile,
  removeProductImageIfUnreferenced,
} = require('../utils/productImages');
const { getUploadedFiles } = require('../middleware/upload');
const { toEtbMongoExpression } = require('../utils/currency');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactMatch = (value) => ({ $regex: `^${escapeRegex(value)}$`, $options: 'i' });
const PRODUCT_SEARCH_FIELDS = ['name', 'description', 'category', 'subcategory', 'brand', 'keywords'];
const PRODUCT_CURRENCY_EXPRESSION = { $ifNull: ['$currency', '$priceCurrency'] };
const isValidImageReference = (value) => (
  typeof value === 'string' &&
  value.length <= 2048 &&
  (/^https?:\/\/\S+$/i.test(value) || /^\/(?!\/)/.test(value))
);

const parseArrayField = (value, field, errors) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') {
    errors.push(`${field} must be an array`);
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch {
    errors.push(`${field} must be a valid JSON array`);
    return null;
  }
};

const cleanupFailedUpload = async (files) => {
  const uploadedFiles = Array.isArray(files) ? files : files ? [files] : [];
  const results = await Promise.allSettled(uploadedFiles.map((file) => discardUploadedFile(file)));
  if (results.some((result) => result.status === 'rejected')) {
    console.error('⚠️ [Product Image]: Failed to clean up an unreferenced upload.');
  }
};

const validateProductFields = (fields, { partial = false } = {}) => {
  const errors = [];
  for (const field of ['name', 'description', 'category']) {
    if (fields[field] === undefined && partial) continue;
    if (typeof fields[field] !== 'string' || !fields[field].trim()) {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  for (const field of ['price', 'stockQuantity']) {
    if (fields[field] === undefined && partial) continue;
    const value = Number(fields[field]);
    if (
      (typeof fields[field] === 'string' && !fields[field].trim()) ||
      !Number.isFinite(value) ||
      value < 0 ||
      (field === 'stockQuantity' && !Number.isInteger(value))
    ) {
      errors.push(`${field} must be a valid ${field === 'price' ? 'non-negative number' : 'non-negative integer'}`);
    } else {
      fields[field] = value;
    }
  }

  for (const field of ['subcategory', 'brand']) {
    if (fields[field] === undefined && partial) continue;
    if (fields[field] !== undefined && (typeof fields[field] !== 'string' || fields[field].length > 120)) {
      errors.push(`${field} must be a string no longer than 120 characters`);
    } else if (fields[field] !== undefined) {
      fields[field] = fields[field].trim();
    }
  }

  if (fields.keywords !== undefined || !partial) {
    const rawKeywords = fields.keywords === undefined
      ? []
      : Array.isArray(fields.keywords)
        ? fields.keywords
        : typeof fields.keywords === 'string'
          ? fields.keywords.split(',')
          : null;
    if (
      !rawKeywords ||
      rawKeywords.length > 30 ||
      rawKeywords.some((keyword) => typeof keyword !== 'string' || keyword.length > 80)
    ) {
      errors.push('keywords must contain no more than 30 strings of at most 80 characters each');
    } else {
      const seenKeywords = new Set();
      fields.keywords = rawKeywords
        .map((keyword) => keyword.trim())
        .filter((keyword) => {
          const normalized = keyword.toLowerCase();
          if (!keyword || seenKeywords.has(normalized)) return false;
          seenKeywords.add(normalized);
          return true;
        });
    }
  }

  if (fields.image !== undefined) {
    const image = typeof fields.image === 'string' ? fields.image.trim() : '';
    if (image && !isValidImageReference(image)) {
      errors.push('image must be an HTTP(S) URL or a local path no longer than 2048 characters');
    } else {
      fields.image = image;
    }
  }

  if (fields.images !== undefined || !partial) {
    const rawImages = fields.images === undefined ? [] : parseArrayField(fields.images, 'images', errors);
    if (
      rawImages &&
      (rawImages.length > 20 || rawImages.some((image) => !isValidImageReference(image.trim?.() || image)))
    ) {
      errors.push('images must contain no more than 20 valid HTTP(S) URLs or local paths');
    } else if (rawImages) {
      fields.images = [...new Set(rawImages.map((image) => image.trim()))];
    }
  }

  if (fields.imageManifest !== undefined) {
    const manifest = parseArrayField(fields.imageManifest, 'imageManifest', errors);
    if (manifest && (
      manifest.length > 20 ||
      manifest.some((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
        const keys = Object.keys(entry);
        if (keys.length !== 1) return true;
        if (keys[0] === 'path') return !isValidImageReference(entry.path);
        return keys[0] !== 'uploadIndex' || !Number.isInteger(entry.uploadIndex) || entry.uploadIndex < 0;
      })
    )) {
      errors.push('imageManifest must contain no more than 20 valid image references');
    } else if (manifest) {
      fields.imageManifest = manifest;
    }
  }

  if (fields.variants !== undefined || !partial) {
    const rawVariants = fields.variants === undefined ? [] : parseArrayField(fields.variants, 'variants', errors);
    if (rawVariants && rawVariants.length > 100) {
      errors.push('variants cannot contain more than 100 entries');
    } else if (rawVariants) {
      const optionNames = new Set();
      const canonicalOptionNames = new Map();
      const combinations = new Set();
      const variants = [];

      for (const [index, rawVariant] of rawVariants.entries()) {
        if (!rawVariant || typeof rawVariant !== 'object' || Array.isArray(rawVariant)) {
          errors.push(`variant ${index + 1} must be an object`);
          continue;
        }

        const rawOptions = rawVariant.options;
        if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) {
          errors.push(`variant ${index + 1} must include option values`);
          continue;
        }

        const optionEntries = Object.entries(rawOptions);
        const options = Object.create(null);
        const seenOptionNames = new Set();
        if (optionEntries.length < 1 || optionEntries.length > 10) {
          errors.push(`variant ${index + 1} must have between 1 and 10 options`);
          continue;
        }
        let invalidOptions = false;
        for (const [rawName, rawValue] of optionEntries) {
          const name = rawName.trim();
          const value = typeof rawValue === 'string' ? rawValue.trim() : '';
          const normalizedName = name.toLowerCase();
          if (
            !/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,59}$/.test(name) ||
            ['__proto__', 'constructor', 'prototype'].includes(normalizedName) ||
            seenOptionNames.has(normalizedName) ||
            !value ||
            value.length > 100
          ) {
            invalidOptions = true;
            break;
          }
          seenOptionNames.add(normalizedName);
          options[name] = value;
        }
        if (invalidOptions) {
          errors.push(`variant ${index + 1} has invalid or duplicate option names or values`);
          continue;
        }

        const orderedNames = [...seenOptionNames].sort();
        if (optionNames.size === 0) {
          orderedNames.forEach((name) => optionNames.add(name));
          Object.keys(options).forEach((name) => canonicalOptionNames.set(name.toLowerCase(), name));
        }
        else if (orderedNames.join('|') !== [...optionNames].sort().join('|')) {
          errors.push('all variants must use the same option names');
          continue;
        }

        const canonicalOptions = {};
        Object.entries(options).forEach(([name, value]) => {
          canonicalOptions[canonicalOptionNames.get(name.toLowerCase())] = value;
        });
        const combination = Object.entries(options)
          .map(([name, value]) => `${name.toLowerCase()}=${value.toLowerCase()}`)
          .sort()
          .join('|');
        if (combinations.has(combination)) {
          errors.push(`variant ${index + 1} duplicates an existing option combination`);
          continue;
        }
        combinations.add(combination);

        const stockQuantity = Number(rawVariant.stockQuantity);
        if (
          (typeof rawVariant.stockQuantity === 'string' && !rawVariant.stockQuantity.trim()) ||
          !Number.isSafeInteger(stockQuantity) ||
          stockQuantity < 0
        ) {
          errors.push(`variant ${index + 1} must have a non-negative integer stock quantity`);
          continue;
        }

        let price;
        if (rawVariant.price !== undefined && rawVariant.price !== null && rawVariant.price !== '') {
          price = Number(rawVariant.price);
          if (!Number.isFinite(price) || price < 0) {
            errors.push(`variant ${index + 1} price must be a non-negative number`);
            continue;
          }
        }
        const sku = typeof rawVariant.sku === 'string' ? rawVariant.sku.trim() : '';
        const image = typeof rawVariant.image === 'string' ? rawVariant.image.trim() : '';
        const colorValue = typeof rawVariant.colorValue === 'string' ? rawVariant.colorValue.trim() : '';
        const isAvailable = rawVariant.isAvailable === undefined ? true : rawVariant.isAvailable;
        const variantId = rawVariant._id === undefined ? '' : String(rawVariant._id);
        const validColorValue = !colorValue ||
          /^(#[\da-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%\s+-]+\))$/i.test(colorValue);
        if (
          (variantId && !/^[a-f\d]{24}$/i.test(variantId)) ||
          (rawVariant.sku !== undefined && typeof rawVariant.sku !== 'string') ||
          (rawVariant.image !== undefined && typeof rawVariant.image !== 'string') ||
          (rawVariant.colorValue !== undefined && typeof rawVariant.colorValue !== 'string') ||
          typeof isAvailable !== 'boolean' ||
          sku.length > 100 ||
          (image && !isValidImageReference(image)) ||
          colorValue.length > 50 ||
          !validColorValue
        ) {
          errors.push(`variant ${index + 1} has an invalid SKU, image reference, color value, or availability`);
          continue;
        }
        variants.push({
          ...(variantId ? { _id: variantId } : {}),
          options: canonicalOptions,
          ...(price === undefined ? {} : { price }),
          stockQuantity,
          sku,
          image,
          colorValue,
          isAvailable,
        });
      }

      if (variants.length === rawVariants.length) {
        fields.variants = variants;
        fields.stockQuantity = variants.reduce(
          (total, variant) => total + (variant.isAvailable ? variant.stockQuantity : 0),
          0
        );
        if (!Number.isSafeInteger(fields.stockQuantity)) {
          errors.push('total variant stock quantity is too large');
        }
      }
    }
  }
  return errors;
};

const resolveGalleryImages = (fields, uploadedImages) => {
  if (fields.imageManifest === undefined) {
    return {
      images: fields.images,
      errors: uploadedImages.length
        ? ['galleryImages require an imageManifest']
        : [],
    };
  }
  if (!Array.isArray(fields.imageManifest)) {
    return { images: fields.images, errors: [] };
  }

  const usedUploadIndexes = new Set();
  const images = [];
  const errors = [];
  for (const entry of fields.imageManifest) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push('imageManifest contains an invalid entry');
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'path')) {
      images.push(entry.path);
      continue;
    }
    if (entry.uploadIndex >= uploadedImages.length || usedUploadIndexes.has(entry.uploadIndex)) {
      errors.push('imageManifest contains an invalid or repeated upload index');
      continue;
    }
    usedUploadIndexes.add(entry.uploadIndex);
    images.push(`/uploads/products/${uploadedImages[entry.uploadIndex].filename}`);
  }
  if (usedUploadIndexes.size !== uploadedImages.length) {
    errors.push('imageManifest must reference every uploaded gallery image exactly once');
  }
  return { images, errors };
};

const getProductImageUploads = (req) => ({
  primary: req.file || req.files?.image?.[0] || null,
  gallery: req.files?.galleryImages || [],
  all: getUploadedFiles(req),
});

/**
 * @desc    Fetch all products with search & filter support
 * @route   GET /api/products
 * @access  Public
 */
const getProducts = async (req, res, next) => {
  try {
    const {
      keyword,
      search,
      category,
      subcategory,
      brand,
      minPrice,
      maxPrice,
      sort,
      page,
      limit,
    } = req.query;
    const isPaginated = page !== undefined || limit !== undefined;
    let pagination;

    if (isPaginated) {
      const currentPage = page === undefined ? 1 : Number(page);
      const pageSize = limit === undefined ? 30 : Number(limit);
      if (
        (page !== undefined && typeof page !== 'string') ||
        (limit !== undefined && typeof limit !== 'string') ||
        !Number.isInteger(currentPage) ||
        currentPage < 1 ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 100
      ) {
        return res.status(400).json({
          status: 'error',
          message: 'page must be a positive integer and limit must be an integer between 1 and 100',
        });
      }
      pagination = { page: currentPage, limit: pageSize };
    }

    const filter = {};

    const searchTerm = search !== undefined ? search : keyword;
    if (searchTerm !== undefined && (typeof searchTerm !== 'string' || searchTerm.length > 200)) {
      return res.status(400).json({ status: 'error', message: 'search must be a string no longer than 200 characters' });
    }
    if (searchTerm && searchTerm.trim() !== '') {
      const terms = searchTerm.trim().split(/\s+/);
      filter.$and = terms.map((term) => ({
        $or: PRODUCT_SEARCH_FIELDS.map((field) => ({
          [field]: { $regex: escapeRegex(term), $options: 'i' },
        })),
      }));
    }

    for (const [field, value] of Object.entries({ category, subcategory, brand })) {
      if (value !== undefined && typeof value !== 'string') {
        return res.status(400).json({ status: 'error', message: `${field} must be a string` });
      }
      if (value && value.trim() !== '' && !(field === 'category' && value === 'All')) {
        filter[field] = exactMatch(value.trim());
      }
    }

    // Product range filters use ETB even while legacy records remain stored in USD.
    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceRange = [];
      if (minPrice !== undefined) {
        if (typeof minPrice !== 'string' || !minPrice.trim()) {
          return res.status(400).json({ status: 'error', message: 'minPrice must be a non-negative number' });
        }
        const minimum = Number(minPrice);
        if (!Number.isFinite(minimum) || minimum < 0) {
          return res.status(400).json({ status: 'error', message: 'minPrice must be a non-negative number' });
        }
        priceRange.push({ $gte: [toEtbMongoExpression('$price', PRODUCT_CURRENCY_EXPRESSION), minimum] });
      }
      if (maxPrice !== undefined) {
        if (typeof maxPrice !== 'string' || !maxPrice.trim()) {
          return res.status(400).json({ status: 'error', message: 'maxPrice must be a non-negative number' });
        }
        const maximum = Number(maxPrice);
        if (!Number.isFinite(maximum) || maximum < 0) {
          return res.status(400).json({ status: 'error', message: 'maxPrice must be a non-negative number' });
        }
        priceRange.push({ $lte: [toEtbMongoExpression('$price', PRODUCT_CURRENCY_EXPRESSION), maximum] });
      }
      const minimum = priceRange.find((constraint) => constraint.$gte)?.$gte[1];
      const maximum = priceRange.find((constraint) => constraint.$lte)?.$lte[1];
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        return res.status(400).json({ status: 'error', message: 'minPrice cannot be greater than maxPrice' });
      }
      filter.$expr = priceRange.length === 1 ? priceRange[0] : { $and: priceRange };
    }

    let products;

    // Popularity and price sorting are performed before database-side pagination.
    const priceSort = sort === 'price-asc' || sort === 'price-desc';
    if (sort === 'popular') {
      const orderItemsCollection = Order.collection.name;
      const pipeline = [
        { $match: filter },
        {
          $lookup: {
            from: orderItemsCollection,
            let: { productId: '$_id' },
            pipeline: [
              { $match: { orderStatus: { $ne: 'Cancelled' } } },
              {
                $project: {
                  __items: {
                    $cond: [
                      { $gt: [{ $size: { $ifNull: ['$orderItems', []] } }, 0] },
                      '$orderItems',
                      { $ifNull: ['$items', []] },
                    ],
                  },
                },
              },
              { $unwind: '$__items' },
              { $match: { $expr: { $eq: ['$__items.product', '$$productId'] } } },
              { $group: { _id: null, units: { $sum: '$__items.qty' } } },
            ],
            as: '__popularity',
          },
        },
        { $addFields: { __units: { $ifNull: [{ $arrayElemAt: ['$__popularity.units', 0] }, 0] } } },
        { $sort: { __units: -1, createdAt: -1, _id: -1 } },
        ...(pagination
          ? [
              { $skip: (pagination.page - 1) * pagination.limit },
              { $limit: pagination.limit },
            ]
          : []),
        { $project: { __popularity: 0, __units: 0 } },
      ];
      products = await Product.aggregate(pipeline);
    } else if (priceSort) {
      const pipeline = [
        { $match: filter },
        { $addFields: { __priceEtb: toEtbMongoExpression('$price', PRODUCT_CURRENCY_EXPRESSION) } },
        { $sort: { __priceEtb: sort === 'price-asc' ? 1 : -1, _id: -1 } },
        ...(pagination
          ? [
              { $skip: (pagination.page - 1) * pagination.limit },
              { $limit: pagination.limit },
            ]
          : []),
        { $project: { __priceEtb: 0 } },
      ];
      products = await Product.aggregate(pipeline);
    } else if (sort !== 'popular') {
      const sortOption = sort === 'name-asc' ? { name: 1, _id: -1 } : { createdAt: -1, _id: -1 };
      let productsQuery = Product.find(filter).sort(sortOption);
      if (pagination) {
        productsQuery = productsQuery
          .skip((pagination.page - 1) * pagination.limit)
          .limit(pagination.limit);
      }
      products = await productsQuery;
    }
    const total = pagination ? await Product.countDocuments(filter) : null;

    res.json({
      count: products.length,
      products,
      ...(pagination && {
        ...pagination,
        total,
        pages: Math.ceil(total / pagination.limit),
      }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all unique product categories
 * @route   GET /api/products/categories
 * @access  Public
 */
const getCategories = async (req, res, next) => {
  try {
    const categories = await Product.distinct('category');
    res.json(categories);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Fetch category, subcategory, and brand values from the product catalog
 * @route   GET /api/products/filters
 * @access  Public
 */
const getProductFilters = async (req, res, next) => {
  try {
    const { category } = req.query;
    if (category !== undefined && typeof category !== 'string') {
      return res.status(400).json({ status: 'error', message: 'category must be a string' });
    }
    const categoryFilter = category && category.trim() && category !== 'All'
      ? { category: exactMatch(category.trim()) }
      : {};
    const [categories, subcategories, brands] = await Promise.all([
      Product.distinct('category'),
      Product.distinct('subcategory', categoryFilter),
      Product.distinct('brand', categoryFilter),
    ]);
    const cleanValues = (values) => [...new Set(
      values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())
    )].sort((left, right) => left.localeCompare(right));
    return res.json({
      categories: cleanValues(categories),
      subcategories: cleanValues(subcategories),
      brands: cleanValues(brands),
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Fetch single product by ID
 * @route   GET /api/products/:id
 * @access  Public
 */
const getProductById = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }
    const product = await Product.findById(req.params.id);

    if (product) {
      res.json(product);
    } else {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a product with Multer image upload
 * @route   POST /api/products
 * @access  Private / Admin
 */
const createProduct = async (req, res, next) => {
  let saved = false;
  const uploads = getProductImageUploads(req);
  try {
    const fields = { ...req.body };
    const validationErrors = validateProductFields(fields);
    const gallery = resolveGalleryImages(fields, uploads.gallery);
    validationErrors.push(...gallery.errors);
    if (validationErrors.length > 0) {
      await cleanupFailedUpload(uploads.all);
      return res.status(400).json({ status: 'error', message: validationErrors.join(', ') });
    }

    const product = new Product({
      name: fields.name.trim(),
      description: fields.description.trim(),
      price: fields.price,
      currency: 'ETB',
      category: fields.category.trim(),
      subcategory: fields.subcategory || '',
      brand: fields.brand || '',
      keywords: fields.keywords || [],
      stockQuantity: fields.stockQuantity,
      image: uploads.primary ? `/uploads/products/${uploads.primary.filename}` : fields.image,
      images: gallery.images || [],
      variants: (fields.variants || []).map(({ _id, ...variant }) => variant),
      user: req.user._id,
    });

    const createdProduct = await product.save();
    saved = true;
    return res.status(201).json(createdProduct);
  } catch (error) {
    if (!saved) await cleanupFailedUpload(uploads.all);
    next(error);
  }
};

/**
 * @desc    Update a product (Admin)
 * @route   PUT /api/products/:id
 * @access  Private / Admin
 */
const updateProduct = async (req, res, next) => {
  let saved = false;
  const uploads = getProductImageUploads(req);
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      await cleanupFailedUpload(uploads.all);
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }

    const fields = { ...req.body };
    const validationErrors = validateProductFields(fields, { partial: true });
    const gallery = resolveGalleryImages(fields, uploads.gallery);
    validationErrors.push(...gallery.errors);
    if (validationErrors.length > 0) {
      await cleanupFailedUpload(uploads.all);
      return res.status(400).json({ status: 'error', message: validationErrors.join(', ') });
    }
    if (fields.imageManifest !== undefined) fields.images = gallery.images;

    if (
      product.variants.length &&
      fields.stockQuantity !== undefined &&
      fields.variants === undefined
    ) {
      await cleanupFailedUpload(uploads.all);
      return res.status(400).json({ status: 'error', message: 'Update variant stock through the product variants.' });
    }

    if (fields.variants !== undefined) {
      const currentVariantIds = new Set(product.variants.map((variant) => variant._id.toString()));
      const submittedVariantIds = new Set();
      for (const variant of fields.variants) {
        if (!variant._id) continue;
        if (!currentVariantIds.has(variant._id) || submittedVariantIds.has(variant._id)) {
          await cleanupFailedUpload(uploads.all);
          return res.status(400).json({ status: 'error', message: 'A submitted variant does not belong to this product.' });
        }
        submittedVariantIds.add(variant._id);
      }

      const removedVariantIds = [...currentVariantIds].filter((variantId) => !submittedVariantIds.has(variantId));
      if (removedVariantIds.length) {
        const activeOrder = await Order.exists({
          orderStatus: { $nin: ['Delivered', 'Cancelled'] },
          $or: [
            { 'orderItems.variantId': { $in: removedVariantIds } },
            { 'items.variantId': { $in: removedVariantIds } },
          ],
        });
        if (activeOrder) {
          await cleanupFailedUpload(uploads.all);
          return res.status(409).json({
            status: 'error',
            message: 'Variants used by active orders cannot be removed.',
          });
        }
      }
    }

    const oldImages = [product.image, ...(product.images || []), ...(product.variants || []).map((variant) => variant.image)]
      .filter(Boolean);
    for (const field of ['name', 'description', 'price', 'category', 'subcategory', 'brand', 'keywords', 'stockQuantity', 'images', 'variants']) {
      if (fields[field] !== undefined) {
        product[field] = typeof fields[field] === 'string' ? fields[field].trim() : fields[field];
      }
    }
    if (fields.price !== undefined) product.currency = 'ETB';
    if (uploads.primary) {
      product.image = `/uploads/products/${uploads.primary.filename}`;
    } else if (fields.image !== undefined) {
      product.image = fields.image;
    }

    const updatedProduct = await product.save();
    saved = true;
    const retainedImages = new Set([
      updatedProduct.image,
      ...(updatedProduct.images || []),
      ...(updatedProduct.variants || []).map((variant) => variant.image),
    ].filter(Boolean));
    for (const oldImage of oldImages.filter((image) => !retainedImages.has(image))) {
      try {
        await removeProductImageIfUnreferenced(oldImage);
      } catch {
        console.error('⚠️ [Product Image]: Failed to remove a replaced unreferenced image.');
      }
    }
    return res.json(updatedProduct);
  } catch (error) {
    if (!saved) await cleanupFailedUpload(uploads.all);
    next(error);
  }
};

/**
 * @desc    Delete a product (Admin)
 * @route   DELETE /api/products/:id
 * @access  Private / Admin
 */
const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }

    await Product.findByIdAndDelete(req.params.id);
    const productImages = [product.image, ...(product.images || []), ...(product.variants || []).map((variant) => variant.image)]
      .filter(Boolean);
    for (const image of productImages) {
      try {
        await removeProductImageIfUnreferenced(image);
      } catch {
        console.error('⚠️ [Product Image]: Failed to remove an unreferenced product image.');
      }
    }
    return res.json({ message: 'Product successfully removed' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
  getCategories,
  getProductFilters,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
