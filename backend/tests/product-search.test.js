const test = require('node:test');
const assert = require('node:assert/strict');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { toEtbMongoExpression } = require('../utils/currency');
const {
  getProducts,
  getProductFilters,
  createProduct,
  updateProduct,
} = require('../controllers/productController');

const createResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('search combines partial terms across product text fields with category, subcategory, and brand filters', async () => {
  const originalFind = Product.find;
  let capturedFilter;
  Product.find = (filter) => {
    capturedFilter = filter;
    return { sort: async () => [{ _id: 'matching-product', name: 'Wireless Headphones' }] };
  };

  try {
    const response = createResponse();
    await getProducts(
      {
        query: {
          search: 'wireless headphone',
          category: 'Electronics',
          subcategory: 'Audio',
          brand: 'A.C.M.E',
        },
      },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.count, 1);
    assert.equal(capturedFilter.category.$regex, '^Electronics$');
    assert.equal(capturedFilter.subcategory.$regex, '^Audio$');
    assert.equal(capturedFilter.brand.$regex, '^A\\.C\\.M\\.E$');
    assert.equal(capturedFilter.$and.length, 2);
    assert.deepEqual(
      capturedFilter.$and[0].$or.map((entry) => Object.keys(entry)[0]),
      ['name', 'description', 'category', 'subcategory', 'brand', 'keywords']
    );
    assert.equal(capturedFilter.$and[0].$or[0].name.$options, 'i');
    assert.equal(capturedFilter.$and[1].$or[0].name.$regex, 'headphone');
  } finally {
    Product.find = originalFind;
  }
});

test('price range and sorting use canonical or legacy product currency fields', async () => {
  const originalAggregate = Product.aggregate;
  const originalCountDocuments = Product.countDocuments;
  let pipeline;
  Product.aggregate = async (value) => {
    pipeline = value;
    return [{ _id: 'priced-product' }];
  };
  Product.countDocuments = async () => 1;

  try {
    const response = createResponse();
    await getProducts(
      {
        query: {
          category: 'Electronics',
          subcategory: 'Audio',
          brand: 'Acme',
          minPrice: '100',
          maxPrice: '500',
          sort: 'price-asc',
          page: '1',
          limit: '10',
        },
      },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.products[0]._id, 'priced-product');
    assert.equal(pipeline[0].$match.category.$regex, '^Electronics$');
    assert.equal(pipeline[0].$match.subcategory.$regex, '^Audio$');
    assert.equal(pipeline[0].$match.brand.$regex, '^Acme$');
    assert.equal(pipeline[0].$match.$expr.$and.length, 2);
    const etbPrice = toEtbMongoExpression('$price', { $ifNull: ['$currency', '$priceCurrency'] });
    assert.deepEqual(pipeline[0].$match.$expr.$and[0].$gte, [etbPrice, 100]);
    assert.deepEqual(pipeline[0].$match.$expr.$and[1].$lte, [etbPrice, 500]);
    assert.deepEqual(pipeline[1].$addFields.__priceEtb, etbPrice);
    assert.deepEqual(pipeline[2].$sort, { __priceEtb: 1, _id: -1 });
  } finally {
    Product.aggregate = originalAggregate;
    Product.countDocuments = originalCountDocuments;
  }
});

test('popular sorting paginates in MongoDB after counting non-cancelled order units', async () => {
  const originalAggregate = Product.aggregate;
  const originalCountDocuments = Product.countDocuments;
  let pipeline;
  Product.aggregate = async (value) => {
    pipeline = value;
    return [{ _id: 'popular-product' }];
  };
  Product.countDocuments = async () => 21;

  try {
    const response = createResponse();
    await getProducts(
      { query: { sort: 'popular', page: '2', limit: '10' } },
      response,
      (error) => { throw error; }
    );

    const orderLookup = pipeline.find((stage) => stage.$lookup)?.$lookup;
    assert.equal(response.body.pages, 3);
    assert.equal(response.body.products[0]._id, 'popular-product');
    assert.equal(orderLookup.from, Order.collection.name);
    assert.deepEqual(orderLookup.pipeline[0], { $match: { orderStatus: { $ne: 'Cancelled' } } });
    assert.deepEqual(pipeline.find((stage) => stage.$skip), { $skip: 10 });
    assert.deepEqual(pipeline.find((stage) => stage.$limit), { $limit: 10 });
  } finally {
    Product.aggregate = originalAggregate;
    Product.countDocuments = originalCountDocuments;
  }
});

test('filter facets return database categories and category-specific subcategories and brands', async () => {
  const originalDistinct = Product.distinct;
  const calls = [];
  Product.distinct = async (field, filter) => {
    calls.push({ field, filter });
    if (field === 'category') return ['Electronics'];
    if (field === 'subcategory') return ['Audio', ''];
    return ['Acme', null];
  };

  try {
    const response = createResponse();
    await getProductFilters({ query: { category: 'Electronics' } }, response, (error) => { throw error; });

    assert.deepEqual(response.body, {
      categories: ['Electronics'],
      subcategories: ['Audio'],
      brands: ['Acme'],
    });
    assert.deepEqual(calls[1].filter.category, { $regex: '^Electronics$', $options: 'i' });
    assert.deepEqual(calls[2].filter, calls[1].filter);
  } finally {
    Product.distinct = originalDistinct;
  }
});

