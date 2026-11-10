# Ganesh AI Brain (`ganesh-ai-brain`)

Central telemetry and multi-agent backend engine for GaneshAI.

## Architecture

- **Host target**: Vercel Serverless Function (`api/index.mjs` wrapping Express `brain-server/index.mjs`) & local runtime.
- **Persistence**: Supabase Postgres with local file fallback.
- **Frontend Console**: React Vite console built to `brain-server/console-dist`.

## Environment Variables

| Variable Name | Description | Required / Optional |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL (e.g., `https://xyz.supabase.co`) | Required for serverless persistence |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key for backend read/write | Required for serverless persistence |
| `STRIPE_SECRET_KEY` | Stripe secret API key (`sk_live_...` or `sk_test_...`) | Optional (enables Stripe features) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint secret (`whsec_...`) | Optional (enables Stripe webhook parsing) |
| `STRIPE_LIVE_LINK` | URL to default Stripe Payment Link | Optional |
| `DASHBOARD_VIEW_TOKEN` | Token for authenticating to the `/brain` console and `/api/dashboard` | Highly recommended |
| `BRAIN_SYNC_SECRET` | Secret for syncing pipeline snapshots at `POST /api/sync/pipeline` | Optional |
| `RESEND_WEBHOOK_SECRET` | Secret for verifying Resend webhook payloads | Optional |
| `API_INTERNAL_KEY` | Key for internal conversion ingest (`POST /api/stripe/webhook` raw JSON) | Optional |
| `GANESH_AI_BRAIN_URL` | Base URL of the Brain server (e.g., `https://brain.ganesh.guru`) | Optional |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | Optional |
| `TRUST_PROXY` | Proxy trust setting (`1`, `true`, or number of hops) | Optional |
| `BRAIN_PORT` / `PORT` | Listening port for standalone Node process (default: `5055`) | Optional |

## Development & Testing

```bash
# Install dependencies
npm install

# Build UI console
npm run build

# Run local dev server
npm run dev

# Run test suite
npm test
```

## Database Migrations

Apply the idempotent migration in `supabase/migrations/20261003000000_brain_storage.sql` to your Supabase Postgres database before cutover to initialize:
- `brain_conversions`
- `brain_system_snapshot`
- `brain_engagement`
- `brain_engagement_events`
- `brain_contacted`

All five tables enable Row Level Security with no public policies. The Node server uses `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never shipped to the console bundle), which bypasses RLS.
