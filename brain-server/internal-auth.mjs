import { safeEqual } from './timing-safe.mjs';

const API_INTERNAL_KEY = process.env.API_INTERNAL_KEY?.trim() ?? '';

export function extractInternalToken(req) {
  const auth = req.headers.authorization?.trim();
  if (auth?.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) {
    return apiKey.trim();
  }
  return undefined;
}

export function internalAuthConfigured() {
  return Boolean(API_INTERNAL_KEY);
}

export function verifyInternalToken(req) {
  if (!API_INTERNAL_KEY) {
    return { ok: false, status: 503, error: 'API_INTERNAL_KEY not configured' };
  }
  const token = extractInternalToken(req);
  if (!token || !safeEqual(token, API_INTERNAL_KEY)) {
    return {
      ok: false,
      status: 401,
      error: 'Invalid signature or unauthorized infrastructure proxy call.',
    };
  }
  return { ok: true };
}