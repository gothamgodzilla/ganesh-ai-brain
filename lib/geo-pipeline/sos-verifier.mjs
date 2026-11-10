/**
 * Public business-registry verification with a three-state outcome:
 *   VERIFIED             — registry affirmatively confirms good standing
 *   NOT_IN_GOOD_STANDING — registry affirmatively says inactive/dissolved
 *   INDETERMINATE        — nothing could be established (network error,
 *                          unexpected shape, no exact match). Never reported
 *                          as a negative claim about the business.
 *
 * Every result carries provenance (source, retrieved_at, raw status) so the
 * trust attestation can cite its evidence.
 */

const GOOD_STANDING = new Set(['ACTIVE', 'GOOD_STANDING', 'ACTIVE_GOOD_STANDING', 'ACTIVE_COMPLIANCE']);

/** Normalize a registry status string: "Active / Good Standing" → "ACTIVE_GOOD_STANDING". */
function normalizeStatus(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Case/punctuation-insensitive legal-name normalization for exact matching. */
function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export class GaneshSOSVerifier {
  /**
   * @param {object} options
   * @param {string} options.apiKey Sent as a header, never in the query
   *   string (query params leak into access logs and proxies).
   * @param {string} [options.endpoint]
   * @param {typeof fetch} [options.fetchImpl] Injectable for tests.
   * @param {number} [options.timeoutMs]
   */
  constructor({ apiKey = process.env.REGISTRY_API_KEY, endpoint, fetchImpl, timeoutMs } = {}) {
    if (!apiKey) {
      throw new Error('GaneshSOSVerifier requires an apiKey (or REGISTRY_API_KEY env var)');
    }
    this.apiKey = apiKey;
    this.endpoint = endpoint ?? 'https://api.business-registry.org/v1/search';
    this.fetchImpl = fetchImpl ?? fetch;
    this.timeoutMs = timeoutMs ?? 15_000;
  }

  #indeterminate(reason, extra = {}) {
    return {
      verified: false,
      outcome: 'INDETERMINATE',
      reason,
      source: this.endpoint,
      retrieved_at: new Date().toISOString(),
      ...extra,
    };
  }

  /**
   * Confirm active status and extract corporate contacts for one business.
   * The registry endpoint is a search: the response may contain several
   * candidates, so a result only counts when its legal name exactly matches
   * the query after normalization. Anything else is INDETERMINATE — the
   * caller must never mint a trust proof from a fuzzy match.
   */
  async verifyBusinessStatus(businessName, stateCode) {
    const url = new URL(this.endpoint);
    url.searchParams.set('q', businessName);
    url.searchParams.set('state', stateCode);

    let data;
    try {
      const response = await this.fetchImpl(url, {
        headers: { 'X-API-Key': this.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        return this.#indeterminate(`Registry returned HTTP ${response.status}`);
      }
      data = await response.json();
    } catch (err) {
      return this.#indeterminate(`Registry request failed: ${err.message}`);
    }

    // Accept both single-record and candidate-list response shapes.
    const candidates = Array.isArray(data.results) ? data.results : [data];
    const wanted = normalizeName(businessName);
    const matches = candidates.filter((c) => normalizeName(c?.legal_name) === wanted);

    if (matches.length === 0) {
      return this.#indeterminate('No exact legal-name match in registry results', {
        candidate_names: candidates.map((c) => c?.legal_name).filter(Boolean),
      });
    }
    if (matches.length > 1) {
      return this.#indeterminate('Multiple exact matches; entity is ambiguous', {
        candidate_ids: matches.map((c) => c?.entity_id).filter(Boolean),
      });
    }

    const record = matches[0];
    const rawStatus = record.status;
    if (rawStatus === undefined || rawStatus === null || rawStatus === '') {
      return this.#indeterminate('Registry record has no status field');
    }

    const status = normalizeStatus(rawStatus);
    const provenance = {
      source: this.endpoint,
      retrieved_at: new Date().toISOString(),
      raw_status: rawStatus,
    };

    if (GOOD_STANDING.has(status)) {
      return {
        verified: true,
        outcome: 'VERIFIED',
        entity_id: record.entity_id,
        legal_name: record.legal_name,
        primary_phone: record.contacts?.phone,
        primary_email: record.contacts?.email,
        registered_address: record.address,
        status,
        ...provenance,
      };
    }

    return {
      verified: false,
      outcome: 'NOT_IN_GOOD_STANDING',
      status,
      reason: `Registry status: ${rawStatus}`,
      ...provenance,
    };
  }
}
