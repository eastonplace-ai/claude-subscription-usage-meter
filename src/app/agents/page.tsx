'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  format,
  formatDistanceToNow,
  startOfDay,
  subDays,
} from 'date-fns';
import { safeParseDate } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge } from '@/components/ui/badge';
import { DataTable, Column } from '@/components/ui/data-table';
import {
  ChartWrapper,
  ChartTooltip,
  ChartAxisTick,
  ChartYAxisTick,
  CHART_COLORS,
  CHART_DEFAULTS,
} from '@/components/ui/chart-wrapper';

// ─── Types ─────────────────────────────────────────────────────────────────────

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

// ─── Agent Config ───────────────────────────────────────────────────────────────

const AGENT_CONFIG: Record<
  string,
  { emoji: string; label: string; model: string; color: string; badgeVariant: 'model' | 'amber' | 'red' | 'purple' }
> = {
  parent: {
    emoji: '🧠',
    label: 'Parent',
    model: 'Opus',
    color: '#5B9BF6',
    badgeVariant: 'model',
  },
  bento: {
    emoji: '🍱',
    label: 'Bento',
    model: 'Sonnet',
    color: '#4ECDC4',
    badgeVariant: 'purple',
  },
  enzo: {
    emoji: '🏎️',
    label: 'Enzo',
    model: 'Sonnet',
    color: '#D71921',
    badgeVariant: 'red',
  },
  jarvis: {
    emoji: '🤖',
    label: 'Jarvis',
    model: 'Haiku',
    color: '#D4A843',
    badgeVariant: 'amber',
  },
};

