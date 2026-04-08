'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  format,
  formatDistanceToNow,
  isToday,
  isThisWeek,
  isThisMonth,
} from 'date-fns';
import { Search, GitBranch, FileText, Calendar, FolderOpen, ChevronDown, Clock, Terminal, User, Bot, Wrench, Loader2 } from 'lucide-react';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge } from '@/components/ui/badge';
import { cn, safeParseDate } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  date: string;
  project: string;
  branch?: string;
  filesModified: string[];
  summary: string;
  filePath: string;
}

interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId: string;
}

interface ConversationTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  toolName?: string;
  model?: string;
}

type DateRange = 'today' | 'week' | 'month' | 'all';

// ─── Project color map ─────────────────────────────────────────────────────────

const PROJECT_COLORS = [
  '#5B9BF6', // blue
  '#4A9E5C', // green
  '#AF52DE', // purple
  '#D4A843', // amber
  '#4ECDC4', // cyan
  '#D71921', // red
];

function getProjectColor(project: string): string {
  let hash = 0;
  for (let i = 0; i < project.length; i++) {
    hash = project.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded bg-nothing-surface2 animate-pulse',
        className,
      )}
    />
  );
}

function SessionSkeleton({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: index * 0.06 }}
      className="flex gap-4"
    >
      {/* Date badge */}
      <div className="flex flex-col items-center gap-1 w-10 shrink-0">
        <SkeletonBlock className="w-10 h-12" />
        <div className="flex-1 w-px bg-nothing-border" />
      </div>

      {/* Card */}
      <div className="flex-1 border border-nothing-border bg-nothing-surface rounded-nothing p-4 mb-4 space-y-3">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="w-2 h-2 rounded-full" />
          <SkeletonBlock className="w-32 h-3" />
          <SkeletonBlock className="w-16 h-4 rounded-full ml-2" />
        </div>
        <SkeletonBlock className="w-full h-3" />
        <SkeletonBlock className="w-3/4 h-3" />
        <div className="flex gap-2">
          <SkeletonBlock className="w-20 h-5 rounded-full" />
          <SkeletonBlock className="w-24 h-5 rounded-full" />
          <SkeletonBlock className="w-16 h-5 rounded-full" />
        </div>
      </div>
    </motion.div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function cleanSummary(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .trim();
}

function SummaryText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const clean = cleanSummary(text);
  const isLong = clean.length > 140;
  const displayText = !expanded && isLong ? clean.slice(0, 140).trimEnd() + '…' : clean;

  return (
    <div>
      <AnimatePresence initial={false} mode="wait">
        <motion.p
          key={expanded ? 'full' : 'short'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="font-mono text-[10px] text-nothing-text-secondary leading-relaxed"
        >
          {displayText}
        </motion.p>
      </AnimatePresence>
      {isLong && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="font-mono text-[9px] uppercase tracking-[0.1em] text-nothing-blue mt-1 hover:text-nothing-blue/80 transition-colors"
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      )}
    </div>
  );
}

// ─── History timeline row ─────────────────────────────────────────────────────

