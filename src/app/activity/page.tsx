'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  ComposedChart,
  Area,
  Line,
  CartesianGrid,
} from 'recharts';
import {
  eachDayOfInterval,
  subDays,
  format,
  getDay,
  startOfWeek,
  startOfDay,
  isAfter,
} from 'date-fns';
import { MetricCard } from '@/components/ui/metric-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  ChartWrapper,
  ChartTooltip,
  ChartAxisTick,
  ChartYAxisTick,
  CHART_COLORS,
  CHART_DEFAULTS,
} from '@/components/ui/chart-wrapper';
import { DataTable, Column } from '@/components/ui/data-table';
import { cn, safeParseDate } from '@/lib/utils';
import { useFilter } from '@/lib/filter-context';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayActivity {
  messages: number;
  sessions: number;
  tokens: number;
}

interface ActivityData {
  daily: Record<string, DayActivity>;
  hourly: Record<string, number>;
  streak: { current: number; longest: number };
}

interface CostEntry {
  timestamp: string;
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

interface AgentEntry {
  timestamp: string;
  agent: string;
  task: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  tool_calls: number;
}

interface HeatmapCell {
  date: string;
  count: number;
  weekIdx: number;
  dayOfWeek: number;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  date: string;
  count: number;
}

interface TableRow {
  id: string;
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost: number;
  source: 'costs' | 'agents';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RANGE_TIERS = [30, 60, 90, 180, 365] as const;
type RangeDays = (typeof RANGE_TIERS)[number];

const MODEL_COLORS: Record<string, string> = {
  'claude-opus': CHART_COLORS.blue,
  'claude-sonnet': CHART_COLORS.purple,
  'claude-haiku': CHART_COLORS.cyan,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function heatColor(count: number): string {
  if (count === 0) return 'var(--nothing-surface2)';
  if (count <= 5) return 'color-mix(in srgb, var(--nothing-green) 25%, var(--nothing-bg))';
  if (count <= 15) return 'color-mix(in srgb, var(--nothing-green) 50%, var(--nothing-bg))';
  if (count <= 30) return 'color-mix(in srgb, var(--nothing-green) 75%, var(--nothing-bg))';
  return 'var(--nothing-green)';
}

function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function getModelColor(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return MODEL_COLORS['claude-opus'];
  if (lower.includes('sonnet')) return MODEL_COLORS['claude-sonnet'];
  if (lower.includes('haiku')) return MODEL_COLORS['claude-haiku'];
  return CHART_COLORS.amber;
}

function shortModelName(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'Opus';
  if (lower.includes('sonnet')) return 'Sonnet';
  if (lower.includes('haiku')) return 'Haiku';
  return model.split('-').slice(-2).join('-');
}

function formatCost(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function autoSelectRange(daily: Record<string, DayActivity>): RangeDays {
  const keys = Object.keys(daily).filter((k) => (daily[k]?.messages ?? 0) > 0);
  if (keys.length === 0) return 30;
  keys.sort();
  const oldest = safeParseDate(keys[0]);
  if (!oldest) return 30;
  const diffDays = Math.ceil((Date.now() - oldest.getTime()) / (1000 * 60 * 60 * 24));
  for (const tier of RANGE_TIERS) {
    if (diffDays <= tier) return tier;
  }
  return 365;
}

function buildHeatmap(daily: Record<string, DayActivity>, rangeDays: RangeDays): HeatmapCell[] {
  const today = new Date();
  const start = subDays(today, rangeDays - 1);
  const weekStart = startOfWeek(start, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: today });
  return days.map((day) => {
    const key = format(day, 'yyyy-MM-dd');
    const dow = getDay(day);
    const dayOfWeek = dow === 0 ? 6 : dow - 1;
    const diffMs = day.getTime() - weekStart.getTime();
    const weekIdx = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    return { date: key, count: daily[key]?.messages ?? 0, weekIdx, dayOfWeek };
  });
}

function buildMonthLabels(cells: HeatmapCell[]): { label: string; weekIdx: number }[] {
  const seen = new Set<string>();
  const labels: { label: string; weekIdx: number }[] = [];
  for (const cell of cells) {
    const month = cell.date.slice(0, 7);
    if (!seen.has(month)) {
      seen.add(month);
      const pm = safeParseDate(month + '-01');
      labels.push({ label: pm ? format(pm, 'MMM') : month, weekIdx: cell.weekIdx });
    }
  }
  return labels;
}

function cellSizeForRange(rangeDays: RangeDays): { cell: number; gap: number } {
  if (rangeDays <= 30) return { cell: 16, gap: 3 };
  if (rangeDays <= 60) return { cell: 13, gap: 3 };
  if (rangeDays <= 90) return { cell: 11, gap: 2 };
  if (rangeDays <= 180) return { cell: 9, gap: 2 };
  return { cell: 7, gap: 1 };
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded bg-nothing-surface2 border border-nothing-border', className)} />
  );
}

// ─── Range tabs ───────────────────────────────────────────────────────────────

function RangeTabs({ active, onChange }: { active: RangeDays; onChange: (r: RangeDays) => void }) {
  return (
    <div className="flex items-center gap-1">
      {RANGE_TIERS.map((tier) => (
        <button
          key={tier}
          onClick={() => onChange(tier)}
          className={cn(
            'font-mono text-[9px] uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors',
            active === tier
              ? 'bg-nothing-surface2 border-nothing-border2 text-nothing-text'
              : 'bg-nothing-surface border-nothing-border text-nothing-text-muted hover:border-nothing-border2 hover:text-nothing-text',
          )}
        >
          {tier}D
        </button>
      ))}
    </div>
  );
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

const LEFT_PAD = 32;
const TOP_PAD = 20;

function ActivityHeatmap({ daily, rangeDays }: { daily: Record<string, DayActivity>; rangeDays: RangeDays }) {
  const { cell: CELL, gap: GAP } = cellSizeForRange(rangeDays);
  const STEP = CELL + GAP;
  const cells = useMemo(() => buildHeatmap(daily, rangeDays), [daily, rangeDays]);
  const monthLabels = useMemo(() => buildMonthLabels(cells), [cells]);
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, date: '', count: 0 });
  const maxWeek = useMemo(() => Math.max(...cells.map((c) => c.weekIdx)), [cells]);
  const totalWeeks = maxWeek + 1;
  const svgWidth = LEFT_PAD + totalWeeks * STEP;
  const svgHeight = TOP_PAD + 7 * STEP;
  const rx = Math.max(1, Math.round(CELL / 5));

