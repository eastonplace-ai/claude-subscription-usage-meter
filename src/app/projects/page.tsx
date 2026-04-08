'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { safeParseDate } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { FolderOpen, Clock, Layers, Cpu, Wrench } from 'lucide-react';
import { MetricCard } from '@/components/ui/metric-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChartTooltip, CHART_COLORS, CHART_DEFAULTS } from '@/components/ui/chart-wrapper';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  slug: string;
  displayName: string;
  path: string;
  sessionCount: number;
  lastActive: string;
  totalTokens: number;
  totalCost: number;
  totalMessages: number;
  modelUsage: Record<string, number>;
  toolUsage: Record<string, number>;
  branches: string[];
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-nothing-surface2 ${className ?? ''}`}
    />
  );
}

function MetricSkeleton() {
  return (
    <div className="rounded-nothing border border-nothing-border bg-nothing-surface p-4 space-y-3">
      <SkeletonBlock className="h-2 w-24" />
      <SkeletonBlock className="h-8 w-16" />
      <SkeletonBlock className="h-2 w-32" />
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <div className="rounded-nothing border border-nothing-border bg-nothing-surface p-4 space-y-3">
      <SkeletonBlock className="h-4 w-40" />
      <SkeletonBlock className="h-2 w-28" />
      <div className="flex gap-2">
        <SkeletonBlock className="h-5 w-16 rounded-full" />
        <SkeletonBlock className="h-5 w-24 rounded-full" />
      </div>
      <SkeletonBlock className="h-1.5 w-full rounded-full" />
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

/** Normalize model name to short label */
function modelLabel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('haiku')) return 'haiku';
  return 'sonnet';
}

const MODEL_COLORS: Record<string, string> = {
  opus: 'bg-nothing-amber',
  sonnet: 'bg-nothing-blue',
  haiku: 'bg-nothing-green',
};

interface ModelBarProps {
  modelUsage: Record<string, number>;
}

function ModelBar({ modelUsage }: ModelBarProps) {
  const buckets: Record<string, number> = {};
  let total = 0;
  for (const [model, tokens] of Object.entries(modelUsage)) {
    const label = modelLabel(model);
    buckets[label] = (buckets[label] ?? 0) + tokens;
    total += tokens;
  }
  if (total === 0) return null;
  const segments = Object.entries(buckets).map(([label, tokens]) => ({
    label,
    pct: (tokens / total) * 100,
  }));

  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <Cpu className="w-2.5 h-2.5 text-nothing-text-dim" />
        <span className="font-mono text-[8px] uppercase tracking-wider text-nothing-text-dim">
          Model mix
        </span>
      </div>
      <div className="flex h-1.5 w-full rounded-full overflow-hidden gap-px">
        {segments.map(({ label, pct }) => (
          <div
            key={label}
            title={`${label}: ${pct.toFixed(0)}%`}
            className={`h-full ${MODEL_COLORS[label] ?? 'bg-nothing-surface2'}`}
            style={{ width: `${pct}%` }}
          />
        ))}
      </div>
      <div className="flex gap-2 mt-1">
        {segments.map(({ label, pct }) => (
          <span key={label} className="font-mono text-[8px] text-nothing-text-dim">
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-0.5 ${MODEL_COLORS[label] ?? 'bg-nothing-surface2'}`} />
            {label} {pct.toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: Project;
  maxTokens: number;
  index: number;
}

