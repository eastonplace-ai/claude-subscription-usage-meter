'use client';

import { ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import type { TooltipProps } from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import { cn } from '@/lib/utils';

// Animation presets — spread onto Recharts chart components for consistent entrance animations
export const CHART_ANIMATION = {
  /** Area / Line charts — draws the line left-to-right */
  line: {
    isAnimationActive: true,
    animationDuration: 1000,
    animationEasing: 'ease-out' as const,
  },
  /** Bar charts — bars grow upward */
  bar: {
    isAnimationActive: true,
    animationDuration: 800,
    animationEasing: 'ease-out' as const,
    animationBegin: 0,
  },
  /** Pie / Donut */
  pie: {
    isAnimationActive: true,
    animationDuration: 900,
    animationEasing: 'ease-out' as const,
    animationBegin: 0,
  },
};

// Nothing UI chart palette
export const CHART_COLORS = {
  blue: '#5B9BF6',
  green: '#4A9E5C',
  amber: '#D4A843',
  red: '#D71921',
  purple: '#AF52DE',
  cyan: '#4ECDC4',
  muted: '#444444',
};

export const CHART_DEFAULTS = {
  gridColor: 'var(--nothing-border)',
  axisColor: 'var(--nothing-text-dim)',
  tickColor: 'var(--nothing-text-muted)',
  backgroundColor: 'transparent',
};

// Custom tooltip
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: TooltipProps<ValueType, NameType> & {
  formatter?: (value: ValueType, name: NameType) => React.ReactNode;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-nothing-surface border border-nothing-border2 rounded-[6px] px-3 py-2 shadow-xl">
      {label !== undefined && (
        <p className="font-mono text-[9px] uppercase tracking-wider text-nothing-text-muted mb-1.5">
          {label}
        </p>
      )}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color ?? '#5B9BF6' }}
          />
          <span className="font-mono text-[10px] text-nothing-text-secondary">
            {entry.name}:
          </span>
          <span className="font-mono text-[10px] text-nothing-text font-bold">
            {formatter
              ? formatter(entry.value!, entry.name!)
              : typeof entry.value === 'number'
              ? entry.value.toLocaleString()
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// Axis tick component for recharts
export function ChartAxisTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value: unknown };
}) {
  return (
    <text
      x={x}
      y={y}
      dy={12}
      textAnchor="middle"
      fill="var(--nothing-text-muted)"
      fontSize={9}
      fontFamily="'Space Mono', monospace"
    >
      {String(payload?.value ?? '')}
    </text>
  );
}

export function ChartYAxisTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value: unknown };
}) {
  return (
    <text
      x={x}
      y={y}
      dx={-4}
      textAnchor="end"
      dominantBaseline="middle"
      fill="var(--nothing-text-muted)"
      fontSize={9}
      fontFamily="'Space Mono', monospace"
    >
      {String(payload?.value ?? '')}
    </text>
  );
}

// Main wrapper
export interface ChartWrapperProps {
  children: React.ReactNode;
  height?: number;
  className?: string;
  title?: string;
}

export function ChartWrapper({
  children,
  height = 240,
  className,
  title,
}: ChartWrapperProps) {
  return (
    <div className={cn('w-full', className)}>
      {title && (
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-nothing-text-muted mb-3">
          {title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={height}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}
