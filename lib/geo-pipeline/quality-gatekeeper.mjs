/**
 * Check-and-balance system for autonomously polished business data.
 * Fails closed: a payload is only APPROVED when every gate affirmatively
 * passes. Indeterminate or missing data is never treated as a pass.
 */

const REQUIRED_SCHEMA_KEYS = ['@context', '@type', 'name', 'sku', 'offers', 'brand'];

/** Strip everything but digits so formatting differences don't matter. */
function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Case/whitespace/punctuation-insensitive legal-name normalization. */
function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export class GaneshQualityGatekeeper {
  /** GATE 1: mandatory schema.org structure. */
  static validateSchemaCompliance(schema) {
    for (const key of REQUIRED_SCHEMA_KEYS) {
      if (!(key in schema)) {
        return { ok: false, message: `Missing required schema key: ${key}` };
      }
    }
    if (schema['@type'] !== 'Product') {
      return { ok: false, message: "Invalid @type; expected 'Product'" };
    }
    const price = schema.offers?.price;
    if (price !== undefined && !/^\d+(\.\d+)?$/.test(String(price))) {
      return { ok: false, message: `Non-numeric offer price: ${price}` };
    }
    return { ok: true, message: 'Schema compliance verified.' };
  }

  /**
   * GATE 2: contact data must survive translation/enrichment unaltered.
   * Compares the registry-sourced record against the seller embedded at
   * offers.seller. If the source has a phone, the polished seller must carry
   * the same one — absence is a failure, not a skip.
   */
  static validateContactFidelity(originalRecord, schema) {
    const seller = schema.offers?.seller;
    if (!seller || typeof seller !== 'object') {
      return { ok: false, message: 'Polished schema has no offers.seller record' };
    }

    const origName = normalizeName(originalRecord.legal_name);
    const polName = normalizeName(seller.name);
    if (origName && origName !== polName) {
      return {
        ok: false,
        message: `Legal name mismatch: source (${originalRecord.legal_name}) vs polished (${seller.name})`,
      };
    }

    const origPhone = digitsOnly(originalRecord.phone);
    const polPhone = digitsOnly(seller.telephone);
    if (origPhone && origPhone !== polPhone) {
      return {
        ok: false,
        message: polPhone
          ? `Phone number mismatch: source (${origPhone}) vs polished (${polPhone})`
          : `Phone number dropped during polish: source (${origPhone})`,
      };
    }

    return { ok: true, message: 'Contact fidelity confirmed.' };
  }

  /** GATE 3: holistic score for deployment approval. */
  static calculateConfidenceScore(schemaValid, fidelityValid, translated) {
    let score = 0;
    if (schemaValid) score += 0.5;
    if (fidelityValid) score += 0.4;
    if (translated) score += 0.1;
    return Math.round(score * 100) / 100;
  }

  /** Run the complete check-and-balance routine on one polished schema. */
  evaluatePayload(originalData, polishedSchema, { translated = true } = {}) {
    const schema = GaneshQualityGatekeeper.validateSchemaCompliance(polishedSchema);
    const fidelity = GaneshQualityGatekeeper.validateContactFidelity(originalData, polishedSchema);
    const score = GaneshQualityGatekeeper.calculateConfidenceScore(schema.ok, fidelity.ok, translated);
    return {
      status: score >= 0.9 ? 'APPROVED' : 'QUARANTINED',
      confidence_score: score,
      logs: [schema.message, fidelity.message],
    };
  }
}
