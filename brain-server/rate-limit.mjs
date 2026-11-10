import { resolveClientIp } from './client-ip.mjs';

const buckets = new Map();

function getBucket(key, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { count: 0, resetAt: now + windowMs };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  return bucket;
}

function sendRateLimited(res, resetAt) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({ error: 'Too many requests', retryAfter });
}

export function createRateLimiter({ name, windowMs, max, keyFn }) {
  return (req, res, next) => {
    const clientKey = keyFn ? keyFn(req) : resolveClientIp(req);
    const key = `${name}:${clientKey}`;
    const bucket = getBucket(key, windowMs);

    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      sendRateLimited(res, bucket.resetAt);
      return;
    }

    next();
  };
}

const AUTH_FAIL_WINDOW_MS = parseInt(process.env.AUTH_FAIL_WINDOW_MS ?? '900000', 10);
const AUTH_FAIL_MAX = parseInt(process.env.AUTH_FAIL_MAX ?? '12', 10);

function authFailKey(req) {
  return `auth-fail:${resolveClientIp(req)}`;
}

/** Block clients that exceeded failed login attempts (per resolved IP, not shared proxy). */
export function checkAuthRateLimit(req, res) {
  const key = authFailKey(req);
  const bucket = buckets.get(key);
  if (!bucket) return true;

  if (Date.now() > bucket.resetAt) {
    buckets.delete(key);
    return true;
  }

  if (bucket.count >= AUTH_FAIL_MAX) {
    sendRateLimited(res, bucket.resetAt);
    return false;
  }

  return true;
}

export function recordAuthFailure(req) {
  const key = authFailKey(req);
  const bucket = getBucket(key, AUTH_FAIL_WINDOW_MS);
  bucket.count += 1;
  buckets.set(key, bucket);
}

export function clearAuthFailures(req) {
  buckets.delete(authFailKey(req));
}