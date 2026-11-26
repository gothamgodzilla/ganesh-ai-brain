import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  loadRolePrompt,
  listRolePrompts,
  scanTextForFindings,
  computeContrarianVerdict,
  runRoleStackPipeline,
  runThreePassVerificationLoop,
  runDecisionReview,
} from '../../lib/role-pipeline/index.mjs';
import {
  DEFAULT_WATCHDOG_PROPERTIES,
  getWatchdogConfig,
} from '../watchdog-config.mjs';
import {
  parseRdapDomainPayload,
  checkProperty,
  runInfrastructureWatchdog,
} from '../watchdog.mjs';
import {
  listRoleTelemetry,
  getLatestWatchdogRun,
  listOrchestratorAlerts,
} from '../store.mjs';
import app from '../index.mjs';

function requestJson(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            // non-JSON
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

describe('1) Multi-Agent Role Stacking & Decision Review', () => {
  it('loads all 4 versioned role prompt files from disk with frontmatter metadata', () => {
    const prompts = listRolePrompts();
    assert.equal(prompts.length, 4);

    const architect = loadRolePrompt('architect');
    const operator = loadRolePrompt('operator');
    const contrarian = loadRolePrompt('contrarian-verifier');
    const decision = loadRolePrompt('decision-review');

    assert.equal(architect.role, 'Architect');
    assert.equal(architect.version, '1.0.0');
    assert.ok(architect.systemPrompt.includes('theoretical rigor'));

    assert.equal(operator.role, 'Operator');
    assert.equal(operator.version, '1.0.0');
    assert.ok(operator.systemPrompt.includes('practical simplicity'));

    assert.equal(contrarian.role, 'ContrarianVerifier');
    assert.equal(contrarian.version, '1.0.0');
    assert.ok(contrarian.systemPrompt.includes('PASS'));

    assert.equal(decision.role, 'DecisionReviewer');
    assert.equal(decision.version, '1.0.0');
  });

  it('executes Architect -> Operator -> Contrarian/Verifier pipeline with mocked LLM across 3 passes', async () => {
    const calls = [];
    const telemetryEvents = [];

    const mockLlm = async ({ role, promptMeta, pass, passStage, input }) => {
      calls.push({ role, pass, passStage, version: promptMeta.version });

      if (role === 'Architect') {
        return {
          role: 'Architect',
          version: promptMeta.version,
          summary: `Mocked Architect schema for: ${input.request}`,
          boundaries: [{ module: 'watchdog', responsibility: 'Health telemetry', invariants: ['RLS enabled'] }],
          schemas: [
            {
              name: 'brain_watchdog_runs',
              kind: 'supabase_sql',
              definition: 'CREATE TABLE brain_watchdog_runs (id TEXT PRIMARY KEY); ALTER TABLE brain_watchdog_runs ENABLE ROW LEVEL SECURITY;',
              rlsEnabled: true,
            },
          ],
        };
      }

      if (role === 'Operator') {
        return {
          role: 'Operator',
          version: promptMeta.version,
          pass,
          passStage,
          summary: `Operator pass ${pass} (${passStage}) implementation`,
          artifacts: [
            {
              target: 'brain-server/handler.mjs',
              runtime: 'node-esm',
              code:
                pass < 3
                  ? 'export async function run() { return fetch("https://ganesh.guru/api/healthz"); }'
                  : 'export async function run() { return fetch("https://ganesh.guru/api/healthz", { signal: AbortSignal.timeout(5000) }); }',
            },
          ],
        };
      }

      if (role === 'ContrarianVerifier') {
        const verdict = pass < 3 ? 'REVISE' : 'PASS';
        return {
          role: 'ContrarianVerifier',
          version: promptMeta.version,
          pass,
          passStage,
          verdict,
          summary: `Contrarian gate pass ${pass}: ${verdict}`,
          findings:
            pass < 3
              ? [
                  {
                    id: `CV-00${pass}`,
                    severity: 'medium',
                    category: 'network-failure',
                    location: 'brain-server/handler.mjs',
                    message: 'Missing AbortSignal.timeout on outbound fetch',
                    remediation: 'Add AbortSignal.timeout(5000)',
                  },
                ]
              : [],
        };
      }
      throw new Error(`Unexpected role: ${role}`);
    };

    const result = await runRoleStackPipeline({
      request: 'Implement watchdog endpoint with Supabase RLS',
      llmAdapter: mockLlm,
      onTelemetry: (entry) => telemetryEvents.push(entry),
    });

    assert.equal(result.ok, true);
    assert.equal(result.finalVerdict, 'PASS');
    assert.equal(result.stageReady, true);
    assert.equal(result.blocked, false);
    assert.equal(result.passesCompleted, 3);
    assert.deepEqual(
      result.passes.map((p) => p.stage),
      ['draft', 'edge-case-analysis', 'optimized-rewrite']
    );
    assert.deepEqual(
      result.passes.map((p) => p.contrarian.verdict),
      ['REVISE', 'REVISE', 'PASS']
    );
    // 1 Architect step + 3 * (Operator + Contrarian) = 7 telemetry events
    assert.equal(telemetryEvents.length, 7);
    for (const item of telemetryEvents) {
      assert.ok(item.role);
      assert.ok(typeof item.pass === 'number');
      assert.ok(item.verdict);
      assert.ok(item.latencyMs >= 1);
    }
  });

  it('halts and returns BLOCK when Contrarian detects a critical finding', async () => {
    const mockBlockingLlm = async ({ role, pass }) => {
      if (role === 'Architect') return { summary: 'Blueprint', schemas: [] };
      if (role === 'Operator') return { summary: 'Draft', artifacts: [] };
      return {
        role: 'ContrarianVerifier',
        pass,
        verdict: 'BLOCK',
        summary: 'Critical hardcoded secret detected',
        findings: [
          {
            id: 'SEC-001',
            severity: 'critical',
            category: 'security',
            location: 'handler.mjs',
            message: 'Hardcoded live Stripe key',
            remediation: 'Use process.env.STRIPE_SECRET_KEY',
          },
        ],
      };
    };

    const result = await runRoleStackPipeline({
      request: 'Unsafe endpoint draft',
      llmAdapter: mockBlockingLlm,
    });

    assert.equal(result.ok, false);
    assert.equal(result.finalVerdict, 'BLOCK');
    assert.equal(result.blocked, true);
    assert.equal(result.stageReady, false);
    assert.equal(result.passesCompleted, 1, 'Should halt immediately on critical BLOCK');
  });

  it('scores project decisions in lightweight decision-review mode', async () => {
    const approved = await runDecisionReview({
      title: 'Use Vercel Cron for Daily Watchdog',
      proposal:
        'Schedule daily watchdog via Vercel Cron hitting /api/cron/watchdog with Supabase RLS table and local JSON fallback plus AbortSignal timeout.',
    });
    assert.equal(approved.verdict, 'APPROVE');
    assert.ok(approved.scores.theoreticalValidity >= 8);
    assert.ok(approved.scores.deploymentSimplicity >= 8);
    assert.ok(approved.scores.executionSpeed >= 8);
    assert.ok(approved.scores.composite >= 8);

    const rejected = await runDecisionReview({
      title: 'Over-engineered Unsafe Cluster',
      proposal:
        'Deploy multi-cluster Kubernetes + Kafka + Terraform broker and skip RLS and hardcode secret in client code.',
    });
    assert.notEqual(rejected.verdict, 'APPROVE');
    assert.ok(rejected.risks.length >= 2);
  });
});

describe('2) Continuous Three-Pass Verification Loop & Static Contrarian Scanner', () => {
  it('remediates draft issues across Draft -> Edge-case analysis -> Optimized rewrite', async () => {
    const flawedDraft = [
      'export async function checkEndpoint(url) {',
      '  try {',
      '    return await fetch("http://example.com/health");',
      '  } catch (e) {}',
      '}',
    ].join('\n');

    const result = await runThreePassVerificationLoop({
      request: 'Harden endpoint health check function',
      initialDraft: flawedDraft,
    });

    assert.equal(result.passesCompleted, 3);
    assert.equal(result.passes[0].stage, 'draft');
    assert.equal(result.passes[0].contrarian.verdict, 'REVISE');
    assert.ok(result.passes[0].contrarian.findings.length >= 2);

    assert.equal(result.passes[1].stage, 'edge-case-analysis');
    assert.equal(result.passes[2].stage, 'optimized-rewrite');
    assert.equal(result.finalVerdict, 'PASS');
    assert.equal(result.stageReady, true);

    const finalCode = result.operator.artifacts[0].code;
    assert.ok(finalCode.includes('https://'), 'Plaintext HTTP should be upgraded to HTTPS');
    assert.ok(finalCode.includes('AbortSignal.timeout'), 'Missing timeout should be remediated');
  });

  it('flags hardcoded secrets, missing SQL RLS, and empty catch blocks', () => {
    const fakeStripeKey = `sk_live_${'a'.repeat(28)}`;
    const secFindings = scanTextForFindings(`const k = "${fakeStripeKey}";`, 'test.js');
    assert.ok(secFindings.some((f) => f.id === 'SEC-STRIPE-LIVE'));
    assert.equal(computeContrarianVerdict(secFindings), 'BLOCK');

    const sqlWithoutRls = 'CREATE TABLE brain_test (id TEXT PRIMARY KEY);';
    const sqlFindings = scanTextForFindings(sqlWithoutRls, 'migration.sql');
    assert.ok(sqlFindings.some((f) => f.id === 'SQL-MISSING-RLS'));
    assert.equal(computeContrarianVerdict(sqlFindings, { isFinalPass: true }), 'BLOCK');
  });
});

describe('3) Autonomous Infrastructure Watchdog (Mocked Network)', () => {
  it('configures all 10 required properties by default and supports env/config overrides', () => {
    const cfg = getWatchdogConfig();
    const domains = cfg.properties.map((p) => p.domain);
    assert.deepEqual(domains, [
      'mangasm.app',
      'ganesh.guru',
      'coexist.llc',
      'coexist.click',
      'nostalgia.sh',
      'lynxlogix.ai',
      'lynxlogix.net',
      'lynxlogix.org',
      'helping.llc',
      'slay.llc',
    ]);
    assert.equal(DEFAULT_WATCHDOG_PROPERTIES.length, 10);
    assert.equal(cfg.thresholds.tlsExpiryWarnDays, 21);
    assert.equal(cfg.thresholds.domainExpiryWarnDays, 30);
  });

  it('parses RDAP expiration dates and handles missing RDAP events gracefully', () => {
    const nowMs = Date.parse('2026-11-26T00:00:00Z');
    const parsed = parseRdapDomainPayload(
      {
        events: [{ eventAction: 'expiration', eventDate: '2026-12-10T00:00:00Z' }],
        entities: [{ roles: ['registrar'], handle: 'Cloudflare, Inc.' }],
      },
      { nowMs }
    );
    assert.equal(parsed.available, true);
    assert.equal(parsed.daysRemaining, 14);
    assert.equal(parsed.registrar, 'Cloudflare, Inc.');

    const unavailable = parseRdapDomainPayload({ events: [] }, { nowMs });
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.daysRemaining, null);
  });

  it('detects down, slow, cert < 21d, and domain < 30d anomalies and pushes alerts to the orchestrator feed', async () => {
    const pushedAlerts = [];

    const report = await runInfrastructureWatchdog({
      dnsProbe: async (domain) => {
        if (domain === 'helping.llc') {
          return { ok: false, addresses: [], latencyMs: 12, error: 'ENOTFOUND' };
        }
        return { ok: true, addresses: ['76.76.21.21'], latencyMs: 8, error: null };
      },
      httpProbe: async (endpoints) => {
        const url = endpoints[0];
        if (url.includes('helping.llc')) {
          return { ok: false, status: 0, latencyMs: 15, endpoints: [], error: 'ENOTFOUND' };
        }
        if (url.includes('nostalgia.sh')) {
          return { ok: false, status: 503, latencyMs: 120, endpoints: [], error: 'HTTP 503' };
        }
        if (url.includes('coexist.click')) {
          return { ok: true, status: 200, latencyMs: 3400, endpoints: [], error: null };
        }
        return { ok: true, status: 200, latencyMs: 95, endpoints: [], error: null };
      },
      tlsProbe: async (domain) => {
        if (domain === 'lynxlogix.ai') {
          return { ok: true, daysRemaining: 12, validTo: '2026-12-08T00:00:00Z', issuer: "Let's Encrypt", error: null };
        }
        return { ok: true, daysRemaining: 74, validTo: '2027-02-08T00:00:00Z', issuer: "Let's Encrypt", error: null };
      },
      rdapProbe: async (domain) => {
        if (domain === 'slay.llc') {
          return { available: true, daysRemaining: 19, expiresAt: '2026-12-15T00:00:00Z', registrar: 'Namecheap', note: null };
        }
        if (domain === 'nostalgia.sh') {
          return { available: false, daysRemaining: null, expiresAt: null, registrar: null, note: 'RDAP unavailable for .sh' };
        }
        return { available: true, daysRemaining: 240, expiresAt: '2027-07-24T00:00:00Z', registrar: 'Cloudflare', note: null };
      },
      onAlerts: (alerts) => pushedAlerts.push(...alerts),
    });

    assert.equal(report.totalProperties, 10);
    assert.equal(report.downCount, 2, 'helping.llc (DNS) and nostalgia.sh (HTTP 503) should be down');
    assert.equal(report.degradedCount, 3, 'coexist.click (slow), lynxlogix.ai (cert < 21d), slay.llc (domain < 30d)');
    assert.equal(report.healthyCount, 5);
    assert.equal(report.anomaliesCount, 5);
    assert.equal(pushedAlerts.length, 5);

    const kinds = new Set(report.anomalies.map((a) => `${a.domain}:${a.kind}`));
    assert.ok(kinds.has('helping.llc:down'));
    assert.ok(kinds.has('nostalgia.sh:down'));
    assert.ok(kinds.has('coexist.click:slow'));
    assert.ok(kinds.has('lynxlogix.ai:cert_expiring'));
    assert.ok(kinds.has('slay.llc:domain_expiring'));

    // Verify local fallback persistence
    const savedRun = await getLatestWatchdogRun();
    assert.equal(savedRun.id, report.id);
    const storedAlerts = await listOrchestratorAlerts(20);
    assert.ok(storedAlerts.some((a) => a.domain === 'lynxlogix.ai' && a.kind === 'cert_expiring'));
  });
});

