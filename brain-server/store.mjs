import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data', 'brain');
const CONVERSIONS_FILE = join(DATA_DIR, 'conversions.json');
const SYSTEM_FILE = join(DATA_DIR, 'system-snapshot.json');
const ROLE_TELEMETRY_FILE = join(DATA_DIR, 'role-telemetry.json');
const WATCHDOG_RUNS_FILE = join(DATA_DIR, 'watchdog-runs.json');
const ALERTS_FILE = join(DATA_DIR, 'alerts.json');

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY)?.trim();

let supabaseInstance = null;

export function isSupabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_KEY &&
    !SUPABASE_URL.includes('REPLACE') &&
    !SUPABASE_KEY.includes('REPLACE')
  );
}

function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseInstance;
}

function ensureDir() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // Ignore on read-only serverless filesystems when using Supabase
  }
}

function readJsonArray(filePath) {
  ensureDir();
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(raw.items) ? raw.items : Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeJsonArray(filePath, items, maxItems = 500) {
  try {
    ensureDir();
    writeFileSync(
      filePath,
      JSON.stringify({ items: items.slice(0, maxItems), updatedAt: new Date().toISOString() }, null, 2)
    );
  } catch (err) {
    console.warn(`Local file write failed (${filePath}):`, err.message);
  }
}

/**
 * Conversions Store (Supabase primary, local file fallback)
 */
export async function listConversions() {
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('brain_conversions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (!error && Array.isArray(data)) {
        return data.map((row) => ({
          id: row.id,
          amount: row.amount,
          currency: row.currency,
          status: row.status,
          customerEmail: row.customer_email ?? undefined,
          businessId: row.business_id ?? undefined,
          tier: row.tier ?? undefined,
          createdAt: row.created_at,
          source: row.source,
        }));
      }
      if (error) {
        console.warn('Supabase listConversions error, falling back to local file:', error.message);
      }
    } catch (err) {
      console.warn('Supabase listConversions exception, falling back to local file:', err.message);
    }
  }

  ensureDir();
  if (!existsSync(CONVERSIONS_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(CONVERSIONS_FILE, 'utf8'));
    return Array.isArray(raw.events) ? raw.events : [];
  } catch {
    return [];
  }
}

export async function addConversion(entry) {
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const row = {
        id: entry.id,
        amount: entry.amount ?? 0,
        currency: entry.currency ?? 'usd',
        status: entry.status ?? 'complete',
        customer_email: entry.customerEmail ?? null,
        business_id: entry.businessId ?? null,
        tier: entry.tier ?? null,
        created_at: entry.createdAt ?? new Date().toISOString(),
        source: entry.source ?? 'webhook',
        raw_payload: entry,
      };

      const { error } = await supabase
        .from('brain_conversions')
        .upsert(row, { onConflict: 'id', ignoreDuplicates: true });

      if (!error) {
        return await listConversions();
      }
      console.warn('Supabase addConversion error, falling back to local file:', error.message);
    } catch (err) {
      console.warn('Supabase addConversion exception, falling back to local file:', err.message);
    }
  }

  const events = await listConversions();
  if (entry.id && events.some((e) => e.id === entry.id)) {
    return events;
  }
  events.unshift(entry);
  const trimmed = events.slice(0, 500);
  try {
    ensureDir();
    writeFileSync(CONVERSIONS_FILE, JSON.stringify({ events: trimmed }, null, 2));
  } catch (err) {
    console.warn('Local file write failed (expected on read-only serverless FS):', err.message);
  }
  return trimmed;
}

/**
 * System Snapshot Store (Supabase primary, local file fallback)
 */
