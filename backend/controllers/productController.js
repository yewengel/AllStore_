const Product = require('../models/Product');
const {
  discardUploadedFile,
  removeProductImageIfUnreferenced,
} = require('../utils/productImages');
const { toEtbMongoExpression } = require('../utils/currency');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cleanupFailedUpload = async (file) => {
  try {
    await discardUploadedFile(file);
  } catch {
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

  if (fields.image !== undefined) {
    const image = typeof fields.image === 'string' ? fields.image.trim() : '';
    if (
      image.length > 2048 ||
      (image && !/^https?:\/\/\S+$/i.test(image) && !/^\/(?!\/)/.test(image))
    ) {
      errors.push('image must be an HTTP(S) URL or a local path no longer than 2048 characters');
    } else {
      fields.image = image;
    }
  }
  return errors;
};

/**
 * @desc    Fetch all products with search & filter support
 * @route   GET /api/products
 * @access  Public
 */
const getProducts = async (req, res, next) => {
  try {
    const { keyword, search, category, minPrice, maxPrice, sort, page, limit } = req.query;
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
    if (searchTerm !== undefined && typeof searchTerm !== 'string') {
      return res.status(400).json({ status: 'error', message: 'search must be a string' });
    }
    if (searchTerm && searchTerm.trim() !== '') {
      filter.name = {
        $regex: escapeRegex(searchTerm.trim()),
        $options: 'i',
      };
    }

    // Filter by category
    if (category !== undefined && typeof category !== 'string') {
      return res.status(400).json({ status: 'error', message: 'category must be a string' });
    }
    if (category && category.trim() !== '' && category !== 'All') {
      filter.category = category.trim();
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
        priceRange.push({ $gte: [toEtbMongoExpression('$price', '$currency'), minimum] });
      }
      if (maxPrice !== undefined) {
        if (typeof maxPrice !== 'string' || !maxPrice.trim()) {
          return res.status(400).json({ status: 'error', message: 'maxPrice must be a non-negative number' });
        }
        const maximum = Number(maxPrice);
        if (!Number.isFinite(maximum) || maximum < 0) {
          return res.status(400).json({ status: 'error', message: 'maxPrice must be a non-negative number' });
        }
        priceRange.push({ $lte: [toEtbMongoExpression('$price', '$currency'), maximum] });
      }
      const minimum = priceRange.find((constraint) => constraint.$gte)?.$gte[1];
      const maximum = priceRange.find((constraint) => constraint.$lte)?.$lte[1];
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        return res.status(400).json({ status: 'error', message: 'minPrice cannot be greater than maxPrice' });
      }
      filter.$expr = priceRange.length === 1 ? priceRange[0] : { $and: priceRange };
    }

    // Sorting
    const priceSort = sort === 'price-asc' || sort === 'price-desc';
    let products;
    if (priceSort) {
      const pipeline = [
        { $match: filter },
        { $addFields: { __priceEtb: toEtbMongoExpression('$price', '$currency') } },
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
    } else {
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
 * @desc    Fetch single product by ID
 * @route   GET /api/products/:id
 * @access  Public
 */
const getProductById = async (req, res, next) => {
  try {
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
  try {
    const fields = { ...req.body };
    const validationErrors = validateProductFields(fields);
    if (validationErrors.length > 0) {
      await cleanupFailedUpload(req.file);
      return res.status(400).json({ status: 'error', message: validationErrors.join(', ') });
    }

    const product = new Product({
      name: fields.name.trim(),
      description: fields.description.trim(),
      price: fields.price,
      currency: 'ETB',
      category: fields.category.trim(),
      stockQuantity: fields.stockQuantity,
      image: req.file ? `/uploads/products/${req.file.filename}` : fields.image,
      user: req.user._id,
    });

    const createdProduct = await product.save();
    saved = true;
    return res.status(201).json(createdProduct);
  } catch (error) {
    if (!saved) await cleanupFailedUpload(req.file);
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
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      await cleanupFailedUpload(req.file);
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }

    const fields = { ...req.body };
    const validationErrors = validateProductFields(fields, { partial: true });
    if (validationErrors.length > 0) {
      await cleanupFailedUpload(req.file);
      return res.status(400).json({ status: 'error', message: validationErrors.join(', ') });
    }

    const oldImage = product.image;
    for (const field of ['name', 'description', 'price', 'category', 'stockQuantity']) {
      if (fields[field] !== undefined) {
        product[field] = typeof fields[field] === 'string' ? fields[field].trim() : fields[field];
      }
    }
    if (fields.price !== undefined) product.currency = 'ETB';
    if (req.file) {
      product.image = `/uploads/products/${req.file.filename}`;
    } else if (fields.image !== undefined) {
      product.image = fields.image;
    }

    const updatedProduct = await product.save();
    saved = true;
    if (oldImage !== updatedProduct.image) {
      try {
        await removeProductImageIfUnreferenced(oldImage);
      } catch {
        console.error('⚠️ [Product Image]: Failed to remove a replaced unreferenced image.');
      }
    }
    return res.json(updatedProduct);
  } catch (error) {
    if (!saved) await cleanupFailedUpload(req.file);
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
    try {
      await removeProductImageIfUnreferenced(product.image);
    } catch {
      console.error('⚠️ [Product Image]: Failed to remove an unreferenced product image.');
    }
    return res.json({ message: 'Product successfully removed' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
  getCategories,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
