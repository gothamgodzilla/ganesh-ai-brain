import { addConversion } from './store.mjs';
import { verifyInternalToken } from './internal-auth.mjs';

const REF_PATTERN = /^[a-z0-9][a-z0-9._-]{0,80}:[a-z0-9][a-z0-9._-]{0,40}$/i;

function parseClientReference(ref) {
  const normalized = ref.trim();
  if (!REF_PATTERN.test(normalized)) {
    throw new Error('client_reference_id must be "{businessId}:{tier}"');
  }
  const [businessId, tier] = normalized.split(':');
  return { businessId, tier };
}

function validatePayload(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid JSON body');
  }
  if (typeof body.status !== 'string' || !body.status.trim()) {
    throw new Error('status is required');
  }
  if (typeof body.client_reference_id !== 'string' || !body.client_reference_id.trim()) {
    throw new Error('client_reference_id is required');
  }
  if (typeof body.amount_total !== 'number' || !Number.isFinite(body.amount_total)) {
    throw new Error('amount_total must be a number');
  }
  return {
    status: body.status,
    client_reference_id: body.client_reference_id,
    amount_total: body.amount_total,
    currency: typeof body.currency === 'string' ? body.currency : 'usd',
    customer_email: typeof body.customer_email === 'string' ? body.customer_email : undefined,
    id: typeof body.id === 'string' ? body.id : undefined,
  };
}

export async function handleInternalStripeConversion(req, res) {
  const auth = verifyInternalToken(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    const payload = validatePayload(req.body);
    const { businessId, tier } = parseClientReference(payload.client_reference_id);

    await addConversion({
      id: payload.id ?? `ingest-${businessId}-${Date.now()}`,
      amount: payload.amount_total,
      currency: payload.currency ?? 'usd',
      status: payload.status,
      customerEmail: payload.customer_email,
      businessId,
      tier,
      createdAt: new Date().toISOString(),
      source: 'ingest',
    });

    res.json({ status: 'success', activated: businessId, tier });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Invalid conversion payload',
    });
  }
}