export async function getSystemSnapshot() {
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('brain_system_snapshot')
        .select('payload')
        .eq('id', 'latest')
        .maybeSingle();

      if (!error && data && data.payload) {
        return data.payload;
      }
      if (error) {
        console.warn('Supabase getSystemSnapshot error, falling back to local file:', error.message);
      }
    } catch (err) {
      console.warn('Supabase getSystemSnapshot exception, falling back to local file:', err.message);
    }
  }

  ensureDir();
  if (!existsSync(SYSTEM_FILE)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(SYSTEM_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export async function saveSystemSnapshot(payload) {
  const next = {
    ...payload,
    syncedAt: new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('brain_system_snapshot')
        .upsert(
          {
            id: 'latest',
            payload: next,
            synced_at: next.syncedAt,
          },
          { onConflict: 'id' }
        );

      if (!error) {
        return next;
      }
      console.warn('Supabase saveSystemSnapshot error, falling back to local file:', error.message);
    } catch (err) {
      console.warn('Supabase saveSystemSnapshot exception, falling back to local file:', err.message);
    }
  }

  try {
    ensureDir();
    writeFileSync(SYSTEM_FILE, JSON.stringify(next, null, 2));
  } catch (err) {
    console.warn('Local file write failed (expected on read-only serverless FS):', err.message);
  }
  return next;
}

/**
 * Role Stack & Verification Loop Telemetry Store (Supabase primary, local file fallback)
 */
export async function addRoleTelemetry(entries) {
  const list = Array.isArray(entries) ? entries : [entries];
  const valid = list.filter((e) => e && typeof e === 'object' && e.role);
  if (valid.length === 0) return listRoleTelemetry();

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const rows = valid.map((item) => ({
        id: item.id ?? `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        run_id: item.runId ?? 'manual',
        role: item.role,
        prompt_version: item.promptVersion ?? '1.0.0',
        pass: item.pass ?? 1,
        pass_stage: item.passStage ?? 'draft',
        verdict: item.verdict ?? 'PASS',
        latency_ms: Number.isFinite(item.latencyMs) ? Math.round(item.latencyMs) : 0,
        findings_count: Number.isFinite(item.findingsCount) ? item.findingsCount : 0,
        summary: item.summary ?? null,
        created_at: item.timestamp ?? new Date().toISOString(),
        raw_event: item,
      }));

      const { error } = await supabase
        .from('brain_role_telemetry')
        .upsert(rows, { onConflict: 'id' });

      if (error) {
        console.warn('Supabase addRoleTelemetry error, falling back to local file:', error.message);
      }
    } catch (err) {
      console.warn('Supabase addRoleTelemetry exception, falling back to local file:', err.message);
    }
  }

  const existing = readJsonArray(ROLE_TELEMETRY_FILE);
  const existingIds = new Set(existing.map((e) => e.id));
  const merged = [...valid.filter((v) => !v.id || !existingIds.has(v.id)), ...existing].slice(0, 200);
  writeJsonArray(ROLE_TELEMETRY_FILE, merged, 200);
  return merged;
}

export async function listRoleTelemetry(limit = 50) {
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('brain_role_telemetry')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(cap);

      if (!error && Array.isArray(data)) {
        return data.map((row) => ({
          id: row.id,
          runId: row.run_id,
          role: row.role,
          promptVersion: row.prompt_version,
          pass: row.pass,
          passStage: row.pass_stage,
          verdict: row.verdict,
          latencyMs: row.latency_ms,
          findingsCount: row.findings_count,
          summary: row.summary,
          timestamp: row.created_at,
        }));
      }
      if (error) {
        console.warn('Supabase listRoleTelemetry error, falling back to local file:', error.message);
      }
    } catch (err) {
      console.warn('Supabase listRoleTelemetry exception, falling back to local file:', err.message);
    }
  }

  return readJsonArray(ROLE_TELEMETRY_FILE).slice(0, cap);
}

/**
 * Autonomous Infrastructure Watchdog Store (Supabase primary, local file fallback)
 */
export async function saveWatchdogRun(runReport) {
  if (!runReport || typeof runReport !== 'object') {
    throw new Error('saveWatchdogRun requires a runReport object');
  }

  const normalized = {
    id: runReport.id ?? `wd-${Date.now()}`,
    checkedAt: runReport.checkedAt ?? new Date().toISOString(),
    totalProperties: runReport.totalProperties ?? (runReport.results?.length || 0),
    healthyCount: runReport.healthyCount ?? 0,
    degradedCount: runReport.degradedCount ?? 0,
    downCount: runReport.downCount ?? 0,
    anomaliesCount: runReport.anomaliesCount ?? (runReport.anomalies?.length || 0),
    results: Array.isArray(runReport.results) ? runReport.results : [],
    anomalies: Array.isArray(runReport.anomalies) ? runReport.anomalies : [],
  };

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('brain_watchdog_runs').upsert(
        {
          id: normalized.id,
          checked_at: normalized.checkedAt,
          total_properties: normalized.totalProperties,
          healthy_count: normalized.healthyCount,
          degraded_count: normalized.degradedCount,
          down_count: normalized.downCount,
          anomalies_count: normalized.anomaliesCount,
          results: normalized.results,
          anomalies: normalized.anomalies,
        },
        { onConflict: 'id' }
      );
      if (error) {
        console.warn('Supabase saveWatchdogRun error, falling back to local file:', error.message);
      }
    } catch (err) {
      console.warn('Supabase saveWatchdogRun exception, falling back to local file:', err.message);
    }
  }

  const existing = readJsonArray(WATCHDOG_RUNS_FILE).filter((r) => r.id !== normalized.id);
  const merged = [normalized, ...existing].slice(0, 100);
  writeJsonArray(WATCHDOG_RUNS_FILE, merged, 100);
  return normalized;
}

export async function listWatchdogRuns(limit = 20) {
  const cap = Math.max(1, Math.min(100, Number(limit) || 20));

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('brain_watchdog_runs')
        .select('*')
        .order('checked_at', { ascending: false })
        .limit(cap);

      if (!error && Array.isArray(data)) {
        return data.map((row) => ({
          id: row.id,
          checkedAt: row.checked_at,
          totalProperties: row.total_properties,
          healthyCount: row.healthy_count,
          degradedCount: row.degraded_count,
          downCount: row.down_count,
          anomaliesCount: row.anomalies_count,
          results: row.results ?? [],
          anomalies: row.anomalies ?? [],
        }));
      }
      if (error) {
        console.warn('Supabase listWatchdogRuns error, falling back to local file:', error.message);
      }
    } catch (err) {
      console.warn('Supabase listWatchdogRuns exception, falling back to local file:', err.message);
    }
  }

  return readJsonArray(WATCHDOG_RUNS_FILE).slice(0, cap);
}

export async function getLatestWatchdogRun() {
  const runs = await listWatchdogRuns(1);
  return runs[0] ?? null;
}

/**
 * Orchestrator Feed Alerts Store (Supabase primary, local file fallback)
 */
export async function pushOrchestratorAlerts(alerts) {
  const list = Array.isArray(alerts) ? alerts : [alerts];
  const valid = list.filter((a) => a && typeof a === 'object' && a.message);
  if (valid.length === 0) return listOrchestratorAlerts();

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const rows = valid.map((a) => ({
        id: a.id ?? `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source: a.source ?? 'watchdog',
        domain: a.domain ?? 'system',
        kind: a.kind ?? 'anomaly',
        severity: a.severity ?? 'warning',
        message: a.message,
        details: a.details ?? null,
        created_at: a.createdAt ?? new Date().toISOString(),
      }));

      const { error } = await supabase.from('brain_alerts').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.warn('Supabase pushOrchestratorAlerts error, falling back to local file:', error.message);
      }
    } catch (err) {
      console.warn('Supabase pushOrchestratorAlerts exception, falling back to local file:', err.message);
    }
  }

  const existing = readJsonArray(ALERTS_FILE);
  const existingIds = new Set(existing.map((a) => a.id));
  const merged = [...valid.filter((a) => !a.id || !existingIds.has(a.id)), ...existing].slice(0, 200);
  writeJsonArray(ALERTS_FILE, merged, 200);
  return merged;
}

export async function listOrchestratorAlerts(limit = 50) {
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('brain_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(cap);

      if (!error && Array.isArray(data)) {
        return data.map((row) => ({
          id: row.id,
          source: row.source,
          domain: row.domain,
          kind: row.kind,
          severity: row.severity,
          message: row.message,
          details: row.details,
          createdAt: row.created_at,
        }));
      }
      if (error) {
        console.warn('Supabase listOrchestratorAlerts error, falling back to local file:', error.message);
      }
    } catch (err) {
      console.warn('Supabase listOrchestratorAlerts exception, falling back to local file:', err.message);
    }
  }

  return readJsonArray(ALERTS_FILE).slice(0, cap);
}
