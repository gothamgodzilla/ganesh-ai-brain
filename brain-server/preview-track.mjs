import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recordPreviewVisit } = require('../lib/engagement-registry.cjs');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/i;

export function handlePreviewTrack(req, res) {
  const body = req.body ?? {};
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';

  if (!slug || !SLUG_RE.test(slug)) {
    res.status(400).json({ error: 'Invalid slug' });
    return;
  }

  recordPreviewVisit({
    slug,
    path: typeof body.path === 'string' ? body.path.slice(0, 500) : undefined,
    referrer: typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : undefined,
    utm: typeof body.utm === 'string' ? body.utm.slice(0, 120) : undefined,
  });

  res.json({ ok: true, slug });
}