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
import {
  getSystemSnapshot,
  saveSystemSnapshot,
  listConversions,
  addRoleTelemetry,
  listRoleTelemetry,
  getLatestWatchdogRun,
  listWatchdogRuns,
  pushOrchestratorAlerts,
  listOrchestratorAlerts,
} from './store.mjs';
import {
  BRAIN_HUB_URL,
  MONITOR_CONTROL_MATRIX,
  STRIPE_PAYMENT_LINK,
  STRIPE_WEBHOOK_PATH,
} from './monitor-matrix.mjs';
import { safeEqual } from './timing-safe.mjs';
import { validateSyncPayload } from './sync-validate.mjs';
import {
  createRateLimiter,
  checkAuthRateLimit,
  recordAuthFailure,
  clearAuthFailures,
} from './rate-limit.mjs';
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
import {
  runRoleStackPipeline,
  runDecisionReview,
  listRolePrompts,
} from '../lib/role-pipeline/index.mjs';
import { runInfrastructureWatchdog } from './watchdog.mjs';
import { getWatchdogConfig } from './watchdog-config.mjs';

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

// Unified auth gate: HTML routes (/brain) and JSON API routes (/api/dashboard) share requireDashboardAuth
const dashboardGate = requireDashboardAuth;

/**
 * Auth middleware for orchestrator & cron endpoints:
 * Accepts Vercel CRON_SECRET Bearer token, BRAIN_SYNC_SECRET, or Dashboard auth.
 */
function requireOrchestratorOrCronAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? '';
  const syncSecret = process.env.BRAIN_SYNC_SECRET?.trim() ?? '';
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() ?? '';
  const syncHeader =
    typeof req.headers['x-brain-sync-secret'] === 'string'
      ? req.headers['x-brain-sync-secret'].trim()
      : '';

  if (secretConfigured(cronSecret) && bearer && safeEqual(bearer, cronSecret)) {
    next();
    return;
  }
  if (
    secretConfigured(syncSecret) &&
    ((bearer && safeEqual(bearer, syncSecret)) || (syncHeader && safeEqual(syncHeader, syncSecret)))
  ) {
    next();
    return;
  }

  requireDashboardAuth(req, res, next);
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
    orchestratorPipelineApi: '/api/orchestrator/pipeline',
    decisionReviewApi: '/api/orchestrator/decision-review',
    watchdogCronApi: '/api/cron/watchdog',
  });
});

app.get('/api/engagement/stats', async (_req, res) => {
  const stats = getEngagementStats();
  res.json({ ok: true, stats, topEngaged: getTopEngaged(20), updatedAt: new Date().toISOString() });
});

/**
 * Multi-Agent Role Stacking & Three-Pass Verification Loop Endpoints
 */
app.get('/api/orchestrator/roles', requireDashboardAuth, (_req, res) => {
  const roles = listRolePrompts().map((p) => ({
    role: p.role,
    slug: p.slug,
    version: p.version,
    updated: p.updated,
    stage: p.stage,
    outputContract: p.outputContract,
    filename: p.filename,
  }));
  res.json({ ok: true, roles });
});

