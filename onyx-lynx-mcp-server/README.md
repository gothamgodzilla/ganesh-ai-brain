# onyx-lynx-mcp-server

Discovery + outreach MCP server for the GANESH-Ai-BRAIN local-business engine ("Sleepy Hollow").

- **Onyx** — resolves a U.S. zip code or Google Plus Code ("global code") to a center point,
  then sweeps Google Places, Apple Maps, and Yelp for businesses in a category within a radius,
  cross-source dedupes them, and points you at the right state Secretary-of-State registry to
  confirm legal status.
- **Lynx** — sends the cold-outreach pitch email via Resend with CAN-SPAM guardrails
  (allowlisted senders, required physical address + opt-out link) and a suppression/CRM list so a
  business is never double-emailed or emailed after opting out.

Built with the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk),
Zod-validated inputs, and `structuredContent` on every tool response.

## Status

This is a **scaffold** built against your MASTER-GOALS.md / MASTERLIST.md doctrine — every tool
that talks to a real API is wired up and compiles, but only three sources have live credentials
in your masterlist today. It has not been run against real traffic yet.

| Tool | Backing service | Status |
|---|---|---|
| `onyx_resolve_location` (zip) | Google Geocoding | Real — needs `GOOGLE_MAPS_API_KEY` |
| `onyx_resolve_location` (global_code) | Local decode (no API) | **Real, works offline** |
| `onyx_search_google_places` | Google Places | Real — needs `GOOGLE_MAPS_API_KEY` |
| `onyx_search_apple_maps` | Apple Maps Server API | Real — needs `APPLE_TEAM_ID` + a **MapKit/Server-API-enabled** key |
| `onyx_search_yelp` | Yelp Fusion | Real — needs `YELP_API_KEY` (already in your masterlist) |
| `onyx_verify_whitepages_business` | — | **Stub** — see "Why WhitePages is stubbed" below |
| `onyx_get_state_registry_link` | Static lookup table | **Real, works offline** — no unified 50-state API exists |
| `onyx_merge_business_records` | Local fuzzy match (no API) | **Real, works offline** |
| `lynx_send_outreach_email` | Resend | Real — needs `RESEND_API_KEY` (already in your masterlist) |
| `lynx_track_and_check_lead` | Local JSON file (`data/leads.json`) | **Real** — swap for a real DB before scaling past a handful of leads |

Plus a companion web service (`src/unsubscribe-server.ts`, run separately) that serves the
opt-out flow and the expiring mockup preview — see "Opt-out service" below.

## Setup

```bash
npm install
cp .env.example .env   # fill in the keys below
npm run build
npm start               # stdio transport, for local MCP clients (Claude Desktop, etc.)
# or: TRANSPORT=http npm start   # streamable HTTP on :3000/mcp
```

### Environment variables

See `.env.example`. Per your `MASTERLIST.md`:

- `GOOGLE_MAPS_API_KEY` — **not yet in your masterlist.** Create one at
  console.cloud.google.com with "Places API" + "Geocoding API" enabled, then add a
  `GOOGLE_MAPS_API_KEY` row to `MASTERLIST.md` alongside the others.
- `APPLE_TEAM_ID` — you have this (`854XZ2543V`).
- `APPLE_MAPKIT_KEY_ID` / `APPLE_MAPKIT_P8_PATH` — your masterlist lists **two different** Apple
  API keys (`3MPBZVJFKG` for APNs/"AI Build", `982Y229Z6V` for App Store Connect JWT). **Neither
  is confirmed to have the MapKit/Maps Server API service enabled.** Check developer.apple.com →
  Certificates, Identifiers & Profiles → Keys, and either enable that service on one of them or
  create a new key specifically for Maps Server API, then point `APPLE_MAPKIT_P8_PATH` at its
  `.p8` file.
- `YELP_API_KEY` — you have this.
- `RESEND_API_KEY` — you have this (bae@slay.llc account). The four `From` addresses in
  `src/constants.ts` (`ALLOWED_FROM_ADDRESSES`) must each be verified senders on **that** Resend
  account/domain before `lynx_send_outreach_email` will actually deliver — check
  resend.com/domains.

### Verify without any keys

```bash
node scripts/smoke-test.mjs
```

Exercises the parts that don't need network access: Plus Code decoding, cross-source dedupe,
CAN-SPAM sender/footer checks, lead-store/suppression logic, and opt-out token signing
(including forgery and wrong-secret rejection). 13 checks.

## Why WhitePages is stubbed

WhitePages' public product line (Identity Check / Pro) is built around verifying an **individual
person** or a specific phone number — there is no documented "search businesses by category and
zip" endpoint. Wiring in a real people-search API here would cut against the "public business
data only, no private-data harvest" rule already written into your own `MASTER-GOALS.md`. The
stub tool explains this and points you at the phone/address you already got from Places/Yelp
instead. If you specifically want phone validity/carrier checks before emailing, a phone-lookup
API (e.g. Twilio Lookup) is the better fit than WhitePages — that'd be a new `onyx_verify_phone`
tool, not a retrofit of this one.

## "Confirmed with the state" — why it's a link, not an API call

