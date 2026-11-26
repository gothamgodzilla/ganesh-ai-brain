# Ganesh AI Brain (`ganesh-ai-brain`)

Central telemetry, multi-agent role-stack orchestrator, continuous verification gate, and autonomous infrastructure watchdog for **GaneshAI / ganesh.guru**.

## Architecture

- **Host target**: Vercel Serverless Function (`api/index.mjs` wrapping Express 5 `brain-server/index.mjs`) & standalone Node ESM runtime.
- **Persistence**: Supabase Postgres primary (`brain-server/store.mjs`) with automatic local JSON fallback under `data/brain/`.
- **Orchestrator & Role Stack**:
  - XState v5 state machine (`src/ganesh.machine.ts`, `src/ganeshOrchestrator.ts`) paired with the 3-role pipeline (`lib/role-pipeline/`):
    1. **Architect** (`prompts/roles/architect.v1.md`) — theoretical rigor, clean boundaries, RLS-enabled schemas, zero over-engineering.
    2. **Operator** (`prompts/roles/operator.v1.md`) — practical simplicity, high-performance Node/TS/SQL/Swift implementations.
    3. **Contrarian/Verifier** (`prompts/roles/contrarian-verifier.v1.md`) — multi-pass adversarial gate for null states, network timeouts, security boundaries, and logic bugs (`PASS` / `REVISE` / `BLOCK` with structured findings).
  - **Decision Review Mode** (`prompts/roles/decision-review.v1.md`) — scores project decisions (`1–10`) on `theoreticalValidity`, `deploymentSimplicity`, and `executionSpeed` (`APPROVE` / `ITERATE` / `REJECT`).
- **Continuous Three-Pass Verification Loop**:
  - Standard procedure: `Pass 1 (Draft) -> Pass 2 (Edge-case analysis) -> Pass 3 (Optimized rewrite)`, gated by the Contrarian/Verifier.
  - Enforced locally and in CI via `scripts/verify-generation.mjs` (`npm run verify`) and the `.githooks/pre-commit` hook.
- **Autonomous Infrastructure Watchdog**:
  - Daily Vercel Cron worker (`GET /api/cron/watchdog` scheduled in `vercel.json`) and on-demand trigger (`POST /api/watchdog/run` or `npm run watchdog:run`).
  - Checks HTTP status & latency, TLS certificate expiry days, DNS resolution (`A`/`AAAA`), and RDAP domain registration expiry across the configured property fleet (`mangasm.app`, `ganesh.guru`, `coexist.llc`, `coexist.click`, `nostalgia.sh`, `lynxlogix.ai`, `lynxlogix.net`, `lynxlogix.org`, `helping.llc`, `slay.llc`).
  - Pushes anomalies (`down`, `slow`, TLS cert `< 21` days, domain `< 30` days) into the orchestrator alert feed (`brain_alerts`) and surfaces them in `/brain`.
- **Frontend Console**: React 19 + Vite + Tailwind console (`brain-server/ui/`) built to `brain-server/console-dist`.

---

## Required & Optional Environment Variables (Names Only)

| Variable Name | Description | Required / Optional |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | Required for serverless persistence (local file fallback used when unset) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key for backend read/write (bypasses RLS) | Required for serverless persistence |
| `DASHBOARD_VIEW_TOKEN` | Operator token for unlocking `/brain`, `/api/dashboard`, `/api/orchestrator/*`, and `/api/watchdog/status` (alias: `BRAIN_DASHBOARD_TOKEN`) | Highly recommended |
| `BRAIN_SYNC_SECRET` | Shared secret for `POST /api/sync/pipeline` and internal orchestrator/watchdog triggers | Recommended |
| `CRON_SECRET` | Vercel Cron bearer secret (`Authorization: Bearer <CRON_SECRET>`) used to authenticate `GET /api/cron/watchdog` | Recommended for Vercel Cron |
| `GANESH_LLM_MODE` | Set to `http` to call a live OpenAI-compatible JSON completion endpoint, or `heuristic` (default) for deterministic local synthesis | Optional |
| `GANESH_LLM_API_KEY` | LLM provider API key (falls back to `OPENAI_API_KEY`) when `GANESH_LLM_MODE=http` | Optional |
| `GANESH_LLM_ENDPOINT` | LLM chat completions endpoint URL | Optional |
| `GANESH_LLM_MODEL` | Default model slug for role pipeline calls | Optional |
| `GANESH_ARCHITECT_MODEL` | Per-role model override for the Architect role | Optional |
| `GANESH_OPERATOR_MODEL` | Per-role model override for the Operator role | Optional |
| `GANESH_CONTRARIAN_MODEL` | Per-role model override for the Contrarian/Verifier role | Optional |
| `WATCHDOG_DOMAINS` | Comma-separated list of domains to override the default 10 watchdog properties | Optional |
| `WATCHDOG_PROPERTIES_JSON` | JSON array override for watchdog properties with custom `endpoints` | Optional |
| `WATCHDOG_SLOW_MS` | HTTP latency warning threshold in milliseconds (default: `2500`) | Optional |
| `WATCHDOG_CERT_WARN_DAYS` | TLS certificate expiry warning threshold in days (default: `21`) | Optional |
| `WATCHDOG_DOMAIN_WARN_DAYS` | RDAP domain registration expiry warning threshold in days (default: `30`) | Optional |
| `STRIPE_SECRET_KEY` | Stripe secret API key | Optional |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | Optional |
| `STRIPE_LIVE_LINK` | Default Stripe Payment Link URL | Optional |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret for Resend email webhooks | Optional |
| `API_INTERNAL_KEY` | Internal conversion ingest bearer token | Optional |
| `GANESH_AI_BRAIN_URL` | Public base URL of the Brain hub | Optional |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed HTTPS CORS origins | Optional |
| `TRUST_PROXY` | Reverse-proxy hop count (`1`, `true`, or integer) | Optional |
| `BRAIN_PORT` / `PORT` | Listening port for standalone Node server (default: `5055`) | Optional |

