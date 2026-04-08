'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Nothing UI tokens ──────────────────────────────────────────────────────
const DARK = {
  bg: '#000000', surface: '#111111', border: '#222222', border2: '#333333',
  text: '#E8E8E8', muted: '#999999', dim: '#666666', faint: '#444444',
};
const LIGHT = {
  bg: '#FFFFFF', surface: '#F5F5F5', border: '#E0E0E0', border2: '#CCCCCC',
  text: '#1A1A1A', muted: '#666666', dim: '#999999', faint: '#BBBBBB',
};
const ACCENT = { green: '#4A9E5C', amber: '#D4A843', red: '#D71921', blue: '#5B9BF6' };

function pctColor(pct: number) {
  if (pct > 85) return ACCENT.red;
  if (pct > 60) return ACCENT.amber;
  return ACCENT.green;
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

// ── Bar component ──────────────────────────────────────────────────────────
function UsageBar({ label, pct, color, remaining, t }: {
  label: string; pct: number; color: string; remaining?: number; t: typeof DARK;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
        <span style={{ color: t.dim, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>{label}</span>
        <span style={{ color, fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct)}%</span>
      </div>
      <div style={{ height: 3, borderRadius: 1.5, backgroundColor: t.border }}>
        <div style={{ height: '100%', borderRadius: 1.5, backgroundColor: color, width: `${Math.min(pct, 100)}%`, transition: 'width 0.5s ease' }} />
      </div>
      {remaining !== undefined && remaining > 0 && (
        <div style={{ textAlign: 'right', marginTop: 2 }}>
          <span style={{ color: t.faint, fontSize: 8 }}>{formatTokens(remaining)} remaining</span>
        </div>
      )}
    </div>
  );
}

// ── Chart bucketing ────────────────────────────────────────────────────────
interface AgentEntry { timestamp?: string; input_tokens?: number; output_tokens?: number; cached_tokens?: number; model?: string; cost_usd?: number; }

function buildBuckets(entries: AgentEntry[]) {
  const now = Date.now();
  const fiveH = 5 * 60 * 60 * 1000;
  const count = 30; // 10-min buckets
  const ms = fiveH / count;
  const buckets = Array.from({ length: count }, (_, i) => ({
    time: new Date(now - fiveH + i * ms + ms / 2).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    input: 0, output: 0, cached: 0,
  }));
  for (const e of entries) {
    if (!e.timestamp) continue;
    const ts = new Date(e.timestamp).getTime();
    if (ts < now - fiveH || ts > now) continue;
    const idx = Math.min(Math.floor((ts - (now - fiveH)) / ms), count - 1);
    buckets[idx].input += e.input_tokens ?? 0;
    buckets[idx].output += e.output_tokens ?? 0;
    buckets[idx].cached += (e.cached_tokens ?? 0) / 10;
  }
  return buckets;
}

// ── Mini chart ─────────────────────────────────────────────────────────────
function MiniChart({ buckets, t }: { buckets: ReturnType<typeof buildBuckets>; t: typeof DARK }) {
  const max = Math.max(1, ...buckets.map(b => b.input + b.output + b.cached));
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        {[{ c: ACCENT.green, l: 'In' }, { c: ACCENT.amber, l: 'Out' }, { c: ACCENT.blue, l: 'Cache' }].map(({ c, l }) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c }} />
            <span style={{ color: t.faint, fontSize: 7 }}>{l}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', height: 50, gap: 1, borderBottom: `1px solid ${t.border}`, paddingBottom: 2 }}>
        {buckets.map((b, i) => {
          const total = b.input + b.output + b.cached;
          if (total === 0) return <div key={i} style={{ flex: 1, height: 1, backgroundColor: t.border }} />;
          const h = (total / max) * 100;
          const cH = (b.cached / total) * 100;
          const iH = (b.input / total) * 100;
          return (
            <div key={i} style={{ flex: 1, height: `${h}%`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minWidth: 1 }}>
              {b.output > 0 && <div style={{ height: `${100 - cH - iH}%`, backgroundColor: ACCENT.amber, borderRadius: '1px 1px 0 0' }} />}
              {b.input > 0 && <div style={{ height: `${iH}%`, backgroundColor: ACCENT.green }} />}
              {b.cached > 0 && <div style={{ height: `${cH}%`, backgroundColor: ACCENT.blue, opacity: 0.6 }} />}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        {[0, 10, 20, 29].map(i => (
          <span key={i} style={{ color: t.faint, fontSize: 7 }}>{buckets[i]?.time ?? ''}</span>
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function MenubarPage() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [cost, setCost] = useState(0);
  const [topModel, setTopModel] = useState('');
  const [chartBuckets, setChartBuckets] = useState<ReturnType<typeof buildBuckets>>([]);
  const [lastRefresh, setLastRefresh] = useState('');
  const mountedRef = useRef(true);

  // Sync theme with app
  useEffect(() => {
    const stored = localStorage.getItem('claude-dashboard-theme');
    if (stored === 'light') setTheme('light');
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'claude-dashboard-theme') setTheme(e.newValue === 'light' ? 'light' : 'dark');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const t = theme === 'dark' ? DARK : LIGHT;

  const fetchAll = useCallback(async () => {
    try {
      const [liveRes, agentsRes, chartRes] = await Promise.all([
        fetch('/api/usage-live'),
        fetch('/api/agents?hours=24'),
        fetch('/api/agents?hours=5'),
      ]);
      if (!mountedRef.current) return;

      if (liveRes.ok) setData(await liveRes.json());

      if (agentsRes.ok) {
        const entries: AgentEntry[] = await agentsRes.json();
        const today = new Date().toISOString().slice(0, 10);
        setCost(entries.filter(e => e.timestamp?.startsWith(today)).reduce((s, e) => s + (e.cost_usd ?? 0), 0));
        // Top model by token count
        const models: Record<string, number> = {};
        for (const e of entries) {
          if (e.model) models[e.model] = (models[e.model] ?? 0) + (e.input_tokens ?? 0) + (e.output_tokens ?? 0);
        }
        const top = Object.entries(models).sort((a, b) => b[1] - a[1])[0];
        setTopModel(top ? top[0].replace(/^claude-/, '').replace(/-\d{8}$/, '') : '');
      }

      if (chartRes.ok) {
        const entries: AgentEntry[] = await chartRes.json();
        setChartBuckets(buildBuckets(entries));
      }

      setLastRefresh(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    const t = setInterval(fetchAll, 60_000);
    return () => { mountedRef.current = false; clearInterval(t); };
  }, [fetchAll]);

  const openDashboard = () => {
    if ((window as Record<string, unknown>).electronAPI) {
      (window as Record<string, unknown> & { electronAPI: { invoke: (ch: string) => void } }).electronAPI.invoke('menubar:openDashboard');
    } else {
      window.open('/', '_blank');
    }
  };

  const d = data as Record<string, unknown> | null;
  const fiveHour = Number(d?.fiveHour ?? 0);
  const sevenDay = Number(d?.sevenDay ?? 0);
  const overage = Number(d?.overage ?? 0);
  const tb = d?.tokenBudget as Record<string, Record<string, number>> | undefined;
  const source = String(d?.source ?? 'claude').toUpperCase();

  return (
    <div style={{
      padding: '12px 14px 10px',
      color: t.text,
      fontFamily: "'Space Mono', monospace",
      backgroundColor: t.bg,
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      WebkitFontSmoothing: 'antialiased',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${t.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: data ? ACCENT.green : t.faint, boxShadow: data ? `0 0 4px ${ACCENT.green}40` : 'none' }} />
          <span style={{ fontSize: 9, color: t.dim, letterSpacing: '0.12em' }}>CLAUDE USAGE</span>
        </div>
        <span style={{ fontSize: 8, color: t.faint }}>{lastRefresh}</span>
      </div>

      {!data ? (
        <div style={{ color: t.faint, fontSize: 10, textAlign: 'center', padding: '30px 0' }}>Connecting...</div>
      ) : (
        <>
          {/* Usage bars */}
          <UsageBar label="5-Hour Window" pct={fiveHour} color={pctColor(fiveHour)} remaining={tb?.fiveHour?.remaining} t={t} />
          <UsageBar label="7-Day Window" pct={sevenDay} color={pctColor(sevenDay)} remaining={tb?.sevenDay?.remaining} t={t} />
          {overage > 0 && <UsageBar label="Sonnet Weekly" pct={overage} color={ACCENT.blue} remaining={tb?.sonnet?.remaining} t={t} />}

          {/* Separator */}
          <div style={{ borderTop: `1px solid ${t.border}`, margin: '4px 0 8px' }} />

          {/* Chart */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: t.dim, fontSize: 8, letterSpacing: '0.1em' }}>TOKEN USAGE (5H)</span>
            <div style={{ marginTop: 4 }}>
              <MiniChart buckets={chartBuckets.length > 0 ? chartBuckets : buildBuckets([])} t={t} />
            </div>
          </div>

          {/* Bottom row */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <div style={{ flex: 1, backgroundColor: t.surface, border: `1px solid ${t.border}`, borderRadius: 6, padding: '6px 8px' }}>
              <div style={{ color: t.faint, fontSize: 7, letterSpacing: '0.1em', marginBottom: 2 }}>TODAY</div>
              <div style={{ color: ACCENT.amber, fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>${cost.toFixed(2)}</div>
            </div>
            <div style={{ flex: 1, backgroundColor: t.surface, border: `1px solid ${t.border}`, borderRadius: 6, padding: '6px 8px', overflow: 'hidden' }}>
              <div style={{ color: t.faint, fontSize: 7, letterSpacing: '0.1em', marginBottom: 2 }}>TOP MODEL</div>
              <div style={{ color: ACCENT.blue, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{topModel || '—'}</div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${t.border}`, paddingTop: 6, marginTop: 'auto' }}>
            <span style={{ color: t.faint, fontSize: 7, letterSpacing: '0.08em' }}>{source}</span>
            <button
              onClick={openDashboard}
              style={{
                background: 'none', border: `1px solid ${t.border}`, borderRadius: 4,
                color: t.dim, fontSize: 8, padding: '3px 8px', cursor: 'pointer',
                letterSpacing: '0.06em', fontFamily: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = t.border2; e.currentTarget.style.color = t.muted; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.dim; }}
            >
              OPEN DASHBOARD
            </button>
          </div>
        </>
      )}
    </div>
  );
}
