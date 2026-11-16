const multer = require('multer');
const path = require('node:path');

const allowedTypes = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.get(extension) === file.mimetype) return callback(null, true);
    return callback(Object.assign(
      new Error('Payment receipts must be JPG, JPEG, PNG, or WebP images.'),
      { statusCode: 400 }
    ));
  },
});

const hasValidReceiptSignature = (file) => {
  const { buffer, mimetype } = file;
  if (mimetype === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimetype === 'image/webp') {
    return buffer.length >= 20 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP' &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.subarray(12, 16).toString('ascii')) &&
      buffer.readUInt32LE(4) + 8 <= buffer.length;
  }
  return false;
};

module.exports = {
  uploadPaymentReceipt: upload.single('receipt'),
  hasValidReceiptSignature,
};
