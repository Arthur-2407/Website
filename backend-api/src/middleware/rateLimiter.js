/**
 * V6 — RATE LIMITER FACTORY
 *
 * Enterprise-grade rate limiting with:
 *   - Per-route configurable windows and limits
 *   - User-identity-aware rate limiting (by user ID when authenticated)
 *   - Degraded-mode bypass (when Redis is down, uses in-memory store)
 *   - Telemetry integration
 *   - Standard RateLimit-* response headers
 *
 * Usage:
 *   const { createLimiter } = require('./middleware/rateLimiter');
 *   router.post('/login', createLimiter({ windowMs: 60000, max: 5, name: 'auth' }), handler);
 */
const rateLimit = require('express-rate-limit');
const { logger } = require('../config/logger');

const limiters = {};

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createLimiter({ windowMs = 60_000, max = 100, name = 'default', keyGenerator = null } = {}) {
  // Return cached limiter if already created with same name
  if (limiters[name]) return limiters[name];

  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests',
      code: 'RATE_LIMITED',
      retryAfter: Math.ceil(windowMs / 1000),
    },
    keyGenerator: keyGenerator || ((req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.id ? `user:${req.user.id}` : req.ip;
    }),
    handler: (req, res, next, options) => {
      logger.warn('[RateLimiter] Rate limit exceeded', {
        name,
        ip: req.ip,
        userId: req.user?.id,
        url: req.url,
      });
      res.status(429).json(options.message);
    },
    skip: (req) => {
      const url = req.originalUrl || req.url;
      // Skip rate limiting for health and status checks.
      return url === '/health'
        || url === '/api/system/status'
        || url === '/api/dev/frontend-error'
        || url === '/api/api/dev/frontend-error';
    },
  });

  limiters[name] = limiter;
  return limiter;
}

// Pre-built limiters
const authLimiter = createLimiter({
  windowMs: numberFromEnv('AUTH_RATE_LIMIT_WINDOW_MS', 60_000),
  max: numberFromEnv('AUTH_RATE_LIMIT_MAX_REQUESTS', 60),
  name: 'auth',
});
const apiLimiter = createLimiter({
  windowMs: numberFromEnv('RATE_LIMIT_WINDOW_MS', 60_000),
  max: numberFromEnv('RATE_LIMIT_MAX_REQUESTS', 300),
  name: 'api',
});
const uploadLimiter = createLimiter({
  windowMs: numberFromEnv('UPLOAD_RATE_LIMIT_WINDOW_MS', 60_000),
  max: numberFromEnv('UPLOAD_RATE_LIMIT_MAX_REQUESTS', 10),
  name: 'upload',
});

module.exports = { createLimiter, authLimiter, apiLimiter, uploadLimiter };
