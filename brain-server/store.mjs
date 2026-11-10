import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSupabaseClient, isSupabaseConfigured } from './storage/supabase-client.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'brain');

async function ensureData() {
  await mkdir(DATA, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(join(DATA, file), 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await ensureData();
  await writeFile(join(DATA, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function listConversions() {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('brain_conversions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('Supabase listConversions error, falling back to local file:', error.message);
      return readJson('conversions.json', []);
    }

    return (data || []).map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      customerEmail: row.customer_email ?? undefined,
      businessId: row.business_id ?? undefined,
      tier: row.tier ?? undefined,
      createdAt: row.created_at,
      source: row.source,
      ...(row.raw_payload ?? {}),
    }));
  }

  return readJson('conversions.json', []);
}

export async function addConversion(event) {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    const row = {
      id: event.id,
      amount: event.amount ?? 0,
      currency: event.currency ?? 'usd',
      status: event.status ?? 'complete',
      customer_email: event.customerEmail || null,
      business_id: event.businessId || null,
      tier: event.tier || null,
      created_at: event.createdAt || new Date().toISOString(),
      source: event.source || 'webhook',
      raw_payload: event,
    };

    // Idempotent upsert by primary key (id)
    const { error } = await supabase
      .from('brain_conversions')
      .upsert(row, { onConflict: 'id' });

    if (error) {
      console.error('Supabase addConversion error, falling back to local file:', error.message);
      const list = await listConversions();
      if (list.some((e) => e.id === event.id)) return;
      list.unshift(event);
      await writeJson('conversions.json', list.slice(0, 500));
    }
    return;
  }

  const list = await listConversions();
  if (list.some((e) => e.id === event.id)) return;
  list.unshift(event);
  await writeJson('conversions.json', list.slice(0, 500));
}

export async function getSystemSnapshot() {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('brain_system_snapshot')
      .select('data')
      .eq('id', 'current')
      .maybeSingle();

    if (error) {
      console.error('Supabase getSystemSnapshot error, falling back to local file:', error.message);
      return readJson('system-snapshot.json', null);
    }

    return data?.data ?? null;
  }

  return readJson('system-snapshot.json', null);
}

export async function saveSystemSnapshot(snapshot) {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('brain_system_snapshot')
      .upsert({
        id: 'current',
        data: snapshot,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    if (error) {
      console.error('Supabase saveSystemSnapshot error, saving to local file as fallback:', error.message);
      await writeJson('system-snapshot.json', snapshot);
    }
    return;
  }

  await writeJson('system-snapshot.json', snapshot);
}
