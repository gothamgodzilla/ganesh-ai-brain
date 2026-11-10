import cors from 'cors';

const DEFAULT_ORIGINS = [
  'https://preview.ceo.slay.llc',
  'https://ceo.slay.llc',
  'https://ganesh.guru',
  'https://preview-hub-tau.vercel.app',
];

function allowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) return DEFAULT_ORIGINS;
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function hardenedCors() {
  const origins = allowedOrigins();

  return cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-brain-sync-secret', 'x-dashboard-token'],
  });
}