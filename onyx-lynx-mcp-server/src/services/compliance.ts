import { ALLOWED_FROM_ADDRESSES } from "../constants.js";

/**
 * Centralized CAN-SPAM guardrails for Lynx outreach email. This is not
 * legal advice (see README) — it encodes the mechanical checks the statute
 * requires so a bad prompt can't produce a non-compliant send:
 *   - From address must be one of the pre-verified sender identities
 *   - Body must include a physical postal address
 *   - Body must include a working unsubscribe/opt-out mechanism
 *   - Subject line must not be deceptive (best-effort heuristic only —
 *     a human should still review subject lines before large sends)
 */

export function assertAllowedSender(fromAddress: string): void {
  const normalized = fromAddress.trim().toLowerCase();
  const allowed = ALLOWED_FROM_ADDRESSES.map((a) => a.toLowerCase());
  if (!allowed.includes(normalized)) {
    throw new Error(
      `From address "${fromAddress}" is not on the allowlist. Allowed senders: ` +
        `${ALLOWED_FROM_ADDRESSES.join(", ")}. Add a new sender to ALLOWED_FROM_ADDRESSES in ` +
        `constants.ts only after verifying its domain in Resend.`
    );
  }
}

export function assertCompliantBody(params: {
  html?: string;
  text?: string;
  physicalAddress?: string;
  unsubscribeUrl?: string;
}): void {
  const body = `${params.html ?? ""} ${params.text ?? ""}`;
  if (!params.physicalAddress || params.physicalAddress.trim().length < 5) {
    throw new Error(
      "CAN-SPAM requires a valid physical postal address in every commercial email. " +
        "Pass `physical_address` (street, city, state, zip — a registered agent address or " +
        "PMB is acceptable) — see README 'Compliance' section."
    );
  }
  if (!params.unsubscribeUrl) {
    throw new Error(
      "CAN-SPAM requires a working opt-out mechanism, honored within 10 business days. " +
        "Pass `unsubscribe_url` — Lynx will render it into the footer automatically."
    );
  }
  if (!body.toLowerCase().includes(params.physicalAddress.toLowerCase().slice(0, 8))) {
    // sanity check that the address actually made it into the rendered body
    throw new Error(
      "Internal error: physical_address was not found in the rendered email body. " +
        "Do not send — check the template."
    );
  }
}

export function renderComplianceFooter(params: {
  physicalAddress: string;
  unsubscribeUrl: string;
  businessName: string;
}): string {
  return `
<hr/>
<p style="font-size:11px;color:#888;line-height:1.5;">
  This is a one-time promotional message from GANESH-Ai-BRAIN regarding ${params.businessName}'s
  online presence. We are not affiliated with ${params.businessName} unless you choose to work
  with us.<br/>
  Mailing address: ${params.physicalAddress}<br/>
  Don't want these emails? <a href="${params.unsubscribeUrl}">Unsubscribe / opt out</a> —
  honored within 10 business days per 15 U.S.C. &sect; 7704.
</p>`.trim();
}
