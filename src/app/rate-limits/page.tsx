'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ChartWrapper,
  ChartTooltip,
  ChartAxisTick,
  ChartYAxisTick,
  CHART_COLORS,
  CHART_DEFAULTS,
  CHART_ANIMATION,
} from '@/components/ui/chart-wrapper';
import { useFilter } from '@/lib/filter-context';

// ── Types ──────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  timestamp: string;
  five_hour_pct: number;
  seven_day_pct: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  agent: string;
  task: string;
}

interface Breakdown {
  input_total: number;
  output_total: number;
  cached_total: number;
  cost_total: number;
}

interface RateLimitData {
  current: {
    five_hour_pct: number;
    seven_day_pct: number;
    overage_pct: number;
    updated_at: string;
    source: string;
  };
  history: HistoryEntry[];
  breakdown: Breakdown;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pctColor(pct: number): string {
  if (pct > 80) return 'var(--nothing-red)';
  if (pct > 50) return 'var(--nothing-amber)';
  return 'var(--nothing-green)';
}

function pctBadgeVariant(pct: number): 'live' | 'amber' | 'red' {
  if (pct > 80) return 'red';
  if (pct > 50) return 'amber';
  return 'live';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function getLast5HoursSlots(): Date[] {
  const now = Date.now();
  return Array.from({ length: 11 }, (_, i) => new Date(now - (10 - i) * 30 * 60 * 1000));
}

function getLast7DaysSlots(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-nothing bg-nothing-surface2 animate-pulse ${className}`} />
  );
}

// ── Circular Gauge ─────────────────────────────────────────────────────────────

function CircularGauge({ pct, label, subtitle }: { pct: number; label: string; subtitle?: string }) {
  const color = pctColor(pct);
  const danger = pct > 90;
  const radius = 54;
  const stroke = 8;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - Math.min(pct, 100) / 100);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        {/* Pulsing ring when danger */}
        {danger && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ border: `2px solid ${color}` }}
            animate={{ opacity: [0.3, 0.8, 0.3], scale: [0.95, 1.05, 0.95] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <svg width="140" height="140" viewBox="0 0 140 140">
          {/* Track */}
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="var(--nothing-border2)"
            strokeWidth={stroke}
          />
          {/* Progress arc */}
          <motion.circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: dashoffset }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            transform="rotate(-90 70 70)"
            style={{ filter: `drop-shadow(0 0 6px ${color}40)` }}
          />
          {/* Center text */}
          <text
            x="70"
            y="62"
            textAnchor="middle"
            dominantBaseline="middle"
            fill={color}
            fontFamily="'Space Mono', monospace"
            fontSize="26"
            fontWeight="bold"
          >
            {Math.round(pct)}
          </text>
          <text
            x="70"
            y="80"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--nothing-text-muted)"
            fontFamily="'Space Mono', monospace"
            fontSize="9"
          >
            %
          </text>
        </svg>
      </div>
      <div className="text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-nothing-text">
          {label}
        </p>
        {subtitle && (
          <p className="font-mono text-[9px] text-nothing-text-muted mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// ── Token Breakdown Card ───────────────────────────────────────────────────────

function TokenBreakdownCard({
  label,
  value5h,
  value7d,
  color,
  delay,
}: {
  label: string;
  value5h: number | string;
  value7d: number | string;
  color: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: delay ?? 0, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card>
        <CardContent>
          <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-nothing-text-muted mb-3">
            {label}
          </p>
          <div className="space-y-2">
            <div>
              <p className="font-mono text-[8px] text-nothing-text-dim mb-0.5">5H WINDOW</p>
              <p className="font-mono text-base font-bold" style={{ color }}>
                {typeof value5h === 'number' ? formatTokens(value5h) : value5h}
              </p>
            </div>
            <div>
              <p className="font-mono text-[8px] text-nothing-text-dim mb-0.5">7D WINDOW</p>
              <p className="font-mono text-sm" style={{ color }}>
                {typeof value7d === 'number' ? formatTokens(value7d) : value7d}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Animation variants ─────────────────────────────────────────────────────────

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
};

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function RateLimitsPage() {
  const { timeFilter, getFilterParams } = useFilter();
  const [data, setData] = useState<RateLimitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'5h' | '7d'>('5h');
  const lastRefreshRef = useRef<Date>(new Date());

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch(`/api/rate-limits${getFilterParams()}`);
      if (res.ok) {
        setData(await res.json());
        lastRefreshRef.current = new Date();
      }
    } catch (e) {
      console.error('rate-limits fetch failed', e);
    } finally {
      if (showRefresh) setTimeout(() => setRefreshing(false), 600);
      setLoading(false);
    }
  }, [getFilterParams]);

  useEffect(() => {
    fetchData();
    const id = setInterval(() => fetchData(true), 30_000);
    return () => clearInterval(id);
  }, [fetchData, timeFilter]);

  // ── Derived data ─────────────────────────────────────────────────────────────

  const history = data?.history ?? [];
  const current = data?.current;
  const breakdown = data?.breakdown ?? { input_total: 0, output_total: 0, cached_total: 0, cost_total: 0 };

  const fivePct = current?.five_hour_pct ?? 0;
  const sevenPct = current?.seven_day_pct ?? 0;
  const overagePct = current?.overage_pct ?? 0;

  // 5h window chart — last 5h in 30-min slots
  const now = Date.now();
  const fiveHourSlots = getLast5HoursSlots();
  const fiveHourChartData = fiveHourSlots.map((slot) => {
    const slotEnd = slot.getTime();
    const slotStart = slotEnd - 30 * 60 * 1000;
    const entries = history.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return t >= slotStart && t < slotEnd;
    });
    return {
      time: shortTime(slot.toISOString()),
      input: entries.reduce((s, e) => s + e.input_tokens, 0),
      output: entries.reduce((s, e) => s + e.output_tokens, 0),
      cached: entries.reduce((s, e) => s + e.cached_tokens, 0),
      total: entries.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0),
      pct: entries.length > 0 ? Math.max(...entries.map((e) => e.five_hour_pct)) : null,
    };
  });

  // 7d window chart — last 7 days
  const last7Days = getLast7DaysSlots();
  const sevenDayChartData = last7Days.map((day) => {
    const entries = history.filter((e) => e.timestamp.startsWith(day));
    return {
      date: shortDate(day + 'T00:00:00'),
      input: entries.reduce((s, e) => s + e.input_tokens, 0),
      output: entries.reduce((s, e) => s + e.output_tokens, 0),
      cached: entries.reduce((s, e) => s + e.cached_tokens, 0),
      total: entries.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0),
    };
  });

  // 30-day historical trend chart
  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d.toISOString().slice(0, 10);
  });
  const trendData = last30Days.map((day) => {
    const entries = history.filter((e) => e.timestamp.startsWith(day));
    const maxPct = entries.length > 0 ? Math.max(...entries.map((e) => e.five_hour_pct)) : 0;
    const hitLimit = maxPct >= 95;
    return {
      date: shortDate(day + 'T00:00:00'),
      tokens: entries.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0),
      maxPct,
      hitLimit: hitLimit ? maxPct : null,
    };
  });

  // Session capacity estimator
  const recentEntries = history.slice(-10);
  const avgTokensPerEntry =
    recentEntries.length > 0
      ? recentEntries.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0) / recentEntries.length
      : 0;

  // Estimate based on rate limit: 100% = some unknown absolute limit
  // Use the pct to estimate how many more "average entries" fit
  const remaining5hPct = Math.max(0, 100 - fivePct);
  const remaining7dPct = Math.max(0, 100 - sevenPct);
  const estimatedEntries5h = remaining5hPct > 0 && avgTokensPerEntry > 0 && fivePct > 0
    ? Math.floor((remaining5hPct / fivePct) * recentEntries.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0) / avgTokensPerEntry)
    : null;
  const estimatedEntries7d = remaining7dPct > 0 && avgTokensPerEntry > 0 && sevenPct > 0
    ? Math.floor((remaining7dPct / sevenPct) * recentEntries.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0) / avgTokensPerEntry)
    : null;

  // ── Loading skeleton ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
        </div>
        <div className="grid grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const activeChartData = activeTab === '5h' ? fiveHourChartData : sevenDayChartData;
  const activeXKey = activeTab === '5h' ? 'time' : 'date';

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="p-6 space-y-4"
    >
      {/* ── Section header ─────────────────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="flex items-center justify-between px-0.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-nothing-text-dim">
          Rate Limits
        </span>
        <div className="flex items-center gap-2">
          <AnimatePresence>
            {refreshing && (
              <motion.span
                key="spinner"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="font-mono text-[8px] text-nothing-text-dim uppercase tracking-wider"
              >
                Refreshing
              </motion.span>
            )}
          </AnimatePresence>
          <motion.div
            animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
            transition={refreshing ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
          >
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke={refreshing ? 'var(--nothing-green)' : 'var(--nothing-text-muted)'}
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </motion.div>
          <span className="font-mono text-[8px] text-nothing-text-dim">AUTO · 30S</span>
          {current?.updated_at && (
            <span className="font-mono text-[8px] text-nothing-text-dim">
              · {relativeTime(current.updated_at)}
            </span>
          )}
        </div>
      </motion.div>

      {/* ── 1. Live Status — Circular Gauges ──────────────────────────────── */}
      <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
        {/* 5h panel */}
        <Card variant="accent" accentColor={pctColor(fivePct)}>
          <CardHeader>
            <CardTitle>5-Hour Window</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="live" showDot>LIVE</Badge>
              <Badge variant={pctBadgeVariant(fivePct)}>
                {fivePct > 80 ? 'HIGH' : fivePct > 50 ? 'MODERATE' : 'NORMAL'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-2">
              <CircularGauge
                pct={fivePct}
                label="5-Hour Usage"
                subtitle={
                  remaining5hPct < 100
                    ? `~${remaining5hPct.toFixed(0)}% remaining capacity`
                    : 'No usage data'
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* 7d panel */}
        <Card variant="accent" accentColor={pctColor(sevenPct)}>
          <CardHeader>
            <CardTitle>7-Day Window</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="live" showDot>LIVE</Badge>
              <Badge variant={pctBadgeVariant(sevenPct)}>
                {sevenPct > 80 ? 'HIGH' : sevenPct > 50 ? 'MODERATE' : 'NORMAL'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-2">
              <CircularGauge
                pct={sevenPct}
                label="7-Day Usage"
                subtitle={
                  remaining7dPct < 100
                    ? `~${remaining7dPct.toFixed(0)}% remaining capacity`
                    : 'No usage data'
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Overage panel */}
        <Card variant="accent" accentColor={pctColor(overagePct)}>
          <CardHeader>
            <CardTitle>Sonnet Weekly</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="live" showDot>LIVE</Badge>
              <Badge variant={pctBadgeVariant(overagePct)}>
                {overagePct > 80 ? 'HIGH' : overagePct > 50 ? 'MODERATE' : 'NORMAL'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-2">
              <CircularGauge
                pct={overagePct}
                label="Sonnet Weekly"
                subtitle={overagePct > 0 ? `${overagePct.toFixed(1)}% of overage consumed` : 'No overage'}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── 2. Token Breakdown Cards ───────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="grid grid-cols-5 gap-3">
        <TokenBreakdownCard
          label="Input Tokens"
          value5h={recentEntries.reduce((s, e) => s + e.input_tokens, 0)}
          value7d={breakdown.input_total}
          color={CHART_COLORS.blue}
          delay={0}
        />
        <TokenBreakdownCard
          label="Output Tokens"
          value5h={recentEntries.reduce((s, e) => s + e.output_tokens, 0)}
          value7d={breakdown.output_total}
          color={CHART_COLORS.green}
          delay={0.05}
        />
        <TokenBreakdownCard
          label="Cached Tokens"
          value5h={recentEntries.reduce((s, e) => s + e.cached_tokens, 0)}
          value7d={breakdown.cached_total}
          color={CHART_COLORS.cyan}
          delay={0.1}
        />
        <TokenBreakdownCard
          label="Total Tokens"
          value5h={recentEntries.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0)}
          value7d={breakdown.input_total + breakdown.output_total}
          color={CHART_COLORS.purple}
          delay={0.15}
        />
        <TokenBreakdownCard
          label="Cost USD"
          value5h={`$${recentEntries.reduce((s, e) => s + e.cost_usd, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          value7d={`$${breakdown.cost_total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          color={CHART_COLORS.amber}
          delay={0.2}
        />
      </motion.div>

      {/* ── 3. Session Capacity Estimator ─────────────────────────────────── */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Session Capacity Estimator</CardTitle>
            <Badge variant="estimated">Based on recent entries</Badge>
          </CardHeader>
          <CardContent>
            {avgTokensPerEntry > 0 ? (
              <div className="grid grid-cols-2 gap-6">
                {/* 5h estimate */}
                <div className="space-y-2">
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-muted">
                    5-Hour Window
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span
                      className="font-mono text-3xl font-bold"
                      style={{ color: pctColor(fivePct) }}
                    >
                      {estimatedEntries5h !== null ? estimatedEntries5h : '—'}
                    </span>
                    <span className="font-mono text-[9px] text-nothing-text-muted">
                      est. entries remaining
                    </span>
                  </div>
                  <p className="font-mono text-[9px] text-nothing-text-dim leading-relaxed">
                    avg {formatTokens(Math.round(avgTokensPerEntry))} tokens/entry
                    {' × '}
                    {remaining5hPct.toFixed(0)}% remaining
                    {' = '}
                    ~{estimatedEntries5h ?? '?'} more messages
                  </p>
                </div>
                {/* 7d estimate */}
                <div className="space-y-2">
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-muted">
                    7-Day Window
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span
                      className="font-mono text-3xl font-bold"
                      style={{ color: pctColor(sevenPct) }}
                    >
                      {estimatedEntries7d !== null ? estimatedEntries7d : '—'}
                    </span>
                    <span className="font-mono text-[9px] text-nothing-text-muted">
                      est. entries remaining
                    </span>
                  </div>
                  <p className="font-mono text-[9px] text-nothing-text-dim leading-relaxed">
                    avg {formatTokens(Math.round(avgTokensPerEntry))} tokens/entry
                    {' × '}
                    {remaining7dPct.toFixed(0)}% remaining
                    {' = '}
                    ~{estimatedEntries7d ?? '?'} more messages
                  </p>
                </div>
              </div>
            ) : (
              <p className="font-mono text-[10px] text-nothing-text-muted">
                Not enough data to estimate. Log more agent entries to the token-log.
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── 4. Line Charts — Tabbed ────────────────────────────────────────── */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Token Usage Over Time</CardTitle>
            <div className="flex items-center gap-1">
              {(['5h', '7d'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="font-mono text-[8px] uppercase tracking-[0.12em] px-2 py-1 rounded-[4px] transition-colors"
                  style={{
                    backgroundColor: activeTab === tab ? 'var(--nothing-surface2)' : 'transparent',
                    color: activeTab === tab ? 'var(--nothing-text)' : 'var(--nothing-text-muted)',
                    border: `1px solid ${activeTab === tab ? 'var(--nothing-border2)' : 'transparent'}`,
                  }}
                >
                  {tab === '5h' ? '5-Hour' : '7-Day'}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <ChartWrapper height={240}>
              <AreaChart data={activeChartData}>
                <defs>
                  <linearGradient id="inputGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.blue} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={CHART_COLORS.blue} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="outputGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.green} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={CHART_COLORS.green} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="cachedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.cyan} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={CHART_COLORS.cyan} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART_DEFAULTS.gridColor} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey={activeXKey}
                  tick={<ChartAxisTick />}
                  axisLine={{ stroke: CHART_DEFAULTS.axisColor }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                {/* Left axis — input + output tokens */}
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  tick={<ChartYAxisTick />}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => formatTokens(v)}
                />
                {/* Right axis — cached tokens (secondary, visually muted) */}
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 9,
                    fill: 'var(--nothing-text-dim)',
                  }}
                  axisLine={false}
                  tickLine={{ stroke: 'var(--nothing-text-dim)', strokeDasharray: '2 3' }}
                  tickFormatter={(v: number) => formatTokens(v)}
                  width={52}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      formatter={(v) =>
                        typeof v === 'number' ? formatTokens(v) : String(v)
                      }
                    />
                  }
                />
                <Legend
                  formatter={(value: string) => (
                    <span
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 9,
                        color: value === 'Cached (right axis)'
                          ? 'var(--nothing-text-dim)'
                          : 'var(--nothing-text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                      }}
                    >
                      {value}
                    </span>
                  )}
                  iconType="circle"
                  iconSize={6}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="input"
                  stroke={CHART_COLORS.blue}
                  strokeWidth={1.5}
                  fill="url(#inputGrad)"
                  name="Input"
                  dot={false}
                  {...CHART_ANIMATION.line}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="output"
                  stroke={CHART_COLORS.green}
                  strokeWidth={1.5}
                  fill="url(#outputGrad)"
                  name="Output"
                  dot={false}
                  {...CHART_ANIMATION.line}
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="cached"
                  stroke={CHART_COLORS.cyan}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  fill="url(#cachedGrad)"
                  name="Cached (right axis)"
                  dot={false}
                  {...CHART_ANIMATION.line}
                />
                {/* 80% danger zone reference — shown as shading note */}
                <ReferenceLine
                  yAxisId="left"
                  y={0}
                  stroke="transparent"
                  label={{
                    value: '⚠ 80% LIMIT ZONE ABOVE',
                    position: 'insideTopRight',
                    fill: 'var(--nothing-text-dim)',
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 8,
                  }}
                />
              </AreaChart>
            </ChartWrapper>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── 5. Historical Trend — 30 days ─────────────────────────────────── */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>30-Day Usage Trend</CardTitle>
            <span className="font-mono text-[9px] text-nothing-text-dim">
              Tokens per session · Red dots = rate limit hit
            </span>
          </CardHeader>
          <CardContent>
            <ChartWrapper height={200}>
              <LineChart data={trendData}>
                <CartesianGrid stroke={CHART_DEFAULTS.gridColor} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={<ChartAxisTick />}
                  axisLine={{ stroke: CHART_DEFAULTS.axisColor }}
                  tickLine={false}
                  interval={4}
                />
                <YAxis
                  tick={<ChartYAxisTick />}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => formatTokens(v)}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      formatter={(v, name) => {
                        if (name === 'hitLimit') return `${v}% (LIMIT HIT)`;
                        return typeof v === 'number' ? formatTokens(v) : String(v);
                      }}
                    />
                  }
                />
                <Line
                  type="monotone"
                  dataKey="tokens"
                  stroke={CHART_COLORS.blue}
                  strokeWidth={2}
                  dot={false}
                  name="Tokens"
                  {...CHART_ANIMATION.line}
                />
                {/* Rate limit hit overlay — red dots */}
                <Line
                  type="monotone"
                  dataKey="hitLimit"
                  stroke={CHART_COLORS.red}
                  strokeWidth={0}
                  dot={{ fill: CHART_COLORS.red, r: 4, strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                  name="Limit Hit"
                  connectNulls={false}
                  {...CHART_ANIMATION.line}
                />
              </LineChart>
            </ChartWrapper>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