test('product creation stores searchable subcategory, brand, and normalized keywords', async () => {
  const originalSave = Product.prototype.save;
  let savedProduct;
  Product.prototype.save = async function save() {
    savedProduct = this;
    return this;
  };

  try {
    const response = createResponse();
    await createProduct(
      {
        body: {
          name: 'Wireless Headphones',
          description: 'Noise cancelling audio',
          price: '50',
          category: 'Electronics',
          subcategory: 'Audio',
          brand: 'Acme',
          keywords: 'wireless, bluetooth, WIRELESS',
          stockQuantity: '3',
        },
        user: { _id: 'admin-id' },
      },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 201);
    assert.equal(savedProduct.subcategory, 'Audio');
    assert.equal(savedProduct.brand, 'Acme');
    assert.deepEqual(savedProduct.keywords, ['wireless', 'bluetooth']);
  } finally {
    Product.prototype.save = originalSave;
  }
});

test('product creation persists gallery images and validated stock variants', async () => {
  const originalSave = Product.prototype.save;
  let savedProduct;
  Product.prototype.save = async function save() {
    savedProduct = this;
    return this;
  };

  try {
    const response = createResponse();
    await createProduct(
      {
        body: {
          name: 'Canvas Backpack',
          description: 'Everyday backpack',
          price: '1200',
          category: 'Accessories',
          stockQuantity: '5',
          images: JSON.stringify(['https://example.test/backpack-side.jpg']),
          variants: JSON.stringify([
            { options: { Color: 'Navy', Size: 'Small' }, price: 1300, stockQuantity: 2, sku: 'BAG-N-S' },
            { options: { color: 'Navy', size: 'Large' }, stockQuantity: 3, sku: 'BAG-N-L' },
          ]),
        },
        user: { _id: 'admin-id' },
      },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 201);
    assert.equal(savedProduct.stockQuantity, 5);
    assert.deepEqual(savedProduct.images, ['https://example.test/backpack-side.jpg']);
    assert.equal(savedProduct.variants.length, 2);
    assert.equal(savedProduct.variants[0].options.get('Color'), 'Navy');
    assert.equal(savedProduct.variants[1].options.get('Color'), 'Navy');
    assert.equal(savedProduct.variants[0].price, 1300);
  } finally {
    Product.prototype.save = originalSave;
  }
});

test('product creation stores uploaded gallery images and unavailable variants safely', async () => {
  const originalSave = Product.prototype.save;
  let savedProduct;
  Product.prototype.save = async function save() {
    savedProduct = this;
    return this;
  };

  try {
    const response = createResponse();
    await createProduct(
      {
        body: {
          name: 'Desk Lamp',
          description: 'Adjustable task lamp',
          price: '800',
          category: 'Home',
          stockQuantity: '8',
          image: '/uploads/products/primary.webp',
          imageManifest: JSON.stringify([
            { path: 'https://example.test/lamp-side.jpg' },
            { uploadIndex: 0 },
          ]),
          variants: JSON.stringify([
            {
              options: { Color: 'Midnight' },
              stockQuantity: 8,
              colorValue: '#171717',
              isAvailable: false,
            },
          ]),
        },
        files: {
          image: [{ filename: 'primary.webp' }],
          galleryImages: [{ filename: 'lamp-back.webp' }],
        },
        user: { _id: 'admin-id' },
      },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 201);
    assert.equal(savedProduct.image, '/uploads/products/primary.webp');
    assert.deepEqual(savedProduct.images, [
      'https://example.test/lamp-side.jpg',
      '/uploads/products/lamp-back.webp',
    ]);
    assert.equal(savedProduct.stockQuantity, 0);
    assert.equal(savedProduct.variants[0].isAvailable, false);
    assert.equal(savedProduct.variants[0].colorValue, '#171717');
  } finally {
    Product.prototype.save = originalSave;
  }
});

test('product updates retain existing variant IDs and protect variants used by active orders', async () => {
  const originalFindById = Product.findById;
  const originalOrderExists = Order.exists;
  const variantId = new Product()._id;
  const product = new Product({
    name: 'Canvas Backpack',
    description: 'Everyday backpack',
    price: 1200,
    category: 'Accessories',
    stockQuantity: 2,
    variants: [{ _id: variantId, options: { Color: 'Navy' }, stockQuantity: 2 }],
  });
  let saveCalled = false;
  product.save = async () => {
    saveCalled = true;
    return product;
  };
  Product.findById = async () => product;
  Order.exists = async () => null;

  try {
    const updateResponse = createResponse();
    await updateProduct(
      {
        params: { id: product._id.toString() },
        body: {
          variants: JSON.stringify([{
            _id: variantId.toString(),
            options: { Color: 'Navy' },
            stockQuantity: 2,
          }]),
        },
      },
      updateResponse,
      (error) => { throw error; }
    );
    assert.equal(updateResponse.statusCode, 200);
    assert.equal(product.variants[0]._id.toString(), variantId.toString());
    assert.equal(saveCalled, true);

    saveCalled = false;
    Order.exists = async () => ({ _id: new Product()._id });
    const removalResponse = createResponse();
    await updateProduct(
      {
        params: { id: product._id.toString() },
        body: { variants: '[]' },
      },
      removalResponse,
      (error) => { throw error; }
    );
    assert.equal(removalResponse.statusCode, 409);
    assert.equal(saveCalled, false);
  } finally {
    Product.findById = originalFindById;
    Order.exists = originalOrderExists;
  }
});

test('invalid minimum and maximum prices are rejected before querying products', async () => {
  const originalFind = Product.find;
  let queried = false;
  Product.find = () => {
    queried = true;
    return { sort: async () => [] };
  };

  try {
    const response = createResponse();
    await getProducts(
      { query: { minPrice: '500', maxPrice: '100' } },
      response,
      (error) => { throw error; }
    );

    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /minPrice cannot be greater than maxPrice/);
    assert.equal(queried, false);
  } finally {
    Product.find = originalFind;
  }
});
