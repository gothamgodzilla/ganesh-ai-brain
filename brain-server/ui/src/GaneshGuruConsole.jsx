import React, { useMemo, useState } from 'react';

const NAV = ['Dashboard', 'Active Fleets', 'Outreach Matrix', 'Stripe Logs', 'Automation Logs'];

const VERTICALS = ['restaurant', 'bar', 'salon', 'dispensary', 'gym', 'auto'];

function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso ?? '—';
  }
}

function heatClass(value, max) {
  if (!value) return 'bg-obsidian-800 border border-obsidian-700/50';
  const t = value / Math.max(max, 1);
  if (t > 0.66) return 'bg-amethyst-500 shadow-glass border border-amethyst-300/30';
  if (t > 0.33) return 'bg-amethyst-700 border border-amethyst-500/20';
  if (t > 0) return 'bg-obsidian-700';
  return 'bg-obsidian-800 border border-obsidian-700/50';
}

export default function GaneshGuruConsole({ payload, health, onRefresh, loading }) {
  const [activeNav, setActiveNav] = useState(0);

  const data = useMemo(() => {
    const sys = payload?.system ?? {};
    const rev = payload?.revenue ?? {};
    const monitor = payload?.monitor ?? {};
    const funnel = monitor.funnel ?? [];
    const funnelMap = Object.fromEntries(funnel.map((f) => [f.stage, f]));

    return {
      previewSlugs: sys.previewSlugs ?? 0,
      contacted: sys.contacted ?? 0,
      scouted: sys.scoutedListings ?? funnelMap.scouted?.count ?? sys.previewSlugs ?? 0,
      portalsOpened: sys.portalsOpened ?? funnelMap.opened?.count ?? 0,
      conversions: funnelMap.conversions?.count ?? rev.paymentCount ?? 0,
      conversionRate: `${(rev.conversionRate ?? 0).toFixed(2)}%`,
      totalRevenue: rev.totalRevenue ?? 0,
      todayRevenue: rev.todayRevenue ?? 0,
      funnel,
      zipHeatmap: monitor.zipHeatmap ?? [],
      recentOutreach: sys.recentOutreach ?? [],
      recentSessions: monitor.recentSessions ?? [],
      recentPayments: rev.recentPayments ?? [],
      links: payload?.links ?? {},
      updatedAt: sys.updatedAt,
      lastMetro: sys.lastPipelineMetro,
      lastZip: sys.lastPipelineZip,
      health,
    };
  }, [payload, health]);

  const maxHeat = useMemo(
    () => Math.max(...data.zipHeatmap.flatMap((r) => VERTICALS.map((v) => r[v] ?? 0)), 1),
    [data.zipHeatmap]
  );

  const funnelBars = [
    {
      label: 'Scouted Listings',
      val: data.scouted.toLocaleString(),
      w: 'w-full',
      c: 'from-amethyst-500 to-electric-indigo',
    },
    {
      label: 'Compiled Portals',
      val: data.previewSlugs.toLocaleString(),
      w: 'w-5/6',
      c: 'from-amethyst-500 to-amethyst-400',
    },
    {
      label: 'Outbound Live Pitches',
      val: data.contacted.toLocaleString(),
      w: 'w-3/4',
      c: 'from-amethyst-400 to-electric-pink',
    },
    {
      label: 'Portals Opened',
      val: data.portalsOpened.toLocaleString(),
      w: data.portalsOpened > 0 ? 'w-1/2' : 'w-1/4',
      c: 'from-electric-pink to-rose-400',
    },
    {
      label: 'Dashboard Converts',
      val: data.conversions > 0 ? data.conversions.toLocaleString() : 'Pending',
      w: data.conversions > 0 ? 'w-2/5' : 'w-1/6',
      c: 'from-rose-400 to-amethyst-300',
    },
  ];

  return (
    <div className="min-h-screen bg-obsidian-900 text-slate-100 font-sans antialiased flex">
      <aside className="w-64 bg-obsidian-800 border-r border-obsidian-700 flex flex-col justify-between p-6 shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-10">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amethyst-500 to-electric-pink flex items-center justify-center font-bold text-obsidian-900">
              G
            </div>
            <h1 className="text-xl font-bold tracking-wider bg-gradient-to-r from-white to-amethyst-300 bg-clip-text text-transparent">
              ganesh.guru
            </h1>
          </div>
          <nav className="space-y-2">
            {NAV.map((item, index) => (
              <button
                key={item}
                type="button"
                onClick={() => setActiveNav(index)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  activeNav === index
                    ? 'bg-amethyst-500/10 text-amethyst-400 border border-amethyst-500/20'
                    : 'text-slate-400 hover:bg-obsidian-700 hover:text-slate-200'
                }`}
              >
                {item}
              </button>
            ))}
          </nav>
        </div>
        <div className="text-xs text-slate-500 border-t border-obsidian-700 pt-4 space-y-1">
          <div>🔒 Secured Node Active</div>
          {data.updatedAt && <div className="text-[10px]">Sync {fmtDate(data.updatedAt)}</div>}
          {data.lastMetro && (
            <div className="text-[10px] text-amethyst-400/80">
              {data.lastMetro}
              {data.lastZip ? ` · ${data.lastZip}` : ''}
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 p-6 lg:p-10 space-y-8 overflow-y-auto">
        <header className="flex flex-wrap justify-between items-center gap-4">
          <div>
            <p className="text-xs font-semibold text-amethyst-400 tracking-widest uppercase">
              Central System Core
            </p>
            <h2 className="text-3xl font-black text-white mt-1">
              {NAV[activeNav] === 'Dashboard' ? 'Ganesh AI Brain Overview' : NAV[activeNav]}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="text-xs font-semibold px-4 py-2 rounded-xl border border-obsidian-700 bg-obsidian-800 hover:border-amethyst-500 transition-colors disabled:opacity-50"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <div className="flex items-center gap-3 bg-obsidian-800 border border-obsidian-700 px-4 py-2 rounded-xl text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              SYS STATUS: {data.health?.ok ? 'ONLINE' : 'DEGRADED'}
            </div>
          </div>
        </header>

        {(activeNav === 0 || activeNav === 1) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-obsidian-800 border border-obsidian-700 p-6 rounded-2xl shadow-glass">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Total Edge Fleets</p>
              <p className="text-4xl font-extrabold mt-2 bg-gradient-to-r from-white to-amethyst-400 bg-clip-text text-transparent">
                {data.previewSlugs.toLocaleString()}
              </p>
              <span className="text-xs text-emerald-400 font-medium flex items-center gap-1 mt-2">
                ↑ Routable Vercel slugs
              </span>
            </div>
            <div className="bg-obsidian-800 border border-obsidian-700 p-6 rounded-2xl">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Live Broadcasts</p>
              <p className="text-4xl font-extrabold text-white mt-2">{data.contacted.toLocaleString()}</p>
              <span className="text-xs text-amethyst-400 font-medium flex items-center gap-1 mt-2">
                Deduplicated registry active
              </span>
            </div>
            <div className="bg-obsidian-800 border border-obsidian-700 p-6 rounded-2xl">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Target Pipeline Velocity</p>
              <p className="text-4xl font-extrabold text-white mt-2">{data.conversionRate}</p>
              <span className="text-xs text-electric-pink font-medium flex items-center gap-1 mt-2">
                {fmtMoney(data.totalRevenue)} · {data.conversions} converts
              </span>
            </div>
          </div>
        )}

        {activeNav === 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 bg-obsidian-800 border border-obsidian-700 p-6 rounded-2xl flex flex-col justify-between shadow-glass">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                Conversion Funnel Velocity
              </h3>
              <div className="space-y-4 my-6">
                {funnelBars.map((tier) => (
                  <div key={tier.label} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-400">{tier.label}</span>
                      <span className="text-white font-bold">{tier.val}</span>
                    </div>
                    <div className="h-3 w-full bg-obsidian-900 rounded-full overflow-hidden">
                      <div className={`h-full bg-gradient-to-r ${tier.c} ${tier.w} rounded-full`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-2 bg-obsidian-800 border border-obsidian-700 p-6 rounded-2xl flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-4">
                  Pipeline Distribution Heatmap
                </h3>
                {data.zipHeatmap.length > 0 ? (
                  <div className="space-y-2 overflow-x-auto">
                    <div className="grid grid-cols-7 gap-2 min-w-[520px] text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      <span>Market</span>
                      {VERTICALS.map((v) => (
                        <span key={v} className="text-center">
                          {v}
                        </span>
                      ))}
                    </div>
                    {data.zipHeatmap.slice(0, 8).map((row) => (
                      <div key={row.zip} className="grid grid-cols-7 gap-2 min-w-[520px] items-center">
                        <span className="text-xs font-semibold truncate" title={row.label}>
                          {row.label}
                          <span className="block text-[10px] text-slate-500 font-normal">{row.zip}</span>
                        </span>
                        {VERTICALS.map((v) => {
                          const n = row[v] ?? 0;
                          return (
                            <div
                              key={v}
                              className={`h-10 rounded-xl flex items-center justify-center text-xs font-bold transition-all hover:scale-105 ${heatClass(n, maxHeat)}`}
                              title={`${row.label} · ${v}: ${n}`}
                            >
                              {n || '·'}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-6 gap-2">
                    {Array.from({ length: 24 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-12 rounded-xl transition-all ${
                          i % 5 === 0
                            ? 'bg-amethyst-500 shadow-glass border border-amethyst-300/30'
                            : i % 3 === 0
                              ? 'bg-amethyst-700 border border-amethyst-500/20'
                              : i % 2 === 0
                                ? 'bg-obsidian-700'
                                : 'bg-obsidian-800 border border-obsidian-700/50'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center border-t border-obsidian-700 pt-4 mt-4 text-xs font-mono text-slate-400">
                <span>Low Velocity (Dark)</span>
                <span>High Conversions (Bright Amethyst)</span>
              </div>
            </div>
          </div>
        )}

        {activeNav === 1 && (
          <section className="bg-obsidian-800 border border-obsidian-700 rounded-2xl p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
                  <th className="pb-3">Slug</th>
                  <th className="pb-3">Business</th>
                  <th className="pb-3">ZIP</th>
                  <th className="pb-3">Portal</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOutreach.slice(0, 40).map((r) => (
                  <tr key={r.slug} className="border-t border-obsidian-700">
                    <td className="py-2 font-mono text-electric-pink text-xs">{r.slug}</td>
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-slate-400">{r.zip ?? '—'}</td>
                    <td className="py-2">
                      {r.previewUrl ? (
                        <a href={r.previewUrl} target="_blank" rel="noreferrer" className="text-amethyst-400 hover:underline">
                          open ↗
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeNav === 2 && (
          <section className="bg-obsidian-800 border border-obsidian-700 rounded-2xl p-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
                  <th className="pb-3">Business</th>
                  <th className="pb-3">ZIP</th>
                  <th className="pb-3">Recipient</th>
                  <th className="pb-3">Sent</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOutreach.map((r) => (
                  <tr key={`${r.slug}-out`} className="border-t border-obsidian-700">
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-slate-400">{r.zip ?? '—'}</td>
                    <td className="py-2 font-mono text-xs">{r.recipient ?? '—'}</td>
                    <td className="py-2 text-slate-500 text-xs">{fmtDate(r.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeNav === 3 && (
          <section className="bg-obsidian-800 border border-obsidian-700 rounded-2xl p-6 overflow-x-auto">
            <p className="text-sm text-slate-400 mb-4">
              Today {fmtMoney(data.todayRevenue)} · Webhook{' '}
              <code className="text-electric-pink text-xs">{data.links.stripeWebhook ?? '/api/v1/stripe/webhook'}</code>
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
                  <th className="pb-3">When</th>
                  <th className="pb-3">Amount</th>
                  <th className="pb-3">Reference</th>
                  <th className="pb-3">Email</th>
                </tr>
              </thead>
              <tbody>
                {(data.recentPayments.length ? data.recentPayments : [{ createdAt: null }]).map((p, i) => (
                  <tr key={p.id ?? i} className="border-t border-obsidian-700">
                    <td className="py-2 text-xs">{p.createdAt ? fmtDate(p.createdAt) : '—'}</td>
                    <td className="py-2">{p.amount != null ? fmtMoney(p.amount / 100) : 'No payments yet'}</td>
                    <td className="py-2 font-mono text-xs text-amethyst-300">
                      {p.businessId ? `${p.businessId}${p.tier ? ':' + p.tier : ''}` : '—'}
                    </td>
                    <td className="py-2">{p.customerEmail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeNav === 4 && (
          <section className="bg-obsidian-800 border border-obsidian-700 rounded-2xl p-6">
            <p className="text-sm text-slate-400 mb-4">Live activity stream · portal opens + checkout signals</p>
            <div className="space-y-2">
              {[...data.recentPayments.map((p) => ({
                tag: p.businessId ?? p.id,
                label: `Stripe $499 · ${fmtMoney((p.amount ?? 0) / 100)}`,
                meta: 'Mobile · Apple Pay / Card',
                at: p.createdAt,
              })), ...data.recentSessions.map((s) => ({
                tag: s.tag,
                label: s.business,
                meta: s.device ?? 'Outreach',
                at: s.timestamp,
              }))].slice(0, 20).map((row, i) => (
                <div key={`${row.tag}-${i}`} className="flex justify-between items-center py-2 border-b border-obsidian-700 text-sm">
                  <span className="font-mono text-electric-pink text-xs">{row.tag}</span>
                  <span className="flex-1 px-4 truncate">{row.label}</span>
                  <span className="text-slate-500 text-xs hidden md:inline">{row.meta}</span>
                  <span className="text-slate-500 text-xs">{fmtDate(row.at)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeNav === 0 && (
          <section className="bg-obsidian-800 border border-obsidian-700 rounded-2xl p-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-4">Recent User Sessions</h3>
            <div className="space-y-2">
              {[...data.recentPayments.map((p) => ({
                tag: p.businessId ?? p.id,
                business: p.businessId ?? 'checkout',
                device: 'Apple Pay / Card',
                duration: fmtMoney((p.amount ?? 0) / 100),
                timestamp: p.createdAt,
              })), ...data.recentSessions].slice(0, 15).map((s, i) => (
                <div key={`${s.tag}-${i}`} className="grid grid-cols-2 md:grid-cols-5 gap-2 py-2 border-b border-obsidian-700 text-xs">
                  <span className="font-mono text-electric-pink">{s.tag ?? s.business}</span>
                  <span className="truncate">{s.business}</span>
                  <span className="text-slate-500">{s.device ?? '—'}</span>
                  <span>{s.duration ?? '—'}</span>
                  <span className="text-slate-500">{fmtDate(s.timestamp)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}