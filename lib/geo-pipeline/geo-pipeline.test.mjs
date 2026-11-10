import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from 'jose';

import { GaneshTradeEngine, TRADE_LANGUAGES } from './trade-engine.mjs';
import { GaneshQualityGatekeeper } from './quality-gatekeeper.mjs';
import { GaneshSOSVerifier } from './sos-verifier.mjs';
import { GaneshAuthenticationSystem, verifyTrustProof, PROOF_TYPE } from './trust-attestation.mjs';

const BIZ = {
  legal_name: 'Mangasm Enterprises',
  ganesh_trust_hash: 'abc123',
  phone: '+1 (212) 555-0187',
};
const SKU = { sku_code: 'SKU-1', item_name: 'Widget', description: 'A widget', price: 9.99 };

describe('GaneshTradeEngine', () => {
  test('emits seller telephone so fidelity gates can verify it', () => {
    const schema = new GaneshTradeEngine().buildSchemaOrg(BIZ, SKU, 'en', 'Widget', 'A widget');
    assert.equal(schema.offers.seller.telephone, BIZ.phone);
    assert.equal(schema.offers.price, '9.99');
  });

  test('regression: missing price is omitted, never serialized as "None"/"undefined"', () => {
    const schema = new GaneshTradeEngine().buildSchemaOrg(
      BIZ, { sku_code: 'SKU-2', item_name: 'X', description: 'Y' }, 'en', 'X', 'Y',
    );
    assert.ok(!('price' in schema.offers));
  });

  test('language set is a config: batch covers exactly the configured fleet', () => {
    const engine = new GaneshTradeEngine({ languages: { en: 'English', vi: 'Vietnamese' } });
    const manifest = engine.processTradeBatch(BIZ, [SKU]);
    assert.deepEqual(Object.keys(manifest).sort(), ['en', 'vi']);
    assert.equal(manifest.vi[0].inLanguage, 'vi');
    assert.equal(Object.keys(TRADE_LANGUAGES).length, 10);
  });
});

describe('GaneshQualityGatekeeper', () => {
  const gate = new GaneshQualityGatekeeper();
  const engine = new GaneshTradeEngine();

  test('regression A: untouched valid payload from a phone-having business is APPROVED', () => {
    // Prior code quarantined this (seller read from wrong path, no telephone emitted).
    const schema = engine.buildSchemaOrg(BIZ, SKU, 'en', 'Widget', 'A widget');
    const result = gate.evaluatePayload(BIZ, schema);
    assert.equal(result.status, 'APPROVED', result.logs.join(' | '));
    assert.equal(result.confidence_score, 1.0);
  });

  test('regression B: hallucinated seller is QUARANTINED even when source has no phone', () => {
    // Prior code approved this at 1.0 — the gate failed open on missing source phone.
    const bizNoPhone = { legal_name: BIZ.legal_name, ganesh_trust_hash: BIZ.ganesh_trust_hash };
    const schema = engine.buildSchemaOrg(bizNoPhone, SKU, 'en', 'Widget', 'A widget');
    schema.offers.seller.name = 'HALLUCINATED LLC';
    const result = gate.evaluatePayload(bizNoPhone, schema);
    assert.equal(result.status, 'QUARANTINED');
    assert.match(result.logs[1], /Legal name mismatch/);
  });

  test('phone dropped during polish fails closed', () => {
    const schema = engine.buildSchemaOrg(BIZ, SKU, 'en', 'Widget', 'A widget');
    delete schema.offers.seller.telephone;
    const result = gate.evaluatePayload(BIZ, schema);
    assert.equal(result.status, 'QUARANTINED');
    assert.match(result.logs[1], /Phone number dropped/);
  });

  test('missing offers.seller entirely fails GATE 2, not crashes', () => {
    const result = gate.evaluatePayload(BIZ, {
      '@context': 'x', '@type': 'Product', name: 'n', sku: 's', brand: {}, offers: {},
    });
    assert.equal(result.status, 'QUARANTINED');
    assert.match(result.logs[1], /no offers\.seller/);
  });

  test('non-numeric price fails schema compliance', () => {
    const schema = engine.buildSchemaOrg(BIZ, SKU, 'en', 'Widget', 'A widget');
    schema.offers.price = 'None';
    const result = gate.evaluatePayload(BIZ, schema);
    assert.match(result.logs[0], /Non-numeric offer price/);
  });
});

