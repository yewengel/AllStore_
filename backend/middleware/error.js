/**
 * Not Found handler for unmatched routes
 */
const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

/**
 * Centralized Error Handling Middleware
 */
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  let statusCode = Number.isInteger(err.statusCode)
    ? err.statusCode
    : Number.isInteger(err.status)
      ? err.status
      : 500;
  let message = err.message;

  if (err.name === 'MulterError') {
    statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const isReceiptUpload = req.originalUrl.includes('/payments/bank-transfer/');
    message = err.code === 'LIMIT_FILE_SIZE'
      ? `${isReceiptUpload ? 'Payment receipt' : 'Image'} exceeds the 5 MB upload limit.`
      : `Invalid ${isReceiptUpload ? 'payment receipt' : 'image'} upload.`;
  }

  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Request body contains invalid JSON.';
  }
  if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Request body exceeds the allowed size.';
  }

  // Handle Mongoose bad ObjectId (CastError)
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    statusCode = 404;
    message = 'Resource not found with the specified ID';
  }

  // Handle Mongoose duplicate key error (code 11000)
  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue || {})[0] || 'value';
    message = `A record with that ${field} already exists`;
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((val) => val.message)
      .join(', ');
  }

  if (statusCode >= 500) {
    message = process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : message;
  }

  return res.status(statusCode).json({
    status: 'error',
    message,
  });
};

module.exports = {
  notFound,
  errorHandler,
};