  const handleMouseEnter = useCallback((e: React.MouseEvent<SVGRectElement>, cell: HeatmapCell) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ visible: true, x: rect.left + rect.width / 2, y: rect.top - 8, date: cell.date, count: cell.count });
  }, []);
  const handleMouseLeave = useCallback(() => setTooltip((t) => ({ ...t, visible: false })), []);

  const dayLabels = [{ label: 'Mon', row: 0 }, { label: 'Wed', row: 2 }, { label: 'Fri', row: 4 }];

  return (
    <div className="relative w-full overflow-x-auto">
      <svg width={svgWidth} height={svgHeight} className="overflow-visible" style={{ display: 'block', minWidth: svgWidth }}>
        {monthLabels.map(({ label, weekIdx }) => (
          <text key={label + weekIdx} x={LEFT_PAD + weekIdx * STEP} y={TOP_PAD - 6} fontSize={Math.max(7, CELL - 3)} fontFamily="'Space Mono', monospace" fill="var(--nothing-text-muted)">{label}</text>
        ))}
        {dayLabels.map(({ label, row }) => (
          <text key={label} x={LEFT_PAD - 4} y={TOP_PAD + row * STEP + CELL - 1} fontSize={Math.max(7, CELL - 3)} fontFamily="'Space Mono', monospace" fill="var(--nothing-text-muted)" textAnchor="end">{label}</text>
        ))}
        {cells.map((cell, i) => {
          const isToday = cell.date === todayKey;
          return (
            <motion.rect
              key={cell.date}
              x={LEFT_PAD + cell.weekIdx * STEP}
              y={TOP_PAD + cell.dayOfWeek * STEP}
              width={CELL} height={CELL} rx={rx} ry={rx}
              fill={isToday ? 'var(--nothing-blue)' : heatColor(cell.count)}
              stroke={isToday ? 'var(--nothing-blue)' : 'none'}
              strokeWidth={isToday ? 1 : 0}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ delay: i * 0.001, duration: 0.15 }}
              onMouseEnter={(e) => handleMouseEnter(e as unknown as React.MouseEvent<SVGRectElement>, cell)}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: 'default' }}
            />
          );
        })}
      </svg>
      <div className="flex items-center gap-2 mt-3">
        <span className="font-mono text-[9px] text-nothing-text-dim uppercase tracking-wider">Less</span>
        {[0, 3, 10, 20, 40].map((v) => (
          <div key={v} style={{ width: CELL, height: CELL, background: heatColor(v), borderRadius: rx }} />
        ))}
        <span className="font-mono text-[9px] text-nothing-text-dim uppercase tracking-wider">More</span>
      </div>
      {tooltip.visible && (
        <div className="fixed z-50 pointer-events-none" style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}>
          <div className="bg-nothing-surface border border-nothing-border2 rounded px-2 py-1.5 shadow-lg">
            <p className="font-mono text-[10px] text-nothing-text whitespace-nowrap">
              {(() => { const d = safeParseDate(tooltip.date); return d ? format(d, 'MMM d, yyyy') : tooltip.date; })()}
            </p>
            <p className="font-mono text-[10px] text-nothing-green">{tooltip.count} {tooltip.count === 1 ? 'message' : 'messages'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Hour bar chart ───────────────────────────────────────────────────────────

function HourDistribution({ hourly }: { hourly: Record<string, number> }) {
  const currentHour = new Date().getHours();
  const data = useMemo(
    () =>
      Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        label: hourLabel(h),
        count: hourly[String(h)] ?? 0,
        isCurrent: h === currentHour,
      })).filter((d) => d.count > 0 || d.isCurrent),
    [hourly, currentHour],
  );
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <XAxis dataKey="label" tick={<ChartAxisTick />} tickLine={false} axisLine={false} interval={2} />
        <YAxis tick={<ChartYAxisTick />} tickLine={false} axisLine={false} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload as (typeof data)[0];
            return (
              <div className="rounded-lg border border-nothing-border bg-nothing-surface p-2 shadow-lg">
                <p className="font-mono text-[10px] text-nothing-text">{d.label}</p>
                <p className="font-mono text-[10px] text-nothing-blue">{d.count} messages</p>
              </div>
            );
          }}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]} isAnimationActive animationBegin={200} animationDuration={600} animationEasing="ease-out">
          {data.map((d) => (
            <Cell
              key={d.hour}
              fill={d.isCurrent ? 'var(--nothing-green)' : d.count > maxCount * 0.4 ? 'var(--nothing-blue)' : 'var(--nothing-purple)'}
              opacity={d.isCurrent ? 1 : 0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.25, ease: 'easeOut' } }),
};

