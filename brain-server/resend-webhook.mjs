import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recordEmailEvent } = require('../lib/engagement-registry.cjs');

function parseSvixSignatures(header) {
  return (header || '')
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [version, signature] = part.split(',');
      return { version, signature };
    });
}

function verifySvixPayload(rawBody, headers, secret) {
  if (!secret) return { ok: false, reason: 'RESEND_WEBHOOK_SECRET not set' };

  const msgId = headers['svix-id'];
  const msgTimestamp = headers['svix-timestamp'];
  const msgSignature = headers['svix-signature'];
  if (!msgId || !msgTimestamp || !msgSignature) {
    return { ok: false, reason: 'missing svix headers' };
  }

  const ts = Number.parseInt(msgTimestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid timestamp' };
  const age = Math.abs(Date.now() / 1000 - ts);
  if (age > 300) return { ok: false, reason: 'timestamp too old' };

  const signedContent = `${msgId}.${msgTimestamp}.${rawBody}`;
  const secretPart = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const key = Buffer.from(secretPart, 'base64');

  for (const { version, signature } of parseSvixSignatures(msgSignature)) {
    if (version !== 'v1' || !signature) continue;
    const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');
    try {
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return { ok: true };
      }
    } catch {
      /* try next signature */
    }
  }

  return { ok: false, reason: 'signature mismatch' };
}

function firstRecipient(data) {
  const to = data?.to;
  if (Array.isArray(to) && to.length) return to[0];
  if (typeof to === 'string') return to;
  return data?.email || null;
}

export async function handleResendWebhook(req, res) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

  if (!secret) {
    // Fail-closed: never accept unsigned Resend events when secret unset.
    // Local-only escape: ALLOW_INSECURE_RESEND=1
    if (process.env.ALLOW_INSECURE_RESEND === '1') {
      console.warn('⚠️  RESEND_WEBHOOK_SECRET unset — ALLOW_INSECURE_RESEND=1 accepting unverified events');
    } else {
      res.status(503).json({ error: 'RESEND_WEBHOOK_SECRET not configured' });
      return;
    }
  } else {
    const verified = verifySvixPayload(rawBody, req.headers, secret);
    if (!verified.ok) {
      res.status(401).json({ error: 'Invalid webhook signature', reason: verified.reason });
      return;
    }
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const type = payload?.type;
  const data = payload?.data ?? {};
  const resendId = data.email_id || data.id || null;
  const recipient = firstRecipient(data);

  const tracked = new Set([
    'email.sent',
    'email.delivered',
    'email.opened',
    'email.clicked',
    'email.bounced',
    'email.complained',
    'email.delivery_delayed',
  ]);

  if (!tracked.has(type)) {
    res.json({ ok: true, ignored: type });
    return;
  }

  recordEmailEvent({
    type,
    resendId,
    recipient,
    timestamp: payload.created_at || new Date().toISOString(),
  });

  res.json({ ok: true, type, resendId });
}