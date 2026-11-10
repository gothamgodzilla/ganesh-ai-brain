import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hardenedCors } from './cors.mjs';
import { internalAuthConfigured } from './internal-auth.mjs';
import { handleInternalStripeConversion } from './stripe-ingest.mjs';
import { handleStripeWebhook } from './stripe-webhook.mjs';
import { handleResendWebhook } from './resend-webhook.mjs';
import { handlePreviewTrack } from './preview-track.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getEngagementStats, getTopEngaged } = require('../lib/engagement-registry.cjs');
import { getSystemSnapshot, saveSystemSnapshot, listConversions } from './store.mjs';
import { BRAIN_HUB_URL, MONITOR_CONTROL_MATRIX, STRIPE_PAYMENT_LINK, STRIPE_WEBHOOK_PATH } from './monitor-matrix.mjs';
import { safeEqual } from './timing-safe.mjs';
import { validateSyncPayload } from './sync-validate.mjs';
import { createRateLimiter, checkAuthRateLimit, recordAuthFailure, clearAuthFailures } from './rate-limit.mjs';
import {
  dashboardAuthConfigured,
  verifyDashboardAccess,
  denyDashboard,
  wantsHtml,
  NOT_CONFIGURED_HTML,
  tryMigrateQueryToken,
  isDashboardHtmlRoute,
  setDashboardSessionCookie,
  clearDashboardSessionCookie,
  applyDashboardSecurityHeaders,
  authenticateDashboardCredential,
} from './dashboard-auth.mjs';
import { handlePublicPitchStats } from './pitch-stats.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONSOLE_DIST = join(ROOT, 'console-dist');
const DASHBOARD_HTML = join(CONSOLE_DIST, 'index.html');
const DASHBOARD_FALLBACK = join(ROOT, 'dashboard.html');
const PITCH_DECK_HTML = join(ROOT, 'pitch-deck.html');
const INTRO_RATE = 499;
const PORT = parseInt(process.env.BRAIN_PORT ?? process.env.PORT ?? '5055', 10);
const SYNC_SECRET = process.env.BRAIN_SYNC_SECRET?.trim() ?? '';

function secretConfigured(value, placeholders = ['REPLACE_ME', 'REPLACE']) {
  const v = value?.trim();
  if (!v) return false;
  return !placeholders.some((p) => v.includes(p));
}

const app = express();
const trustProxy = process.env.TRUST_PROXY?.trim();
if (trustProxy === 'true') {
  app.set('trust proxy', true);
} else if (trustProxy) {
  const hops = parseInt(trustProxy, 10);
  app.set('trust proxy', Number.isFinite(hops) ? hops : 1);
} else {
  app.set('trust proxy', 1);
}
app.disable('x-powered-by');
app.use(hardenedCors());

const stripeWebhookParser = express.raw({ type: 'application/json' });
const syncRateLimit = createRateLimiter({ name: 'sync', windowMs: 60_000, max: 30 });
const webhookRateLimit = createRateLimiter({ name: 'webhook', windowMs: 60_000, max: 120 });

async function dispatchStripeWebhook(req, res) {
  if (req.headers['stripe-signature']) {
    await handleStripeWebhook(req, res);
    return;
  }

  try {
    const body =
      Buffer.isBuffer(req.body) && req.body.length
        ? JSON.parse(req.body.toString('utf8'))
        : req.body;
    req.body = body;
    await handleInternalStripeConversion(req, res);
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
  }
}

app.post('/api/v1/stripe/webhook', webhookRateLimit, stripeWebhookParser, dispatchStripeWebhook);
app.post('/api/stripe/webhook', webhookRateLimit, stripeWebhookParser, dispatchStripeWebhook);
app.post('/api/v1/resend/webhook', webhookRateLimit, stripeWebhookParser, handleResendWebhook);
app.post('/api/resend/webhook', webhookRateLimit, stripeWebhookParser, handleResendWebhook);

