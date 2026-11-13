const jwt = require('jsonwebtoken');
const User = require('../models/User');

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured.');
  }
  return secret;
};

/**
 * Generate a JSON Web Token for authenticated users
 * @param {string} id - User ID
 * @returns {string} Signed JWT
 */
const generateToken = (id) => {
  return jwt.sign({ id }, getJwtSecret(), { expiresIn: '30d' });
};

/**
 * Protect routes: Verify JWT in Authorization header
 */
const protect = async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return res.status(401).json({ status: 'error', message: 'Not authorized, no valid bearer token provided' });
  }

  let decoded;
  try {
    decoded = jwt.verify(tokenMatch[1], getJwtSecret());
  } catch (error) {
    if (
      error.name === 'JsonWebTokenError' ||
      error.name === 'TokenExpiredError' ||
      error.name === 'NotBeforeError'
    ) {
      return res.status(401).json({ status: 'error', message: 'Not authorized, token failed or expired' });
    }
    return next(error);
  }

  try {
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'User belonging to this token no longer exists' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Admin authorization: Restrict route access to users with role === 'admin'
 * Requirement: Customers cannot access Admin routes (return 403 Forbidden)
 */
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({
    status: 'error',
    message: 'Forbidden: Admin access required',
  });
};

module.exports = {
  generateToken,
  getJwtSecret,
  protect,
  admin,
};