describe('GaneshSOSVerifier', () => {
  const mkVerifier = (fetchImpl) =>
    new GaneshSOSVerifier({ apiKey: 'test-key', fetchImpl });
  const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  test('active exact match verifies with provenance', async () => {
    const verifier = mkVerifier(async () => jsonResponse({
      results: [{
        legal_name: 'Mangasm Enterprises', entity_id: 'E-1', status: 'Active / Good Standing',
        contacts: { phone: '212-555-0187', email: 'ops@mangasm.com' }, address: '1 Way, NY',
      }],
    }));
    const result = await verifier.verifyBusinessStatus('Mangasm Enterprises', 'NY');
    assert.equal(result.outcome, 'VERIFIED');
    assert.equal(result.entity_id, 'E-1');
    assert.equal(result.raw_status, 'Active / Good Standing');
    assert.ok(result.retrieved_at);
  });

  test('regression: missing status field is INDETERMINATE, never "Inactive/Dissolved"', async () => {
    const verifier = mkVerifier(async () => jsonResponse({ results: [{ legal_name: 'Mangasm Enterprises' }] }));
    const result = await verifier.verifyBusinessStatus('Mangasm Enterprises', 'NY');
    assert.equal(result.outcome, 'INDETERMINATE');
    assert.ok(!/dissolved/i.test(result.reason));
  });

  test('regression: fuzzy name match never verifies the wrong entity', async () => {
    const verifier = mkVerifier(async () => jsonResponse({
      results: [{ legal_name: 'Mangasm Enterprises LLC', entity_id: 'E-OTHER', status: 'ACTIVE' }],
    }));
    const result = await verifier.verifyBusinessStatus('Mangasm Enterprises', 'NY');
    assert.equal(result.outcome, 'INDETERMINATE');
    assert.deepEqual(result.candidate_names, ['Mangasm Enterprises LLC']);
  });

  test('affirmative dissolved status is NOT_IN_GOOD_STANDING', async () => {
    const verifier = mkVerifier(async () => jsonResponse({
      results: [{ legal_name: 'Mangasm Enterprises', status: 'Dissolved' }],
    }));
    const result = await verifier.verifyBusinessStatus('Mangasm Enterprises', 'NY');
    assert.equal(result.outcome, 'NOT_IN_GOOD_STANDING');
    assert.equal(result.status, 'DISSOLVED');
  });

  test('network failure and HTTP errors are INDETERMINATE, not crashes', async () => {
    const down = mkVerifier(async () => { throw new Error('ECONNREFUSED'); });
    assert.equal((await down.verifyBusinessStatus('X', 'NY')).outcome, 'INDETERMINATE');
    const http500 = mkVerifier(async () => new Response('<html>oops</html>', { status: 500 }));
    assert.equal((await http500.verifyBusinessStatus('X', 'NY')).outcome, 'INDETERMINATE');
  });

  test('API key travels in a header, never the query string', async () => {
    let captured;
    const verifier = mkVerifier(async (url, init) => {
      captured = { url: String(url), headers: init.headers };
      return jsonResponse({ results: [] });
    });
    await verifier.verifyBusinessStatus('X', 'NY');
    assert.ok(!captured.url.includes('test-key'));
    assert.equal(captured.headers['X-API-Key'], 'test-key');
  });
});

describe('GaneshAuthenticationSystem (JWS)', () => {
  test('mint → verify round-trip carries attestation, kid, and expiry', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const auth = new GaneshAuthenticationSystem({ privateKey, keyId: 'ganesh-2026-07' });
    const token = await auth.mintTrustProof({
      entityId: 'E-1', legalName: 'Mangasm Enterprises', sosStatus: 'ACTIVE',
      source: 'https://api.business-registry.org/v1/search', retrievedAt: '2026-07-21T00:00:00Z',
    });
    const { payload, keyId } = await verifyTrustProof(token, publicKey);
    assert.equal(payload.proof_type, PROOF_TYPE);
    assert.equal(payload.attestation.entityId, 'E-1');
    assert.equal(keyId, 'ganesh-2026-07');
    assert.ok(payload.exp > payload.iat);
  });

  test('proofs from a foreign key are rejected', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const { publicKey: wrongPublic } = await generateKeyPair('ES256');
    const auth = new GaneshAuthenticationSystem({ privateKey, keyId: 'k1' });
    const token = await auth.mintTrustProof({ entityId: 'E', legalName: 'L', sosStatus: 'ACTIVE' });
    await assert.rejects(() => verifyTrustProof(token, wrongPublic));
  });

  test('expired proofs are rejected', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const auth = new GaneshAuthenticationSystem({ privateKey, keyId: 'k1', ttlSeconds: -60 });
    const token = await auth.mintTrustProof({ entityId: 'E', legalName: 'L', sosStatus: 'ACTIVE' });
    await assert.rejects(() => verifyTrustProof(token, publicKey), /exp/i);
  });

  test('incomplete attestations refuse to mint', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const auth = new GaneshAuthenticationSystem({ privateKey, keyId: 'k1' });
    await assert.rejects(() => auth.mintTrustProof({ entityId: 'E', legalName: 'L' }), /sosStatus/);
  });
});

describe('end-to-end: verifier → engine → gatekeeper → attestation', () => {
  test('registry-sourced record flows through every gate and mints a verifiable proof', async () => {
    const verifier = new GaneshSOSVerifier({
      apiKey: 'k',
      fetchImpl: async () => new Response(JSON.stringify({
        results: [{
          legal_name: 'Mangasm Enterprises', entity_id: 'E-1', status: 'ACTIVE',
          contacts: { phone: '+1 (212) 555-0187' },
        }],
      }), { status: 200 }),
    });
    const sos = await verifier.verifyBusinessStatus('Mangasm Enterprises', 'NY');
    assert.equal(sos.outcome, 'VERIFIED');

    const business = {
      legal_name: sos.legal_name,
      ganesh_trust_hash: 'abc123',
      phone: sos.primary_phone,
    };
    const manifest = new GaneshTradeEngine().processTradeBatch(business, [SKU]);
    const gate = new GaneshQualityGatekeeper();
    for (const [lang, schemas] of Object.entries(manifest)) {
      for (const schema of schemas) {
        const result = gate.evaluatePayload(business, schema);
        assert.equal(result.status, 'APPROVED', `${lang}: ${result.logs.join(' | ')}`);
      }
    }

    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const auth = new GaneshAuthenticationSystem({ privateKey, keyId: 'ganesh-2026-07' });
    const token = await auth.mintTrustProof({
      entityId: sos.entity_id, legalName: sos.legal_name, sosStatus: sos.status,
      source: sos.source, retrievedAt: sos.retrieved_at,
    });
    const { payload } = await verifyTrustProof(token, publicKey);
    assert.equal(payload.attestation.legalName, 'Mangasm Enterprises');
  });
});
