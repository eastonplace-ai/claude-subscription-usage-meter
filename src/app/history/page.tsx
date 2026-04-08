'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';

// ── Types ──────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  return format(new Date(ts), 'MMM d, h:mm a');
}

function projectName(project: string): string {
  const parts = project.split('/');
  return parts[parts.length - 1] || project;
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-nothing bg-nothing-surface2 animate-pulse ${className}`} />
  );
}

// ── Entry Row ──────────────────────────────────────────────────────────────────

function HistoryRow({ entry, delay }: { entry: HistoryEntry; delay: number }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const name = projectName(entry.project);
  const isLong = entry.display.length > 80;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay, ease: 'easeOut' }}
      className="group relative flex items-start gap-3 px-4 py-3 border-b border-nothing-border last:border-b-0 hover:bg-nothing-surface2/40 transition-colors"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Timestamp */}
      <span className="font-mono text-[9px] text-nothing-text-dim shrink-0 pt-0.5 w-[105px] tabular-nums">
        {formatTs(entry.timestamp)}
      </span>

      {/* Command text */}
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[11px] text-nothing-text-secondary group-hover:text-nothing-text truncate transition-colors duration-100">
          {entry.display}
        </p>
      </div>

      {/* Project badge */}
      <Badge variant="estimated" className="shrink-0">
        {name}
      </Badge>

      {/* Full text tooltip on hover */}
      <AnimatePresence>
        {showTooltip && isLong && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-4 top-full z-50 mt-1 max-w-lg rounded-nothing border border-nothing-border2 bg-nothing-surface2 px-3 py-2 shadow-2xl"
          >
            <p className="font-mono text-[10px] text-nothing-text-secondary leading-relaxed whitespace-pre-wrap break-words">
              {entry.display}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function HistoryPage() {
  const [data, setData] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch('/api/history');
        if (res.ok) {
          const json: HistoryEntry[] = await res.json();
          json.sort((a, b) => b.timestamp - a.timestamp);
          setData(json);
        }
      } catch (e) {
        console.error('Failed to fetch history', e);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, []);

  const projectOptions = useMemo(() => {
    const names = Array.from(new Set(data.map((e) => projectName(e.project)))).sort();
    return names;
  }, [data]);

  const filtered = useMemo(() => {
    let result = data;
    if (projectFilter !== 'all') {
      result = result.filter((e) => projectName(e.project) === projectFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) => e.display.toLowerCase().includes(q));
    }
    return result;
  }, [data, search, projectFilter]);

  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;

  useEffect(() => { setPage(1); }, [search, projectFilter]);

  // ── Loading skeleton ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-3">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-44" />
        </div>
        <div className="rounded-nothing border border-nothing-border overflow-hidden">
          {Array.from({ length: 14 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3 border-b border-nothing-border last:border-b-0"
            >
              <Skeleton className="h-3 w-[105px]" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-nothing-text-muted">
          No history found
        </span>
        <span className="font-mono text-[9px] text-nothing-text-dim">
          Command history will appear here once Claude Code is used
        </span>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      {/* Search + Filter */}
      <div className="flex gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search commands..."
          className="flex-1 h-9 px-3 rounded-nothing border border-nothing-border bg-nothing-surface font-mono text-[11px] text-nothing-text placeholder:text-nothing-text-dim focus:outline-none focus:border-nothing-border2 focus:ring-1 focus:ring-nothing-border2/40 focus:ring-offset-0 transition-all duration-150"
        />
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="h-9 px-3 rounded-nothing border border-nothing-border bg-nothing-surface font-mono text-[10px] text-nothing-text-secondary uppercase tracking-wider focus:outline-none focus:border-nothing-border2 transition-colors cursor-pointer appearance-none pr-6"
        >
          <option value="all">All Projects</option>
          {projectOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {/* Count row */}
      <div className="flex items-center justify-between px-1">
        <span className="font-mono text-[9px] uppercase tracking-wider text-nothing-text-muted">
          {filtered.length.toLocaleString()} commands
          {search.trim() && ` matching "${search}"`}
        </span>
        <Badge variant="estimated">
          {Math.min(visible.length, filtered.length)} / {filtered.length}
        </Badge>
      </div>

      {/* List or no-results */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 border border-nothing-border rounded-nothing gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-nothing-text-muted">
            No results
          </span>
        </div>
      ) : (
        <div className="rounded-nothing border border-nothing-border overflow-hidden bg-nothing-surface">
          {visible.map((entry, i) => (
            <HistoryRow
              key={`${entry.sessionId}-${entry.timestamp}-${i}`}
              entry={entry}
              delay={Math.min(i * 0.012, 0.35)}
            />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex justify-center pt-2"
        >
          <motion.button
            onClick={() => setPage((p) => p + 1)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="font-mono text-[10px] uppercase tracking-wider text-nothing-text-muted border border-nothing-border rounded-nothing px-6 py-2.5 hover:border-nothing-border3 hover:text-nothing-text-secondary hover:bg-nothing-surface2/30 transition-all duration-150"
          >
            Load more
            <span className="ml-2 text-nothing-text-dim">
              {filtered.length - visible.length} remaining
            </span>
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}