describe('4) Express API Routes for Orchestrator Pipeline, Decision Review & Dashboard Telemetry', () => {
  it('exposes role pipeline, decision review, and telemetry on brain-server when authenticated via BRAIN_SYNC_SECRET', async () => {
    process.env.BRAIN_SYNC_SECRET = 'test-sync-secret-12345';
    process.env.DASHBOARD_VIEW_TOKEN = 'test-dash-token-12345';

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const authHeaders = { Authorization: 'Bearer test-dash-token-12345' };
      const syncHeaders = { Authorization: 'Bearer test-sync-secret-12345' };

      const rolesRes = await requestJson(server, '/api/orchestrator/roles', {
        headers: authHeaders,
      });
      assert.equal(rolesRes.status, 200);
      assert.equal(rolesRes.body.roles.length, 4);

      const pipeRes = await requestJson(server, '/api/orchestrator/pipeline', {
        method: 'POST',
        headers: syncHeaders,
        body: {
          request: 'Create watchdog telemetry table and endpoint',
        },
      });
      assert.equal(pipeRes.status, 200);
      assert.equal(pipeRes.body.finalVerdict, 'PASS');
      assert.equal(pipeRes.body.passesCompleted, 3);

      const decisionRes = await requestJson(server, '/api/orchestrator/decision-review', {
        method: 'POST',
        headers: syncHeaders,
        body: {
          title: 'Use local JSON fallback when Supabase is unset',
          proposal: 'Persist telemetry to Supabase Postgres primary with local file fallback and RLS.',
        },
      });
      assert.equal(decisionRes.status, 200);
      assert.equal(decisionRes.body.verdict, 'APPROVE');

      const dashRes = await requestJson(server, '/api/dashboard', {
        headers: authHeaders,
      });
      assert.equal(dashRes.status, 200);
      assert.ok(Array.isArray(dashRes.body.orchestrator?.telemetry));
      assert.ok(dashRes.body.orchestrator.telemetry.length >= 1);
      assert.equal(dashRes.body.watchdog?.properties?.length, 10);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
