import tls from 'node:tls';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { getWatchdogConfig } from './watchdog-config.mjs';
import { saveWatchdogRun, pushOrchestratorAlerts } from './store.mjs';

const MS_PER_DAY = 86_400_000;

/**
 * Default DNS resolution check (A and AAAA records).
 */
export async function defaultDnsProbe(domain) {
  const start = performance.now();
  try {
    const [v4, v6] = await Promise.allSettled([
      dns.resolve4(domain),
      dns.resolve6(domain),
    ]);
    const addresses = [
      ...(v4.status === 'fulfilled' ? v4.value : []),
      ...(v6.status === 'fulfilled' ? v6.value : []),
    ];
    const latencyMs = Math.max(1, Math.round(performance.now() - start));

    if (addresses.length === 0) {
      const reason =
        v4.status === 'rejected'
          ? v4.reason?.code || v4.reason?.message || 'DNS resolution returned no records'
          : 'No A/AAAA records';
      return { ok: false, addresses: [], latencyMs, error: String(reason) };
    }

    return { ok: true, addresses, latencyMs, error: null };
  } catch (err) {
    return {
      ok: false,
      addresses: [],
      latencyMs: Math.max(1, Math.round(performance.now() - start)),
      error: err instanceof Error ? err.message : 'DNS resolution failed',
    };
  }
}

/**
 * Default HTTP status & latency check across configured key endpoints for a property.
 */
export async function defaultHttpProbe(endpoints, { timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  const endpointResults = [];
  for (const url of endpoints) {
    const start = performance.now();
    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'GaneshAI-Watchdog/2.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Math.max(1, Math.round(performance.now() - start));
      const ok = res.status >= 200 && res.status < 400;
      endpointResults.push({
        url,
        ok,
        status: res.status,
        latencyMs,
        error: ok ? null : `HTTP ${res.status}`,
      });
    } catch (err) {
      const latencyMs = Math.max(1, Math.round(performance.now() - start));
      endpointResults.push({
        url,
        ok: false,
        status: 0,
        latencyMs,
        error: err instanceof Error ? err.message : 'HTTP request failed',
      });
    }
  }

  const allOk = endpointResults.length > 0 && endpointResults.every((r) => r.ok);
  const maxLatencyMs = endpointResults.reduce((max, r) => Math.max(max, r.latencyMs), 0);
  const primaryStatus = endpointResults[0]?.status ?? 0;
  const firstError = endpointResults.find((r) => !r.ok)?.error ?? null;

  return {
    ok: allOk,
    status: primaryStatus,
    latencyMs: maxLatencyMs,
    endpoints: endpointResults,
    error: firstError,
  };
}

/**
 * Default TLS certificate inspection via node:tls.
 */
export async function defaultTlsProbe(domain, { timeoutMs = 6000, nowMs = Date.now() } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = tls.connect(
      {
        host: domain,
        port: 443,
        servername: domain,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) {
            finish({
              ok: false,
              daysRemaining: null,
              validTo: null,
              issuer: null,
              error: 'No peer TLS certificate presented',
            });
            return;
          }
          const expiresAtMs = Date.parse(cert.valid_to);
          if (!Number.isFinite(expiresAtMs)) {
            finish({
              ok: false,
              daysRemaining: null,
              validTo: cert.valid_to,
              issuer: cert.issuer?.O ?? null,
              error: 'Unparseable TLS valid_to date',
            });
            return;
          }
          const daysRemaining = Math.floor((expiresAtMs - nowMs) / MS_PER_DAY);
          finish({
            ok: daysRemaining > 0,
            daysRemaining,
            validTo: new Date(expiresAtMs).toISOString(),
            issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null,
            error: daysRemaining <= 0 ? 'TLS certificate expired' : null,
          });
        } catch (err) {
          socket.destroy();
          finish({
            ok: false,
            daysRemaining: null,
            validTo: null,
            issuer: null,
            error: err instanceof Error ? err.message : 'TLS inspection error',
          });
        }
      }
    );

    socket.on('timeout', () => {
      socket.destroy();
      finish({
        ok: false,
        daysRemaining: null,
        validTo: null,
        issuer: null,
        error: `TLS handshake timed out after ${timeoutMs}ms`,
      });
    });

    socket.on('error', (err) => {
      socket.destroy();
      finish({
        ok: false,
        daysRemaining: null,
        validTo: null,
        issuer: null,
        error: err instanceof Error ? err.message : 'TLS socket error',
      });
    });
  });
}