app.use(express.json({ limit: '2mb' }));

app.post('/api/v1/track/preview', webhookRateLimit, handlePreviewTrack);
app.post('/api/track/preview', webhookRateLimit, handlePreviewTrack);

// Dashboard assets only — avoids collision with legacy SPA /assets/* on shared domains.
if (existsSync(CONSOLE_DIST)) {
  app.use(
    '/brain-static',
    express.static(CONSOLE_DIST, { index: false, maxAge: '1h', fallthrough: false })
  );
}

function extractSyncSecret(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;
  const header = req.headers['x-brain-sync-secret'];
  return typeof header === 'string' ? header.trim() : undefined;
}

function requireSyncAuth(req, res, next) {
  if (!SYNC_SECRET) {
    res.status(503).json({ error: 'BRAIN_SYNC_SECRET not set' });
    return;
  }
  const auth = extractSyncSecret(req);
  if (!auth || !safeEqual(auth, SYNC_SECRET)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function serveDashboard(_req, res) {
  const path = existsSync(DASHBOARD_HTML) ? DASHBOARD_HTML : DASHBOARD_FALLBACK;
  applyDashboardSecurityHeaders(res);
  res.type('html').send(readFileSync(path, 'utf8'));
}

function dashboardGate(req, res, next) {
  if (isDashboardHtmlRoute(req) && req.query?.token) {
    if (!checkAuthRateLimit(req, res)) return;
    if (tryMigrateQueryToken(req, res)) return;
  }
  const auth = verifyDashboardAccess(req);
  if (!auth.ok) {
    if (auth.status === 503) {
      denyDashboard(res, req, 503, NOT_CONFIGURED_HTML);
      return;
    }
    denyDashboard(res, req);
    return;
  }
  next();
}

function finishDashboardAuth(req, res) {
  if (wantsHtml(req) || req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
    res.redirect(303, '/brain');
    return;
  }
  res.json({ ok: true });
}

function handleDashboardAuth(req, res) {
  if (!checkAuthRateLimit(req, res)) return;

  if (!dashboardAuthConfigured()) {
    denyDashboard(res, req, 503, NOT_CONFIGURED_HTML);
    return;
  }

  if (verifyDashboardAccess(req).ok) {
    clearAuthFailures(req);
    setDashboardSessionCookie(res, req);
    finishDashboardAuth(req, res);
    return;
  }

  const bodyToken =
    (typeof req.body?.token === 'string' && req.body.token.trim()) ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() ||
    (typeof req.headers['x-dashboard-token'] === 'string' && req.headers['x-dashboard-token'].trim()) ||
    '';

  if (!authenticateDashboardCredential(bodyToken)) {
    recordAuthFailure(req);
    if (wantsHtml(req) || req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
      denyDashboard(res, req, 401);
      return;
    }
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  clearAuthFailures(req);
  setDashboardSessionCookie(res, req);
  finishDashboardAuth(req, res);
}

function handleDashboardLogout(req, res) {
  clearDashboardSessionCookie(res, req);
  res.redirect(303, '/brain');
}

function servePitchDeck(_req, res) {
  if (!existsSync(PITCH_DECK_HTML)) {
    res.status(503).type('html').send('<h1>Pitch deck not built</h1>');
    return;
  }
  res.type('html').send(readFileSync(PITCH_DECK_HTML, 'utf8'));
}

function requireDashboardAuth(req, res, next) {
  if (isDashboardHtmlRoute(req) && req.query?.token) {
    if (!checkAuthRateLimit(req, res)) return;
    if (tryMigrateQueryToken(req, res)) return;
  }
  const auth = verifyDashboardAccess(req);
  if (!auth.ok) {
    if (auth.status === 503) {
      denyDashboard(res, req, 503, NOT_CONFIGURED_HTML);
      return;
    }
    if (isDashboardHtmlRoute(req) || wantsHtml(req)) {
      denyDashboard(res, req);
      return;
    }
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

const BRAIN_BUILD =
  process.env.BRAIN_BUILD_ID?.trim() ||
  (process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : '') ||
  'luxury-mcp-engine-brain-server';

app.get(['/', '/pitch', '/deck', '/platform', '/showcase'], servePitchDeck);
app.post('/api/brain/auth', express.urlencoded({ extended: false }), handleDashboardAuth);
app.post('/api/brain/logout', handleDashboardLogout);
app.get(['/brain', '/api/brain'], dashboardGate, serveDashboard);

app.get('/api/v1/pitch/stats', handlePublicPitchStats);
app.get('/api/pitch/stats', handlePublicPitchStats);

app.get('/api/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'ganesh-ai-brain',
    build: BRAIN_BUILD,
    routes: 'brain-server-express',
    pitchDeck: Boolean(existsSync(PITCH_DECK_HTML)),
    dashboardAuth: 'cookie-session',
    time: new Date().toISOString(),
  });
});

app.get('/api/health', async (req, res) => {
  if (wantsHtml(req)) {
    dashboardGate(req, res, () => serveDashboard(req, res));
    return;
  }

  res.json({
    ok: true,
    service: 'ganesh-ai-brain',
    build: BRAIN_BUILD,
    routes: 'brain-server-express',
    host: 'luxury-mcp-engine/brain-server',
    stripe: secretConfigured(process.env.STRIPE_SECRET_KEY),
    webhook: secretConfigured(process.env.STRIPE_WEBHOOK_SECRET),
    sync: Boolean(SYNC_SECRET),
    internalIngest: internalAuthConfigured(),
    dashboardLocked: dashboardAuthConfigured(),
    dashboardPaths: ['/brain', '/api/brain'],
    dashboardAuth: 'HttpOnly session cookie or Authorization: Bearer (no URL tokens)',
    pitchDeck: '/pitch',
    resendWebhook: secretConfigured(process.env.RESEND_WEBHOOK_SECRET),
    engagementApi: '/api/engagement/stats',
    previewTrackApi: '/api/v1/track/preview',
  });
});

app.get('/api/engagement/stats', async (_req, res) => {
  const stats = getEngagementStats();
  res.json({ ok: true, stats, topEngaged: getTopEngaged(20), updatedAt: new Date().toISOString() });
});

app.get('/api/dashboard', requireDashboardAuth, async (_req, res) => {
  const system = await getSystemSnapshot();
  const engagement = getEngagementStats();
  const conversions = await listConversions();
  const paid = conversions.filter((e) => e.status === 'paid' || e.status === 'complete');
  const outreachCount = system?.contacted ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const todayPaid = paid.filter((e) => e.createdAt.startsWith(today));
  const previewBase = system?.previewBase ?? 'https://preview.ceo.slay.llc';

  res.json({
    system,
    revenue: {
      configured: secretConfigured(process.env.STRIPE_SECRET_KEY),
      paymentCount: paid.length,
      totalRevenue: paid.reduce((s, e) => s + e.amount, 0) / 100,
      todayRevenue: todayPaid.reduce((s, e) => s + e.amount, 0) / 100,
      todayCount: todayPaid.length,
      pipelinePotential: outreachCount * INTRO_RATE,
      conversionRate: outreachCount ? (paid.length / outreachCount) * 100 : 0,
      recentPayments: conversions.slice(0, 20),
    },
    links: {
      previewHub: previewBase,
      stripeDashboard: 'https://dashboard.stripe.com/payments',
      paymentLink: STRIPE_PAYMENT_LINK,
      brainHub: BRAIN_HUB_URL,
      stripeWebhook: `${BRAIN_HUB_URL}${STRIPE_WEBHOOK_PATH}`,
    },
    engagement,
    monitor: {
      funnel: [
        {
          stage: 'scouted',
          label: 'Scouted listings',
          count: system?.scoutedListings ?? system?.previewSlugs ?? 0,
        },
        {
          stage: 'portals',
          label: 'Portals compiled',
          count: system?.previewSlugs ?? 0,
          url: previewBase,
        },
        {
          stage: 'pitches',
          label: 'Pitches sent',
          count: system?.emailsSentLive ?? system?.contacted ?? 0,
        },
        {
          stage: 'opened',
          label: 'Emails opened',
          count: engagement.uniqueOpens ?? system?.emailsOpened ?? 0,
        },
        {
          stage: 'clicked',
          label: 'Email clicks',
          count: engagement.uniqueClicks ?? system?.emailsClicked ?? 0,
        },
        {
          stage: 'preview_visits',
          label: 'Preview visits',
          count: engagement.uniquePreviewVisits ?? system?.portalsOpened ?? 0,
          url: previewBase,
        },
        {
          stage: 'conversions',
          label: 'Conversions ($499.99)',
          count: paid.length,
          url: STRIPE_PAYMENT_LINK,
        },
      ],
      zipHeatmap: system?.zipHeatmap ?? [],
      verticals: ['restaurant', 'bar', 'salon', 'dispensary', 'gym', 'auto'],
      recentSessions: system?.recentSessions ?? [],
      controlMatrix: MONITOR_CONTROL_MATRIX,
      attributionFormat: 'client_reference_id: "{businessId}:{tier}" · status: "complete"',
    },
    updatedAt: new Date().toISOString(),
  });
});

app.get('/api/monitor/matrix', requireDashboardAuth, (_req, res) => {
  res.json({
    matrix: MONITOR_CONTROL_MATRIX,
    attributionFormat: 'client_reference_id: "{businessId}:{tier}" · status: "complete"',
    updatedAt: new Date().toISOString(),
  });
});

app.use('/assets', (_req, res) => {
  res
    .status(410)
    .type('html')
    .send(
      '<h1>Legacy SPA removed</h1><p>Use <a href="/pitch">/pitch</a> or <a href="/brain">/brain</a>.</p>'
    );
});

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  if (req.path.startsWith('/api/') || req.path.startsWith('/brain-static/')) {
    next();
    return;
  }
  if (req.accepts('html')) {
    servePitchDeck(req, res);
    return;
  }
  next();
});