All 50 states (+ DC) run their own Secretary of State business-entity search, and none expose a
public API for it — you either scrape their (frequently CAPTCHA'd, ToS-restricted) search UI or
click through manually. `onyx_get_state_registry_link` gives you the right URL per state so this
can be a manual click-through step now, and a Claude-in-Chrome-automated step later if you decide
that's worth building — that's a separate, larger piece of work (per-state HTML scraping) that
this scaffold intentionally does not attempt yet.

## Compliance — read before sending real email

`lynx_send_outreach_email` enforces the mechanical parts of CAN-SPAM (15 U.S.C. § 7704), but
**this is not legal advice** and a human should review the actual template and any state-level
addenda (California, for one, has its own commercial-email rules) before a real campaign:

- **From address allowlist** — only `src/constants.ts:ALLOWED_FROM_ADDRESSES` can send. Add a
  sender there only after verifying its domain in Resend.
- **Physical address required** — every send needs a real mailing address in the footer.
- **Working opt-out required, honored within 10 business days** — handled end to end by the
  opt-out service below. Omit `unsubscribe_url` and Lynx mints a signed link automatically;
  clicking it flips the lead to `opted_out` immediately, and `lynx_send_outreach_email` then
  refuses that business permanently.
- **Non-deceptive subject lines** — not mechanically enforced (there's no reliable heuristic);
  a human should eyeball subject lines before a batch send.
- **30-day cooldown per business by default** (`cooldown_days`) — prevents accidental re-sends
  from tanking your sending domain's reputation.

### Self-destruct limitation (read this)

The project brief asks for the mockup preview to "self-destruct after 14 days" so an owner can't
reuse it months later. **Email itself has no remote-delete mechanism** — once a message is
delivered, there is no API (Resend or otherwise) that reaches into someone's inbox and removes
it. What `preview_expiry_days` actually gives you:

1. A `preview_expires_at` timestamp stamped on the lead record.
2. `GET /preview/:businessId` on the opt-out service returns `410 Gone` past that timestamp, so
   the hosted mockup stops resolving on schedule. The pitch email must therefore **link** to
   that URL rather than embedding the mockup inline — an inlined image lives in the inbox
   forever and no expiry can touch it.

Anything advertised to the business owner as "this offer expires in 14 days" should be phrased
around the **link/offer expiring**, not the email disappearing — the latter isn't something any
email system can promise.

## Opt-out service

`src/unsubscribe-server.ts` is a small Express app that runs as its **own process**, separate
from the MCP server, and must be deployed somewhere publicly reachable (Vercel/Fly/Render).
Both processes read and write the same lead store.

```bash
npm run build
UNSUBSCRIBE_TOKEN_SECRET=$(openssl rand -hex 32) npm run start:unsubscribe
```

| Route | Purpose |
|---|---|
| `GET /unsubscribe?t=…` | Renders a confirmation page. **Does not opt out.** |
| `POST /unsubscribe` | Performs the opt-out. Idempotent. |
| `POST /unsubscribe/one-click?t=…` | RFC 8058 endpoint for Gmail/Yahoo. |
| `GET /preview/:businessId` | Serves the mockup; `410 Gone` once expired. |
| `GET /healthz` | Liveness check. |

Three design decisions worth knowing, because getting any of them wrong causes real damage:

**GET shows a form instead of unsubscribing.** Corporate mail scanners and link-preview bots
issue a GET against every URL in an inbound email. A GET that opted out on sight would silently
remove people who never clicked, and would burn the link before the human ever saw it. Only the
POST commits.

**Tokens are HMAC-signed, not raw ids.** An unsigned `?id=business-123` link is both forgeable
(anyone can opt out any business) and enumerable (walk the ids to dump your lead list). Set
`UNSUBSCRIBE_TOKEN_SECRET` to a 32+ char random string; without it every link is rejected rather
than silently trusted.

**`List-Unsubscribe` headers ship on every send.** Gmail and Yahoo require one-click unsubscribe
from bulk senders. Missing these headers is one of the most common reasons legitimate outreach
gets spam-foldered regardless of how good the content is — directly relevant to keeping the
Resend account in good standing.

## Architecture

```
src/
  constants.ts        API URLs, sender allowlist, state registry links
  types.ts             BusinessRecord / MergedBusinessRecord / LeadRecord
  unsubscribe-server.ts  public opt-out + preview-expiry service (separate process)
  services/
    http.ts             shared GET/POST + error formatting + structuredContent cast
    tokens.ts            HMAC-signed, non-enumerable opt-out tokens
    geocode.ts          zip -> lat/lng (Google) and Plus Code -> lat/lng (offline)
    apple-maps.ts        Apple Maps Server API JWT auth + search
    matching.ts           cross-source fuzzy dedupe
    lead-store.ts          JSON-file suppression/CRM store
    compliance.ts          CAN-SPAM sender/footer enforcement
  schemas/            Zod input schemas (one file per agent: onyx.ts, lynx.ts)
  tools/              registerTool() calls (one file per agent)
  index.ts            McpServer wiring + stdio/HTTP transport
scripts/
  smoke-test.mjs       offline logic tests (no API keys required)
```

## Next steps

1. Get `GOOGLE_MAPS_API_KEY` and confirm which Apple key has MapKit/Server API enabled.
2. Verify the four `ALLOWED_FROM_ADDRESSES` domains in Resend.
3. Build the actual mockup-generation pipeline (Grok Imagine UI, carousel, reviews pull) that
   feeds `preview_html_body` into `lynx_send_outreach_email` — that's a separate piece of work
   from this MCP server, which only handles discovery + compliant sending.
4. Deploy `src/unsubscribe-server.ts` publicly and point `UNSUBSCRIBE_BASE_URL` at it. Until
   that's live, every send must pass an explicit working `unsubscribe_url`.
5. Swap `data/leads.json` for a real database once you're past a handful of test leads. Note the
   two processes currently share that file, so they must run on the same host until you do.
