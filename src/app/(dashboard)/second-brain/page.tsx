'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge } from '@/components/ui/badge';
import {
  ChartWrapper,
  ChartTooltip,
  ChartYAxisTick,
  CHART_DEFAULTS,
} from '@/components/ui/chart-wrapper';

// ─── Colors ─────────────────────────────────────────────────────────────────────

const OBSIDIAN_PURPLE = '#7C3AED';
const KHOJ_ORANGE = '#F59E0B';
const GRAPHIFY_GREEN = '#10B981';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface SecondBrainData {
  vault: { notes: number; decisions: number; sessions: number; projects: number };
  graphify: { nodes: number; edges: number; communities: number };
  khoj: { online: boolean; avgLatencyMs: number; totalResults: number };
  telemetry: {
    totalEntries: number;
    last24h: number;
    last7d: number;
    hitRate: number;
    avgLatencyMs: number;
    totalInjections: number;
    totalNoMatch: number;
    totalBytesInjected: number;
    totalFilesInjected: number;
    obsidianEvents: number;
    obsidianHitRate: number;
    obsidianBytesInjected: number;
    khojEvents: number;
    khojHitRate: number;
    khojBytesInjected: number;
    graphifyEvents: number;
    graphifyHitRate: number;
    graphifyBytesInjected: number;
    contextTokens: { obsidian: number; khoj: number; graphify: number; total: number };
  };
  hourlyActivity: { hour: string; obsidian: number; khoj: number; graphify: number }[];
  topFiles: { file: string; count: number }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

function hitRateColor(rate: number): string {
  if (rate >= 70) return '#4A9E5C';
  if (rate >= 40) return '#D4A843';
  return '#D71921';
}

// ─── Skeletons ───────────────────────────────────────────────────────────────────

function friendlyFileName(filePath: string): string {
  const p = filePath.replace(/\\/g, '/');

  // Session with precompact suffix: sessions/2026-04-06-14-30-precompact
  const precompactMatch = p.match(/sessions\/(\d{4})-(\d{2})-(\d{2}).*precompact/i);
  if (precompactMatch) {
    const d = new Date(`${precompactMatch[1]}-${precompactMatch[2]}-${precompactMatch[3]}`);
    return `Precompact ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }

  // Session date: sessions/2026-04-06 or sessions/2026-04-06-HH-MM-...
  const sessionMatch = p.match(/sessions\/(\d{4})-(\d{2})-(\d{2})/i);
  if (sessionMatch) {
    const d = new Date(`${sessionMatch[1]}-${sessionMatch[2]}-${sessionMatch[3]}`);
    return `Session ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }

  // Known project name overrides
  const knownProjects: Record<string, string> = {
    'agentsmonitor': 'Agents Monitor',
    'architecture': 'Architecture',
    'dashboard-claude': 'Dashboard Config',
    'dashboard': 'Dashboard Config',
    'database': 'Database Schema',
    'mcps': 'MCPs',
    'command-palette': 'Command Palette',
    'header': 'Header',
  };

  // Extract just the filename (no directory, no extension)
  const parts = p.split('/');
  const basename = parts[parts.length - 1];
  const ext = basename.includes('.') ? basename.split('.').pop()!.toLowerCase() : '';
  const name = ext ? basename.slice(0, -(ext.length + 1)) : basename;

  if (knownProjects[name.toLowerCase()]) return knownProjects[name.toLowerCase()];

  // Title-case helper
  const titleCase = (s: string) =>
    s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const friendlyName = titleCase(name);

  if (['tsx', 'ts', 'js', 'jsx'].includes(ext)) return `${friendlyName} (Code)`;
  return friendlyName;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-nothing-border ${className ?? ''}`} />;
}

function StatusCardSkeleton() {
  return (
    <div className="rounded-nothing border border-nothing-border bg-nothing-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-16 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2 pt-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-2 w-14" />
            <Skeleton className="h-5 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── fadeUp animation ────────────────────────────────────────────────────────────

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, delay, ease: 'easeOut' },
});

// ─── Status Dot ──────────────────────────────────────────────────────────────────

function StatusDot({ online, color }: { online: boolean; color: string }) {
  return (
    <span className="relative flex items-center gap-1.5">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: online ? '#4A9E5C' : '#D71921' }}
      />
      <span
        className="font-mono text-[9px] uppercase tracking-[0.12em]"
        style={{ color: online ? '#4A9E5C' : '#D71921' }}
      >
        {online ? 'online' : 'offline'}
      </span>
    </span>
  );
}

// ─── System Cards ────────────────────────────────────────────────────────────────

function ObsidianCard({ vault, delay }: { vault: SecondBrainData['vault']; delay: number }) {
  return (
    <motion.div {...fadeUp(delay)}>
      <motion.div
        whileHover={{ boxShadow: `0 0 0 1px ${OBSIDIAN_PURPLE}33, 0 4px 20px ${OBSIDIAN_PURPLE}18` }}
        transition={{ duration: 0.2 }}
        className="rounded-nothing h-full"
      >
        <Card variant="accent" accentColor={OBSIDIAN_PURPLE} className="h-full">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-base">🧠</span>
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: OBSIDIAN_PURPLE }}>
                  Obsidian Vault
                </span>
              </div>
              <StatusDot online={true} color={OBSIDIAN_PURPLE} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Notes', value: vault.notes },
                { label: 'Decisions', value: vault.decisions },
                { label: 'Sessions', value: vault.sessions },
                { label: 'Projects', value: vault.projects },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-dim mb-0.5">{label}</p>
                  <p className="font-mono text-lg font-bold" style={{ color: OBSIDIAN_PURPLE }}>{fmt(value)}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-nothing-border">
              <p className="font-mono text-[8px] text-nothing-text-dim uppercase tracking-[0.1em]">
                Hook: per-turn keyword grep · session start inject
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

function KhojCard({ khoj, telemetry, delay }: { khoj: SecondBrainData['khoj']; telemetry: SecondBrainData['telemetry']; delay: number }) {
  return (
    <motion.div {...fadeUp(delay)}>
      <motion.div
        whileHover={{ boxShadow: `0 0 0 1px ${KHOJ_ORANGE}33, 0 4px 20px ${KHOJ_ORANGE}18` }}
        transition={{ duration: 0.2 }}
        className="rounded-nothing h-full"
      >
        <Card variant="accent" accentColor={KHOJ_ORANGE} className="h-full">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-base">🔍</span>
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: KHOJ_ORANGE }}>
                  Khoj / Gemma
                </span>
              </div>
              <StatusDot online={khoj.online} color={KHOJ_ORANGE} />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-dim mb-0.5">Queries</p>
                  <p className="font-mono text-sm font-bold" style={{ color: KHOJ_ORANGE }}>{fmt(telemetry.khojEvents)}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-dim mb-0.5">Results</p>
                  <p className="font-mono text-sm font-bold" style={{ color: KHOJ_ORANGE }}>{fmt(khoj.totalResults)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-dim mb-0.5">Avg Latency</p>
                  <p className="font-mono text-[10px] text-nothing-text-secondary">{khoj.avgLatencyMs > 0 ? `${fmt(khoj.avgLatencyMs)}ms` : '—'}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-dim mb-0.5">Hit Rate</p>
                  <p className="font-mono text-[10px] text-nothing-text-secondary">{telemetry.khojHitRate}%</p>
                </div>
              </div>
              <div>
                <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-dim mb-0.5">Model</p>
                <p className="font-mono text-[10px] text-nothing-text-secondary">Gemma 4 · localhost:42110</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-nothing-border">
              <p className="font-mono text-[8px] text-nothing-text-dim uppercase tracking-[0.1em]">
                Ollama backend · vector embeddings
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

function GraphifyCard({ graphify, delay }: { graphify: SecondBrainData['graphify']; delay: number }) {
  return (
    <motion.div {...fadeUp(delay)}>
      <motion.div
        whileHover={{ boxShadow: `0 0 0 1px ${GRAPHIFY_GREEN}33, 0 4px 20px ${GRAPHIFY_GREEN}18` }}
        transition={{ duration: 0.2 }}
        className="rounded-nothing h-full"
      >
        <Card variant="accent" accentColor={GRAPHIFY_GREEN} className="h-full">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-base">🕸️</span>
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: GRAPHIFY_GREEN }}>
                  Graphify
                </span>
              </div>
              <StatusDot online={graphify.nodes > 0} color={GRAPHIFY_GREEN} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Nodes', value: graphify.nodes },
                { label: 'Edges', value: graphify.edges },
                { label: 'Communities', value: graphify.communities },
                { label: 'Type', value: null, text: 'AST' },
              ].map(({ label, value, text }) => (
                <div key={label}>
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-dim mb-0.5">{label}</p>
                  {text
                    ? <p className="font-mono text-sm font-bold" style={{ color: GRAPHIFY_GREEN }}>{text}</p>
                    : <p className="font-mono text-lg font-bold" style={{ color: GRAPHIFY_GREEN }}>{fmt(value ?? 0)}</p>
                  }
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-nothing-border">
              <p className="font-mono text-[8px] text-nothing-text-dim uppercase tracking-[0.1em]">
                Code structure graph · community detection
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-8 h-8 rounded-full border border-nothing-border flex items-center justify-center mb-3">
        <span className="text-nothing-text-dim text-xs">—</span>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-nothing-text-dim max-w-xs">{message}</p>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────────

export default function SecondBrainPage() {
  const [data, setData] = useState<SecondBrainData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/second-brain')
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const hasTopFiles = data && data.topFiles.length > 0;

  return (
    <div className="flex-1 overflow-y-auto bg-nothing-bg">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Page Header */}
        <motion.div {...fadeUp(0)}>
          <div className="flex items-baseline gap-3">
            <h1 className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-nothing-text">
              Second Brain
            </h1>
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-nothing-text-dim">
              Obsidian · Khoj · Graphify
            </span>
          </div>
          <p className="font-mono text-[9px] text-nothing-text-dim mt-1 uppercase tracking-[0.1em]">
            Knowledge system effectiveness · hook telemetry · context injection
          </p>
        </motion.div>

        {/* Row 1: System Status Cards */}
        <div className="grid grid-cols-3 gap-4">
          {loading ? (
            <>
              <StatusCardSkeleton />
              <StatusCardSkeleton />
              <StatusCardSkeleton />
            </>
          ) : data ? (
            <>
              <ObsidianCard vault={data.vault} delay={0.05} />
              <KhojCard khoj={data.khoj} telemetry={data.telemetry} delay={0.1} />
              <GraphifyCard graphify={data.graphify} delay={0.15} />
            </>
          ) : null}
        </div>

        {/* Row 2: Effectiveness Metrics */}
        <motion.div {...fadeUp(0.2)}>
          <div className="grid grid-cols-4 gap-4">
            {loading ? (
              [...Array(4)].map((_, i) => (
                <div key={i} className="rounded-nothing border border-nothing-border bg-nothing-surface p-4 space-y-2">
                  <Skeleton className="h-2 w-20" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-2 w-24" />
                </div>
              ))
            ) : data ? (
              <>
                <MetricCard
                  label="Context Hit Rate"
                  value={`${data.telemetry.hitRate.toFixed(1)}%`}
                  subtitle={`${data.telemetry.totalInjections} injections / ${data.telemetry.totalNoMatch} misses`}
                  accentColor={hitRateColor(data.telemetry.hitRate)}
                />
                <MetricCard
                  label="Avg Latency"
                  value={data.telemetry.avgLatencyMs > 0 ? `${data.telemetry.avgLatencyMs}ms` : '—'}
                  subtitle="hook response time"
                  accentColor={OBSIDIAN_PURPLE}
                />
                <MetricCard
                  label="Total Injections"
                  value={fmt(data.telemetry.totalInjections)}
                  subtitle={`${data.telemetry.last24h} events last 24h`}
                  accentColor={OBSIDIAN_PURPLE}
                />
                <MetricCard
                  label="Files Served"
                  value={fmt(data.telemetry.totalFilesInjected)}
                  subtitle={fmtBytes(data.telemetry.totalBytesInjected) + ' total'}
                  accentColor={GRAPHIFY_GREEN}
                />
              </>
            ) : null}
          </div>
        </motion.div>

        {/* Row 2.5: Per-Source Hit Rates */}
        {data && data.telemetry.totalEntries > 0 && (
          <motion.div {...fadeUp(0.22)}>
            <Card>
              <CardHeader>
                <CardTitle>Source Effectiveness</CardTitle>
                <Badge variant="estimated">Per-system hit rates</Badge>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-6">
                  {[
                    { label: 'Obsidian Vault', color: OBSIDIAN_PURPLE, hitRate: data.telemetry.obsidianHitRate, events: data.telemetry.obsidianEvents, bytes: data.telemetry.obsidianBytesInjected },
                    { label: 'Khoj / Gemma', color: KHOJ_ORANGE, hitRate: data.telemetry.khojHitRate, events: data.telemetry.khojEvents, bytes: data.telemetry.khojBytesInjected },
                    { label: 'Graphify', color: GRAPHIFY_GREEN, hitRate: data.telemetry.graphifyHitRate, events: data.telemetry.graphifyEvents, bytes: data.telemetry.graphifyBytesInjected },
                  ].map(({ label, color, hitRate, events, bytes }) => (
                    <div key={label} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-nothing-text-dim">{label}</span>
                        <span className="font-mono text-[8px] text-nothing-text-dim">{events} events</span>
                      </div>
                      <div className="flex items-end gap-2">
                        <span className="font-mono text-2xl font-bold" style={{ color }}>{hitRate}%</span>
                        <span className="font-mono text-[9px] text-nothing-text-dim mb-1">hit rate</span>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: 'var(--nothing-surface2)' }}>
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(hitRate, 100)}%` }}
                          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </div>
                      {bytes > 0 && (
                        <p className="font-mono text-[8px] uppercase tracking-[0.1em]" style={{ color }}>
                          {fmtBytes(bytes)} injected
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Row 2.7: Context Injection */}
        {data && (
          <motion.div {...fadeUp(0.24)}>
            <Card>
              <CardHeader>
                <CardTitle>Context Injection</CardTitle>
                <Badge variant="estimated">Est. tokens per source · bytes ÷ 4</Badge>
              </CardHeader>
              <CardContent>
                {data.telemetry.contextTokens?.total === 0 ? (
                  <EmptyState message="No context injected yet — tokens will appear once hooks fire." />
                ) : (
                  <div className="space-y-4">
                    {/* Three token counts */}
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { label: 'Obsidian', color: OBSIDIAN_PURPLE, tokens: data.telemetry.contextTokens?.obsidian },
                        { label: 'Khoj', color: KHOJ_ORANGE, tokens: data.telemetry.contextTokens?.khoj },
                        { label: 'Graphify', color: GRAPHIFY_GREEN, tokens: data.telemetry.contextTokens?.graphify },
                      ].map(({ label, color, tokens }) => (
                        <div key={label} className="space-y-1">
                          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-dim">{label}</p>
                          <p className="font-mono text-xl font-bold" style={{ color }}>
                            ~{fmt(tokens)}
                          </p>
                          <p className="font-mono text-[8px] text-nothing-text-dim">tokens</p>
                        </div>
                      ))}
                    </div>

                    {/* Stacked bar */}
                    <div className="space-y-2">
                      <div className="w-full h-2 rounded-full overflow-hidden flex" style={{ backgroundColor: 'var(--nothing-surface2)' }}>
                        {[
                          { color: OBSIDIAN_PURPLE, tokens: data.telemetry.contextTokens?.obsidian },
                          { color: KHOJ_ORANGE, tokens: data.telemetry.contextTokens?.khoj },
                          { color: GRAPHIFY_GREEN, tokens: data.telemetry.contextTokens?.graphify },
                        ].map(({ color, tokens }, i) => {
                          const pct = data.telemetry.contextTokens?.total > 0
                            ? (tokens / data.telemetry.contextTokens?.total) * 100
                            : 0;
                          return pct > 0 ? (
                            <motion.div
                              key={i}
                              style={{ backgroundColor: color, width: `${pct}%` }}
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.9, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                            />
                          ) : null;
                        })}
                      </div>
                      <p className="font-mono text-[9px] text-nothing-text-dim uppercase tracking-[0.1em]">
                        ~{fmt(data.telemetry.contextTokens?.total)} total context tokens injected
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Row 3: Source Distribution Donut */}
        {data && (
          <motion.div {...fadeUp(0.25)}>
            <Card>
              <CardHeader>
                <CardTitle>Source Distribution</CardTitle>
                <Badge variant="estimated">Share of events by source</Badge>
              </CardHeader>
              <CardContent>
                {(() => {
                  const total = data.telemetry.obsidianEvents + data.telemetry.khojEvents + data.telemetry.graphifyEvents;
                  const pieData = [
                    { name: 'Obsidian', value: data.telemetry.obsidianEvents, color: OBSIDIAN_PURPLE },
                    { name: 'Khoj', value: data.telemetry.khojEvents, color: KHOJ_ORANGE },
                    { name: 'Graphify', value: data.telemetry.graphifyEvents, color: GRAPHIFY_GREEN },
                  ].filter(d => d.value > 0);

                  if (total === 0) {
                    return <EmptyState message="Collecting data... Source events will appear here as you use Claude Code." />;
                  }

                  return (
                    <div className="flex items-center justify-center gap-12 py-4">
                      {/* Donut */}
                      <div className="relative" style={{ width: 250, height: 250 }}>
                        <PieChart width={250} height={250}>
                          <Pie
                            data={pieData}
                            cx={125}
                            cy={125}
                            innerRadius={72}
                            outerRadius={110}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {pieData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                        {/* Center label */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                          <span className="font-mono text-2xl font-bold text-nothing-text">{fmt(total)}</span>
                          <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-dim mt-0.5">total events</span>
                        </div>
                      </div>

                      {/* Legend */}
                      <div className="space-y-4">
                        {pieData.map(({ name, value, color }) => {
                          const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                          return (
                            <div key={name} className="flex items-center gap-3 min-w-[180px]">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              <div className="flex-1">
                                <div className="flex items-center justify-between gap-4">
                                  <span className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color }}>{name}</span>
                                  <span className="font-mono text-[9px] text-nothing-text-dim">{pct}%</span>
                                </div>
                                <div className="flex items-center justify-between gap-4 mt-0.5">
                                  <span className="font-mono text-sm font-bold" style={{ color }}>{fmt(value)}</span>
                                  <span className="font-mono text-[8px] text-nothing-text-dim">events</span>
                                </div>
                                {/* Mini bar */}
                                <div className="w-full h-1 rounded-full mt-1.5" style={{ backgroundColor: 'var(--nothing-surface2)' }}>
                                  <motion.div
                                    className="h-full rounded-full"
                                    style={{ backgroundColor: color }}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${pct}%` }}
                                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Row 4: Top Knowledge Files */}
        <motion.div {...fadeUp(0.3)}>
          <Card>
            <CardHeader>
              <CardTitle>Top Knowledge Files</CardTitle>
            </CardHeader>
            <CardContent>
              {!hasTopFiles ? (
                <EmptyState message="No data yet — files will appear here once hooks start matching vault content." />
              ) : (
                <ChartWrapper height={Math.max(200, data!.topFiles.length * 32)}>
                  <BarChart
                    data={data!.topFiles.map(f => ({
                      ...f,
                      file: friendlyFileName(f.file),
                    }))}
                    layout="vertical"
                    {...CHART_DEFAULTS}
                    margin={{ top: 4, right: 16, bottom: 4, left: 16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--nothing-border)" horizontal={false} />
                    <XAxis type="number" tick={<ChartYAxisTick />} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="file"
                      tick={<ChartYAxisTick />}
                      tickLine={false}
                      axisLine={false}
                      width={220}
                      interval={0}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" radius={[0, 3, 3, 0]} name="Matches">
                      {data!.topFiles.map((_, i) => (
                        <Cell key={i} fill={OBSIDIAN_PURPLE} fillOpacity={1 - i * 0.06} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartWrapper>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Row 5: System Architecture */}
        <motion.div {...fadeUp(0.35)}>
          <Card>
            <CardHeader>
              <CardTitle>How It Works</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-6">
                {[
                  {
                    color: OBSIDIAN_PURPLE,
                    icon: '🧠',
                    title: 'Obsidian Hooks',
                    steps: [
                      'Session start → inject index.md + active.md (~2KB)',
                      'Per-turn → keyword grep on vault notes',
                      'Precompact → capture session state to Sessions/',
                      'Stop → append cost + tool summary',
                    ],
                  },
                  {
                    color: KHOJ_ORANGE,
                    icon: '🔍',
                    title: 'Khoj / Gemma 4',
                    steps: [
                      'Semantic search on every turn (parallel with grep)',
                      'Vector embeddings over entire vault',
                      'Gemma 4 LLM via local Ollama (20s timeout)',
                      'API at localhost:42110',
                    ],
                  },
                  {
                    color: GRAPHIFY_GREEN,
                    icon: '🕸️',
                    title: 'Graphify',
                    steps: [
                      'AST parsing → code entity extraction',
                      'Builds nodes (files, functions, classes)',
                      'Edges = import/call/reference relationships',
                      'Community detection → logical code clusters',
                    ],
                  },
                ].map(({ color, icon, title, steps }) => (
                  <div key={title} className="space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-nothing-border">
                      <span className="text-sm">{icon}</span>
                      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color }}>
                        {title}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {steps.map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="font-mono text-[8px] mt-0.5 shrink-0" style={{ color }}>→</span>
                          <span className="font-mono text-[9px] text-nothing-text-secondary leading-relaxed">{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

      </div>
    </div>
  );
}