function HistoryTimelineRow({ entry, delay }: { entry: HistoryEntry; delay: number }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const isLong = entry.display.length > 80;
  const time = format(new Date(entry.timestamp), 'HH:mm');

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, delay, ease: 'easeOut' }}
      className="group relative flex items-start gap-2.5 px-3 py-2 border-b border-nothing-border/50 last:border-b-0 hover:bg-nothing-surface/40 transition-colors"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Left accent line */}
      <div className="w-0.5 h-full shrink-0 bg-nothing-border2/40 rounded-full mt-0.5 self-stretch min-h-[14px]" />

      {/* Time */}
      <span className="font-mono text-[9px] text-nothing-text-dim shrink-0 w-9 tabular-nums pt-0.5">
        {time}
      </span>

      {/* Terminal icon */}
      <Terminal className="w-2.5 h-2.5 text-nothing-text-dim shrink-0 mt-0.5" />

      {/* Command text */}
      <p className="flex-1 min-w-0 font-mono text-[10px] text-nothing-text-secondary group-hover:text-nothing-text truncate transition-colors duration-100">
        {entry.display}
      </p>

      {/* Full text tooltip */}
      <AnimatePresence>
        {showTooltip && isLong && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-4 top-full z-50 mt-1 max-w-lg rounded-nothing border border-nothing-border2 bg-nothing-surface2 px-3 py-2 shadow-2xl pointer-events-none"
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

// ─── Conversation turn row ────────────────────────────────────────────────────

function ConversationTurnRow({ turn, index }: { turn: ConversationTurn; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = turn.content.length > 300;
  const displayContent = !expanded && isLong ? turn.content.slice(0, 300).trimEnd() + '…' : turn.content;

  const time = turn.timestamp
    ? (() => { try { return format(new Date(turn.timestamp), 'HH:mm:ss'); } catch { return ''; } })()
    : '';

  if (turn.role === 'tool' && !turn.content && turn.toolName) {
    // Tool call (no result content) — compact chip
    return (
      <motion.div
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.1, delay: Math.min(index * 0.008, 0.15) }}
        className="flex items-center gap-2 px-3 py-1.5 border-b border-nothing-border/30 last:border-b-0"
      >
        <span className="font-mono text-[9px] text-nothing-text-dim w-14 shrink-0 tabular-nums">{time}</span>
        <Wrench className="w-2.5 h-2.5 text-nothing-amber shrink-0" />
        <span className="font-mono text-[9px] text-nothing-amber bg-nothing-amber/8 border border-nothing-amber/20 px-1.5 py-0.5 rounded-full">
          {turn.toolName}
        </span>
      </motion.div>
    );
  }

  if (turn.role === 'tool') {
    // Tool result
    return (
      <motion.div
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.1, delay: Math.min(index * 0.008, 0.15) }}
        className="flex items-start gap-2 px-3 py-1.5 border-b border-nothing-border/30 last:border-b-0 bg-nothing-amber/3"
      >
        <span className="font-mono text-[9px] text-nothing-text-dim w-14 shrink-0 tabular-nums pt-0.5">{time}</span>
        <Wrench className="w-2.5 h-2.5 text-nothing-amber shrink-0 mt-0.5" />
        <p className="flex-1 font-mono text-[9px] text-nothing-text-dim leading-relaxed whitespace-pre-wrap break-words">
          {displayContent}
        </p>
      </motion.div>
    );
  }

  if (turn.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.1, delay: Math.min(index * 0.008, 0.15) }}
        className="flex items-start gap-2 px-3 py-2.5 border-b border-nothing-border/30 last:border-b-0 hover:bg-nothing-blue/3 transition-colors"
      >
        <span className="font-mono text-[9px] text-nothing-text-dim w-14 shrink-0 tabular-nums pt-0.5">{time}</span>
        <User className="w-2.5 h-2.5 text-nothing-blue shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] text-nothing-text leading-relaxed whitespace-pre-wrap break-words">
            {displayContent}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="font-mono text-[8px] uppercase tracking-[0.1em] text-nothing-blue mt-1 hover:opacity-80 transition-opacity"
            >
              {expanded ? 'collapse' : 'expand'}
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  // assistant
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.1, delay: Math.min(index * 0.008, 0.15) }}
      className="flex items-start gap-2 px-3 py-2.5 border-b border-nothing-border/30 last:border-b-0 bg-nothing-surface2/30 hover:bg-nothing-surface2/60 transition-colors"
    >
      <span className="font-mono text-[9px] text-nothing-text-dim w-14 shrink-0 tabular-nums pt-0.5">{time}</span>
      <Bot className="w-2.5 h-2.5 text-nothing-green shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[10px] text-nothing-text-secondary leading-relaxed whitespace-pre-wrap break-words">
          {displayContent}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="font-mono text-[8px] uppercase tracking-[0.1em] text-nothing-green mt-1 hover:opacity-80 transition-opacity"
          >
            {expanded ? 'collapse' : 'expand'}
          </button>
        )}
        {turn.model && (
          <span className="font-mono text-[8px] text-nothing-text-dim mt-1 block">{turn.model}</span>
        )}
      </div>
    </motion.div>
  );
}

// ─── Session conversation panel ───────────────────────────────────────────────

function ConversationPanel({ sessionId }: { sessionId: string }) {
  const [turns, setTurns] = useState<ConversationTurn[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setTurns(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) { setError(true); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 gap-2">
        <Loader2 className="w-3 h-3 text-nothing-text-dim animate-spin" />
        <span className="font-mono text-[9px] text-nothing-text-dim uppercase tracking-[0.1em]">Loading conversation…</span>
      </div>
    );
  }

  if (error || turns === null) {
    return (
      <div className="px-3 py-4">
        <p className="font-mono text-[9px] text-nothing-red">Failed to load conversation</p>
      </div>
    );
  }

  if (turns.length === 0) {
    return (
      <div className="px-3 py-4">
        <p className="font-mono text-[9px] text-nothing-text-dim">No conversation turns found for this session</p>
      </div>
    );
  }

  return (
    <div className="max-h-[480px] overflow-y-auto">
      {turns.map((turn, i) => (
        <ConversationTurnRow key={i} turn={turn} index={i} />
      ))}
    </div>
  );
}

