const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

let contactedRegistry = null;
try {
  contactedRegistry = require('../contacted-registry.cjs');
} catch (err) {
  if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('contacted-registry')) {
    console.warn('⚠️  contacted-registry.cjs missing from repository root. Operating in graceful fallback mode.');
  } else {
    console.warn('⚠️  Failed to load contacted-registry.cjs:', err.message);
  }
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const ENGAGEMENT_FILE = path.join(DATA_DIR, 'engagement.json');
const EVENTS_FILE = path.join(DATA_DIR, 'engagement-events.jsonl');

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY)?.trim();

let supabaseInstance = null;

function isSupabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_KEY &&
    !SUPABASE_URL.includes('REPLACE') &&
    !SUPABASE_KEY.includes('REPLACE')
  );
}

function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseInstance;
}

function defaultContacted() {
  return { contacted: [], lastUpdated: new Date().toISOString() };
}

function normalizeEmail(email) {
  if (contactedRegistry?.normalizeEmail) {
    return contactedRegistry.normalizeEmail(email);
  }
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function loadContacted() {
  if (contactedRegistry?.loadContacted) {
    try {
      return contactedRegistry.loadContacted();
    } catch {
      return defaultContacted();
    }
  }
  const contactedFile = path.join(DATA_DIR, '..', 'contacted.json');
  if (fs.existsSync(contactedFile)) {
    try {
      return JSON.parse(fs.readFileSync(contactedFile, 'utf8'));
    } catch {
      return defaultContacted();
    }
  }
  return defaultContacted();
}

function saveContacted(log) {
  if (contactedRegistry?.saveContacted) {
    try {
      contactedRegistry.saveContacted(log);
      return;
    } catch {
      // ignore
    }
  }
  try {
    const contactedFile = path.join(DATA_DIR, '..', 'contacted.json');
    fs.writeFileSync(contactedFile, JSON.stringify(log, null, 2));
  } catch {
    // ignore
  }
}

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // Read-only filesystem in serverless
  }
}

function defaultEngagement() {
  return {
    lastUpdated: new Date().toISOString(),
    byResendId: {},
    bySlug: {},
    totals: {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complained: 0,
      previewVisits: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
      uniquePreviewVisits: 0,
    },
  };
}

// In-memory cache for fast sync access (seeded or updated via async Supabase / local fs)
let memoryEngagement = null;

function loadEngagement() {
  if (memoryEngagement) return memoryEngagement;

  ensureDataDir();
  if (!fs.existsSync(ENGAGEMENT_FILE)) {
    memoryEngagement = defaultEngagement();
    return memoryEngagement;
  }
  try {
    const data = JSON.parse(fs.readFileSync(ENGAGEMENT_FILE, 'utf8'));
    memoryEngagement = { ...defaultEngagement(), ...data, totals: { ...defaultEngagement().totals, ...data.totals } };
    return memoryEngagement;
  } catch {
    memoryEngagement = defaultEngagement();
    return memoryEngagement;
  }
}

function saveEngagement(data) {
  memoryEngagement = data;
  data.lastUpdated = new Date().toISOString();

  // Try file write (works locally)
  try {
    ensureDataDir();
    fs.writeFileSync(ENGAGEMENT_FILE, JSON.stringify(data, null, 2));
  } catch {
    // Read-only filesystem on Vercel
  }

  // Persist to Supabase if configured
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    supabase
      .from('brain_engagement')
      .upsert({
        id: 'current',
        data: data,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      .then(({ error }) => {
        if (error) console.error('Supabase brain_engagement save error:', error.message);
      })
      .catch((err) => console.error('Supabase engagement upsert error:', err));
  }
}

function appendEvent(event) {
  // Try file write
  try {
    ensureDataDir();
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Read-only filesystem on Vercel
  }

  // Persist to Supabase if configured
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    supabase
      .from('brain_engagement_events')
      .insert({
        event_type: event.type || 'unknown',
        slug: event.slug || null,
        resend_id: event.resendId || null,
        recipient: event.recipient || null,
        timestamp: event.timestamp || new Date().toISOString(),
        raw_event: event,
      })
      .then(({ error }) => {
        if (error) console.error('Supabase brain_engagement_events insert error:', error.message);
      })
      .catch((err) => console.error('Supabase engagement event insert error:', err));
  }
}

