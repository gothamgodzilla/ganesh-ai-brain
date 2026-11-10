import Stripe from 'stripe';
import { addConversion } from './store.mjs';

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || key.includes('REPLACE_ME')) return null;
  return new Stripe(key);
}

export function parseCheckoutSession(session) {
  const ref = session.client_reference_id ?? '';
  const [businessId, tier] = ref.split(':');
  return {
    id: session.id,
    amount: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    status: session.payment_status ?? 'complete',
    customerEmail: session.customer_details?.email ?? undefined,
    businessId: businessId || undefined,
    tier: tier || undefined,
    createdAt: new Date((session.created ?? 0) * 1000).toISOString(),
    source: 'webhook',
  };
}

export async function handleStripeWebhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const stripe = stripeClient();
  if (!secret || !stripe) {
    res.status(503).json({ error: 'Stripe webhook not configured' });
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    res.status(400).send('Missing stripe-signature');
    return;
  }

  if (!Buffer.isBuffer(req.body)) {
    res.status(400).send('Webhook requires raw request body');
    return;
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, secret);
    if (event.type === 'checkout.session.completed') {
      await addConversion(parseCheckoutSession(event.data.object));
    }
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      await addConversion({
        id: pi.id,
        amount: pi.amount,
        currency: pi.currency,
        status: 'paid',
        customerEmail: typeof pi.receipt_email === 'string' ? pi.receipt_email : undefined,
        createdAt: new Date((pi.created ?? 0) * 1000).toISOString(),
        source: 'webhook',
      });
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(400).send(err instanceof Error ? err.message : 'Webhook failed');
  }
}