async function handleRolePipelineRequest(req, res) {
  const body = req.body ?? {};
  const mode = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : 'pipeline';

  try {
    if (mode === 'decision-review' || mode === 'decision') {
      const title =
        typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Project Decision';
      const proposal = typeof body.proposal === 'string' ? body.proposal : body.request;
      if (typeof proposal !== 'string' || !proposal.trim()) {
        res.status(400).json({ error: 'proposal (or request) is required for decision-review mode' });
        return;
      }

      const review = await runDecisionReview({
        title,
        proposal,
        context: body.context ?? {},
        onTelemetry: async (entry) => {
          await addRoleTelemetry(entry);
        },
      });

      res.json(review);
      return;
    }

    const request = typeof body.request === 'string' ? body.request : body.prompt;
    if (typeof request !== 'string' || !request.trim()) {
      res.status(400).json({ error: 'request (or prompt) is required' });
      return;
    }

    const result = await runRoleStackPipeline({
      request,
      context: body.context ?? {},
      initialDraft: typeof body.initialDraft === 'string' ? body.initialDraft : null,
      maxPasses: typeof body.maxPasses === 'number' ? body.maxPasses : 3,
      enforceThreePasses: body.enforceThreePasses ?? true,
      onTelemetry: async (entry) => {
        await addRoleTelemetry(entry);
      },
    });

    if (result.blocked) {
      await pushOrchestratorAlerts([
        {
          id: `block-${result.runId}`,
          source: 'contrarian-verifier',
          domain: 'orchestrator',
          kind: 'contrarian_block',
          severity: 'critical',
          message: `Contrarian/Verifier BLOCKED pipeline run ${result.runId}: ${result.contrarian?.summary ?? 'critical findings detected'}`,
          details: {
            runId: result.runId,
            findings: result.contrarian?.findings ?? [],
          },
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Role pipeline execution failed',
    });
  }
}

app.post('/api/orchestrator/pipeline', requireOrchestratorOrCronAuth, handleRolePipelineRequest);
app.post('/api/v1/orchestrator/pipeline', requireOrchestratorOrCronAuth, handleRolePipelineRequest);

async function handleDecisionReviewRequest(req, res) {
  const body = req.body ?? {};
  const title =
    typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Project Decision';
  const proposal = typeof body.proposal === 'string' ? body.proposal : body.request;

  if (typeof proposal !== 'string' || !proposal.trim()) {
    res.status(400).json({ error: 'proposal is required' });
    return;
  }

  try {
    const review = await runDecisionReview({
      title,
      proposal,
      context: body.context ?? {},
      onTelemetry: async (entry) => {
        await addRoleTelemetry(entry);
      },
    });
    res.json(review);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Decision review failed',
    });
  }
}

app.post(
  '/api/orchestrator/decision-review',
  requireOrchestratorOrCronAuth,
  handleDecisionReviewRequest
);
app.post(
  '/api/v1/orchestrator/decision-review',
  requireOrchestratorOrCronAuth,
  handleDecisionReviewRequest
);

app.get('/api/orchestrator/telemetry', requireDashboardAuth, async (req, res) => {
  const limit = Number.parseInt(String(req.query.limit ?? '50'), 10) || 50;
  const [telemetry, alerts] = await Promise.all([
    listRoleTelemetry(limit),
    listOrchestratorAlerts(limit),
  ]);
  res.json({
    ok: true,
    telemetry,
    alerts,
  });
});

/**
 * Autonomous Infrastructure Watchdog Endpoints (Vercel Cron + Manual Trigger + Status)
 */
async function handleWatchdogRun(_req, res) {
  try {
    const report = await runInfrastructureWatchdog();
    res.json({
      ok: report.downCount === 0,
      ...report,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Watchdog execution failed',
    });
  }
}

app.get('/api/cron/watchdog', requireOrchestratorOrCronAuth, handleWatchdogRun);
app.post('/api/watchdog/run', requireOrchestratorOrCronAuth, handleWatchdogRun);
app.post('/api/v1/watchdog/run', requireOrchestratorOrCronAuth, handleWatchdogRun);

app.get('/api/watchdog/status', requireDashboardAuth, async (_req, res) => {
  const config = getWatchdogConfig();
  const [latestRun, recentRuns, alerts] = await Promise.all([
    getLatestWatchdogRun(),
    listWatchdogRuns(10),
    listOrchestratorAlerts(30),
  ]);
  res.json({
    ok: true,
    config,
    latestRun,
    recentRuns,
    alerts: alerts.filter((a) => a.source === 'watchdog'),
  });
});

app.get('/api/dashboard', requireDashboardAuth, async (_req, res) => {
  const [system, conversions, roleTelemetry, latestWatchdogRun, alerts] = await Promise.all([
    getSystemSnapshot(),
    listConversions(),
    listRoleTelemetry(30),
    getLatestWatchdogRun(),
    listOrchestratorAlerts(30),
  ]);
  const engagement = getEngagementStats();
  const paid = conversions.filter((e) => e.status === 'paid' || e.status === 'complete');
  const outreachCount = system?.contacted ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const todayPaid = paid.filter((e) => e.createdAt.startsWith(today));
  const previewBase = system?.previewBase ?? 'https://preview.ceo.slay.llc';
  const watchdogConfig = getWatchdogConfig();
  const rolePrompts = listRolePrompts().map((p) => ({
    role: p.role,
    slug: p.slug,
    version: p.version,
    stage: p.stage,
  }));

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
    orchestrator: {
      roles: rolePrompts,
      telemetry: roleTelemetry,
      alerts,
    },
    watchdog: {
      properties: watchdogConfig.properties,
      thresholds: watchdogConfig.thresholds,
      latestRun: latestWatchdogRun,
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