const ALL_AGENTS = ['parent', 'bento', 'enzo', 'jarvis'];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Skeletons ──────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-nothing-border ${className ?? ''}`} />
  );
}

function AgentCardSkeleton() {
  return (
    <div className="rounded-nothing border border-nothing-border bg-nothing-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-14 rounded-full" />
      </div>
      <Skeleton className="h-8 w-32" />
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-nothing-border">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-2 w-12" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded bg-nothing-border/30"
      style={{ height }}
    />
  );
}

// ─── Agent Overview Card ────────────────────────────────────────────────────────

interface AgentStats {
  totalTokens: number;
  totalCost: number;
  totalTasks: number;
  lastActive: string | null;
}

function AgentCard({
  agentKey,
  stats,
  delay,
}: {
  agentKey: string;
  stats: AgentStats;
  delay: number;
}) {
  const cfg = AGENT_CONFIG[agentKey] ?? {
    emoji: '?',
    label: agentKey,
    model: 'Unknown',
    color: CHART_COLORS.muted,
    badgeVariant: 'estimated' as const,
  };

  const hasData = stats.totalTasks > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
    >
      <motion.div
        whileHover={{ boxShadow: `0 0 0 1px ${cfg.color}22, 0 4px 20px ${cfg.color}18` }}
        transition={{ duration: 0.2 }}
        className="rounded-nothing h-full"
      >
      <Card
        variant="accent"
        accentColor={cfg.color}
        className="h-full"
      >
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">{cfg.emoji}</span>
              <span
                className="font-mono text-[11px] font-bold uppercase tracking-[0.12em]"
                style={{ color: cfg.color }}
              >
                {cfg.label}
              </span>
            </div>
            <Badge variant={cfg.badgeVariant}>
              {cfg.model}
            </Badge>
          </div>

          {/* Total cost — hero metric */}
          <div className="mb-3">
            <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-muted mb-1">
              Total Cost
            </p>
            <p className="font-mono text-3xl font-bold text-nothing-text">
              ${formatCost(stats.totalCost)}
            </p>
          </div>

          {/* 3-col stats */}
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-nothing-border">
            <div>
              <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-nothing-text-muted mb-1">
                Tokens
              </p>
              <p className="font-mono text-[11px] font-bold text-nothing-text">
                {hasData ? fmt(stats.totalTokens) : '—'}
              </p>
            </div>
            <div>
              <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-nothing-text-muted mb-1">
                Tasks
              </p>
              <p className="font-mono text-[11px] font-bold text-nothing-text">
                {hasData ? stats.totalTasks : '—'}
              </p>
            </div>
            <div>
              <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-nothing-text-muted mb-1">
                Last Active
              </p>
              <p className="font-mono text-[9px] text-nothing-text-secondary">
                {stats.lastActive
                  ? (() => { const d = safeParseDate(stats.lastActive); return d ? formatDistanceToNow(d, { addSuffix: true }) : 'never'; })()
                  : 'never'}
              </p>
            </div>
          </div>

          {/* Empty state hint */}
          {!hasData && (
            <p className="font-mono text-[8px] text-nothing-text-dim mt-2 text-center opacity-60">
              No activity logged yet
            </p>
          )}
        </CardContent>
      </Card>
      </motion.div>
    </motion.div>
  );
}

// ─── Custom Pie Center Label ────────────────────────────────────────────────────

function PieCenterLabel({
  total,
  cx,
  cy,
}: {
  total: number;
  cx?: number;
  cy?: number;
}) {
  return (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontFamily="'Space Mono', monospace">
      <tspan x={cx} dy="-0.5em" fontSize={8} fill="var(--nothing-text-muted)" letterSpacing="0.1em">
        TOTAL
      </tspan>
      <tspan x={cx} dy="1.5em" fontSize={13} fill="var(--nothing-text)" fontWeight="bold">
        ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </tspan>
    </text>
  );
}

// ─── Expandable Row State ───────────────────────────────────────────────────────

function ExpandedTask({ task }: { task: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="px-4 pb-3 pt-1 font-mono text-[9px] text-nothing-text-secondary border-t border-nothing-border/50 bg-nothing-surface2/30"
    >
      {task}
    </motion.div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [entries, setEntries] = useState<TokenLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ── Per-agent stats ──────────────────────────────────────────────────────────

  const agentStats = useMemo<Record<string, AgentStats>>(() => {
    const map: Record<string, AgentStats> = {};

    for (const agent of ALL_AGENTS) {
      map[agent] = { totalTokens: 0, totalCost: 0, totalTasks: 0, lastActive: null };
    }

    for (const e of entries) {
      const key = e.agent?.toLowerCase() ?? 'parent';
      if (!map[key]) {
        map[key] = { totalTokens: 0, totalCost: 0, totalTasks: 0, lastActive: null };
      }
      const s = map[key];
      s.totalTokens += (e.input_tokens ?? 0) + (e.output_tokens ?? 0);
      s.totalCost += e.cost_usd ?? 0;
      s.totalTasks += 1;
      if (!s.lastActive || e.timestamp > s.lastActive) {
        s.lastActive = e.timestamp;
      }
    }

    return map;
  }, [entries]);

  // ── Stacked area chart — token usage by agent over time ─────────────────────

  const areaData = useMemo(() => {
    const today = startOfDay(new Date());
    const days: Record<string, Record<string, number>> = {};

    for (let i = 29; i >= 0; i--) {
      const d = format(subDays(today, i), 'yyyy-MM-dd');
      days[d] = { parent: 0, bento: 0, enzo: 0, jarvis: 0 };
    }

    for (const e of entries) {
      const _d = safeParseDate(e.timestamp);
      const d = _d ? format(_d, 'yyyy-MM-dd') : '';
      if (!(d in days)) continue;
      const key = e.agent?.toLowerCase() ?? 'parent';
      if (!(key in days[d])) days[d][key] = 0;
      days[d][key] += (e.input_tokens ?? 0) + (e.output_tokens ?? 0);
    }

    return Object.entries(days).map(([date, agentTokens]) => ({
      date: (() => { const _pd = safeParseDate(date); return _pd ? format(_pd, 'MMM d') : date; })(),
      ...agentTokens,
    }));
  }, [entries]);

  // ── Cost donut ───────────────────────────────────────────────────────────────

  const costDonutData = useMemo(() => {
    return ALL_AGENTS.map((agent) => ({
      name: AGENT_CONFIG[agent]?.label ?? agent,
      value: parseFloat((agentStats[agent]?.totalCost ?? 0).toFixed(4)),
      color: AGENT_CONFIG[agent]?.color ?? CHART_COLORS.muted,
    })).filter((d) => d.value > 0);
  }, [agentStats]);

  const totalCost = costDonutData.reduce((a, b) => a + b.value, 0);

  // ── Category bar chart ───────────────────────────────────────────────────────

  const categoryData = useMemo(() => {
    const catMap: Record<string, Record<string, number>> = {};

    for (const e of entries) {
      const cat = e.category || 'other';
      const agent = e.agent?.toLowerCase() ?? 'parent';
      if (!catMap[cat]) catMap[cat] = {};
      catMap[cat][agent] = (catMap[cat][agent] ?? 0) + 1;
    }

    return Object.entries(catMap)
      .map(([category, agentCounts]) => ({
        category: category.toUpperCase(),
        ...agentCounts,
        total: Object.values(agentCounts).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [entries]);

  // ── Recent activity table ────────────────────────────────────────────────────

  const recentEntries = useMemo(() => {
    return [...entries]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20)
      .map((e, i) => ({ ...e, _id: `${e.timestamp}-${i}` }));
  }, [entries]);

  type RecentRow = (typeof recentEntries)[number];

  const tableColumns: Column<RecentRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      sortable: true,
      width: '100px',
      render: (v) => (
        <span className="text-nothing-text-secondary font-mono text-[9px]">
          {(() => { const _pv = safeParseDate(String(v)); return _pv ? format(_pv, 'MMM d, HH:mm') : String(v); })()}
        </span>
      ),
    },
    {
      key: 'agent',
      label: 'Agent',
      sortable: true,
      width: '90px',
      render: (v) => {
        const key = String(v).toLowerCase();
        const cfg = AGENT_CONFIG[key];
        const color = cfg?.color ?? CHART_COLORS.muted;
        return (
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span
              className="font-mono text-[9px] uppercase tracking-wider font-bold"
              style={{ color }}
            >
              {cfg?.emoji} {cfg?.label ?? v}
            </span>
          </div>
        );
      },
    },
    {
      key: 'task',
      label: 'Task',
      render: (v) => (
        <span className="font-mono text-[9px] text-nothing-text-secondary truncate max-w-[200px] block">
          {String(v)}
        </span>
      ),
    },
    {
      key: 'model',
      label: 'Model',
      width: '70px',
      render: (v) => {
        const s = String(v).toLowerCase();
        const color = s.includes('opus')
          ? CHART_COLORS.blue
          : s.includes('sonnet')
          ? CHART_COLORS.cyan
          : CHART_COLORS.amber;
        return (
          <span
            className="font-mono text-[8px] px-1.5 py-0.5 rounded"
            style={{ color, backgroundColor: `${color}18` }}
          >
            {s.includes('opus') ? 'Opus' : s.includes('sonnet') ? 'Sonnet' : 'Haiku'}
          </span>
        );
      },
    },
    {
      key: 'input_tokens',
      label: 'Tokens',
      sortable: true,
      align: 'right',
      width: '80px',
      render: (v, row) => {
        const total = ((row as RecentRow).input_tokens ?? 0) + ((row as RecentRow).output_tokens ?? 0);
        return (
          <span className="font-mono text-[9px]">{fmt(total)}</span>
        );
      },
    },
    {
      key: 'cost_usd',
      label: 'Cost',
      sortable: true,
      align: 'right',
      width: '70px',
      render: (v) => (
        <span className="font-mono text-[9px] text-nothing-text font-bold">
          ${typeof v === 'number' ? v.toFixed(4) : '0.0000'}
        </span>
      ),
    },
    {
      key: 'tool_calls',
      label: 'Tools',
      sortable: true,
      align: 'right',
      width: '60px',
      render: (v) =>
        typeof v === 'number' && v > 0 ? (
          <span className="font-mono text-[9px] text-nothing-green">{v}</span>
        ) : (
          <span className="text-nothing-text-dim font-mono text-[9px]">—</span>
        ),
    },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="font-mono text-xs uppercase tracking-[0.15em] text-nothing-text-muted">
          Agent Intelligence
        </h1>
        <p className="font-mono text-[9px] text-nothing-text-dim mt-0.5">
          Multi-agent telemetry · {entries.length} task log entries
        </p>
      </div>

      {/* ── Agent Cards ── */}
      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <AgentCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {ALL_AGENTS.map((agent, i) => (
            <AgentCard
              key={agent}
              agentKey={agent}
              stats={agentStats[agent] ?? { totalTokens: 0, totalCost: 0, totalTasks: 0, lastActive: null }}
              delay={i * 0.07}
            />
          ))}
        </div>
      )}

      {/* ── Charts Row 1 ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Stacked Area: Token Usage by Agent */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Token Usage by Agent — Last 30 Days</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <ChartSkeleton height={240} />
              ) : areaData.every((d) =>
                  ALL_AGENTS.every((a) => (d as unknown as Record<string, number>)[a] === 0),
                ) ? (
                <div className="flex items-center justify-center h-60 font-mono text-[10px] text-nothing-text-dim">
                  No token data available
                </div>
              ) : (
                <ChartWrapper height={240}>
                  <AreaChart data={areaData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      {ALL_AGENTS.map((agent) => (
                        <linearGradient key={agent} id={`grad-${agent}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={AGENT_CONFIG[agent]?.color} stopOpacity={0.55} />
                          <stop offset="60%" stopColor={AGENT_CONFIG[agent]?.color} stopOpacity={0.15} />
                          <stop offset="100%" stopColor={AGENT_CONFIG[agent]?.color} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
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
                      tickFormatter={(v: number) => fmt(v)}
                      width={44}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          formatter={(v) =>
                            fmt(typeof v === 'number' ? v : Number(v))
                          }
                        />
                      }
                    />
                    <Legend
                      wrapperStyle={{ fontFamily: "'Space Mono', monospace", fontSize: 9, paddingTop: 8 }}
                      formatter={(value) => {
                        const cfg = AGENT_CONFIG[value];
                        return `${cfg?.emoji ?? ''} ${cfg?.label ?? value}`;
                      }}
                    />
                    {ALL_AGENTS.map((agent) => (
                      <Area
                        key={agent}
                        type="monotone"
                        dataKey={agent}
                        name={agent}
                        stroke={AGENT_CONFIG[agent]?.color}
                        strokeWidth={1.5}
                        fill={`url(#grad-${agent})`}
                        stackId="1"
                        dot={false}
                        activeDot={{ r: 3, fill: AGENT_CONFIG[agent]?.color }}
                      />
                    ))}
                  </AreaChart>
                </ChartWrapper>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Donut: Cost Distribution */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Cost Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <ChartSkeleton height={240} />
              ) : costDonutData.length === 0 ? (
                <div className="flex items-center justify-center h-60 font-mono text-[10px] text-nothing-text-dim">
                  No cost data available
                </div>
              ) : (
                <div className="flex items-center gap-6">
                  <div className="flex-1">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={costDonutData}
                          cx="50%"
                          cy="50%"
                          innerRadius={58}
                          outerRadius={88}
                          dataKey="value"
                          nameKey="name"
                          strokeWidth={0}
                          paddingAngle={3}
                        >
                          {costDonutData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <PieCenterLabel total={totalCost} cx={100} cy={100} />
                        <Tooltip
                          content={
                            <ChartTooltip
                              formatter={(v) =>
                                `$${typeof v === 'number' ? v.toFixed(4) : v}`
                              }
                            />
                          }
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Legend */}
                  <div className="space-y-3 min-w-[130px]">
                    {costDonutData.map((entry) => {
                      const pct = totalCost > 0 ? ((entry.value / totalCost) * 100).toFixed(1) : '0';
                      return (
                        <div key={entry.name} className="flex items-start gap-2">
                          <span
                            className="w-2 h-2 rounded-full mt-0.5 shrink-0"
                            style={{ backgroundColor: entry.color }}
                          />
                          <div>
                            <p className="font-mono text-[9px] text-nothing-text-secondary">
                              {entry.name}
                            </p>
                            <p className="font-mono text-[9px] text-nothing-text font-bold">
                              ${entry.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="font-mono text-[8px] text-nothing-text-dim">
                              {pct}%
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Charts Row 2 ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Task Categories Bar Chart */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Task Categories by Agent</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <ChartSkeleton height={220} />
              ) : categoryData.length === 0 ? (
                <div className="flex items-center justify-center h-52 font-mono text-[10px] text-nothing-text-dim">
                  No category data available
                </div>
              ) : (
                <ChartWrapper height={220}>
                  <BarChart
                    data={categoryData}
                    margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                    barSize={10}
                    barGap={2}
                  >
                    <CartesianGrid
                      stroke={CHART_DEFAULTS.gridColor}
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="category"
                      tick={<ChartAxisTick />}
                      axisLine={{ stroke: CHART_DEFAULTS.axisColor }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={<ChartYAxisTick />}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      width={30}
                    />
                    <Tooltip
                      content={<ChartTooltip formatter={(v) => String(v)} />}
                    />
                    <Legend
                      wrapperStyle={{ fontFamily: "'Space Mono', monospace", fontSize: 9, paddingTop: 8 }}
                      formatter={(value) => {
                        const cfg = AGENT_CONFIG[value];
                        return `${cfg?.emoji ?? ''} ${cfg?.label ?? value}`;
                      }}
                    />
                    {ALL_AGENTS.map((agent) => (
                      <Bar
                        key={agent}
                        dataKey={agent}
                        name={agent}
                        fill={AGENT_CONFIG[agent]?.color ?? CHART_COLORS.muted}
                        radius={[2, 2, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ChartWrapper>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Summary stats — efficiency panel */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.55 }}
        >
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Efficiency Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : (
                ALL_AGENTS.map((agent) => {
                  const stats = agentStats[agent];
                  const cfg = AGENT_CONFIG[agent];
                  const avgCostPerTask =
                    stats.totalTasks > 0
                      ? stats.totalCost / stats.totalTasks
                      : 0;
                  const avgTokensPerTask =
                    stats.totalTasks > 0
                      ? stats.totalTokens / stats.totalTasks
                      : 0;
                  const hasData = stats.totalTasks > 0;

                  return (
                    <div
                      key={agent}
                      className="flex items-center gap-3 p-2.5 rounded-[6px] border border-nothing-border bg-nothing-surface2/30"
                    >
                      <div
                        className="w-0.5 self-stretch rounded-full shrink-0"
                        style={{ backgroundColor: cfg?.color ?? CHART_COLORS.muted }}
                      />
                      <div className="flex items-center gap-1.5 w-20 shrink-0">
                        <span className="text-sm">{cfg?.emoji}</span>
                        <span
                          className="font-mono text-[9px] font-bold uppercase tracking-wider"
                          style={{ color: cfg?.color }}
                        >
                          {cfg?.label}
                        </span>
                      </div>
                      {hasData ? (
                        <div className="flex gap-4 flex-1">
                          <div>
                            <p className="font-mono text-[8px] text-nothing-text-dim uppercase tracking-wider">
                              $/task
                            </p>
                            <p className="font-mono text-[10px] text-nothing-text font-bold">
                              ${avgCostPerTask.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                            </p>
                          </div>
                          <div>
                            <p className="font-mono text-[8px] text-nothing-text-dim uppercase tracking-wider">
                              tok/task
                            </p>
                            <p className="font-mono text-[10px] text-nothing-text font-bold">
                              {fmt(Math.round(avgTokensPerTask))}
                            </p>
                          </div>
                          <div>
                            <p className="font-mono text-[8px] text-nothing-text-dim uppercase tracking-wider">
                              tasks
                            </p>
                            <p className="font-mono text-[10px] text-nothing-text font-bold">
                              {stats.totalTasks}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="font-mono text-[8px] text-nothing-text-dim italic">
                          No data
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Recent Activity Table ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.6 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Recent Agent Activity</CardTitle>
            <span className="font-mono text-[9px] text-nothing-text-dim">
              Last 20 entries · click row to expand task
            </span>
          </CardHeader>
          {loading ? (
            <CardContent>
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            </CardContent>
          ) : recentEntries.length === 0 ? (
            <CardContent>
              <div className="flex items-center justify-center h-32 font-mono text-[10px] text-nothing-text-dim">
                No activity logged yet
              </div>
            </CardContent>
          ) : (
            <div>
              {recentEntries.map((row) => {
                const agentKey = row.agent?.toLowerCase() ?? 'parent';
                const cfg = AGENT_CONFIG[agentKey];
                const isExpanded = expandedRow === row._id;
                const totalTok = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
                return (
                  <div key={row._id} className="border-b border-nothing-border/50 last:border-0">
                    <div
                      className="grid items-center px-4 py-2.5 cursor-pointer hover:bg-nothing-surface2/40 transition-colors"
                      style={{ gridTemplateColumns: '100px 90px 1fr 70px 80px 70px 60px' }}
                      onClick={() => setExpandedRow(isExpanded ? null : row._id)}
                    >
                      {/* Time */}
                      <span className="font-mono text-[9px] text-nothing-text-secondary">
                        {(() => { const _pt = safeParseDate(row.timestamp); return _pt ? format(_pt, 'MMM d, HH:mm') : row.timestamp; })()}
                      </span>
                      {/* Agent */}
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: cfg?.color ?? CHART_COLORS.muted }}
                        />
                        <span
                          className="font-mono text-[9px] uppercase tracking-wider font-bold"
                          style={{ color: cfg?.color }}
                        >
                          {cfg?.emoji} {cfg?.label ?? row.agent}
                        </span>
                      </div>
                      {/* Task */}
                      <span className="font-mono text-[9px] text-nothing-text-secondary truncate pr-4">
                        {row.task}
                      </span>
                      {/* Model */}
                      <span className="font-mono text-[8px] text-nothing-text-dim">
                        {row.model?.includes('opus')
                          ? 'Opus'
                          : row.model?.includes('sonnet')
                          ? 'Sonnet'
                          : 'Haiku'}
                      </span>
                      {/* Tokens */}
                      <span className="font-mono text-[9px] text-right pr-2">
                        {fmt(totalTok)}
                      </span>
                      {/* Cost */}
                      <span className="font-mono text-[9px] text-nothing-text font-bold text-right pr-2">
                        ${(row.cost_usd ?? 0).toFixed(4)}
                      </span>
                      {/* Tools */}
                      <span className="font-mono text-[9px] text-center">
                        {row.tool_calls > 0 ? (
                          <span className="text-nothing-green">{row.tool_calls}</span>
                        ) : (
                          <span className="text-nothing-text-dim">—</span>
                        )}
                      </span>
                    </div>
                    <AnimatePresence>
                      {isExpanded && <ExpandedTask key="expanded" task={row.task} />}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
