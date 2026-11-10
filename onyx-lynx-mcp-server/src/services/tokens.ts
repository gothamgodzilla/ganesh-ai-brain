import crypto from "node:crypto";

/**
 * HMAC-signed opt-out tokens.
 *
 * Why signed rather than a raw business_id in the URL: an unsigned link is
 * both forgeable (anyone can opt out any business) and enumerable (walk the
 * ids to dump your lead list). The token carries the business_id plus a
 * signature over it, so the endpoint can trust the id without a lookup table
 * and without exposing the id space.
 */

function requireSecret(): string {
  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "UNSUBSCRIBE_TOKEN_SECRET must be set to a random string of at least 32 characters. " +
        "Generate one with: openssl rand -hex 32"
    );
  }
  return secret;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", requireSecret()).update(payload).digest("base64url");
}

/** Build an opaque, tamper-evident token for a business id. */
export function createOptOutToken(businessId: string): string {
  const payload = b64url(businessId);
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a token and recover the business id. Returns null on any failure —
 * bad format, bad signature, tampering. Uses a timing-safe comparison so the
 * endpoint can't be used as a signature oracle.
 */
export function verifyOptOutToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, providedSig] = parts;
  if (!payload || !providedSig) return null;

  let expectedSig: string;
  try {
    expectedSig = sign(payload);
  } catch {
    return null;
  }

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** Full unsubscribe URL for an email footer, if a base URL is configured. */
export function buildUnsubscribeUrl(businessId: string): string | null {
  const base = process.env.UNSUBSCRIBE_BASE_URL;
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/unsubscribe?t=${encodeURIComponent(createOptOutToken(businessId))}`;
}
