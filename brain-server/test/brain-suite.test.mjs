import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../index.mjs';
import { listConversions, addConversion, getSystemSnapshot, saveSystemSnapshot } from '../store.mjs';
import { isSupabaseConfigured } from '../storage/supabase-client.mjs';

const engagement = await import('../../lib/engagement-registry.cjs');

describe('Ganesh AI Brain Server & Storage Suite', () => {
  let server;
  let port;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = http.createServer(app).listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('Health and Routes', () => {
    test('GET /api/healthz returns 200 with service and routes info', async () => {
      const res = await fetch(`${baseUrl}/api/healthz`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.equal(json.service, 'ganesh-ai-brain');
      assert.equal(json.routes, 'brain-server-express');
      assert.ok(json.build);
    });

    test('GET /api/health returns 200 with ok:true and endpoint statuses', async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { Accept: 'application/json' },
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.ok, true);
      assert.equal(json.service, 'ganesh-ai-brain');
      assert.equal(typeof json.stripe, 'boolean');
      assert.equal(typeof json.webhook, 'boolean');
      assert.equal(typeof json.sync, 'boolean');
    });

    test('GET /api/dashboard returns 401 or 503 without valid dashboard auth', async () => {
      const res = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { Accept: 'application/json' },
      });
      assert.ok(res.status === 401 || res.status === 503);
      const json = await res.json();
      assert.ok(json.error);
    });
  });

  describe('Storage Layer', () => {
    test('isSupabaseConfigured returns boolean based on env', () => {
      assert.equal(typeof isSupabaseConfigured(), 'boolean');
    });

    test('conversions store deduplicates/idempotently handles events by id', async () => {
      const testEventId = `test-conv-${Date.now()}`;
      const conv = {
        id: testEventId,
        amount: 49900,
        currency: 'usd',
        status: 'complete',
        customerEmail: 'vip@example.com',
        businessId: 'test-biz-1',
        tier: 'cohort',
        createdAt: new Date().toISOString(),
        source: 'test',
      };

      await addConversion(conv);
      await addConversion(conv); // Duplicate add

      const list = await listConversions();
      const matches = list.filter((c) => c.id === testEventId);
      assert.equal(matches.length, 1, 'Should have exactly 1 conversion entry for event id');
      assert.equal(matches[0].amount, 49900);
      assert.equal(matches[0].customerEmail, 'vip@example.com');
    });

    test('system snapshot store saves and retrieves data', async () => {
      const testSnapshot = {
        updatedAt: new Date().toISOString(),
        contacted: 42,
        previewSlugs: 10,
        previewBase: 'https://preview.ceo.slay.llc',
      };

      await saveSystemSnapshot(testSnapshot);
      const retrieved = await getSystemSnapshot();
      assert.ok(retrieved);
      assert.equal(retrieved.contacted, 42);
      assert.equal(retrieved.previewSlugs, 10);
    });
  });

  describe('Engagement Registry and Missing contacted-registry.cjs Graceful Fallback', () => {
    test('engagement registry exports are intact and functional without crashing', () => {
      const stats = engagement.getEngagementStats();
      assert.ok(stats);
      assert.equal(typeof stats.sent, 'number');
      assert.equal(typeof stats.uniqueOpens, 'number');
      assert.equal(typeof stats.uniqueClicks, 'number');

      const top = engagement.getTopEngaged(5);
      assert.ok(Array.isArray(top));
    });

    test('recordPreviewVisit and recordEmailEvent execute cleanly', () => {
      const testSlug = `test-slug-${Date.now()}`;
      assert.doesNotThrow(() => {
        engagement.recordPreviewVisit({
          slug: testSlug,
          path: '/preview',
          referrer: 'https://google.com',
          utm: 'utm_source=test',
        });
      });

      assert.doesNotThrow(() => {
        engagement.recordEmailEvent({
          type: 'email.opened',
          resendId: `resend-${Date.now()}`,
          recipient: 'test@example.com',
          slug: testSlug,
          timestamp: new Date().toISOString(),
        });
      });
    });
  });
});
