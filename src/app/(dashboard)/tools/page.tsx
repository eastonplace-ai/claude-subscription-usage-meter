'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { MetricCard } from '@/components/ui/metric-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DataTable, Column } from '@/components/ui/data-table';
import {
  ChartWrapper,
  ChartTooltip,
  ChartAxisTick,
  CHART_COLORS,
  CHART_DEFAULTS,
} from '@/components/ui/chart-wrapper';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolEntry {
  tool: string;
  category: string;
  count: number;
  tokens: number;
  avgDuration: number | null;
  errorCount: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

type Category = 'filesystem' | 'search' | 'execution' | 'agent' | 'mcp' | 'skill' | 'communication' | 'browser' | 'other';

const CATEGORY_COLORS: Record<Category, string> = {
  filesystem: '#5B9BF6',
  search: '#4ECDC4',
  execution: '#D4A843',
  agent: '#AF52DE',
  mcp: '#4A9E5C',
  skill: '#FF6B6B',
  communication: '#FFD93D',
  browser: '#6BCB77',
  other: '#666666',
};

const CATEGORY_ORDER: Category[] = ['filesystem', 'search', 'execution', 'agent', 'mcp', 'skill', 'communication', 'browser', 'other'];

function getCategory(tool: string, _rawCategory: string): Category {
  const t = tool.toLowerCase();

  // Communication: telegram, imessage, email/mail (check before generic MCP)
  if (t.includes('telegram') || t.includes('imessage') || t.includes('apple-mail') ||
      t.includes('apple_mail') || t.includes('_mail_') || t.includes('_email')) {
    return 'communication';
  }

  // Browser
  if (t.includes('browser') || t.includes('browser-use') || t.includes('browser_use')) {
    return 'browser';
  }

  // MCP (generic — after communication/browser checks)
  if (t.startsWith('mcp__')) return 'mcp';

  // Skill tool
  if (t === 'skill' || t.includes('skill')) return 'skill';

  // Filesystem
  if (['read', 'write', 'edit', 'notebookedit'].includes(t)) return 'filesystem';
  if (t === 'glob') return 'filesystem';

  // Search
  if (['grep', 'toolsearch', 'websearch'].includes(t)) return 'search';
  if (t === 'glob') return 'search'; // glob can go either way — filesystem wins above

  // Execution
  if (t === 'bash') return 'execution';

  // Agent
  if (['agent', 'todowrite', 'taskcreate', 'taskupdate', 'taskget', 'tasklist', 'taskstop', 'taskoutput'].includes(t)) return 'agent';

  return 'other';
}

// ─── Tool Name Cleaner ────────────────────────────────────────────────────────

const MCP_SERVICE_LABELS: Record<string, string> = {
  plugin_telegram_telegram: 'Telegram',
  plugin_imessage_imessage: 'iMessage',
  'browser-use': 'Browser',
  'apple-mail': 'Mail',
  'apple-calendar': 'Calendar',
  'apple-reminders': 'Reminders',
  'apple-notes': 'Notes',
  f1: 'F1',
  'nyc-navigation': 'NYC Nav',
};

function toTitleCase(s: string): string {
  return s
    .replace(/[-_]/g, ' ')
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function cleanToolName(raw: string): string {
  const lower = raw.toLowerCase();
  if (!lower.startsWith('mcp__')) return raw;

  // Strip leading mcp__
  const rest = lower.slice(5); // e.g. "plugin_telegram_telegram__reply"
  const dblIdx = rest.indexOf('__');
  if (dblIdx === -1) return toTitleCase(rest);

  const serviceKey = rest.slice(0, dblIdx);   // e.g. "plugin_telegram_telegram"
  const actionRaw = rest.slice(dblIdx + 2);   // e.g. "reply"

  const serviceLabel = MCP_SERVICE_LABELS[serviceKey] ?? toTitleCase(serviceKey);
  // Strip common browser-use "browser_" prefix on action
  const action = actionRaw.startsWith('browser_')
    ? actionRaw.slice(8)
    : actionRaw;

  const actionLabel = toTitleCase(action);
  return `${serviceLabel}: ${actionLabel}`;
}

function getCategoryColor(cat: Category): string {
  return CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other;
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-nothing-border ${className ?? ''}`} />
  );
}

function MetricSkeleton() {
  return (
    <div className="rounded-nothing border border-nothing-border bg-nothing-surface p-4 space-y-3">
      <Skeleton className="h-2 w-20" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-2 w-16" />
    </div>
  );
}

function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="animate-pulse rounded bg-nothing-border/30" style={{ height }} />
  );
}

// ─── Category Badge ───────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: Category }) {
  const color = getCategoryColor(category);
  return (
    <span
      className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: `${color}20` }}
    >
      {category}
    </span>
  );
}

// ─── Table row type ───────────────────────────────────────────────────────────

interface TableRow extends Record<string, unknown> {
  tool: string;
  category: Category;
  count: number;
  errorCount: number;
  errorRate: number;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<'calls' | 'tokens'>('calls');

  useEffect(() => {
    fetch('/api/tools')
      .then((r) => r.json())
      .then((data) => setTools(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ── Enrich entries with resolved categories ───────────────────────────────

  const enriched = useMemo<(ToolEntry & { resolvedCategory: Category })[]>(
    () =>
      tools.map((t) => ({
        ...t,
        resolvedCategory: getCategory(t.tool, t.category),
      })),
    [tools],
  );

  // ── Summary metrics ───────────────────────────────────────────────────────

  const { totalCalls, uniqueTools, errorRate, mostUsed } = useMemo(() => {
    if (enriched.length === 0) {
      return { totalCalls: 0, uniqueTools: 0, errorRate: 0, mostUsed: '—' };
    }
    const totalCalls = enriched.reduce((s, t) => s + t.count, 0);
    const totalErrors = enriched.reduce((s, t) => s + (t.errorCount ?? 0), 0);
    const uniqueTools = enriched.length;
    const errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;
    const mostUsed = cleanToolName([...enriched].sort((a, b) => b.count - a.count)[0]?.tool ?? '—');
    return { totalCalls, uniqueTools, errorRate, mostUsed };
  }, [enriched]);

  // ── Bar chart data: top 15 tools by count ─────────────────────────────────

  const barData = useMemo(
    () =>
      [...enriched]
        .sort((a, b) => metric === 'tokens' ? (b.tokens ?? 0) - (a.tokens ?? 0) : b.count - a.count)
        .slice(0, 15)
        .map((t) => {
          const displayName = cleanToolName(t.tool);
          const truncated = displayName.length > 18 ? displayName.slice(0, 17) + '…' : displayName;
          return {
            tool: truncated,
            fullName: displayName,
            rawTool: t.tool,
            count: t.count,
            tokens: t.tokens ?? 0,
            metricValue: metric === 'tokens' ? (t.tokens ?? 0) : t.count,
            errorCount: t.errorCount ?? 0,
            color: getCategoryColor(t.resolvedCategory),
            category: t.resolvedCategory,
          };
        }),
    [enriched, metric],
  );

  // ── Pie chart data: group by category ─────────────────────────────────────

  const pieData = useMemo(() => {
    const map: Partial<Record<Category, number>> = {};
    for (const t of enriched) {
      const val = metric === 'tokens' ? (t.tokens ?? 0) : t.count;
      map[t.resolvedCategory] = (map[t.resolvedCategory] ?? 0) + val;
    }
    const total = Object.values(map).reduce((s, v) => s + (v ?? 0), 0) || 1;
    return CATEGORY_ORDER.filter((cat) => (map[cat] ?? 0) > 0).map((cat) => ({
      name: cat,
      value: map[cat] ?? 0,
      pct: parseFloat((((map[cat] ?? 0) / total) * 100).toFixed(1)),
      color: getCategoryColor(cat),
    }));
  }, [enriched, metric]);

  const pieTotalCalls = pieData.reduce((s, d) => s + d.value, 0);

  // ── Table data ────────────────────────────────────────────────────────────

  const tableData = useMemo<TableRow[]>(
    () =>
      [...enriched]
        .sort((a, b) => b.count - a.count)
        .map((t) => ({
          tool: t.tool,
          category: t.resolvedCategory,
          count: t.count,
          errorCount: t.errorCount ?? 0,
          errorRate:
            t.count > 0
              ? parseFloat((((t.errorCount ?? 0) / t.count) * 100).toFixed(1))
              : 0,
        })),
    [enriched],
  );

  const tableColumns: Column<TableRow>[] = [
    {
      key: 'tool',
      label: 'Tool',
      sortable: true,
      render: (v) => (
        <span className="font-mono text-[11px] text-nothing-text" title={String(v)}>
          {cleanToolName(String(v))}
        </span>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      sortable: true,
      render: (v) => <CategoryBadge category={v as Category} />,
    },
    {
      key: 'count',
      label: 'Calls',
      sortable: true,
      align: 'right',
      render: (v) => (
        <span className="text-nothing-text font-bold">
          {typeof v === 'number' ? v.toLocaleString() : '—'}
        </span>
      ),
    },
    {
      key: 'errorCount',
      label: 'Errors',
      sortable: true,
      align: 'right',
      render: (v) =>
        typeof v === 'number' && v > 0 ? (
          <span className="text-nothing-red">{v.toLocaleString()}</span>
        ) : (
          <span className="text-nothing-text-dim">—</span>
        ),
    },
    {
      key: 'errorRate',
      label: 'Error Rate',
      sortable: true,
      align: 'right',
      render: (v) => {
        const rate = typeof v === 'number' ? v : 0;
        return rate > 5 ? (
          <span className="font-mono text-[10px] text-nothing-red font-bold">
            {rate.toFixed(1)}%
          </span>
        ) : rate > 0 ? (
          <span className="font-mono text-[10px] text-nothing-text-secondary">
            {rate.toFixed(1)}%
          </span>
        ) : (
          <span className="font-mono text-[10px] text-nothing-text-dim">0%</span>
        );
      },
    },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page title */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <h1 className="font-mono text-xs uppercase tracking-[0.15em] text-nothing-text-muted">
          Tool Analytics
        </h1>
        <p className="font-mono text-[9px] text-nothing-text-dim mt-0.5">
          Aggregated from /api/tools
        </p>
      </motion.div>

      {/* ── Metric Cards ── */}
      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <MetricSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            label="Total Tool Calls"
            value={totalCalls}
            accentColor={CHART_COLORS.blue}
            delay={0}
            formatValue={(v) => v.toLocaleString()}
          />
          <MetricCard
            label="Unique Tools"
            value={uniqueTools}
            accentColor={CHART_COLORS.cyan}
            delay={0.05}
            formatValue={(v) => String(v)}
          />
          <div className="relative">
            <MetricCard
              label="Error Rate"
              value={errorRate}
              suffix="%"
              accentColor={errorRate > 5 ? CHART_COLORS.red : CHART_COLORS.green}
              delay={0.1}
              formatValue={(v) => v.toFixed(2)}
            />
            {errorRate > 5 && (
              <span className="absolute top-3 right-3 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-nothing-red opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-nothing-red" />
              </span>
            )}
          </div>
          <MetricCard
            label="Most Used"
            value={0}
            accentColor={CHART_COLORS.purple}
            delay={0.15}
            subtitle={mostUsed}
            formatValue={() => mostUsed}
          />
        </div>
      )}

      {/* ── Metric Toggle ── */}
      <div className="flex items-center gap-1 self-start">
        <button
          onClick={() => setMetric('calls')}
          className={`font-mono text-[9px] uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
            metric === 'calls'
              ? 'border-nothing-text-muted bg-nothing-surface text-nothing-text'
              : 'border-nothing-border text-nothing-text-dim hover:text-nothing-text-secondary'
          }`}
        >
          Calls
        </button>
        <button
          onClick={() => setMetric('tokens')}
          className={`font-mono text-[9px] uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
            metric === 'tokens'
              ? 'border-nothing-text-muted bg-nothing-surface text-nothing-text'
              : 'border-nothing-border text-nothing-text-dim hover:text-nothing-text-secondary'
          }`}
        >
          Tokens (est.)
        </button>
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left: Tool Usage Ranking */}
        <Card>
          <CardHeader>
            <CardTitle>Tool Usage Ranking — Top 15 by {metric === 'tokens' ? 'Tokens (est.)' : 'Calls'}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton height={360} />
            ) : barData.length === 0 ? (
              <div className="flex items-center justify-center h-72 font-mono text-[10px] text-nothing-text-dim">
                No tool data available
              </div>
            ) : (
              <ChartWrapper height={barData.length * 28 + 32}>
                <BarChart
                  data={barData}
                  layout="vertical"
                  margin={{ top: 4, right: 60, left: 8, bottom: 0 }}
                  barSize={14}
                >
                  <CartesianGrid
                    stroke={CHART_DEFAULTS.gridColor}
                    strokeDasharray="3 3"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={<ChartAxisTick />}
                    axisLine={{ stroke: CHART_DEFAULTS.axisColor }}
                    tickLine={false}
                    tickFormatter={(v: number) => v.toLocaleString()}
                  />
                  <YAxis
                    type="category"
                    dataKey="tool"
                    tick={(props) => (
                      <text
                        x={props.x}
                        y={props.y}
                        dx={-4}
                        textAnchor="end"
                        dominantBaseline="middle"
                        fill="var(--nothing-text-muted)"
                        fontSize={9}
                        fontFamily="'Space Mono', monospace"
                      >
                        {String(props.payload?.value ?? '')}
                      </text>
                    )}
                    axisLine={false}
                    tickLine={false}
                    width={130}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload as typeof barData[0];
                      return (
                        <div className="bg-nothing-surface border border-nothing-border2 rounded-[6px] px-3 py-2 shadow-xl">
                          <p className="font-mono text-[9px] uppercase tracking-wider text-nothing-text-muted mb-1.5">
                            {d.fullName}
                          </p>
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: d.color }}
                            />
                            <span className="font-mono text-[10px] text-nothing-text-secondary">
                              {metric === 'tokens' ? 'Tokens (est.):' : 'Calls:'}
                            </span>
                            <span className="font-mono text-[10px] text-nothing-text font-bold">
                              {metric === 'tokens' ? d.tokens.toLocaleString() : d.count.toLocaleString()}
                            </span>
                          </div>
                          {d.errorCount > 0 && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="w-2 h-2 rounded-full shrink-0 bg-nothing-red" />
                              <span className="font-mono text-[10px] text-nothing-text-secondary">Errors:</span>
                              <span className="font-mono text-[10px] text-nothing-red font-bold">
                                {d.errorCount.toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="metricValue" name={metric === 'tokens' ? 'Tokens' : 'Calls'} radius={[0, 3, 3, 0]} isAnimationActive animationBegin={0} animationDuration={800} animationEasing="ease-out">
                    {barData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} fillOpacity={entry.errorCount > 0 ? 1 : 0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartWrapper>
            )}
          </CardContent>
        </Card>

        {/* Right: Category Distribution Pie */}
        <Card>
          <CardHeader>
            <CardTitle>Tool Category Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton height={360} />
            ) : pieData.length === 0 ? (
              <div className="flex items-center justify-center h-72 font-mono text-[10px] text-nothing-text-dim">
                No category data available
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={64}
                      outerRadius={96}
                      dataKey="value"
                      nameKey="name"
                      strokeWidth={0}
                      paddingAngle={2}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload as typeof pieData[0];
                        return (
                          <div className="bg-nothing-surface border border-nothing-border2 rounded-[6px] px-3 py-2 shadow-xl">
                            <p className="font-mono text-[9px] uppercase tracking-wider text-nothing-text-muted mb-1.5">
                              {d.name}
                            </p>
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: d.color }}
                              />
                              <span className="font-mono text-[10px] text-nothing-text font-bold">
                                {d.value.toLocaleString()} {metric === 'tokens' ? 'tokens' : 'calls'}
                              </span>
                              <span className="font-mono text-[9px] text-nothing-text-dim">
                                ({d.pct}%)
                              </span>
                            </div>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* Legend */}
                <div className="space-y-2 border-t border-nothing-border pt-3">
                  {pieData.map((entry) => (
                    <div key={entry.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="font-mono text-[9px] uppercase tracking-wider text-nothing-text-secondary">
                          {entry.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[9px] text-nothing-text">
                          {entry.value.toLocaleString()}
                        </span>
                        <span className="font-mono text-[8px] text-nothing-text-dim w-10 text-right">
                          {entry.pct}%
                        </span>
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-nothing-border pt-2 flex items-center justify-between">
                    <span className="font-mono text-[9px] text-nothing-text-muted uppercase tracking-wider">
                      Total {metric === 'tokens' ? 'Tokens' : 'Calls'}
                    </span>
                    <span className="font-mono text-[11px] text-nothing-text font-bold">
                      {pieTotalCalls.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Full Tool Table ── */}
      <Card>
        <CardHeader>
          <CardTitle>All Tools</CardTitle>
          <span className="font-mono text-[9px] text-nothing-text-dim">
            {tableData.length} tools · sorted by calls desc
          </span>
        </CardHeader>
        {loading ? (
          <CardContent>
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </CardContent>
        ) : (
          <DataTable
            columns={tableColumns}
            data={tableData}
            rowKey="tool"
            alternating
            pageSize={20}
            emptyMessage="No tool data found"
          />
        )}
      </Card>
    </div>
  );
}
