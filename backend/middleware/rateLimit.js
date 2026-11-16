const createRateLimiter = ({ windowMs, max, message }) => {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ status: 'error', message });
    }

    bucket.count += 1;
    if (buckets.size > 5000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    return next();
  };
};

module.exports = { createRateLimiter };
