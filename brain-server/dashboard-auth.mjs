import crypto from 'node:crypto';
import { safeEqual } from './timing-safe.mjs';
import { recordAuthFailure } from './rate-limit.mjs';

const DASHBOARD_VIEW_TOKEN =
  process.env.DASHBOARD_VIEW_TOKEN?.trim() ||
  process.env.BRAIN_DASHBOARD_TOKEN?.trim() ||
  '';

export const DASHBOARD_COOKIE = 'ganesh_brain_session';
const SESSION_MAX_AGE_SEC = 60 * 60 * 8;
const SESSION_VERSION = 'v1';

export function dashboardAuthConfigured() {
  return Boolean(DASHBOARD_VIEW_TOKEN);
}

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  const out = {};
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function requestIsSecure(req) {
  return req.secure === true || req.headers['x-forwarded-proto'] === 'https';
}

function sessionSigningKey() {
  // Derived from the view token; never write the raw token into the cookie.
  return crypto.createHmac('sha256', 'ganesh-brain-session').update(DASHBOARD_VIEW_TOKEN).digest();
}

/** Opaque session: v1.<expUnix>.<hmac> — HMAC over `${SESSION_VERSION}.${exp}` */
export function mintDashboardSession(nowSec = Math.floor(Date.now() / 1000)) {
  if (!DASHBOARD_VIEW_TOKEN) return null;
  const exp = nowSec + SESSION_MAX_AGE_SEC;
  const payload = `${SESSION_VERSION}.${exp}`;
  const sig = crypto.createHmac('sha256', sessionSigningKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyDashboardSession(session) {
  if (!DASHBOARD_VIEW_TOKEN || typeof session !== 'string') return false;
  const parts = session.trim().split('.');
  if (parts.length !== 3) return false;
  const [ver, expStr, sig] = parts;
  if (ver !== SESSION_VERSION) return false;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp)) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;
  const payload = `${ver}.${exp}`;
  const expected = crypto.createHmac('sha256', sessionSigningKey()).update(payload).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function extractDashboardToken(req) {
  // Bearer / header still accept the raw operator token (never put in cookie).
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (bearer) return { kind: 'token', value: bearer };

  const header = req.headers['x-dashboard-token'];
  if (typeof header === 'string' && header.trim()) {
    return { kind: 'token', value: header.trim() };
  }

  const fromCookie = parseCookies(req)[DASHBOARD_COOKIE]?.trim();
  if (fromCookie) return { kind: 'session', value: fromCookie };

  return undefined;
}

export function authenticateDashboardCredential(token) {
  if (!DASHBOARD_VIEW_TOKEN || typeof token !== 'string' || !token.trim()) return false;
  return safeEqual(token.trim(), DASHBOARD_VIEW_TOKEN);
}

export function verifyDashboardAccess(req) {
  if (!DASHBOARD_VIEW_TOKEN) {
    return {
      ok: false,
      status: 503,
      error: 'DASHBOARD_VIEW_TOKEN not configured',
    };
  }

  const cred = extractDashboardToken(req);
  if (!cred) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  if (cred.kind === 'session') {
    if (!verifyDashboardSession(cred.value)) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
    return { ok: true };
  }

  if (!safeEqual(cred.value, DASHBOARD_VIEW_TOKEN)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

export function setDashboardSessionCookie(res, req) {
  const session = mintDashboardSession();
  if (!session) return;
  const secure = requestIsSecure(req);
  let cookie = `${DASHBOARD_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SEC}`;
  if (secure) cookie += '; Secure';
  res.append('Set-Cookie', cookie);
}

export function clearDashboardSessionCookie(res, req) {
  const secure = requestIsSecure(req);
  let cookie = `${DASHBOARD_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
  if (secure) cookie += '; Secure';
  res.append('Set-Cookie', cookie);
}

/** One-time migration: accept ?token= once, set derived session cookie, redirect to clean URL. */
export function tryMigrateQueryToken(req, res) {
  const query = req.query?.token;
  if (typeof query !== 'string' || !query.trim()) return false;
  if (!DASHBOARD_VIEW_TOKEN) {
    res.redirect(303, req.path);
    return true;
  }
  if (safeEqual(query.trim(), DASHBOARD_VIEW_TOKEN)) {
    setDashboardSessionCookie(res, req);
    res.redirect(303, req.path);
    return true;
  }
  recordAuthFailure?.(req);
  res.redirect(303, req.path);
  return true;
}

export function wantsHtml(req) {
  return (
    req.query?.ui === '1' ||
    (typeof req.headers.accept === 'string' && req.headers.accept.includes('text/html'))
  );
}

export function isDashboardHtmlRoute(req) {
  return req.path === '/brain' || req.path === '/api/brain' || (req.path === '/api/health' && req.query?.ui === '1');
}

const NOT_CONFIGURED_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>Brain Dashboard — Locked</title>
<style>body{font-family:system-ui;background:#0a1f1a;color:#e0f2e9;display:grid;place-items:center;min-height:100vh;margin:0}
.card{max-width:480px;padding:2rem;border:1px solid #fbbf24;border-radius:12px;background:#1a2f2a}
h1{font-size:1.2rem;margin:0 0 .75rem;color:#fbbf24}p{color:#a1e2b8;margin:0 0 .75rem;line-height:1.5}code{background:#122820;padding:.1rem .35rem;border-radius:4px}</style></head>
<body><div class="card"><h1>Dashboard not locked yet</h1>
<p>Set <code>DASHBOARD_VIEW_TOKEN</code> in Replit Secrets (same value as Mac <code>luxury-mcp-engine/.env</code>), then republish.</p>
<p>Until then, revenue and client IDs may be visible on public routes.</p></div></body></html>`;

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Brain Dashboard — Sign in</title>
<style>body{font-family:system-ui;background:#0a1f1a;color:#e0f2e9;display:grid;place-items:center;min-height:100vh;margin:0}
.card{max-width:420px;width:100%;padding:2rem;border:1px solid #2d4a3e;border-radius:12px;background:#1a2f2a}
h1{font-size:1.2rem;margin:0 0 .5rem}p{color:#a1e2b8;margin:0 0 1.25rem;line-height:1.5;font-size:.9rem}
label{display:block;font-size:.75rem;color:#7dd3a8;margin-bottom:.35rem;text-transform:uppercase;letter-spacing:.06em}
input{width:100%;box-sizing:border-box;padding:.65rem .75rem;border-radius:8px;border:1px solid #2d4a3e;background:#122820;color:#e0f2e9;font-size:1rem}
button{margin-top:1rem;width:100%;padding:.7rem;border:0;border-radius:8px;background:#a855f7;color:#fff;font-weight:600;cursor:pointer}
button:hover{background:#9333ea}.err{color:#fca5a5;font-size:.85rem;margin-top:.75rem}</style></head>
<body><div class="card"><h1>Brain dashboard</h1>
<p>Revenue and conversion telemetry is private. Enter your operator access token — it is stored in an HttpOnly session cookie, never in the URL.</p>
<form method="POST" action="/api/brain/auth">
<label for="token">Access token</label>
<input id="token" name="token" type="password" autocomplete="current-password" required autofocus/>
<button type="submit">Unlock dashboard</button>
<p id="err" class="err" hidden></p>
</form></div>
<script>if(location.search){history.replaceState(null,'',location.pathname)}</script></body></html>`;

export function denyDashboard(res, req, status = 401, html = LOGIN_HTML) {
  if (isDashboardHtmlRoute(req) || wantsHtml(req)) {
    res
      .status(status === 503 ? 503 : 200)
      .set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      })
      .type('html')
      .send(status === 503 ? NOT_CONFIGURED_HTML : html);
    return;
  }
  res.status(status).json({ error: status === 503 ? 'DASHBOARD_VIEW_TOKEN not configured' : 'Unauthorized' });
}

export function applyDashboardSecurityHeaders(res) {
  res.set({
    'Cache-Control': 'no-store, private',
    'Referrer-Policy': 'no-referrer',
    Pragma: 'no-cache',
  });
}

export { NOT_CONFIGURED_HTML, LOGIN_HTML };