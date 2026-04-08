'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { MetricCard } from '@/components/ui/metric-card';
import { ChartWrapper, ChartTooltip, ChartAxisTick, ChartYAxisTick, CHART_COLORS, CHART_DEFAULTS, CHART_ANIMATION } from '@/components/ui/chart-wrapper';
import { DataTable, Column } from '@/components/ui/data-table';
import { useFilter } from '@/lib/filter-context';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TokenBudgetWindow {
  used: number;
  budget: number;
  remaining: number;
}

interface LiveUsage {
  ts: string;
  fiveHour: number;
  sevenDay: number;
  overage: number;
  fiveHourResetsAt: string;
  sevenDayResetsAt: string;
  source: string;
  tokenBudget?: {
    fiveHour: TokenBudgetWindow;
    sevenDay: TokenBudgetWindow;
  };
}

interface CostEntry {
  timestamp: string;
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

interface TokenLogEntry {
  timestamp: string;
  agent: string;
  task: string;
  category: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  five_hour_pct: number;
  seven_day_pct: number;
  tool_calls: number;
}

interface ClaudeCodeStatusData {
  active: boolean;
  sessions: number;
  lastActivity: string | null;
}

interface ActivityData {
  daily: Record<string, { messages: number; sessions: number; tokens: number }>;
  hourly: Record<string, number>;
  streak?: { current: number; longest: number };
}

interface TableRow extends Record<string, unknown> {
  id: string;
  agent: string;
  task: string;
  model: string;
  tokens: number;
  cost: string;
  time: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCountdown(resetsAt: string): string {
  if (!resetsAt) return '—';
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return 'RESETTING';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (h > 0) return `RESETS IN ${h}H ${m}M`;
  if (m > 0) return `RESETS IN ${m}M ${s}S`;
  return `RESETS IN ${s}S`;
}

function getRateLevelColor(pct: number): string {
  if (pct > 85) return '#D71921';
  if (pct > 60) return '#D4A843';
  return '#4A9E5C';
}

function getRateLevelVariant(pct: number): 'live' | 'amber' | 'red' {
  if (pct > 85) return 'red';
  if (pct > 60) return 'amber';
  return 'live';
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function isToday(ts: string): boolean {
  return ts.startsWith(todayKey());
}

function isLast24h(ts: string): boolean {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) && Date.now() - t < 86_400_000;
}

function getLast7Days(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${m}/${d}`;
}

function formatCost(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatModel(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return model.slice(0, 10);
}

function relativeTime(ts: string): string {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const AGENT_COLORS: Record<string, string> = {
  bento: '#4ECDC4',
  enzo: '#D71921',
  jarvis: '#D4A843',
  parent: '#5B9BF6',
};

function agentColor(name: string): string {
  const key = name.toLowerCase();
  for (const [k, c] of Object.entries(AGENT_COLORS)) {
    if (key.includes(k)) return c;
  }
  return '#666666';
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-nothing bg-nothing-surface2 animate-pulse ${className}`}
    />
  );
}

// ── Rate Limit Panel ───────────────────────────────────────────────────────────

function formatTokenCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function RateLimitPanel({
  label,
  pct,
  resetsAt,
  overagePct,
  budget,
  delay,
}: {
  label: string;
  pct: number;
  resetsAt: string;
  overagePct?: number;
  budget?: TokenBudgetWindow;
  delay?: number;
}) {
  const [countdown, setCountdown] = useState(formatCountdown(resetsAt));
  const color = getRateLevelColor(pct);
  const badgeVariant = getRateLevelVariant(pct);

  useEffect(() => {
    const id = setInterval(() => setCountdown(formatCountdown(resetsAt)), 1000);
    return () => clearInterval(id);
  }, [resetsAt]);

  return (
    <Card variant="accent" accentColor={color} delay={delay ?? 0}>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="live" showDot>LIVE</Badge>
          <Badge variant={badgeVariant}>{countdown}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Big percentage */}
        <div className="flex items-end gap-3 mb-4">
          <span
            className="font-mono font-bold leading-none"
            style={{ fontSize: 40, color }}
          >
            {pct.toFixed(0)}
          </span>
          <span className="font-mono text-lg text-nothing-text-dim mb-1">%</span>
          <span className="font-mono text-[10px] text-nothing-text-muted mb-2 uppercase tracking-wider">
            of limit used
          </span>
        </div>

        {/* Main bar */}
        <ProgressBar value={pct} size="lg" variant="auto" delay={0.1} />

        {/* Token budget breakdown */}
        {budget && budget.budget > 0 && (
          <div className="mt-3 flex items-center gap-4 font-mono text-[10px] tracking-wider">
            <div>
              <span className="text-nothing-text-muted">USED </span>
              <span className="text-nothing-text">{formatTokenCount(budget.used)}</span>
            </div>
            <div>
              <span className="text-nothing-text-muted">REMAINING </span>
              <span style={{ color }}>{formatTokenCount(budget.remaining)}</span>
            </div>
            <div>
              <span className="text-nothing-text-muted">BUDGET </span>
              <span className="text-nothing-text-dim">{formatTokenCount(budget.budget)}</span>
            </div>
          </div>
        )}

        {/* Overage sub-bar */}
        {overagePct !== undefined && (
          <div className="mt-4">
            <ProgressBar
              value={overagePct}
              size="sm"
              variant="blue"
              label="SONNET WEEKLY"
              showLabel
              delay={0.2}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Donut center label ─────────────────────────────────────────────────────────

function DonutCenterLabel({
  cx,
  cy,
  total,
}: {
  cx?: number;
  cy?: number;
  total: number;
}) {
  return (
    <text
      x={cx}
      y={cy}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="var(--nothing-text)"
      fontFamily="'Space Mono', monospace"
    >
      <tspan x={cx} dy="-8" fontSize={18} fontWeight="bold">
        ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </tspan>
      <tspan x={cx} dy={18} fontSize={9} fill="var(--nothing-text-muted)">
        TOTAL
      </tspan>
    </text>
  );
}

// ── Claude Code Status Card ────────────────────────────────────────────────────

function ClaudeCodeStatusCard({ status }: { status: ClaudeCodeStatusData | null }) {
  const active = status?.active ?? false;
  const dotColor = active ? 'var(--nothing-green)' : 'var(--nothing-text-muted)';
  const label = active ? 'ACTIVE' : 'INACTIVE';

  return (
    <div
      className="rounded-nothing border border-nothing-border bg-nothing-surface p-4 h-full flex flex-col justify-between"
      style={{ minHeight: 96 }}
    >
      <span
        className="font-mono text-[9px] uppercase tracking-[0.15em] text-nothing-text-dim"
      >
        Claude Code
      </span>
      <div className="flex items-center gap-2 mt-2">
        {/* Pulsing dot */}
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {active && (
            <motion.span
              className="absolute inline-flex h-full w-full rounded-full"
              style={{ backgroundColor: dotColor, opacity: 0.6 }}
              animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          <span
            className="relative inline-flex rounded-full h-2.5 w-2.5"
            style={{ backgroundColor: dotColor }}
          />
        </span>
        <span
          className="font-mono font-bold text-lg leading-none"
          style={{ color: dotColor }}
        >
          {label}
        </span>
      </div>
      <span
        className="font-mono text-[9px] text-nothing-text-dim mt-2 block"
      >
        {status
          ? active
            ? status.lastActivity
              ? `LAST: ${relativeTime(status.lastActivity)}`
              : 'RUNNING'
            : status.lastActivity
            ? `LAST: ${relativeTime(status.lastActivity)}`
            : 'NO RECENT SESSIONS'
          : '—'}
      </span>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const { timeFilter, getFilterParams } = useFilter();
  const [live, setLive] = useState<LiveUsage | null>(null);
  const [costs, setCosts] = useState<CostEntry[]>([]);
  const [agents, setAgents] = useState<TokenLogEntry[]>([]);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [ccStatus, setCcStatus] = useState<ClaudeCodeStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshRef = useRef<Date>(new Date());

  const fetchLive = useCallback(async () => {
    setRefreshing(true);
    try {
      const [liveRes, ccRes] = await Promise.all([
        fetch('/api/usage-live'),
        fetch('/api/cc-status'),
      ]);
      if (liveRes.ok) {
        setLive(await liveRes.json());
        lastRefreshRef.current = new Date();
      }
      if (ccRes.ok) setCcStatus(await ccRes.json());
    } catch {}
    finally {
      // Keep spinner visible briefly so the animation is perceptible
      setTimeout(() => setRefreshing(false), 600);
    }
  }, []);

  useEffect(() => {
    async function fetchAll() {
      try {
        const fp = getFilterParams();
        const [liveRes, costsRes, agentsRes, activityRes, ccStatusRes] = await Promise.all([
          fetch('/api/usage-live'),
          fetch(`/api/costs${fp}`),
          fetch(`/api/agents${fp}`),
          fetch(`/api/activity${fp}`),
          fetch('/api/cc-status'),
        ]);

        if (liveRes.ok) setLive(await liveRes.json());
        if (costsRes.ok) setCosts(await costsRes.json());
        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (activityRes.ok) setActivity(await activityRes.json());
        if (ccStatusRes.ok) setCcStatus(await ccStatusRes.json());
      } catch (e) {
        console.error('Failed to fetch overview data', e);
      } finally {
        setLoading(false);
      }
    }

    fetchAll();

    // Poll live every 30s
    const id = setInterval(fetchLive, 30_000);
    return () => clearInterval(id);
  }, [fetchLive, timeFilter, getFilterParams]);

  // ── Derived metrics ──────────────────────────────────────────────────────────

  // Use agents (token-log) as primary data source — already filtered by time range via API
  const FILTER_LABELS: Record<string, string> = { '1H': '1h', '24H': 'Today', '7D': '7d', '30D': '30d' };
  const filterLabel = FILTER_LABELS[timeFilter] || timeFilter;

  const filteredTokens = agents.reduce(
    (s, a) => s + (a.input_tokens ?? 0) + (a.output_tokens ?? 0),
    0,
  );
  const filteredCost = agents.reduce((s, a) => s + (a.cost_usd ?? 0), 0);

  const filteredSessions = Object.values(activity?.daily ?? {}).reduce(
    (s: number, d: any) => s + (d.sessions ?? 0), 0,
  );

  const activeAgents = new Set(agents.map((a) => a.agent)).size;

  // 7-day token chart data (from agent token-log)
  const last7Days = getLast7Days();
  const tokenChartData = last7Days.map((day) => {
    const dayAgents = agents.filter((a) => a.timestamp.startsWith(day));
    const tokens = dayAgents.reduce(
      (s, a) => s + (a.input_tokens ?? 0) + (a.output_tokens ?? 0),
      0,
    );
    return { date: shortDate(day), tokens };
  });

  // Cost by model donut data (from agent token-log)
  const modelCostMap: Record<string, number> = {};
  agents.forEach((a) => {
    const m = formatModel(a.model);
    modelCostMap[m] = (modelCostMap[m] ?? 0) + (a.cost_usd ?? 0);
  });
  const donutData = Object.entries(modelCostMap).map(([name, value]) => ({
    name,
    value: parseFloat(value.toFixed(4)),
  }));
  const totalCost = Object.values(modelCostMap).reduce((s, v) => s + v, 0);

  const MODEL_COLORS: Record<string, string> = {
    Opus: CHART_COLORS.blue,
    Sonnet: CHART_COLORS.purple,
    Haiku: CHART_COLORS.cyan,
  };

  // Recent agent activity table
  const recentActivity: TableRow[] = [...agents]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)
    .map((a, i) => ({
      id: `${a.timestamp}-${i}`,
      agent: a.agent,
      task: a.task,
      model: formatModel(a.model),
      tokens: (a.input_tokens ?? 0) + (a.output_tokens ?? 0),
      cost: `$${(a.cost_usd ?? 0).toFixed(4)}`,
      time: relativeTime(a.timestamp),
    }));

  const tableColumns: Column<TableRow>[] = [
    {
      key: 'agent',
      label: 'Agent',
      width: '100px',
      render: (_, row) => (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: agentColor(String(row.agent)) }}
          />
          <span>{String(row.agent)}</span>
        </span>
      ),
    },
    {
      key: 'task',
      label: 'Task',
      render: (v) => (
        <span className="text-nothing-text-secondary truncate block max-w-[220px]">
          {String(v ?? '—')}
        </span>
      ),
    },
    {
      key: 'model',
      label: 'Model',
      width: '80px',
      render: (v) => {
        const m = String(v ?? '');
        const color =
          m === 'Opus'
            ? CHART_COLORS.blue
            : m === 'Sonnet'
            ? CHART_COLORS.purple
            : CHART_COLORS.cyan;
        return <span style={{ color }}>{m}</span>;
      },
    },
    {
      key: 'tokens',
      label: 'Tokens',
      align: 'right',
      width: '90px',
      sortable: true,
      render: (v) => (
        <span>{Number(v).toLocaleString()}</span>
      ),
    },
    {
      key: 'cost',
      label: 'Cost',
      align: 'right',
      width: '80px',
    },
    {
      key: 'time',
      label: 'Time',
      align: 'right',
      width: '80px',
      render: (v) => (
        <span className="text-nothing-text-dim">{String(v)}</span>
      ),
    },
  ];

  // ── Loading skeleton ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-60" />
          <Skeleton className="h-60" />
        </div>
        <Skeleton className="h-56" />
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const container = {
    hidden: {},
    show: {
      transition: { staggerChildren: 0.07, delayChildren: 0.05 },
    },
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
  };

  // Tighter stagger for the 4-up metric card row
  const metricContainer = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
  };

  const metricItem = {
    hidden: { opacity: 0, y: 10, scale: 0.98 },
    show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="p-6 space-y-4"
    >
      {/* ── Rate Limit Panels ──────────────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="space-y-2">
        {/* Section header with live refresh indicator */}
        <div className="flex items-center justify-between px-0.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-nothing-text-dim">
            Rate Limits
          </span>
          <div className="flex items-center gap-2">
            <AnimatePresence>
              {refreshing && (
                <motion.span
                  key="spinner"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
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
              {/* Circular arrow icon inline SVG — no lucide dependency needed */}
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke={refreshing ? 'var(--nothing-green)' : 'var(--nothing-text-muted)'}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transition: 'stroke 0.3s' }}
              >
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </motion.div>
            <span className="font-mono text-[8px] text-nothing-text-dim">
              AUTO · 30S
            </span>
          </div>
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="grid grid-cols-2 gap-4">
        {live ? (
          <>
            <RateLimitPanel
              label="5-Hour Window"
              pct={live.fiveHour}
              resetsAt={live.fiveHourResetsAt}
              budget={live.tokenBudget?.fiveHour}
              delay={0}
            />
            <RateLimitPanel
              label="7-Day Window"
              pct={live.sevenDay}
              resetsAt={live.sevenDayResetsAt}
              overagePct={live.overage}
              budget={live.tokenBudget?.sevenDay}
              delay={0.05}
            />
          </>
        ) : (
          <>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </>
        )}
      </motion.div>

      {/* ── Key Metrics ────────────────────────────────────────────────────── */}
      <motion.div
        variants={metricContainer}
        initial="hidden"
        animate="show"
        className="grid grid-cols-4 gap-4"
      >
        <motion.div variants={metricItem}>
          <MetricCard
            label={`Sessions ${filterLabel}`}
            value={filteredSessions}
            accentColor={CHART_COLORS.blue}
          />
        </motion.div>
        <motion.div variants={metricItem}>
          <MetricCard
            label={`Tokens ${filterLabel}`}
            value={filteredTokens}
            accentColor={CHART_COLORS.green}
          />
        </motion.div>
        <motion.div variants={metricItem}>
          <MetricCard
            label={`Cost ${filterLabel}`}
            value={filteredCost}
            prefix="$"
            accentColor={CHART_COLORS.amber}
            formatValue={(v) => formatCost(v)}
          />
        </motion.div>
        <motion.div variants={metricItem}>
          <ClaudeCodeStatusCard status={ccStatus} />
        </motion.div>
      </motion.div>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="grid grid-cols-2 gap-4">
        {/* Token Usage 7-day area chart */}
        <Card>
          <CardHeader>
            <CardTitle>Token Usage — 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartWrapper height={200}>
              <AreaChart data={tokenChartData}>
                <defs>
                  <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.blue} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.blue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={<ChartAxisTick />}
                  axisLine={{ stroke: CHART_DEFAULTS.axisColor }}
                  tickLine={false}
                />
                <YAxis
                  tick={<ChartYAxisTick />}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) =>
                    v >= 1_000_000
                      ? `${(v / 1_000_000).toFixed(1)}M`
                      : v >= 1_000
                      ? `${(v / 1_000).toFixed(0)}K`
                      : String(v)
                  }
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      formatter={(v) =>
                        typeof v === 'number' ? v.toLocaleString() : String(v)
                      }
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="tokens"
                  stroke={CHART_COLORS.blue}
                  strokeWidth={2}
                  fill="url(#tokenGradient)"
                  name="Tokens"
                  {...CHART_ANIMATION.line}
                />
              </AreaChart>
            </ChartWrapper>
          </CardContent>
        </Card>

        {/* Cost by model donut */}
        <Card>
          <CardHeader>
            <CardTitle>Cost by Model</CardTitle>
            <span className="font-mono text-[9px] text-nothing-text-dim">
              All time
            </span>
          </CardHeader>
          <CardContent>
            <ChartWrapper height={200}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                  labelLine={false}
                  {...CHART_ANIMATION.pie}
                >
                  {donutData.map((entry, i) => (
                    <Cell
                      key={entry.name}
                      fill={MODEL_COLORS[entry.name] ?? CHART_COLORS.muted}
                    />
                  ))}
                  <DonutCenterLabel total={totalCost} />
                </Pie>
                <Tooltip
                  content={
                    <ChartTooltip
                      formatter={(v) =>
                        typeof v === 'number' ? `$${v.toFixed(4)}` : String(v)
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
                        color: 'var(--nothing-text-muted)',
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
              </PieChart>
            </ChartWrapper>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Recent Agent Activity ──────────────────────────────────────────── */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Recent Agent Activity</CardTitle>
            <Badge variant="estimated">Last 10 entries</Badge>
          </CardHeader>
          <DataTable
            columns={tableColumns}
            data={recentActivity}
            rowKey="id"
            emptyMessage="No agent activity logged yet"
          />
        </Card>
      </motion.div>
    </motion.div>
  );
}
