import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { httpPost, handleApiError, asStructured } from "../services/http.js";
import { assertAllowedSender, assertCompliantBody, renderComplianceFooter } from "../services/compliance.js";
import { getLead, upsertLead, isSuppressed } from "../services/lead-store.js";
import { SendOutreachEmailInputSchema, TrackLeadInputSchema } from "../schemas/lynx.js";
import { RESEND_SEND_URL } from "../constants.js";
import { buildUnsubscribeUrl, createOptOutToken } from "../services/tokens.js";
import type { LeadRecord } from "../types.js";

export function registerLynxTools(server: McpServer): void {
  server.registerTool(
    "lynx_send_outreach_email",
    {
      title: "Lynx: Send Outreach Email",
      description: `Send the cold-outreach "here's what we could build you" pitch email via Resend, with
CAN-SPAM guardrails and suppression-list checks baked in. This tool WILL REFUSE to send if:
  - the from address isn't on the pre-verified allowlist,
  - physical_address is missing, or no opt-out URL can be resolved,
  - the business is already in cooldown or has opted out (checked via lynx_track_and_check_lead's
    same store — call that first if you want to inspect status without sending).

Args:
  - from (enum): one of the verified GANESH-Ai-BRAIN sender addresses.
  - to (email): business owner/manager's verified email.
  - business_id (string): stable id for suppression tracking (e.g. Google place_id).
  - business_name (string).
  - subject (string): non-deceptive subject line.
  - preview_html_body (string): the pitch HTML — mockup carousel link, reviews summary, projected
    lift. Compliance footer is appended automatically, do not include your own.
  - physical_address (string): required CAN-SPAM mailing address.
  - unsubscribe_url (string, optional): CAN-SPAM opt-out link. Omit to have Lynx mint a signed,
    tamper-evident one from UNSUBSCRIBE_BASE_URL (preferred). Sends are refused if neither an
    explicit URL nor UNSUBSCRIBE_BASE_URL is available.
  - preview_expiry_days (number, default 14): informational — stamped into the lead record so you
    can expire the mockup link/CDN asset on schedule. Does NOT delete the delivered email itself
    (see "Self-destruct limitation" in README) — email has no remote-delete capability.
  - cooldown_days (number, default 30): minimum gap before this business can be emailed again.
  - dry_run (boolean, default false): validate + report without actually calling Resend.

Every send also carries List-Unsubscribe and List-Unsubscribe-Post (RFC 8058) headers, which
Gmail and Yahoo require from bulk senders — omitting them is a common reason good-faith outreach
gets spam-foldered regardless of content.

Returns JSON: { sent: boolean, dry_run: boolean, resend_id?, business_id, next_eligible_send_at }

Error Handling:
  - "Error: From address ... not on the allowlist" — fix the from param, don't add new senders
    without verifying the domain in Resend first.
  - "Error: ... requires a valid physical postal address" / "... opt-out mechanism" — add the
    missing field.
  - "Error: Suppressed — ..." — business opted out or still in cooldown; do not retry.`,
      inputSchema: SendOutreachEmailInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        assertAllowedSender(params.from);

        const existingLead = await getLead(params.business_id);
        const suppression = isSuppressed(existingLead, params.cooldown_days);
        if (suppression.suppressed) {
          return { content: [{ type: "text", text: `Error: Suppressed — ${suppression.reason}` }] };
        }

        // Explicit URL wins; otherwise mint a signed one. If neither is
        // available we must not send — CAN-SPAM requires a working opt-out.
        const unsubscribeUrl = params.unsubscribe_url ?? buildUnsubscribeUrl(params.business_id);
        if (!unsubscribeUrl) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Error: No unsubscribe URL. Either pass `unsubscribe_url`, or set " +
                  "UNSUBSCRIBE_BASE_URL (plus UNSUBSCRIBE_TOKEN_SECRET) so Lynx can generate a " +
                  "signed one. Sending without a working opt-out violates CAN-SPAM.",
              },
            ],
          };
        }

        const footer = renderComplianceFooter({
          physicalAddress: params.physical_address,
          unsubscribeUrl,
          businessName: params.business_name,
        });
        const fullHtml = `${params.preview_html_body}\n${footer}`;

        assertCompliantBody({
          html: fullHtml,
          physicalAddress: params.physical_address,
          unsubscribeUrl,
        });

        const nowIso = new Date().toISOString();
        const expiresIso = new Date(
          Date.now() + params.preview_expiry_days * 24 * 60 * 60 * 1000
        ).toISOString();

        if (params.dry_run) {
          const output = {
            sent: false,
            dry_run: true,
            business_id: params.business_id,
            would_send: { from: params.from, to: params.to, subject: params.subject },
            unsubscribe_url: unsubscribeUrl,
            preview_expires_at: expiresIso,
          };
          return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: asStructured(output) };
        }

        const base = process.env.UNSUBSCRIBE_BASE_URL?.replace(/\/+$/, "");
        const oneClickUrl = base
          ? `${base}/unsubscribe/one-click?t=${encodeURIComponent(createOptOutToken(params.business_id))}`
          : null;

        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          return { content: [{ type: "text", text: "Error: RESEND_API_KEY is not set. See README setup steps." }] };
        }

        const resendResponse = await httpPost<{ id: string }>(
          RESEND_SEND_URL,
          {
            from: params.from,
            to: [params.to],
            subject: params.subject,
            html: fullHtml,
            // Gmail/Yahoo bulk-sender rules require one-click unsubscribe.
            // Missing these headers is a common cause of outreach landing in
            // spam regardless of content quality.
            headers: oneClickUrl
              ? {
                  "List-Unsubscribe": `<${oneClickUrl}>, <${unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                }
              : { "List-Unsubscribe": `<${unsubscribeUrl}>` },
          },
          { Authorization: `Bearer ${apiKey}` }
        );

        const updatedLead: LeadRecord = {
          business_id: params.business_id,
          business_name: params.business_name,
          contact_email: params.to,
          status: "contacted",
          first_contacted_at: existingLead?.first_contacted_at ?? nowIso,
          last_contacted_at: nowIso,
          contact_count: (existingLead?.contact_count ?? 0) + 1,
          preview_expires_at: expiresIso,
          notes: existingLead?.notes,
        };
        await upsertLead(updatedLead);

        const output = {
          sent: true,
          dry_run: false,
          resend_id: resendResponse.id,
          business_id: params.business_id,
          preview_expires_at: expiresIso,
          next_eligible_send_at: new Date(
            Date.now() + params.cooldown_days * 24 * 60 * 60 * 1000
          ).toISOString(),
        };
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: asStructured(output) };
      } catch (error) {
        if (error instanceof Error && !("isAxiosError" in (error as any))) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
        return { content: [{ type: "text", text: handleApiError(error, "Resend") }] };
      }
    }
  );

  server.registerTool(
    "lynx_track_and_check_lead",
    {
      title: "Lynx: Track / Check Lead",
      description: `Read or update a business's position in the outreach suppression list, without sending
anything. Use 'check' before drafting a pitch (skip businesses already contacted/opted out),
and 'mark_opted_out' the moment a reply asks to stop — that status is permanent.

Args:
  - business_id (string).
  - business_name (string).
  - action ('check' | 'mark_contacted' | 'mark_opted_out' | 'mark_converted').
  - contact_email (string, optional).
  - cooldown_days (number, default 30): only affects 'check' suppression math.
  - notes (string, optional).

Returns JSON: { lead: LeadRecord | null, suppressed: boolean, reason?: string }`,
      inputSchema: TrackLeadInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const existing = await getLead(params.business_id);

      if (params.action === "check") {
        const suppression = isSuppressed(existing, params.cooldown_days);
        const output = { lead: existing ?? null, ...suppression };
        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: asStructured(output) };
      }

      const nowIso = new Date().toISOString();
      const statusMap = {
        mark_contacted: "contacted",
        mark_opted_out: "opted_out",
        mark_converted: "converted",
      } as const;

      const updated: LeadRecord = {
        business_id: params.business_id,
        business_name: params.business_name,
        contact_email: params.contact_email ?? existing?.contact_email,
        status: statusMap[params.action as keyof typeof statusMap],
        first_contacted_at: existing?.first_contacted_at,
        last_contacted_at: params.action === "mark_contacted" ? nowIso : existing?.last_contacted_at,
        contact_count: existing?.contact_count ?? 0,
        preview_expires_at: existing?.preview_expires_at,
        notes: params.notes ?? existing?.notes,
      };
      await upsertLead(updated);
      const output = { lead: updated, suppressed: updated.status === "opted_out" };
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: asStructured(output) };
    }
  );
}
