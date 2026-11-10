// Quick logic smoke test — no network calls, no real API keys needed.
// Run with: node scripts/smoke-test.mjs (after `npm run build`)

import assert from "node:assert/strict";
import { resolveGlobalCode } from "../dist/services/geocode.js";
import { mergeBusinessRecords } from "../dist/services/matching.js";
import { assertAllowedSender, renderComplianceFooter } from "../dist/services/compliance.js";
import { getLead, upsertLead, isSuppressed } from "../dist/services/lead-store.js";
import { createOptOutToken, verifyOptOutToken, buildUnsubscribeUrl } from "../dist/services/tokens.js";

// Tokens need a secret; set one for the test run only.
process.env.UNSUBSCRIBE_TOKEN_SECRET = "test-secret-of-at-least-32-characters-long!!";

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`ok - ${label}`);
}

check("resolveGlobalCode decodes a full Plus Code", () => {
  // 849VCWC8+R9 is Google's own documented example code (Googleplex, Mountain View, CA).
  const loc = resolveGlobalCode("849VCWC8+R9");
  assert.ok(loc.lat > 37 && loc.lat < 38, `lat out of range: ${loc.lat}`);
  assert.ok(loc.lng < -122 && loc.lng > -123, `lng out of range: ${loc.lng}`);
  assert.equal(loc.source, "global_code");
});

check("resolveGlobalCode rejects a short code with a clear error", () => {
  assert.throws(() => resolveGlobalCode("CWC8+R9"), /reference location/);
});

check("mergeBusinessRecords collapses the same storefront across sources", () => {
  const merged = mergeBusinessRecords([
    { source: "google_places", source_id: "g1", name: "Onyx Barber Shop", address: "123 Main St, Long Beach, CA" },
    { source: "yelp", source_id: "y1", name: "Onyx Barber Shop", address: "123 Main St, Long Beach, CA 90802", phone: "(555) 555-0100" },
    { source: "apple_maps", source_id: "a1", name: "Completely Different Salon", address: "999 Other Ave" },
  ]);
  assert.equal(merged.length, 2, `expected 2 merged groups, got ${merged.length}`);
  const barber = merged.find((m) => m.canonical_name === "Onyx Barber Shop");
  assert.ok(barber, "barber shop group not found");
  assert.deepEqual(barber.sources.sort(), ["google_places", "yelp"]);
});

check("assertAllowedSender accepts an allowlisted address", () => {
  assertAllowedSender("ceo@ganesh.guru");
});

check("assertAllowedSender rejects a random address", () => {
  assert.throws(() => assertAllowedSender("random@notallowed.com"), /not on the allowlist/);
});

check("renderComplianceFooter includes the physical address and opt-out link", () => {
  const footer = renderComplianceFooter({
    physicalAddress: "123 Fake St, Long Beach, CA 90802",
    unsubscribeUrl: "https://ganesh.guru/unsub/abc123",
    businessName: "Onyx Barber Shop",
  });
  assert.ok(footer.includes("123 Fake St"));
  assert.ok(footer.includes("https://ganesh.guru/unsub/abc123"));
});

await (async () => {
  const businessId = `smoke-test-${Date.now()}`;
  const lead = await upsertLead({
    business_id: businessId,
    business_name: "Smoke Test Salon",
    status: "contacted",
    last_contacted_at: new Date().toISOString(),
    contact_count: 1,
  });
  const fetched = await getLead(businessId);
  assert.equal(fetched?.business_id, businessId, "lead round-trip failed");
  const suppression = isSuppressed(fetched, 30);
  assert.equal(suppression.suppressed, true, "fresh contact should be in cooldown");
  passed++;
  console.log("ok - lead-store round-trip + cooldown suppression");
})();

check("opt-out token round-trips to the original business id", () => {
  const id = "ChIJ_test_place_id_123";
  assert.equal(verifyOptOutToken(createOptOutToken(id)), id);
});

check("opt-out token rejects a tampered payload", () => {
  const token = createOptOutToken("business-A");
  const [, sig] = token.split(".");
  // swap in a different business id, keep the original signature
  const forged = `${Buffer.from("business-B").toString("base64url")}.${sig}`;
  assert.equal(verifyOptOutToken(forged), null, "forged token must not verify");
});

check("opt-out token rejects garbage and wrong-length signatures", () => {
  assert.equal(verifyOptOutToken("not-a-token"), null);
  assert.equal(verifyOptOutToken("a.b"), null);
  assert.equal(verifyOptOutToken(""), null);
});

check("opt-out token is signature-dependent (different secret -> reject)", () => {
  const token = createOptOutToken("business-C");
  const original = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  process.env.UNSUBSCRIBE_TOKEN_SECRET = "a-completely-different-secret-32-chars-x!!";
  const result = verifyOptOutToken(token);
  process.env.UNSUBSCRIBE_TOKEN_SECRET = original;
  assert.equal(result, null, "token signed with another secret must not verify");
});

check("buildUnsubscribeUrl returns null when no base URL configured", () => {
  delete process.env.UNSUBSCRIBE_BASE_URL;
  assert.equal(buildUnsubscribeUrl("x"), null);
});

check("buildUnsubscribeUrl builds a verifiable link when configured", () => {
  process.env.UNSUBSCRIBE_BASE_URL = "https://ganesh.guru/lynx/";
  const url = buildUnsubscribeUrl("business-D");
  assert.ok(url.startsWith("https://ganesh.guru/lynx/unsubscribe?t="), `unexpected: ${url}`);
  const token = decodeURIComponent(new URL(url).searchParams.get("t"));
  assert.equal(verifyOptOutToken(token), "business-D");
  delete process.env.UNSUBSCRIBE_BASE_URL;
});

console.log(`\n${passed} checks passed.`);
