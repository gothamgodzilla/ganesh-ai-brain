import type { BusinessRecord, MergedBusinessRecord } from "../types.js";

function normalize(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Cheap Levenshtein-based similarity, good enough for "is this the same
// storefront reported by two different APIs" without pulling in a
// fuzzy-matching dependency.
function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const dist = dp[m][n];
  return 1 - dist / Math.max(m, n, 1);
}

/**
 * Groups business records that likely refer to the same physical storefront
 * (matched on normalized name similarity + partial address match), so Lynx
 * sends ONE outreach email per business instead of one per data source.
 */
export function mergeBusinessRecords(records: BusinessRecord[]): MergedBusinessRecord[] {
  const groups: MergedBusinessRecord[] = [];

  for (const record of records) {
    const normName = normalize(record.name);
    const normAddr = normalize(record.address).slice(0, 20);

    const match = groups.find((g) => {
      const nameScore = similarity(normalize(g.canonical_name), normName);
      const addrOverlap = g.addresses.some((a) => normalize(a).slice(0, 20) === normAddr && normAddr.length > 0);
      return nameScore > 0.82 || (nameScore > 0.6 && addrOverlap);
    });

    if (match) {
      match.records.push(record);
      match.sources = Array.from(new Set([...match.sources, record.source]));
      if (record.address && !match.addresses.includes(record.address)) match.addresses.push(record.address);
      if (record.phone && !match.phones.includes(record.phone)) match.phones.push(record.phone);
      if (record.website && !match.websites.includes(record.website)) match.websites.push(record.website);
      if (record.rating !== undefined) {
        match.best_rating = Math.max(match.best_rating ?? 0, record.rating);
      }
      if (record.review_count !== undefined) {
        match.total_review_count = (match.total_review_count ?? 0) + record.review_count;
      }
    } else {
      groups.push({
        canonical_name: record.name,
        addresses: record.address ? [record.address] : [],
        phones: record.phone ? [record.phone] : [],
        websites: record.website ? [record.website] : [],
        sources: [record.source],
        best_rating: record.rating,
        total_review_count: record.review_count,
        records: [record],
      });
    }
  }

  return groups;
}