app.post('/api/sync/pipeline', syncRateLimit, requireSyncAuth, async (req, res) => {
  try {
    const validated = validateSyncPayload(req.body ?? {});
    const snapshot = {
      updatedAt: new Date().toISOString(),
      ...validated,
    };
    await saveSystemSnapshot(snapshot);
    res.json({
      status: 'success',
      synced: true,
      ok: true,
      contacted: snapshot.contacted,
      previewSlugs: snapshot.previewSlugs,
      snapshot,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Invalid sync payload',
    });
  }
});

export default app;

const isDirectRun = Boolean(
  process.argv[1] &&
  (process.argv[1].endsWith('brain-server/index.mjs') || process.argv[1].endsWith('brain-server/index.js'))
);

if (!process.env.VERCEL && (isDirectRun || process.env.BRAIN_AUTO_LISTEN === '1')) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🧠 Brain hub (folded) → http://0.0.0.0:${PORT}`);
    if (dashboardAuthConfigured()) {
      console.log(`   Dashboard: GET  /brain  (POST /api/brain/auth · cookie session)`);
    } else {
      console.warn('   ⚠️  DASHBOARD_VIEW_TOKEN unset — lock the telemetry UI in Replit Secrets');
    }
    console.log(`   Pitch:     GET  /pitch  (/deck · /platform · public /)`);
    console.log(`   Health:    GET  /api/health`);
    console.log(`   Sync:      POST /api/sync/pipeline`);
    console.log(`   Webhook:   POST /api/v1/stripe/webhook`);
    console.log(`   Build:     ${BRAIN_BUILD}`);
    console.log(
      '   ⚠️  If /pitch shows old Replit SPA: Publishing → remove Static Deployment → Autoscale only → Republish'
    );
  });
}