/**
 * Default RDAP domain registration expiry check.
 * Queries https://rdap.org/domain/<domain> and extracts the `expiration` event.
 * Gracefully reports `available: false` when a TLD registry does not expose RDAP expiration.
 */
export async function defaultRdapProbe(
  domain,
  { timeoutMs = 7000, nowMs = Date.now(), fetchImpl = globalThis.fetch } = {}
) {
  const rdapUrl = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  try {
    const res = await fetchImpl(rdapUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'application/rdap+json, application/json',
        'User-Agent': 'GaneshAI-Watchdog/2.0',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return {
        available: false,
        daysRemaining: null,
        expiresAt: null,
        registrar: null,
        note: `RDAP HTTP ${res.status}`,
      };
    }

    const payload = await res.json();
    return parseRdapDomainPayload(payload, { nowMs });
  } catch (err) {
    return {
      available: false,
      daysRemaining: null,
      expiresAt: null,
      registrar: null,
      note: err instanceof Error ? err.message : 'RDAP lookup unavailable',
    };
  }
}

export function parseRdapDomainPayload(payload, { nowMs = Date.now() } = {}) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const expiryEvent = events.find((e) =>
    /^(?:expiration|registrar expiration)$/i.test(String(e?.eventAction ?? '').trim())
  );

  if (!expiryEvent?.eventDate) {
    return {
      available: false,
      daysRemaining: null,
      expiresAt: null,
      registrar: extractRdapRegistrar(payload),
      note: 'RDAP response did not include an expiration event',
    };
  }

  const expiresAtMs = Date.parse(expiryEvent.eventDate);
  if (!Number.isFinite(expiresAtMs)) {
    return {
      available: false,
      daysRemaining: null,
      expiresAt: null,
      registrar: extractRdapRegistrar(payload),
      note: 'Unparseable RDAP expiration date',
    };
  }

  const daysRemaining = Math.floor((expiresAtMs - nowMs) / MS_PER_DAY);
  return {
    available: true,
    daysRemaining,
    expiresAt: new Date(expiresAtMs).toISOString(),
    registrar: extractRdapRegistrar(payload),
    note: null,
  };
}

function extractRdapRegistrar(payload) {
  const entities = Array.isArray(payload?.entities) ? payload.entities : [];
  const registrar = entities.find(
    (ent) => Array.isArray(ent?.roles) && ent.roles.includes('registrar')
  );
  if (!registrar) return null;
  const vcard = registrar?.vcardArray?.[1];
  if (Array.isArray(vcard)) {
    const fnEntry = vcard.find((row) => Array.isArray(row) && row[0] === 'fn');
    if (fnEntry?.[3]) return String(fnEntry[3]);
  }
  return registrar.handle ?? null;
}

/**
 * Evaluate a single property across DNS, HTTP, TLS, and RDAP probes and detect anomalies.
 */
