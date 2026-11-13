const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const { randomUUID } = require('node:crypto');

const productUploadDir = path.join(__dirname, '..', 'uploads', 'products');
fs.mkdirSync(productUploadDir, { recursive: true });

const allowedTypes = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, productUploadDir);
  },
  filename(req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${randomUUID()}${extension}`);
  },
});

const fileFilter = (req, file, callback) => {
  const extension = path.extname(file.originalname).toLowerCase();
  if (allowedTypes.get(extension) === file.mimetype) {
    return callback(null, true);
  }
  return callback(Object.assign(new Error('Only JPG, JPEG, PNG, and WebP images are allowed.'), { statusCode: 400 }));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
});

const validateImageSignature = async (req, res, next) => {
  if (!req.file) return next();

  try {
    const handle = await fs.promises.open(req.file.path, 'r');
    let header;
    try {
      header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      header = header.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }

    const isJpeg = header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isPng = header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp =
      header.length >= 12 &&
      header.toString('ascii', 0, 4) === 'RIFF' &&
      header.toString('ascii', 8, 12) === 'WEBP';

    if (!isJpeg && !isPng && !isWebp) {
      await fs.promises.unlink(req.file.path);
      return next(Object.assign(new Error('Uploaded file content is not a valid JPG, PNG, or WebP image.'), { statusCode: 400 }));
    }

    return next();
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') {
        console.error('⚠️ [Product Image]: Failed to clean up an invalid upload.');
      }
    });
    return next(error);
  }
};

module.exports = {
  upload,
  validateImageSignature,
  productUploadDir,
};
