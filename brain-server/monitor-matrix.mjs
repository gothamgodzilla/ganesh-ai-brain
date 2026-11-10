function stripQuotes(v) {
  return v.replace(/^["']|["']$/g, '');
}

export const BRAIN_HUB_URL = stripQuotes(
  process.env.GANESH_AI_BRAIN_URL ?? process.env.BRAIN_DASHBOARD_URL ?? 'http://localhost:5055'
).replace(/\/$/, '');

export const STRIPE_WEBHOOK_PATH = '/api/v1/stripe/webhook';

export const STRIPE_PAYMENT_LINK =
  process.env.STRIPE_LIVE_LINK?.trim() || 'https://buy.stripe.com/aFaeVc2FZaNla1ScJd8bS00';

export const MONITOR_CONTROL_MATRIX = [
  {
    name: 'GaneshAI Brain App',
    endpoint: BRAIN_HUB_URL,
    url: BRAIN_HUB_URL,
    intent: 'Central visualization hub for incoming B2B revenue and active assets.',
  },
  {
    name: 'Live Telemetry Pipe',
    endpoint: STRIPE_WEBHOOK_PATH,
    url: `${BRAIN_HUB_URL}${STRIPE_WEBHOOK_PATH}`,
    intent: 'Captures, parses, and logs incoming client_reference_id strings.',
  },
  {
    name: 'Frictionless Gate',
    endpoint: 'buy.stripe.com/...Jd8bS00',
    url: STRIPE_PAYMENT_LINK,
    intent: 'Processes transactions cleanly under your verified Mangasm billing profile.',
  },
];