---

## Setup, Verification & Pre-Commit Hook

```bash
# 1. Install dependencies (also installs .githooks/pre-commit via the prepare script)
npm install

# 2. Build the React/Vite console into brain-server/console-dist
npm run build

# 3. Run unit & integration tests (geo-pipeline, brain-server, role stack, watchdog)
npm test

# 4. Run the XState + TypeScript orchestrator suite
npm run test:orchestrator

# 5. Run the post-generation 3-pass verification gate (CI & local)
npm run verify
```

### Pre-Commit Hook & Emergency Bypass

`npm install` configures Git to use `.githooks/pre-commit` (`node scripts/install-hooks.mjs`). On every commit, it runs `node scripts/verify-generation.mjs --fast`, which executes:
1. Syntax validation (`node --check`) on all `.mjs` and `.cjs` files and frontmatter validation on `prompts/roles/*.v1.md`.
2. Secret & edge-case smell scanning (hardcoded keys, missing Supabase `ENABLE ROW LEVEL SECURITY` on `CREATE TABLE`, unguarded `eval`, empty `catch {}` blocks, and untimed non-loopback `fetch` calls).
3. Self-verification of the 3-pass `Draft -> Edge-case analysis -> Optimized rewrite` loop and the full unit test suite.

**Emergency bypass (incident hotfixes only):**
```bash
git commit --no-verify -m "hotfix: ..."
# or
GANESH_SKIP_PRECOMMIT=1 git commit -m "hotfix: ..."
```

---

## Enabling the Autonomous Infrastructure Watchdog Cron

### Why Vercel Cron (`vercel.json`)?
`ganesh-ai-brain` already runs as a Vercel Serverless Function (`api/index.mjs` -> `brain-server/index.mjs`) with `@supabase/supabase-js` and `brain-server/store.mjs` handling Supabase + local JSON fallback. Running the watchdog via Vercel Cron (`GET /api/cron/watchdog`) gives direct access to Node's native `node:tls` (for peer certificate `valid_to` inspection), `node:dns/promises`, and `fetch` (for HTTP latency and RDAP domain expiration) while writing directly to the same `store.mjs` and orchestrator alert feed without maintaining a separate runtime.

### How to Enable in Vercel
1. `vercel.json` includes the daily cron definition:
   ```json
   "crons": [
     {
       "path": "/api/cron/watchdog",
       "schedule": "0 7 * * *"
     }
   ]
   ```
2. In the Vercel project settings (**Settings -> Environment Variables**), add `CRON_SECRET` (Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when invoking cron routes).
3. You can also trigger a run on demand via API or CLI:
   ```bash
   # CLI
   npm run watchdog:run

   # HTTP (using BRAIN_SYNC_SECRET, CRON_SECRET, or DASHBOARD_VIEW_TOKEN)
   curl -X POST https://ganesh.guru/api/watchdog/run \
     -H "Authorization: Bearer $BRAIN_SYNC_SECRET"
   ```

---

## Database Migrations

Two idempotent SQL migrations live under `supabase/migrations/` (both enable Row Level Security on every table):
1. `supabase/migrations/20261003000000_brain_storage.sql` — `brain_conversions`, `brain_system_snapshot`, `brain_engagement`, `brain_engagement_events`, `brain_contacted`.
2. `supabase/migrations/20261126000000_watchdog_and_role_telemetry.sql` — `brain_role_telemetry`, `brain_watchdog_runs`, `brain_alerts`.

See `docs/SUPABASE-AND-ENDPOINT-AUDIT.md` for the full schema, endpoint, middleware, and dependency audit report.
