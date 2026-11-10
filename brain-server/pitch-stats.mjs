import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSystemSnapshot, listConversions } from './store.mjs';
import { STRIPE_PAYMENT_LINK } from './monitor-matrix.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function countLocalPreviewSlugs() {
  const hub = join(ROOT, 'output', 'preview-hub');
  try {
    return readdirSync(hub).filter((n) => {
      try {
        return statSync(join(hub, n)).isDirectory() && statSync(join(hub, n, 'index.html')).isFile();
      } catch {
        return false;
      }
    }).length;
  } catch {
    return 0;
  }
}

function countLocalContacted() {
  try {
    const data = JSON.parse(readFileSync(join(ROOT, 'contacted.json'), 'utf8'));
    return data.contacted?.length ?? 0;
  } catch {
    return 0;
  }
}

function engagementStats() {
  try {
    const { getEngagementStats } = require('../lib/engagement-registry.cjs');
    return getEngagementStats();
  } catch {
    return null;
  }
}

export async function buildPublicPitchStats() {
  const system = (await getSystemSnapshot()) ?? {};
  const conversions = await listConversions();
  const paid = conversions.filter((e) => e.status === 'paid' || e.status === 'complete');
  const engagement = engagementStats();
  const contacted = Math.max(system.contacted ?? 0, system.emailsSentLive ?? 0, countLocalContacted());
  const previewSlugs = Math.max(system.previewSlugs ?? 0, countLocalPreviewSlugs());
  const siteVisitors = parseInt(process.env.SITE_VISITORS ?? '235', 10);

  return {
    brand: 'Ganesh.AI',
    tagline: 'Autonomous luxury business intelligence',
    updatedAt: new Date().toISOString(),
    proof: {
      siteVisitors,
      pitchesSent: contacted,
      previewPortals: previewSlugs,
      scoutedListings: Math.max(system.scoutedListings ?? 0, previewSlugs),
      emailsOpened: engagement?.uniqueOpens ?? system.emailsOpened ?? 0,
      emailClicks: engagement?.uniqueClicks ?? system.emailsClicked ?? 0,
      previewVisits: engagement?.uniquePreviewVisits ?? system.portalsOpened ?? 0,
      paidConversions: paid.length,
      pipelineUsd: contacted * 499,
    },
    funnel: [
      { stage: 'scout', label: 'Scouted listings', count: system.scoutedListings ?? previewSlugs },
      { stage: 'build', label: 'Luxury portals built', count: previewSlugs },
      { stage: 'pitch', label: 'Live pitches sent', count: contacted },
      { stage: 'engage', label: 'Preview visits', count: engagement?.uniquePreviewVisits ?? system.portalsOpened ?? 0 },
      { stage: 'convert', label: 'Paid conversions', count: paid.length },
    ],
    verticals: ['restaurant', 'bar', 'salon', 'dispensary', 'gym', 'auto'],
    modules: 35,
    pricing: {
      cohort: 499,
      standard: 1499,
      currency: 'USD',
      paymentLink: STRIPE_PAYMENT_LINK,
    },
    links: {
      previewHub: system.previewBase ?? 'https://preview.ceo.slay.llc',
      brainHub: process.env.GANESH_AI_BRAIN_URL?.replace(/\/$/, '') ?? 'https://ganesh.guru',
      checkout: STRIPE_PAYMENT_LINK,
      checkoutStandard:
        process.env.STRIPE_LIVE_LINK_STANDARD?.trim() ??
        'https://buy.stripe.com/9B600ifsLdZxa1SdNh8bS01',
    },
    stripeBuyButton: {
      id: process.env.STRIPE_BUY_BUTTON_ID?.trim() ?? 'buy_btn_1TkFPWAxzA1LgWEjw3sfVVWP',
      publishableKey:
        process.env.STRIPE_PUBLISHABLE_KEY?.trim() ??
        'pk_live_51Sj5vwAxzA1LgWEjmjO2mcx6JeDMe109m8hYAFOJtNFAhmaBZSEOt62C4h7WzBl1lLoXQAMDofmtM6dDOAW3oi8100QCMuC4nq',
    },
    products: {
      cohort: {
        id: process.env.STRIPE_PRODUCT_ID_COHORT?.trim() ?? 'prod_UhR5PxRn2mzhoB',
        priceId: process.env.STRIPE_PRICE_ID_COHORT?.trim() ?? 'price_1Ti2DhAxzA1LgWEjDL9dXYGO',
        name: 'Basic',
        amount: 499,
      },
      standard: {
        id: process.env.STRIPE_PRODUCT_ID_STANDARD?.trim() ?? 'prod_Ujarmg5IGD3EKq',
        priceId: process.env.STRIPE_PRICE_ID_STANDARD?.trim() ?? 'price_1Tk7foAxzA1LgWEjt7MWoiYe',
        name: 'Premium Upgrade',
        amount: 1499,
      },
    },
    metros: system.zipHeatmap?.slice(0, 8).map((z) => z.zip) ?? ['90210', '98101', '89101', '02108', '10011'],
  };
}

export async function handlePublicPitchStats(_req, res) {
  const stats = await buildPublicPitchStats();
  res.json({ ok: true, ...stats });
}