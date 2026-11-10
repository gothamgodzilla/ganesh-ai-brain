import { z } from "zod";
import { ALLOWED_FROM_ADDRESSES, DEFAULT_PREVIEW_EXPIRY_DAYS } from "../constants.js";

export const SendOutreachEmailInputSchema = z
  .object({
    from: z
      .enum(ALLOWED_FROM_ADDRESSES)
      .describe("Must be one of the pre-verified GANESH-Ai-BRAIN sender identities."),
    to: z.string().email().describe("The business's most-verifiable email (owner/manager, not a generic scrape guess)."),
    business_id: z
      .string()
      .min(1)
      .describe("Stable id for this lead (e.g. a Google Places place_id, or normalized 'name|zip'). Used for suppression tracking."),
    business_name: z.string().min(1).max(200),
    subject: z.string().min(3).max(150).describe("Non-deceptive subject line — must not misrepresent the email as anything other than a business pitch."),
    preview_html_body: z
      .string()
      .min(20)
      .describe("The pitch body HTML (mockup carousel/link, reviews summary, projected traffic/revenue lift, etc). Do NOT include the compliance footer — it is appended automatically."),
    physical_address: z.string().min(5).max(300).describe("Sender's physical postal mailing address — required by CAN-SPAM, appended to every send."),
    unsubscribe_url: z
      .string()
      .url()
      .optional()
      .describe(
        "Working opt-out link — required by CAN-SPAM. Omit this to have Lynx mint a signed " +
          "one automatically from UNSUBSCRIBE_BASE_URL (preferred: the generated link is " +
          "tamper-evident and non-enumerable). Passing an explicit URL overrides that."
      ),
    preview_expiry_days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(DEFAULT_PREVIEW_EXPIRY_DAYS)
      .describe(
        "How many days until the mockup preview link should stop resolving. NOTE: this expires " +
          "the *link*, not the email itself — Resend/email protocols have no mechanism to delete " +
          "mail already delivered to an inbox. See README 'Self-destruct limitation'."
      ),
    cooldown_days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(30)
      .describe("Minimum days between sends to the same business_id before this tool will allow a re-send."),
    dry_run: z
      .boolean()
      .default(false)
      .describe("If true, run all validation/suppression checks and return what WOULD be sent, without calling Resend."),
  })
  .strict();
export type SendOutreachEmailInput = z.infer<typeof SendOutreachEmailInputSchema>;

export const TrackLeadInputSchema = z
  .object({
    business_id: z.string().min(1),
    business_name: z.string().min(1).max(200),
    action: z.enum(["check", "mark_contacted", "mark_opted_out", "mark_converted"]).describe(
      "'check' just returns current status/suppression state; the others update it."
    ),
    contact_email: z.string().email().optional(),
    cooldown_days: z.number().int().min(1).max(90).default(30),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type TrackLeadInput = z.infer<typeof TrackLeadInputSchema>;