export async function checkProperty(property, options = {}) {
  const thresholds = options.thresholds ?? getWatchdogConfig().thresholds;
  const dnsProbe = options.dnsProbe ?? defaultDnsProbe;
  const httpProbe = options.httpProbe ?? defaultHttpProbe;
  const tlsProbe = options.tlsProbe ?? defaultTlsProbe;
  const rdapProbe = options.rdapProbe ?? defaultRdapProbe;
  const nowIso = options.nowIso ?? new Date().toISOString();

  const domain = property.domain;
  const endpoints =
    Array.isArray(property.endpoints) && property.endpoints.length > 0
      ? property.endpoints
      : [`https://${domain}/`];

  const [dnsResult, httpResult, tlsResult, rdapResult] = await Promise.all([
    dnsProbe(domain, { thresholds }),
    httpProbe(endpoints, { timeoutMs: thresholds.httpTimeoutMs, fetchImpl: options.fetchImpl }),
    tlsProbe(domain, { timeoutMs: thresholds.tlsTimeoutMs, nowMs: options.nowMs }),
    rdapProbe(domain, {
      timeoutMs: thresholds.rdapTimeoutMs,
      nowMs: options.nowMs,
      fetchImpl: options.fetchImpl,
    }),
  ]);

  const anomalies = [];

  if (!dnsResult.ok) {
    anomalies.push({
      domain,
      kind: 'down',
      subkind: 'dns_failure',
      severity: 'critical',
      message: `${domain} DNS resolution failed (${dnsResult.error ?? 'no A/AAAA records'})`,
    });
  } else if (!httpResult.ok) {
    anomalies.push({
      domain,
      kind: 'down',
      subkind: 'http_failure',
      severity: 'critical',
      message: `${domain} endpoint check failed (${httpResult.error ?? `HTTP ${httpResult.status}`})`,
    });
  }

  if (httpResult.ok && httpResult.latencyMs > thresholds.slowLatencyMs) {
    anomalies.push({
      domain,
      kind: 'slow',
      severity: 'warning',
      message: `${domain} responded slowly (${httpResult.latencyMs}ms > ${thresholds.slowLatencyMs}ms threshold)`,
    });
  }

  if (
    typeof tlsResult.daysRemaining === 'number' &&
    tlsResult.daysRemaining < thresholds.tlsExpiryWarnDays
  ) {
    anomalies.push({
      domain,
      kind: 'cert_expiring',
      severity: tlsResult.daysRemaining <= 7 ? 'critical' : 'warning',
      message: `${domain} TLS certificate expires in ${tlsResult.daysRemaining} day(s) (< ${thresholds.tlsExpiryWarnDays}d threshold)`,
    });
  } else if (!tlsResult.ok && dnsResult.ok) {
    anomalies.push({
      domain,
      kind: 'cert_expiring',
      severity: 'critical',
      message: `${domain} TLS certificate check failed (${tlsResult.error ?? 'invalid TLS'})`,
    });
  }

  if (
    rdapResult.available &&
    typeof rdapResult.daysRemaining === 'number' &&
    rdapResult.daysRemaining < thresholds.domainExpiryWarnDays
  ) {
    anomalies.push({
      domain,
      kind: 'domain_expiring',
      severity: rdapResult.daysRemaining <= 7 ? 'critical' : 'warning',
      message: `${domain} domain registration expires in ${rdapResult.daysRemaining} day(s) (< ${thresholds.domainExpiryWarnDays}d threshold)`,
    });
  }

  let status = 'healthy';
  if (!dnsResult.ok || !httpResult.ok) {
    status = 'down';
  } else if (anomalies.length > 0) {
    status = 'degraded';
  }

  return {
    domain,
    name: property.name ?? domain,
    status,
    checkedAt: nowIso,
    dns: dnsResult,
    http: httpResult,
    tls: tlsResult,
    rdap: rdapResult,
    anomalies,
  };
}

/**
 * Execute the full autonomous infrastructure watchdog across all configured properties,
 * persist the run to Supabase (with local JSON fallback), and push any anomalies
 * into the orchestrator alert feed.
 */
export async function runInfrastructureWatchdog(options = {}) {
  const config = getWatchdogConfig(options);
  const checkedAt = options.nowIso ?? new Date().toISOString();
  const runId = options.runId ?? `wd-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  const results = await Promise.all(
    config.properties.map((prop) =>
      checkProperty(prop, {
        ...options,
        thresholds: config.thresholds,
        nowIso: checkedAt,
      })
    )
  );

  const healthyCount = results.filter((r) => r.status === 'healthy').length;
  const degradedCount = results.filter((r) => r.status === 'degraded').length;
  const downCount = results.filter((r) => r.status === 'down').length;

  const anomalies = results.flatMap((r) =>
    r.anomalies.map((a, idx) => ({
      id: `${runId}-${r.domain}-${a.kind}-${idx}`,
      source: 'watchdog',
      domain: r.domain,
      kind: a.kind,
      severity: a.severity,
      message: a.message,
      details: {
        httpStatus: r.http.status,
        httpLatencyMs: r.http.latencyMs,
        tlsDaysRemaining: r.tls.daysRemaining,
        domainDaysRemaining: r.rdap.daysRemaining,
      },
      createdAt: checkedAt,
    }))
  );

  const report = {
    id: runId,
    checkedAt,
    thresholds: config.thresholds,
    totalProperties: results.length,
    healthyCount,
    degradedCount,
    downCount,
    anomaliesCount: anomalies.length,
    results,
    anomalies,
  };

  if (options.persist !== false) {
    await saveWatchdogRun(report);
    if (anomalies.length > 0) {
      await pushOrchestratorAlerts(anomalies);
    }
    if (typeof options.onAlerts === 'function' && anomalies.length > 0) {
      await options.onAlerts(anomalies);
    }
  }

  return report;
}
