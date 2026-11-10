function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return 'unknown';
  const trimmed = ip.trim();
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}

/**
 * Resolve the end-user IP behind reverse proxies (Replit, Vercel, Cloudflare).
 * Requires `app.set('trust proxy', …)` so Express populates req.ip from X-Forwarded-For.
 */
export function resolveClientIp(req) {
  if (req.ip) return normalizeIp(req.ip);

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length) return normalizeIp(hops[0]);
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return normalizeIp(realIp);
  }

  return normalizeIp(req.socket?.remoteAddress ?? 'unknown');
}