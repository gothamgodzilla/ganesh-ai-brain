-- Migration: Ganesh AI Brain Postgres Schema for Supabase
-- Tables for state persistence on serverless / cloud hosts

CREATE TABLE IF NOT EXISTS brain_conversions (
  id TEXT PRIMARY KEY,
  amount BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'complete',
  customer_email TEXT,
  business_id TEXT,
  tier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  source TEXT NOT NULL DEFAULT 'webhook',
  raw_payload JSONB
);

CREATE INDEX IF NOT EXISTS idx_brain_conversions_created_at ON brain_conversions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_conversions_status ON brain_conversions (status);

CREATE TABLE IF NOT EXISTS brain_system_snapshot (
  id TEXT PRIMARY KEY DEFAULT 'current',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS brain_engagement (
  id TEXT PRIMARY KEY DEFAULT 'current',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS brain_engagement_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  slug TEXT,
  resend_id TEXT,
  recipient TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  raw_event JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_engagement_events_slug ON brain_engagement_events (slug);
CREATE INDEX IF NOT EXISTS idx_brain_engagement_events_resend_id ON brain_engagement_events (resend_id);
CREATE INDEX IF NOT EXISTS idx_brain_engagement_events_timestamp ON brain_engagement_events (timestamp DESC);

CREATE TABLE IF NOT EXISTS brain_contacted (
  id TEXT PRIMARY KEY DEFAULT 'current',
  data JSONB NOT NULL DEFAULT '{"contacted":[]}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS) on all tables to prevent unauthorized access via Supabase public/anon API.
-- No public policies are defined: backend access uses the Supabase service role key, which bypasses RLS.
ALTER TABLE brain_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_system_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_engagement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_contacted ENABLE ROW LEVEL SECURITY;