// Pre-fetch latest engagement state from Supabase on cold start if available
if (isSupabaseConfigured()) {
  const supabase = getSupabase();
  supabase
    .from('brain_engagement')
    .select('data')
    .eq('id', 'current')
    .maybeSingle()
    .then(({ data, error }) => {
      if (!error && data?.data) {
        memoryEngagement = { ...defaultEngagement(), ...data.data, totals: { ...defaultEngagement().totals, ...data.data.totals } };
      }
    })
    .catch(() => {});
}

function slugEntry(data, slug) {
  if (!data.bySlug[slug]) {
    data.bySlug[slug] = {
      slug,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complained: 0,
      previewVisits: 0,
      firstOpenAt: null,
      lastOpenAt: null,
      firstClickAt: null,
      lastClickAt: null,
      firstPreviewVisitAt: null,
      lastPreviewVisitAt: null,
      recipient: null,
      resendId: null,
    };
  }
  return data.bySlug[slug];
}

function recomputeTotals(data) {
  const slugs = Object.values(data.bySlug);
  data.totals.uniqueOpens = slugs.filter((s) => s.opened > 0).length;
  data.totals.uniqueClicks = slugs.filter((s) => s.clicked > 0).length;
  data.totals.uniquePreviewVisits = slugs.filter((s) => s.previewVisits > 0).length;
  data.totals.opened = slugs.reduce((n, s) => n + s.opened, 0);
  data.totals.clicked = slugs.reduce((n, s) => n + s.clicked, 0);
  data.totals.delivered = slugs.reduce((n, s) => n + s.delivered, 0);
  data.totals.bounced = slugs.filter((s) => s.bounced > 0).length;
  data.totals.complained = slugs.filter((s) => s.complained > 0).length;
  data.totals.previewVisits = slugs.reduce((n, s) => n + s.previewVisits, 0);
  const contacted = loadContacted();
  data.totals.sent = contacted.contacted?.length ?? 0;
}

function patchContactedEntry({ slug, recipient, resendId, patch }) {
  const log = loadContacted();
  if (!Array.isArray(log?.contacted)) return;

  let idx = -1;
  if (slug) idx = log.contacted.findIndex((c) => c.slug === slug);
  if (idx < 0 && recipient) {
    const email = normalizeEmail(recipient);
    idx = log.contacted.findIndex((c) => normalizeEmail(c.recipient) === email);
  }
  if (idx < 0 && resendId) {
    idx = log.contacted.findIndex((c) => c.resendId === resendId);
  }
  if (idx < 0) return;

  const row = log.contacted[idx];
  if (resendId && !row.resendId) row.resendId = resendId;
  row.engagement = { ...(row.engagement || {}), ...patch, updatedAt: new Date().toISOString() };
  saveContacted(log);
}

function linkSend({ slug, recipient, resendId, emailSent, previewUrl, zip }) {
  const data = loadEngagement();
  const now = new Date().toISOString();

  if (resendId) {
    data.byResendId[resendId] = slug || normalizeEmail(recipient);
  }

  if (slug) {
    const entry = slugEntry(data, slug);
    if (recipient) entry.recipient = normalizeEmail(recipient);
    if (resendId) entry.resendId = resendId;
    if (emailSent) entry.emailSent = emailSent;
    if (previewUrl) entry.previewUrl = previewUrl;
    if (zip) entry.zip = zip;
    entry.linkedAt = now;
  }

  recomputeTotals(data);
  saveEngagement(data);

  patchContactedEntry({
    slug,
    recipient,
    resendId,
    patch: { linkedAt: now },
  });
}

function resolveSlug({ slug, resendId, recipient }) {
  if (slug) return slug;
  const data = loadEngagement();
  if (resendId && data.byResendId[resendId]) {
    const mapped = data.byResendId[resendId];
    if (typeof mapped === 'string' && !mapped.includes('@')) return mapped;
  }
  if (recipient) {
    const email = normalizeEmail(recipient);
    const log = loadContacted();
    if (Array.isArray(log?.contacted)) {
      const hit = log.contacted.find((c) => normalizeEmail(c.recipient) === email);
      if (hit?.slug) return hit.slug;
    }
  }
  return null;
}

