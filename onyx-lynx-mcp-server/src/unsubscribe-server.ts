#!/usr/bin/env node
/**
 * Lynx opt-out + preview-expiry web service.
 *
 * Runs SEPARATELY from the MCP server (different process, public-facing).
 * The MCP server writes lead state; this service reads and updates the same
 * store when a business owner clicks "unsubscribe" or opens a mockup preview.
 *
 *   npm run build && npm run start:unsubscribe
 *
 * Deploy this somewhere public (Vercel/Fly/Render) and point
 * UNSUBSCRIBE_BASE_URL at it so Lynx can mint working opt-out links.
 */

import express, { type Request, type Response } from "express";
import { verifyOptOutToken } from "./services/tokens.js";
import { getLead, upsertLead } from "./services/lead-store.js";

const app = express();
app.use(express.urlencoded({ extended: false }));

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:34rem;margin:4rem auto;
       padding:0 1.25rem;line-height:1.6;color:#1a1a1a;background:#fff}
  h1{font-size:1.35rem;margin-bottom:.5rem}
  button{background:#1a1a1a;color:#fff;border:0;border-radius:6px;padding:.7rem 1.4rem;
         font-size:1rem;cursor:pointer}
  button:hover{background:#333}
  .muted{color:#666;font-size:.9rem}
  @media(prefers-color-scheme:dark){
    body{background:#141414;color:#eee} button{background:#eee;color:#141414}
    button:hover{background:#ccc} .muted{color:#999}
  }
</style></head><body>${body}</body></html>`;
}

/**
 * GET renders a confirmation form rather than opting out immediately.
 *
 * This is deliberate: corporate mail scanners and link-preview bots issue GET
 * requests against every URL in an inbound email. A GET that unsubscribes on
 * sight would silently opt people out who never clicked anything — and would
 * also let a scanner burn the link before the human ever sees it.
 */
app.get("/unsubscribe", (req: Request, res: Response) => {
  const token = typeof req.query.t === "string" ? req.query.t : "";
  const businessId = token ? verifyOptOutToken(token) : null;

  if (!businessId) {
    return res
      .status(400)
      .send(
        page(
          "Invalid link",
          `<h1>This unsubscribe link isn't valid</h1>
           <p>It may have been altered in transit or copied incompletely.</p>
           <p class="muted">Reply to the original email and we'll remove you manually.</p>`
        )
      );
  }

  res.send(
    page(
      "Confirm unsubscribe",
      `<h1>Unsubscribe from these emails?</h1>
       <p>We'll stop sending to this address and won't contact this business again.</p>
       <form method="POST" action="/unsubscribe">
         <input type="hidden" name="t" value="${token.replace(/"/g, "&quot;")}"/>
         <button type="submit">Confirm unsubscribe</button>
       </form>
       <p class="muted">Takes effect immediately.</p>`
    )
  );
});

/** POST performs the actual opt-out. Idempotent. */
app.post("/unsubscribe", async (req: Request, res: Response) => {
  const token = typeof req.body?.t === "string" ? req.body.t : "";
  const businessId = token ? verifyOptOutToken(token) : null;

  if (!businessId) {
    return res.status(400).send(page("Invalid link", `<h1>This unsubscribe link isn't valid</h1>`));
  }

  try {
    const existing = await getLead(businessId);
    await upsertLead({
      business_id: businessId,
      business_name: existing?.business_name ?? businessId,
      contact_email: existing?.contact_email,
      status: "opted_out",
      first_contacted_at: existing?.first_contacted_at,
      last_contacted_at: existing?.last_contacted_at,
      contact_count: existing?.contact_count ?? 0,
      preview_expires_at: existing?.preview_expires_at,
      notes: existing?.notes,
    });

    res.send(
      page(
        "Unsubscribed",
        `<h1>You're unsubscribed</h1>
         <p>We won't email this business again. Nothing else is needed from you.</p>`
      )
    );
  } catch (error) {
    console.error("[unsubscribe] failed to record opt-out:", error);
    res
      .status(500)
      .send(
        page(
          "Something went wrong",
          `<h1>We couldn't record that just now</h1>
           <p>Please reply to the original email and we'll remove you manually.</p>`
        )
      );
  }
});

/**
 * RFC 8058 one-click unsubscribe. Gmail and Yahoo require this for bulk
 * senders; without it, outreach volume gets throttled or spam-foldered.
 * Mail providers POST here directly with no human confirmation step, which
 * is safe because only the provider (not a scanner) issues it.
 */
app.post("/unsubscribe/one-click", async (req: Request, res: Response) => {
  const token = typeof req.query.t === "string" ? req.query.t : "";
  const businessId = token ? verifyOptOutToken(token) : null;
  if (!businessId) return res.status(400).end();

  try {
    const existing = await getLead(businessId);
    await upsertLead({
      business_id: businessId,
      business_name: existing?.business_name ?? businessId,
      contact_email: existing?.contact_email,
      status: "opted_out",
      first_contacted_at: existing?.first_contacted_at,
      last_contacted_at: existing?.last_contacted_at,
      contact_count: existing?.contact_count ?? 0,
      preview_expires_at: existing?.preview_expires_at,
      notes: existing?.notes,
    });
    res.status(200).end();
  } catch (error) {
    console.error("[unsubscribe/one-click] failed:", error);
    res.status(500).end();
  }
});

/**
 * Mockup preview, gated on the expiry stamped at send time. This is what
 * actually implements the "14-day self-destruct" — the hosted asset stops
 * resolving. The email itself stays in the inbox; nothing can change that.
 */
app.get("/preview/:businessId", async (req: Request, res: Response) => {
  const businessId = String(req.params.businessId ?? "");
  const lead = await getLead(businessId);

  if (!lead || !lead.preview_expires_at) {
    return res.status(404).send(page("Not found", `<h1>This preview doesn't exist</h1>`));
  }

  if (Date.now() > new Date(lead.preview_expires_at).getTime()) {
    return res
      .status(410)
      .send(
        page(
          "Preview expired",
          `<h1>This preview has expired</h1>
           <p>Previews stay live for a limited window. Reply to the original
              email and we'll generate a fresh one.</p>`
        )
      );
  }

  // Wire your generated mockup HTML in here (S3/CDN fetch, template render, etc).
  res.send(
    page(
      `Preview — ${lead.business_name}`,
      `<h1>${lead.business_name}</h1>
       <p>Mockup preview goes here.</p>
       <p class="muted">Expires ${new Date(lead.preview_expires_at).toLocaleDateString()}.</p>`
    )
  );
});

app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true }));

const port = parseInt(process.env.UNSUBSCRIBE_PORT || "3001", 10);
app.listen(port, () => {
  if (!process.env.UNSUBSCRIBE_TOKEN_SECRET) {
    console.error(
      "[unsubscribe] WARNING: UNSUBSCRIBE_TOKEN_SECRET is not set — every link will be rejected. " +
        "Generate one with: openssl rand -hex 32"
    );
  }
  console.error(`[unsubscribe] listening on http://localhost:${port}`);
});
