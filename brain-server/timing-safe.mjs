import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison — mitigates timing attacks on secret headers.
 */
export function safeEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}