function recordEmailEvent({ type, resendId, recipient, slug, timestamp }) {
  const data = loadEngagement();
  const resolvedSlug = resolveSlug({ slug, resendId, recipient });
  const ts = timestamp || new Date().toISOString();
  const event = { type, resendId, recipient, slug: resolvedSlug, timestamp: ts };

  if (!resolvedSlug) {
    appendEvent({ ...event, note: 'unmapped' });
    return data;
  }

  const entry = slugEntry(data, resolvedSlug);
  if (recipient) entry.recipient = normalizeEmail(recipient);
  if (resendId) {
    entry.resendId = resendId;
    data.byResendId[resendId] = resolvedSlug;
  }

  const patch = {};
  if (type === 'email.delivered') {
    entry.delivered += 1;
    patch.delivered = entry.delivered;
  } else if (type === 'email.opened') {
    entry.opened += 1;
    if (!entry.firstOpenAt) entry.firstOpenAt = ts;
    entry.lastOpenAt = ts;
    patch.opened = entry.opened;
    patch.firstOpenAt = entry.firstOpenAt;
    patch.lastOpenAt = entry.lastOpenAt;
  } else if (type === 'email.clicked') {
    entry.clicked += 1;
    if (!entry.firstClickAt) entry.firstClickAt = ts;
    entry.lastClickAt = ts;
    patch.clicked = entry.clicked;
    patch.firstClickAt = entry.firstClickAt;
    patch.lastClickAt = entry.lastClickAt;
  } else if (type === 'email.bounced') {
    entry.bounced += 1;
    patch.bounced = entry.bounced;
  } else if (type === 'email.complained') {
    entry.complained += 1;
    patch.complained = entry.complained;
  }

  appendEvent(event);
  recomputeTotals(data);
  saveEngagement(data);
  patchContactedEntry({ slug: resolvedSlug, recipient, resendId, patch });
  return data;
}

function recordPreviewVisit({ slug, path: pagePath, referrer, utm }) {
  const data = loadEngagement();
  const ts = new Date().toISOString();
  const entry = slugEntry(data, slug);
  entry.previewVisits += 1;
  if (!entry.firstPreviewVisitAt) entry.firstPreviewVisitAt = ts;
  entry.lastPreviewVisitAt = ts;

  appendEvent({ type: 'preview.visit', slug, path: pagePath, referrer, utm, timestamp: ts });
  recomputeTotals(data);
  saveEngagement(data);
  patchContactedEntry({
    slug,
    patch: {
      previewVisits: entry.previewVisits,
      firstPreviewVisitAt: entry.firstPreviewVisitAt,
      lastPreviewVisitAt: entry.lastPreviewVisitAt,
    },
  });
  return data;
}

function getEngagementStats() {
  const data = loadEngagement();
  recomputeTotals(data);
  const sent = data.totals.sent || 0;
  const uniqueOpens = data.totals.uniqueOpens || 0;
  const uniqueClicks = data.totals.uniqueClicks || 0;
  const uniquePreviewVisits = data.totals.uniquePreviewVisits || 0;

  return {
    ...data.totals,
    sent,
    openRate: sent ? (uniqueOpens / sent) * 100 : 0,
    clickRate: sent ? (uniqueClicks / sent) * 100 : 0,
    previewVisitRate: sent ? (uniquePreviewVisits / sent) * 100 : 0,
    clickToOpenRate: uniqueOpens ? (uniqueClicks / uniqueOpens) * 100 : 0,
    lastUpdated: data.lastUpdated,
  };
}

function getTopEngaged(limit = 15) {
  const data = loadEngagement();
  return Object.values(data.bySlug)
    .filter((s) => s.opened > 0 || s.clicked > 0 || s.previewVisits > 0)
    .sort((a, b) => b.opened + b.clicked * 2 + b.previewVisits - (a.opened + a.clicked * 2 + a.previewVisits))
    .slice(0, limit);
}

module.exports = {
  ENGAGEMENT_FILE,
  loadEngagement,
  saveEngagement,
  linkSend,
  recordEmailEvent,
  recordPreviewVisit,
  getEngagementStats,
  getTopEngaged,
  resolveSlug,
};