function ProjectCard({ project, maxTokens, index }: ProjectCardProps) {
  const barWidth = maxTokens > 0 ? (project.totalTokens / maxTokens) * 100 : 0;
  const lastActiveDate = safeParseDate(project.lastActive);
  const relativeTime = lastActiveDate
    ? formatDistanceToNow(lastActiveDate, { addSuffix: true })
    : 'No activity';
  const totalTools = Object.values(project.toolUsage).reduce((a, b) => a + b, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.07, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className="group"
    >
      <motion.div
        className="rounded-nothing border border-nothing-border bg-nothing-surface h-full transition-shadow duration-200 group-hover:shadow-[0_0_0_1px_var(--nothing-border2),0_4px_24px_rgba(91,155,246,0.08)]"
        whileHover={{ borderColor: 'var(--nothing-border2)' }}
        transition={{ duration: 0.15 }}
      >
        <CardContent className="p-4 flex flex-col gap-3">
          {/* Title + last active */}
          <div>
            <h3 className="font-mono font-bold text-sm text-nothing-text leading-tight truncate">
              {project.displayName}
            </h3>
            <p className="font-mono text-[9px] text-nothing-text-muted mt-0.5 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5 inline" />
              {relativeTime}
            </p>
          </div>

          {/* Primary stats — tokens + cost prominent */}
          <div className="flex items-end justify-between gap-2 border-b border-nothing-border pb-3">
            <div>
              <div className="font-mono text-[8px] uppercase tracking-wider text-nothing-text-dim mb-0.5">Tokens</div>
              <div className="font-mono text-[18px] leading-none text-nothing-text font-bold tracking-tight">{formatTokens(project.totalTokens)}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[8px] uppercase tracking-wider text-nothing-text-dim mb-0.5">Est. Cost</div>
              <div className="font-mono text-[18px] leading-none text-nothing-amber font-bold tracking-tight">{formatCost(project.totalCost)}</div>
            </div>
          </div>
          {/* Secondary stats */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div>
              <div className="font-mono text-[8px] uppercase tracking-wider text-nothing-text-dim">Sessions</div>
              <div className="font-mono text-xs text-nothing-text font-bold">{project.sessionCount}</div>
            </div>
            <div>
              <div className="font-mono text-[8px] uppercase tracking-wider text-nothing-text-dim">Messages</div>
              <div className="font-mono text-xs text-nothing-text font-bold">{project.totalMessages.toLocaleString()}</div>
            </div>
          </div>

          {/* Tool usage count */}
          {totalTools > 0 && (
            <div className="flex items-center gap-1.5">
              <Wrench className="w-2.5 h-2.5 text-nothing-text-dim" />
              <span className="font-mono text-[9px] text-nothing-text-muted">
                {totalTools.toLocaleString()} tool calls
              </span>
            </div>
          )}

          {/* Model distribution bar */}
          {Object.keys(project.modelUsage).length > 0 && (
            <ModelBar modelUsage={project.modelUsage} />
          )}

          {/* Relative activity bar (now by tokens) */}
          <div className="mt-auto">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[8px] uppercase tracking-wider text-nothing-text-dim">
                Relative activity
              </span>
              <span className="font-mono text-[8px] text-nothing-text-dim">
                {barWidth.toFixed(0)}%
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-nothing-surface2 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-nothing-blue"
                initial={{ width: 0 }}
                animate={{ width: `${barWidth}%` }}
                transition={{ duration: 0.6, delay: index * 0.06 + 0.3, ease: 'easeOut' }}
              />
            </div>
          </div>
        </CardContent>
      </motion.div>
    </motion.div>
  );
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function ProjectsBarTooltip(props: Parameters<typeof ChartTooltip>[0]) {
  return (
    <ChartTooltip
      {...props}
      formatter={(value) => {
        const n = Number(value);
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K tokens`;
        return `${n} tokens`;
      }}
    />
  );
}

// ─── Custom Y-axis tick (truncated project names) ─────────────────────────────

function YAxisTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
}) {
  const name = payload?.value ?? '';
  const truncated = name.length > 20 ? name.slice(0, 20) + '…' : name;
  return (
    <text
      x={x}
      y={y}
      dx={-6}
      textAnchor="end"
      dominantBaseline="middle"
      fill={CHART_DEFAULTS.tickColor}
      fontSize={9}
      fontFamily="'Space Mono', monospace"
    >
      {truncated}
    </text>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-24 gap-3"
    >
      <FolderOpen className="w-10 h-10 text-nothing-text-dim" />
      <p className="font-mono text-xs text-nothing-text-muted uppercase tracking-widest">
        No projects found
      </p>
      <p className="font-mono text-[9px] text-nothing-text-dim text-center max-w-xs">
        Projects appear here once Claude Code sessions are detected.
      </p>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/projects');
        if (!res.ok) throw new Error('Failed to fetch projects');
        const data: Project[] = await res.json();
        // Sort by lastActive descending
        data.sort((a, b) => {
          const da = safeParseDate(a.lastActive)?.getTime() ?? 0;
          const db = safeParseDate(b.lastActive)?.getTime() ?? 0;
          return db - da;
        });
        setProjects(data);
      } catch (err) {
        console.error('Projects fetch error:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const totalSessions = projects.reduce((sum, p) => sum + p.sessionCount, 0);
  const totalTokensAll = projects.reduce((sum, p) => sum + p.totalTokens, 0);
  const totalCostAll = projects.reduce((sum, p) => sum + p.totalCost, 0);
  const mostActive = projects.reduce<Project | null>(
    (max, p) => (!max || p.totalTokens > (max.totalTokens ?? 0) ? p : max),
    null,
  );
  const maxTokens = mostActive?.totalTokens ?? 1;

  // Chart data — sorted by total tokens descending
  const chartData = [...projects]
    .filter((p) => p.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .map((p) => ({
      name: p.displayName,
      tokens: p.totalTokens,
    }));

  const barHeight = Math.max(chartData.length * 36, 120);

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-nothing-blue" />
        <h1 className="font-mono text-xs uppercase tracking-[0.15em] text-nothing-text-secondary">
          Projects
        </h1>
      </div>

      {/* ── Summary metrics ── */}
      <div className="grid grid-cols-3 gap-4">
        {loading ? (
          <>
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              label="Total Projects"
              value={projects.length}
              accentColor={CHART_COLORS.blue}
              delay={0}
            />
            <MetricCard
              label="Total Sessions"
              value={totalSessions}
              accentColor={CHART_COLORS.cyan}
              delay={0.05}
            />
            <MetricCard
              label="Total Tokens"
              value={formatTokens(totalTokensAll)}
              subtitle={`~${formatCost(totalCostAll)} est.`}
              accentColor={CHART_COLORS.green}
              delay={0.1}
            />
          </>
        )}
      </div>

      {/* ── Project cards grid ── */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {projects.map((project, i) => (
            <ProjectCard
              key={project.slug}
              project={project}
              maxTokens={maxTokens}
              index={i}
            />
          ))}
        </div>
      )}

      {/* ── Sessions by project bar chart ── */}
      {!loading && projects.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.35, ease: 'easeOut' }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Tokens by Project</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <ResponsiveContainer width="100%" height={barHeight}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 0, right: 16, bottom: 0, left: 110 }}
                  barCategoryGap="30%"
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke={CHART_DEFAULTS.gridColor}
                    strokeDasharray="2 4"
                  />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{
                      fill: CHART_DEFAULTS.tickColor,
                      fontSize: 9,
                      fontFamily: "'Space Mono', monospace",
                    }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_DEFAULTS.gridColor }}
                    tickFormatter={(v) => {
                      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
                      if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
                      return String(v);
                    }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={YAxisTick as unknown as React.ReactElement}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    content={<ProjectsBarTooltip />}
                    cursor={{ fill: 'var(--nothing-surface2)', fillOpacity: 0.5 }}
                  />
                  <Bar
                    dataKey="tokens"
                    fill={CHART_COLORS.blue}
                    radius={[0, 3, 3, 0]}
                    maxBarSize={18}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
