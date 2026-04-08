'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Plan {
  name: string;
  content: string;
  frontmatter: Record<string, unknown>;
  filePath: string;
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-nothing bg-nothing-surface2 animate-pulse ${className}`} />
  );
}

// ── Markdown renderer ──────────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => (
          <h1 className="font-mono text-[15px] uppercase tracking-[0.1em] text-nothing-text border-b border-nothing-border pb-2 mb-4 mt-6 first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="font-mono text-[12px] uppercase tracking-[0.08em] text-nothing-text border-b border-nothing-border pb-1.5 mb-3 mt-5">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="font-mono text-[11px] uppercase tracking-[0.06em] text-nothing-text-secondary mb-2 mt-4">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="text-[12px] text-nothing-text-secondary leading-relaxed mb-3">
            {children}
          </p>
        ),
        code: ({ children, ...props }) => (
            <code className="font-mono text-[10px] bg-nothing-surface border border-nothing-border px-1.5 py-0.5 rounded text-nothing-text-secondary" {...props}>
              {children}
            </code>
          ),
        pre: ({ children }) => (
          <pre className="relative bg-nothing-surface2 border border-nothing-border rounded-nothing p-4 mb-4 overflow-x-auto font-mono text-[10px] text-nothing-text-secondary leading-relaxed shadow-inner">
            <div className="absolute top-2 right-2 flex gap-1">
              <span className="w-2 h-2 rounded-full bg-nothing-border2" />
              <span className="w-2 h-2 rounded-full bg-nothing-border2" />
              <span className="w-2 h-2 rounded-full bg-nothing-border2" />
            </div>
            {children}
          </pre>
        ),
        ul: ({ children }) => (
          <ul className="mb-3 space-y-1 pl-4">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 space-y-1 pl-4 list-decimal list-inside">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="text-[12px] text-nothing-text-secondary leading-relaxed flex gap-2">
            <span className="text-nothing-text-dim shrink-0 font-mono">—</span>
            <span>{children}</span>
          </li>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-nothing-blue underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-nothing-border2 pl-3 mb-3 text-nothing-text-muted italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-nothing-border my-4" />,
        strong: ({ children }) => (
          <strong className="text-nothing-text font-semibold">{children}</strong>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ── Frontmatter badges ─────────────────────────────────────────────────────────

function FrontmatterBadges({ fm }: { fm: Record<string, unknown> }) {
  const entries = Object.entries(fm).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mb-4 pb-4 border-b border-nothing-border">
      {entries.map(([k, v]) => {
        const display = Array.isArray(v) ? v.join(', ') : String(v);
        return (
          <span
            key={k}
            className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-nothing-border2 bg-nothing-surface2 text-nothing-text-muted"
          >
            <span className="text-nothing-text-dim">{k}:</span>
            <span className="text-nothing-text-secondary">{display}</span>
          </span>
        );
      })}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch('/api/plans');
        if (res.ok) {
          const json: Plan[] = await res.json();
          setPlans(json);
          if (json.length > 0) setSelected(json[0].name);
        }
      } catch (e) {
        console.error('Failed to fetch plans', e);
      } finally {
        setLoading(false);
      }
    }
    fetchPlans();
  }, []);

  const activePlan = plans.find((p) => p.name === selected) ?? null;

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex gap-4 h-[calc(100vh-120px)]">
        <div className="w-48 shrink-0 space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
        <div className="flex-1 space-y-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-20 w-full mt-4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  // ── No plans ───────────────────────────────────────────────────────────────

  if (plans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-nothing-text-muted">
          No plans found
        </span>
        <span className="font-mono text-[9px] text-nothing-text-dim">
          Plans from .claude/plans/ will appear here
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
      className="flex gap-4 h-[calc(100vh-120px)]"
    >
      {/* Left sidebar — plan list */}
      <div className="w-48 shrink-0 flex flex-col gap-0.5 overflow-y-auto">
        <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-nothing-text-dim px-2 pb-2">
          Plans ({plans.length})
        </span>
        {plans.map((plan, i) => {
          const isActive = plan.name === selected;
          return (
            <motion.button
              key={plan.name}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15, delay: i * 0.03 }}
              onClick={() => setSelected(plan.name)}
              className={`relative w-full text-left pl-3 pr-2 py-1.5 rounded-nothing font-mono text-[10px] truncate transition-all duration-150 overflow-hidden ${
                isActive
                  ? 'bg-nothing-surface2 text-nothing-text border border-nothing-border2'
                  : 'text-nothing-text-muted hover:text-nothing-text-secondary hover:bg-nothing-surface2/40 border border-transparent'
              }`}
            >
              {/* Active left border accent */}
              <AnimatePresence>
                {isActive && (
                  <motion.span
                    layoutId="plan-active-bar"
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    exit={{ scaleY: 0 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-0 top-0 bottom-0 w-[2px] bg-nothing-blue rounded-full"
                  />
                )}
              </AnimatePresence>
              {plan.name}
            </motion.button>
          );
        })}
      </div>

      {/* Vertical divider */}
      <div className="w-px bg-nothing-border shrink-0" />

      {/* Right — content viewer */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {activePlan && (
            <motion.div
              key={activePlan.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="pr-2"
            >
              {/* Plan name header */}
              <div className="mb-4 pb-3 border-b border-nothing-border">
                <h2 className="font-mono text-[13px] text-nothing-text tracking-wide">
                  {activePlan.name}
                </h2>
                <p className="font-mono text-[9px] text-nothing-text-dim mt-1 truncate">
                  {activePlan.filePath}
                </p>
              </div>

              {/* Frontmatter badges */}
              {activePlan.frontmatter && Object.keys(activePlan.frontmatter).length > 0 && (
                <FrontmatterBadges fm={activePlan.frontmatter} />
              )}

              {/* Markdown body */}
              <div className="prose-nothing">
                <MarkdownContent content={activePlan.content} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
