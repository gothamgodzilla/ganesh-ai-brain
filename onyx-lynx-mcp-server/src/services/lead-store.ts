import { promises as fs } from "node:fs";
import path from "node:path";
import { LEAD_STORE_PATH } from "../constants.js";
import type { LeadRecord, LeadStore } from "../types.js";

/**
 * Minimal file-backed suppression/CRM store so Lynx never double-emails a
 * business or emails one that opted out. This is intentionally simple
 * (a JSON file) — swap for Postgres/Supabase/Airtable in production, but
 * keep the same read/write contract (getLead/upsertLead) so the tools in
 * tools/lynx-outreach.ts don't need to change.
 */

async function ensureStoreFile(): Promise<string> {
  const resolved = path.resolve(LEAD_STORE_PATH);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  try {
    await fs.access(resolved);
  } catch {
    const empty: LeadStore = { leads: {} };
    await fs.writeFile(resolved, JSON.stringify(empty, null, 2), "utf8");
  }
  return resolved;
}

export async function readStore(): Promise<LeadStore> {
  const resolved = await ensureStoreFile();
  const raw = await fs.readFile(resolved, "utf8");
  try {
    return JSON.parse(raw) as LeadStore;
  } catch {
    return { leads: {} };
  }
}

async function writeStore(store: LeadStore): Promise<void> {
  const resolved = await ensureStoreFile();
  await fs.writeFile(resolved, JSON.stringify(store, null, 2), "utf8");
}

export async function getLead(businessId: string): Promise<LeadRecord | undefined> {
  const store = await readStore();
  return store.leads[businessId];
}

export async function upsertLead(record: LeadRecord): Promise<LeadRecord> {
  const store = await readStore();
  store.leads[record.business_id] = record;
  await writeStore(store);
  return record;
}

/**
 * Suppression check: is it safe to send an outreach email to this business
 * right now? Blocks opted-out leads permanently, and blocks re-sends within
 * `cooldownDays` of the last contact to avoid spam-flagging the sending
 * domain/account.
 */
export function isSuppressed(
  lead: LeadRecord | undefined,
  cooldownDays: number
): { suppressed: boolean; reason?: string } {
  if (!lead) return { suppressed: false };
  if (lead.status === "opted_out") {
    return { suppressed: true, reason: "Business previously opted out — permanent suppression." };
  }
  if (lead.last_contacted_at) {
    const last = new Date(lead.last_contacted_at).getTime();
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    if (Date.now() - last < cooldownMs) {
      const daysLeft = Math.ceil((cooldownMs - (Date.now() - last)) / (24 * 60 * 60 * 1000));
      return {
        suppressed: true,
        reason: `Already contacted ${lead.contact_count}x, last on ${lead.last_contacted_at}. Cooldown active — wait ~${daysLeft} more day(s) before re-sending.`,
      };
    }
  }
  return { suppressed: false };
}
