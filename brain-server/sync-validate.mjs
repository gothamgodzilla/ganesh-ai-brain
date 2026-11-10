import { assertAllowedHttpsUrl, assertAllowedPreviewBase } from './allowed-urls.mjs';

const MAX_OUTREACH = 50;
const MAX_CONTACTED = 1_000_000;
const MAX_SLUGS = 1_000_000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,120}$/i;
const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

function finiteInt(value, field, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
  if (value < 0 || value > max) {
    throw new Error(`${field} out of range`);
  }
  return value;
}

function optionalString(value, field, maxLen) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) throw new Error(`${field} invalid length`);
  return trimmed;
}

export function validateSyncPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid JSON body');
  }

  const contacted = finiteInt(body.contacted ?? 0, 'contacted', MAX_CONTACTED);
  const previewSlugs = finiteInt(body.previewSlugs ?? 0, 'previewSlugs', MAX_SLUGS);
  const emailsSentLive =
    body.emailsSentLive === undefined
      ? undefined
      : finiteInt(body.emailsSentLive, 'emailsSentLive', MAX_CONTACTED);

  const previewBase = assertAllowedPreviewBase(
    (body.previewBase ?? 'https://preview.ceo.slay.llc').replace(/\/$/, '')
  );

  const lastPipelineZip = optionalString(body.lastPipelineZip, 'lastPipelineZip', 16);
  if (lastPipelineZip && !ZIP_PATTERN.test(lastPipelineZip)) {
    throw new Error('lastPipelineZip must be a US ZIP code');
  }

  const lastPipelineMetro = optionalString(body.lastPipelineMetro, 'lastPipelineMetro', 120);

  const rawOutreach = Array.isArray(body.recentOutreach) ? body.recentOutreach : [];
  if (rawOutreach.length > MAX_OUTREACH) {
    throw new Error(`recentOutreach exceeds max ${MAX_OUTREACH}`);
  }

  const recentOutreach = rawOutreach.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`recentOutreach[${index}] invalid`);
    }
    const name = optionalString(entry.name, `recentOutreach[${index}].name`, 200);
    const slug = optionalString(entry.slug, `recentOutreach[${index}].slug`, 140);
    if (!slug || !SLUG_PATTERN.test(slug)) {
      throw new Error(`recentOutreach[${index}].slug invalid`);
    }
    const recipient = optionalString(entry.recipient, `recentOutreach[${index}].recipient`, 320);
    const timestamp = optionalString(entry.timestamp, `recentOutreach[${index}].timestamp`, 40);
    const zip = optionalString(entry.zip, `recentOutreach[${index}].zip`, 16);
    if (zip && !ZIP_PATTERN.test(zip)) {
      throw new Error(`recentOutreach[${index}].zip invalid`);
    }

    const previewUrl = assertAllowedHttpsUrl(
      entry.previewUrl ?? `${previewBase}/${slug}/`,
      `recentOutreach[${index}].previewUrl`
    );

    return { name, slug, recipient, previewUrl, timestamp, zip };
  });

  const scoutedListings =
    body.scoutedListings === undefined
      ? undefined
      : finiteInt(body.scoutedListings, 'scoutedListings', MAX_SLUGS);

  const portalsOpened =
    body.portalsOpened === undefined
      ? undefined
      : finiteInt(body.portalsOpened, 'portalsOpened', MAX_CONTACTED);

  const emailsOpened =
    body.emailsOpened === undefined
      ? undefined
      : finiteInt(body.emailsOpened, 'emailsOpened', MAX_CONTACTED);

  const emailsClicked =
    body.emailsClicked === undefined
      ? undefined
      : finiteInt(body.emailsClicked, 'emailsClicked', MAX_CONTACTED);

  const zipHeatmap = Array.isArray(body.zipHeatmap) ? body.zipHeatmap.slice(0, 24) : undefined;

  const recentSessions = Array.isArray(body.recentSessions) ? body.recentSessions.slice(0, 40) : undefined;

  return {
    contacted,
    previewSlugs,
    emailsSentLive,
    previewBase,
    lastPipelineZip,
    lastPipelineMetro,
    recentOutreach,
    scoutedListings,
    portalsOpened,
    emailsOpened,
    emailsClicked,
    zipHeatmap,
    recentSessions,
  };
}