export default function ActivityCostsPage() {
  const { timeFilter, getFilterParams } = useFilter();
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [costs, setCosts] = useState<CostEntry[]>([]);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [rangeAutoSet, setRangeAutoSet] = useState(false);

  useEffect(() => {
    const fp = getFilterParams();
    Promise.all([
      fetch(`/api/activity${fp}`).then((r) => r.json()),
      fetch(`/api/costs${fp}`).then((r) => r.json()),
      fetch(`/api/agents${fp}`).then((r) => r.json()),
    ])
      .then(([act, costData, agentData]) => {
        setActivity(act);
        setCosts(Array.isArray(costData) ? costData : []);
        setAgents(Array.isArray(agentData) ? agentData : []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [timeFilter, getFilterParams]);

  useEffect(() => {
    if (activity && !rangeAutoSet) {
      setRangeDays(autoSelectRange(activity.daily ?? {}));
      setRangeAutoSet(true);
    }
  }, [activity, rangeAutoSet]);

  // ── Activity stats ────────────────────────────────────────────────────────

  const activityStats = useMemo(() => {
    if (!activity) return null;
    const daily = activity.daily ?? {};
    const days = Object.values(daily);
    const daysActive = days.filter((d) => d.messages > 0).length;
    const totalMessages = days.reduce((s, d) => s + d.messages, 0);
    return { daysActive, totalMessages };
  }, [activity]);

  // ── Cost stats ────────────────────────────────────────────────────────────

  const costStats = useMemo(() => {
    const now = new Date();
    const weekAgo = subDays(startOfDay(now), 7);
    const CACHED_TOKEN_SAVE_RATE = 0.0000027;
    let totalCost = 0;
    let weekCost = 0;
    let cacheSavings = 0;
    const sessionCosts: Record<string, number> = {};

    for (const e of costs) {
      totalCost += e.estimated_cost_usd;
      const ts = safeParseDate(e.timestamp);
      if (ts && isAfter(ts, weekAgo)) weekCost += e.estimated_cost_usd;
      sessionCosts[e.session_id] = (sessionCosts[e.session_id] ?? 0) + e.estimated_cost_usd;
    }
    for (const e of agents) {
      totalCost += e.cost_usd;
      const ts = safeParseDate(e.timestamp);
      if (ts && isAfter(ts, weekAgo)) weekCost += e.cost_usd;
      cacheSavings += (e.cached_tokens ?? 0) * CACHED_TOKEN_SAVE_RATE;
    }

    const sessionValues = Object.values(sessionCosts);
    const avgCostPerSession = sessionValues.length > 0
      ? sessionValues.reduce((a, b) => a + b, 0) / sessionValues.length
      : 0;

    return { totalCost, weekCost, cacheSavings, avgCostPerSession };
  }, [costs, agents]);

  // ── Model donut data ──────────────────────────────────────────────────────

  const modelData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of costs) map[e.model] = (map[e.model] ?? 0) + e.estimated_cost_usd;
    for (const e of agents) map[e.model] = (map[e.model] ?? 0) + (e.cost_usd ?? 0);
    const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([model, cost]) => ({
        model,
        displayName: shortModelName(model),
        cost: parseFloat(cost.toFixed(4)),
        pct: parseFloat(((cost / total) * 100).toFixed(1)),
        color: getModelColor(model),
      }));
  }, [costs, agents]);

  const modelTotal = modelData.reduce((a, b) => a + b.cost, 0);

  // ── Daily cost trend ──────────────────────────────────────────────────────

  const dailyTrendData = useMemo(() => {
    const today = startOfDay(new Date());
    const days: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = format(subDays(today, i), 'yyyy-MM-dd');
      days[d] = 0;
    }
    for (const e of costs) {
      const ts = safeParseDate(e.timestamp);
      const d = ts ? format(ts, 'yyyy-MM-dd') : '';
      if (d && d in days) days[d] += e.estimated_cost_usd;
    }
    for (const e of agents) {
      const ts = safeParseDate(e.timestamp);
      const d = ts ? format(ts, 'yyyy-MM-dd') : '';
      if (d && d in days) days[d] += e.cost_usd;
    }
    let running = 0;
    return Object.entries(days).map(([date, cost]) => {
      running += cost;
      const pd = safeParseDate(date);
      return { date: pd ? format(pd, 'MMM d') : date, cost: parseFloat(cost.toFixed(4)), running: parseFloat(running.toFixed(4)) };
    });
  }, [costs, agents]);

  // ── Table data ────────────────────────────────────────────────────────────

  const tableData = useMemo<TableRow[]>(() => {
    const rows: TableRow[] = [];
    for (const e of costs) {
      rows.push({ id: `${e.timestamp}-${e.session_id}-${e.model}`, date: e.timestamp, model: e.model, input_tokens: e.input_tokens, output_tokens: e.output_tokens, cached_tokens: 0, cost: e.estimated_cost_usd, source: 'costs' });
    }
    for (const e of agents) {
      rows.push({ id: `${e.timestamp}-${e.agent}-${e.model}`, date: e.timestamp, model: e.model, input_tokens: e.input_tokens, output_tokens: e.output_tokens, cached_tokens: e.cached_tokens ?? 0, cost: e.cost_usd, source: 'agents' });
    }
    return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [costs, agents]);

  const tableColumns: Column<TableRow>[] = [
    {
      key: 'date', label: 'Date', sortable: true,
      render: (v) => <span className="text-nothing-text-secondary">{(() => { const d = safeParseDate(String(v)); return d ? format(d, 'MMM d, HH:mm') : String(v); })()}</span>,
      width: '130px',
    },
    {
      key: 'model', label: 'Model', sortable: true,
      render: (v) => {
        const color = getModelColor(String(v));
        return <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ color, backgroundColor: `${color}18` }}>{shortModelName(String(v))}</span>;
      },
    },
    { key: 'input_tokens', label: 'Input', sortable: true, align: 'right', render: (v) => (typeof v === 'number' ? v.toLocaleString() : '—') },
    { key: 'output_tokens', label: 'Output', sortable: true, align: 'right', render: (v) => (typeof v === 'number' ? v.toLocaleString() : '—') },
    {
      key: 'cached_tokens', label: 'Cached', sortable: true, align: 'right',
      render: (v) => typeof v === 'number' && v > 0
        ? <span className="text-nothing-green">{v.toLocaleString()}</span>
        : <span className="text-nothing-text-dim">—</span>,
    },
    {
      key: 'cost', label: 'Cost', sortable: true, align: 'right',
      render: (v) => <span className="text-nothing-text font-bold">${typeof v === 'number' ? v.toFixed(4) : '0.0000'}</span>,
    },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!activity) {
    return <div className="font-mono text-sm text-nothing-text-muted uppercase tracking-wider">Failed to load data.</div>;
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        <h1 className="font-mono text-xs uppercase tracking-[0.15em] text-nothing-text-muted">Activity &amp; Costs</h1>
        <p className="font-mono text-[9px] text-nothing-text-dim mt-0.5">
          Messages · Streaks · Spend · Model breakdown
        </p>
      </motion.div>

      {/* ── Row 1: KPI cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Total Messages"
          value={activityStats?.totalMessages ?? 0}
          accentColor={CHART_COLORS.blue}
          delay={0}
          subtitle="All-time messages"
        />
        <MetricCard
          label="Current Streak"
          value={activity.streak.current}
          suffix="days"
          accentColor={CHART_COLORS.green}
          delay={0.05}
          subtitle="Keep it going"
        />
        <MetricCard
          label="Total Cost"
          value={costStats.totalCost}
          prefix="$"
          accentColor={CHART_COLORS.purple}
          delay={0.1}
          formatValue={(v) => formatCost(v)}
        />
        <MetricCard
          label="Avg Cost / Session"
          value={costStats.avgCostPerSession}
          prefix="$"
          accentColor={CHART_COLORS.amber}
          delay={0.15}
          formatValue={(v) => formatCost(v)}
        />
      </div>

      {/* ── Row 2: Heatmap + Model donut ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Heatmap */}
        <motion.div custom={0} initial="hidden" animate="visible" variants={cardVariants}>
          <Card variant="default">
            <CardHeader>
              <CardTitle>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-nothing-text-muted">
                    Activity — Last {rangeDays} Days
                  </span>
                  <RangeTabs active={rangeDays} onChange={setRangeDays} />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-2">
              <ActivityHeatmap daily={activity.daily ?? {}} rangeDays={rangeDays} />
            </CardContent>
          </Card>
        </motion.div>

        {/* Cost by Model donut */}
        <motion.div custom={1} initial="hidden" animate="visible" variants={cardVariants}>
          <Card variant="default">
            <CardHeader>
              <CardTitle>
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-nothing-text-muted">Cost by Model</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {modelData.length === 0 ? (
                <div className="flex items-center justify-center h-48 font-mono text-[10px] text-nothing-text-dim">No model data available</div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={modelData} cx="50%" cy="50%"
                          innerRadius={60} outerRadius={90}
                          dataKey="cost" nameKey="displayName"
                          strokeWidth={2} stroke="var(--nothing-bg)" paddingAngle={2}
                        >
                          {modelData.map((entry, i) => <Cell key={i} fill={entry.color} opacity={0.9} />)}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0]?.payload as typeof modelData[0];
                            return (
                              <div className="bg-nothing-surface border border-nothing-border2 rounded-[6px] px-3 py-2 shadow-2xl">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                                  <span className="font-mono text-[9px] uppercase tracking-wider text-nothing-text-muted">{d.displayName}</span>
                                </div>
                                <p className="font-mono text-[13px] text-nothing-text font-bold">${d.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                <p className="font-mono text-[9px] text-nothing-text-dim">{d.pct}% of total</p>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2 min-w-[110px]">
                    {modelData.map((entry) => (
                      <div key={entry.model} className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: entry.color }} />
                        <div>
                          <p className="font-mono text-[9px] text-nothing-text-secondary">{entry.displayName}</p>
                          <p className="font-mono text-[9px] text-nothing-text">${entry.cost.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</p>
                          <p className="font-mono text-[8px] text-nothing-text-dim">{entry.pct}%</p>
                        </div>
                      </div>
                    ))}
                    <div className="border-t border-nothing-border pt-2">
                      <p className="font-mono text-[9px] text-nothing-text-muted">Total</p>
                      <p className="font-mono text-[11px] text-nothing-text font-bold">${modelTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Row 3: Hours of Day + Daily Cost trend ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Hours of Day */}
        <motion.div custom={2} initial="hidden" animate="visible" variants={cardVariants}>
          <Card variant="default">
            <CardHeader>
              <CardTitle>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-nothing-text-muted">Hour of Day</span>
                  <span className="flex items-center gap-1">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-nothing-green opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-nothing-green" />
                    </span>
                    <span className="font-mono text-[8px] text-nothing-green uppercase tracking-wider">
                      {hourLabel(new Date().getHours())}
                    </span>
                  </span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartWrapper height={240}>
                <HourDistribution hourly={activity.hourly ?? {}} />
              </ChartWrapper>
            </CardContent>
          </Card>
        </motion.div>

        {/* Daily Cost trend */}
        <motion.div custom={3} initial="hidden" animate="visible" variants={cardVariants}>
          <Card variant="default">
            <CardHeader>
              <CardTitle>
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-nothing-text-muted">Daily Cost — Last 30 Days</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dailyTrendData.every((d) => d.cost === 0) ? (
                <div className="flex items-center justify-center h-40 font-mono text-[10px] text-nothing-text-dim">No cost data in this period</div>
              ) : (
                <ChartWrapper height={240}>
                  <ComposedChart data={dailyTrendData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.blue} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={CHART_COLORS.blue} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="runningGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="var(--nothing-amber)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--nothing-amber)" stopOpacity={1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={CHART_DEFAULTS.gridColor} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={<ChartAxisTick />} axisLine={{ stroke: CHART_DEFAULTS.axisColor }} tickLine={false} interval={4} />
                    <YAxis yAxisId="left" tick={<ChartYAxisTick />} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v.toFixed(2)}`} width={52} />
                    <YAxis yAxisId="right" orientation="right" tick={<ChartYAxisTick />} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v.toFixed(2)}`} width={52} />
                    <Tooltip content={<ChartTooltip formatter={(v) => `$${typeof v === 'number' ? v.toFixed(4) : v}`} />} />
                    <Area yAxisId="left" type="monotone" dataKey="cost" name="Daily Cost" stroke={CHART_COLORS.blue} strokeWidth={1.5} fill="url(#costGrad)" dot={false} activeDot={{ r: 3, fill: CHART_COLORS.blue }} />
                    <Line yAxisId="right" type="monotone" dataKey="running" name="Running Total" stroke="url(#runningGrad)" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: 'var(--nothing-amber)', stroke: 'var(--nothing-bg)', strokeWidth: 2 }} />
                  </ComposedChart>
                </ChartWrapper>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Row 4: Cost breakdown table ── */}
      <motion.div custom={4} initial="hidden" animate="visible" variants={cardVariants}>
        <Card variant="default">
          <CardHeader>
            <CardTitle>
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-nothing-text-muted">Cost Breakdown</span>
            </CardTitle>
            <span className="font-mono text-[9px] text-nothing-text-dim">
              {tableData.length.toLocaleString()} entries · sorted by date desc
            </span>
          </CardHeader>
          <DataTable
            columns={tableColumns as unknown as Column<Record<string, unknown>>[]}
            data={tableData as unknown as Record<string, unknown>[]}
            rowKey="id"
            alternating
            pageSize={20}
            emptyMessage="No cost entries found"
          />
        </Card>
      </motion.div>
    </div>
  );
}
