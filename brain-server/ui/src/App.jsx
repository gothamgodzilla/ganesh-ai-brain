import React, { useCallback, useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import GaneshGuruConsole from './GaneshGuruConsole.jsx';

const fetchOpts = { credentials: 'include' };

export default function App() {
  const [payload, setPayload] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashRes, healthRes] = await Promise.all([
        fetch('/api/dashboard', fetchOpts),
        fetch('/api/health', fetchOpts),
      ]);
      if (dashRes.status === 401) {
        throw new Error('Session expired — reload /brain and sign in with your access token');
      }
      if (!dashRes.ok) throw new Error(`Dashboard HTTP ${dashRes.status}`);
      setPayload(await dashRes.json());
      setHealth(healthRes.ok ? await healthRes.json() : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  let content;
  if (error) {
    content = (
      <div className="min-h-screen bg-obsidian-900 flex items-center justify-center p-8">
        <div className="max-w-md bg-obsidian-800 border border-rose-500/40 rounded-2xl p-6 text-center">
          <p className="text-rose-400 font-semibold mb-2">Dashboard unavailable</p>
          <p className="text-slate-400 text-sm">{error}</p>
          <a
            href="/brain"
            className="inline-block mt-4 px-4 py-2 rounded-xl bg-amethyst-500/20 border border-amethyst-500/30 text-amethyst-300 text-sm"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  } else {
    content = (
      <GaneshGuruConsole payload={payload} health={health} onRefresh={load} loading={loading} />
    );
  }

  return (
    <>
      {content}
      <Analytics />
      <SpeedInsights />
    </>
  );
}