-- Ganesh AI Brain: Role Stack Telemetry, Autonomous Watchdog & Orchestrator Alert Feed
-- Migration file only (do not auto-apply to live Supabase instances without operator review).

-- 1. Role Stack & Verification Loop Telemetry
CREATE TABLE IF NOT EXISTS brain_role_telemetry (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  role TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT '1.0.0',
  pass INTEGER NOT NULL DEFAULT 1,
  pass_stage TEXT NOT NULL DEFAULT 'draft',
  verdict TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  findings_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_event JSONB
);

CREATE INDEX IF NOT EXISTS idx_brain_role_telemetry_created_at
  ON brain_role_telemetry (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_role_telemetry_run_id
  ON brain_role_telemetry (run_id);

-- 2. Autonomous Infrastructure Watchdog Runs
CREATE TABLE IF NOT EXISTS brain_watchdog_runs (
  id TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_properties INTEGER NOT NULL DEFAULT 0,
  healthy_count INTEGER NOT NULL DEFAULT 0,
  degraded_count INTEGER NOT NULL DEFAULT 0,
  down_count INTEGER NOT NULL DEFAULT 0,
  anomalies_count INTEGER NOT NULL DEFAULT 0,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  anomalies JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_watchdog_runs_checked_at
  ON brain_watchdog_runs (checked_at DESC);

-- 3. Orchestrator Feed Alerts (Watchdog anomalies & Contrarian gate blocks)
CREATE TABLE IF NOT EXISTS brain_alerts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'watchdog',
  domain TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_alerts_created_at
  ON brain_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_alerts_domain
  ON brain_alerts (domain);

-- Enable Row Level Security (RLS) on all telemetry & watchdog tables.
-- Service-role key bypasses RLS; anon/public keys are denied by default.
ALTER TABLE brain_role_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_watchdog_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_alerts ENABLE ROW LEVEL SECURITY;
