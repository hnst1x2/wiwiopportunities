// Tiny dependency-free in-memory rate limiter shared by the public POST endpoints
// (login, register, newsletter, admin login, API writes).
// Single-process by design: the app runs as one container, so a Map is enough and
// avoids pulling in Redis just for brute-force / flood protection.

// Hard cap on tracked keys: expired buckets are dropped first, then the oldest live
// ones, so a flood from many distinct IPs inside one window cannot grow the map without
// bound. Evicting a live bucket resets that key's counter — acceptable, since reaching
// the cap already means the traffic is far beyond a legitimate visitor pattern.
const MAX_TRACKED_KEYS = 5000;

function defaultKey(req) {
  return `${req.ip}|${req.path}`;
}

/**
 * Build a rate-limiting middleware.
 * @param {object} options
 * @param {number} options.max        Allowed requests per window.
 * @param {number} options.windowMs   Window length in milliseconds.
 * @param {Function} options.onLimit  (req, res) => void — sends the "too many requests" response.
 * @param {Function} [options.keyFn]  (req) => string — bucket key, defaults to IP + path.
 * @param {number} [options.maxTrackedKeys] Memory cap on distinct keys.
 */
function createRateLimiter({ max, windowMs, onLimit, keyFn = defaultKey, maxTrackedKeys = MAX_TRACKED_KEYS }) {
  // Insertion-ordered: iterating yields the oldest bucket first, which is what the
  // eviction below relies on.
  const buckets = new Map();

  function evictIfNeeded(now) {
    if (buckets.size <= maxTrackedKeys) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(key);
    }
    for (const key of buckets.keys()) {
      if (buckets.size <= maxTrackedKeys) break;
      buckets.delete(key);
    }
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    evictIfNeeded(now);

    const key = keyFn(req);
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return onLimit(req, res);
    }
    return next();
  };
}

module.exports = { createRateLimiter };
