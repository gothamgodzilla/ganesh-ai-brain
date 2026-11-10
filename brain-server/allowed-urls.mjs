const DEFAULT_ORIGINS = ['https://preview.ceo.slay.llc', 'https://ceo.slay.llc'];

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  const entries = raw
    ? raw.split(',').map((o) => o.trim()).filter(Boolean)
    : DEFAULT_ORIGINS;

  return entries.map((entry) => {
    try {
      const url = new URL(entry);
      if (url.protocol !== 'https:') {
        throw new Error(`ALLOWED_ORIGINS must use HTTPS: ${entry}`);
      }
      return url.origin.toLowerCase();
    } catch (err) {
      throw new Error(
        err instanceof Error && err.message.startsWith('ALLOWED_ORIGINS')
          ? err.message
          : `Invalid ALLOWED_ORIGINS entry: ${entry}`
      );
    }
  });
}

let cachedOrigins;

function allowedOrigins() {
  if (!cachedOrigins) {
    cachedOrigins = parseAllowedOrigins();
  }
  return cachedOrigins;
}

export function assertAllowedHttpsUrl(url, label = 'URL') {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`);
  }

  const origin = parsed.origin.toLowerCase();
  const allowed = allowedOrigins();
  if (!allowed.includes(origin)) {
    throw new Error(`${label} origin not allowlisted (${origin})`);
  }

  return parsed.toString();
}

export function assertAllowedPreviewBase(previewBase) {
  return assertAllowedHttpsUrl(previewBase, 'previewBase');
}