// ─── Session card ─────────────────────────────────────────────────────────────

function SessionCard({
  session,
  index,
  historyEntries,
}: {
  session: Session;
  index: number;
  historyEntries: HistoryEntry[];
}) {
  const color = getProjectColor(session.project);
  const date = safeParseDate(session.date);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [conversationExpanded, setConversationExpanded] = useState(false);
  const MAX_FILES = 5;
  const visibleFiles = session.filesModified.slice(0, MAX_FILES);
  const overflowCount = session.filesModified.length - MAX_FILES;

  // Sort history entries by timestamp ascending
  const sortedHistory = useMemo(
    () => [...historyEntries].sort((a, b) => a.timestamp - b.timestamp),
    [historyEntries],
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05, ease: 'easeOut' }}
      className="flex gap-4"
    >
      {/* Date badge + timeline line */}
      <div className="flex flex-col items-center gap-0 w-10 shrink-0">
        {/* Date badge — sticky */}
        <div className="sticky top-4 bg-nothing-surface2 border border-nothing-border2 rounded-nothing-sm px-1.5 py-1.5 flex flex-col items-center w-10 shrink-0 shadow-[0_0_0_1px_var(--nothing-border)]">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-nothing-text-muted leading-none">
            {date ? format(date, 'MMM') : '—'}
          </span>
          <span className="font-mono text-[16px] font-bold text-nothing-text leading-none mt-0.5">
            {date ? format(date, 'd') : '?'}
          </span>
        </div>
        {/* Timeline line — gradient fade at bottom */}
        <div className="flex-1 w-px mt-1" style={{ background: 'linear-gradient(to bottom, var(--nothing-surface2) 0%, var(--nothing-surface) 60%, transparent 100%)' }} />
      </div>

      {/* Card */}
      <motion.div
        whileHover={{ borderColor: 'var(--nothing-border2)', boxShadow: `0 0 0 1px var(--nothing-border), 0 2px 12px rgba(0,0,0,0.15)` }}
        transition={{ duration: 0.15 }}
        className={cn(
          'flex-1 border border-nothing-border rounded-nothing mb-4 overflow-hidden',
          index % 2 === 0 ? 'bg-nothing-surface' : 'bg-nothing-bg',
        )}
      >
        {/* Main card content — clickable for files */}
        <div
          className="p-4 cursor-pointer"
          onClick={() => setFilesExpanded((e) => !e)}
        >
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              {/* Colored project dot */}
              <span
                className="w-2 h-2 rounded-full shrink-0 mt-0.5"
                style={{ backgroundColor: color }}
              />
              <span className="font-mono text-[11px] font-bold text-nothing-text truncate">
                {session.project}
              </span>
              {session.branch && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-nothing-border2 bg-nothing-surface2 font-mono text-[8px] uppercase tracking-[0.1em] text-nothing-text-muted shrink-0">
                  <GitBranch className="w-2.5 h-2.5" />
                  {session.branch}
                </span>
              )}
            </div>
            {/* Relative time + history toggle */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[9px] text-nothing-text-dim mt-0.5">
                {date ? formatDistanceToNow(date, { addSuffix: true }) : ''}
              </span>
              {/* Conversation toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConversationExpanded((c) => !c);
                  if (historyExpanded) setHistoryExpanded(false);
                }}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-mono text-[8px] uppercase tracking-[0.08em] transition-colors duration-150',
                  conversationExpanded
                    ? 'border-nothing-green/40 bg-nothing-green/10 text-nothing-green'
                    : 'border-nothing-border bg-nothing-surface text-nothing-text-dim hover:border-nothing-border2 hover:text-nothing-text-muted',
                )}
              >
                <Bot className="w-2.5 h-2.5" />
                chat
                <motion.span
                  animate={{ rotate: conversationExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="leading-none"
                >
                  <ChevronDown className="w-2.5 h-2.5" />
                </motion.span>
              </button>
              {sortedHistory.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setHistoryExpanded((h) => !h);
                    if (conversationExpanded) setConversationExpanded(false);
                  }}
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-mono text-[8px] uppercase tracking-[0.08em] transition-colors duration-150',
                    historyExpanded
                      ? 'border-nothing-border2 bg-nothing-surface2 text-nothing-text-secondary'
                      : 'border-nothing-border bg-nothing-surface text-nothing-text-dim hover:border-nothing-border2 hover:text-nothing-text-muted',
                  )}
                >
                  <Clock className="w-2.5 h-2.5" />
                  {sortedHistory.length}
                  <motion.span
                    animate={{ rotate: historyExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="leading-none"
                  >
                    <ChevronDown className="w-2.5 h-2.5" />
                  </motion.span>
                </button>
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="mb-2" onClick={(e) => e.stopPropagation()}>
            <SummaryText text={session.summary} />
          </div>

          {/* Files modified — expandable */}
          <AnimatePresence initial={false}>
            {filesExpanded && session.filesModified.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {visibleFiles.map((f) => (
                    <span
                      key={f}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-nothing-surface2 border border-nothing-border font-mono text-[8px] text-nothing-text-muted"
                    >
                      <FileText className="w-2.5 h-2.5 shrink-0" />
                      {f.split('/').pop()}
                    </span>
                  ))}
                  {overflowCount > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-nothing-surface border border-nothing-border2 font-mono text-[8px] text-nothing-text-dim">
                      +{overflowCount} more
                    </span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Expand hint */}
          {session.filesModified.length > 0 && (
            <div className="mt-2 flex items-center gap-1">
              <span className="font-mono text-[8px] text-nothing-text-dim uppercase tracking-wider">
                {session.filesModified.length} file{session.filesModified.length !== 1 ? 's' : ''}
              </span>
              <motion.span
                animate={{ rotate: filesExpanded ? 180 : 0 }}
                transition={{ duration: 0.15 }}
                className="text-nothing-text-dim text-[10px] leading-none"
              >
                ▾
              </motion.span>
            </div>
          )}
        </div>

        {/* Conversation panel — lazy loaded on expand */}
        <AnimatePresence initial={false}>
          {conversationExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="border-t border-nothing-border bg-nothing-surface2/40">
                {/* Panel header */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-nothing-border/50">
                  <Bot className="w-2.5 h-2.5 text-nothing-green" />
                  <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-muted">
                    Conversation
                  </span>
                  <span className="font-mono text-[8px] text-nothing-text-dim ml-auto">
                    {session.id}
                  </span>
                </div>
                <ConversationPanel sessionId={sortedHistory.length > 0 ? sortedHistory[0].sessionId : session.id} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* History timeline — expandable panel */}
        <AnimatePresence initial={false}>
          {historyExpanded && sortedHistory.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="border-t border-nothing-border bg-nothing-surface2/60">
                {/* Panel header */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-nothing-border/50">
                  <Clock className="w-2.5 h-2.5 text-nothing-text-dim" />
                  <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-nothing-text-muted">
                    Session History
                  </span>
                  <span className="font-mono text-[8px] text-nothing-text-dim ml-auto">
                    {sortedHistory.length} command{sortedHistory.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {/* Entries */}
                <div className="max-h-52 overflow-y-auto">
                  {sortedHistory.map((entry, i) => (
                    <HistoryTimelineRow
                      key={`${entry.sessionId}-${entry.timestamp}-${i}`}
                      entry={entry}
                      delay={Math.min(i * 0.015, 0.2)}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-24 gap-3"
    >
      <FolderOpen className="w-8 h-8 text-nothing-text-dim" />
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-nothing-text-muted">
        {filtered ? 'No sessions match your filters' : 'No sessions found'}
      </p>
      {filtered && (
        <p className="font-mono text-[9px] text-nothing-text-dim">
          Try broadening your search or date range
        </p>
      )}
    </motion.div>
  );
}

// ─── Date range filter ─────────────────────────────────────────────────────────

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
];

function inDateRange(date: Date, range: DateRange): boolean {
  switch (range) {
    case 'today':
      return isToday(date);
    case 'week':
      return isThisWeek(date, { weekStartsOn: 1 });
    case 'month':
      return isThisMonth(date);
    case 'all':
      return true;
  }
}

/** Returns a YYYY-MM-DD string in local time for a Date */
function toLocalDateKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('all');

  useEffect(() => {
    Promise.all([
      fetch('/api/sessions').then((r) => r.json()),
      fetch('/api/history').then((r) => r.json()),
    ])
      .then(([sessionData, historyData]: [Session[], HistoryEntry[]]) => {
        const sorted = [...sessionData].sort((a, b) => {
          const da = safeParseDate(a.date)?.getTime() ?? 0;
          const db = safeParseDate(b.date)?.getTime() ?? 0;
          return db - da;
        });
        setSessions(sorted);
        setHistory(historyData);
      })
      .catch(() => setError('Failed to load sessions'))
      .finally(() => setLoading(false));
  }, []);

  // ── Group history by date key ─────────────────────────────────────────────────

  const historyByDate = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const entry of history) {
      const key = toLocalDateKey(new Date(entry.timestamp));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return map;
  }, [history]);

  // ── Derived metrics ──────────────────────────────────────────────────────────

  const totalSessions = sessions.length;

  const sessionsThisWeek = useMemo(
    () =>
      sessions.filter((s) => {
        const d = safeParseDate(s.date);
        return d ? isThisWeek(d, { weekStartsOn: 1 }) : false;
      }).length,
    [sessions],
  );

  const uniqueFiles = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => s.filesModified.forEach((f) => set.add(f)));
    return set.size;
  }, [sessions]);

  // ── Filtered list ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      const matchesSearch =
        !q ||
        s.project.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q);
      const parsedDate = safeParseDate(s.date);
      const matchesDate = parsedDate ? inDateRange(parsedDate, dateRange) : dateRange === 'all';
      return matchesSearch && matchesDate;
    });
  }, [sessions, search, dateRange]);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Page title */}
      <div>
        <h1 className="font-mono text-[10px] uppercase tracking-[0.2em] text-nothing-text-muted mb-1">
          Sessions
        </h1>
        <p className="font-mono text-[9px] text-nothing-text-dim">
          Claude Code work sessions — click a session to expand history
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          label="Total Sessions"
          value={loading ? 0 : totalSessions}
          accentColor="#5B9BF6"
          delay={0}
          valueSize="md"
        />
        <MetricCard
          label="This Week"
          value={loading ? 0 : sessionsThisWeek}
          accentColor="#4A9E5C"
          delay={0.05}
          valueSize="md"
        />
        <MetricCard
          label="Files Modified"
          value={loading ? 0 : uniqueFiles}
          accentColor="#AF52DE"
          delay={0.1}
          valueSize="md"
          subtitle="unique across all sessions"
        />
      </div>

      {/* Filter bar */}
      <div className="flex gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-nothing-text-dim pointer-events-none" />
          <input
            type="text"
            placeholder="Search project or summary..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              'w-full pl-8 pr-3 py-2 rounded-nothing-sm border border-nothing-border',
              'bg-nothing-surface font-mono text-[10px] text-nothing-text',
              'placeholder:text-nothing-text-dim',
              'focus:outline-none focus:border-nothing-border2',
              'transition-colors duration-150',
            )}
          />
        </div>

        {/* Date range */}
        <div className="flex gap-1">
          {DATE_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDateRange(opt.value)}
              className={cn(
                'px-3 py-2 rounded-nothing-sm border font-mono text-[9px] uppercase tracking-[0.1em] transition-colors duration-150',
                dateRange === opt.value
                  ? 'border-nothing-border2 bg-nothing-surface2 text-nothing-text'
                  : 'border-nothing-border bg-nothing-surface text-nothing-text-muted hover:border-nothing-border2 hover:text-nothing-text-secondary',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      {!loading && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="font-mono text-[9px] text-nothing-text-dim"
        >
          {filtered.length} session{filtered.length !== 1 ? 's' : ''}
          {search || dateRange !== 'all' ? ' matching filters' : ''}
        </motion.p>
      )}

      {/* Error */}
      {error && (
        <div className="border border-nothing-red/20 bg-nothing-red/5 rounded-nothing px-4 py-3">
          <p className="font-mono text-[10px] text-nothing-red">{error}</p>
        </div>
      )}

      {/* Session list */}
      <div>
        {loading ? (
          // Skeletons
          Array.from({ length: 5 }).map((_, i) => (
            <SessionSkeleton key={i} index={i} />
          ))
        ) : filtered.length === 0 ? (
          <EmptyState filtered={!!(search || dateRange !== 'all')} />
        ) : (
          <AnimatePresence mode="popLayout">
            {filtered.map((session, i) => {
              const sessionDate = safeParseDate(session.date);
              const dateKey = sessionDate ? toLocalDateKey(sessionDate) : '';
              const entries = dateKey ? (historyByDate.get(dateKey) ?? []) : [];
              return (
                <SessionCard
                  key={session.id}
                  session={session}
                  index={i}
                  historyEntries={entries}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
