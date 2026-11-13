const fs = require('node:fs/promises');
const path = require('node:path');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { productUploadDir } = require('../middleware/upload');

const resolveManagedFile = (imagePath) => {
  if (typeof imagePath !== 'string' || !imagePath.startsWith('/uploads/products/')) return null;

  const fileName = imagePath.slice('/uploads/products/'.length);
  if (!fileName || path.basename(fileName) !== fileName) return null;

  const absolutePath = path.resolve(productUploadDir, fileName);
  return path.dirname(absolutePath) === path.resolve(productUploadDir) ? absolutePath : null;
};

const discardUploadedFile = async (file) => {
  if (!file?.path) return;
  await fs.unlink(file.path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
};

const removeProductImageIfUnreferenced = async (imagePath) => {
  const absolutePath = resolveManagedFile(imagePath);
  if (!absolutePath) return;

  const [productReference, orderReference] = await Promise.all([
    Product.exists({ image: imagePath }),
    Order.exists({ 'orderItems.image': imagePath }),
  ]);
  if (productReference || orderReference) return;

  await fs.unlink(absolutePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
};

module.exports = {
  discardUploadedFile,
  removeProductImageIfUnreferenced,
};
