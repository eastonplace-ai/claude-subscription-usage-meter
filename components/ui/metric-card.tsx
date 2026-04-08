'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './card';

export interface MetricCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
  trend?: {
    direction: 'up' | 'down';
    percentage: number;
    label?: string;
  };
  prefix?: string;
  suffix?: string;
  valueSize?: 'sm' | 'md' | 'lg';
  accentColor?: string;
  delay?: number;
  className?: string;
  formatValue?: (v: number) => string;
}

function useCountUp(target: number, duration = 1200, enabled = true) {
  const [current, setCurrent] = useState(0);
  const startTime = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);
  // Track whether target is a float so we preserve decimals during animation
  const isFloat = target !== Math.floor(target);

  useEffect(() => {
    if (!enabled || typeof target !== 'number') return;

    startTime.current = null;
    setCurrent(0);

    const animate = (timestamp: number) => {
      if (!startTime.current) startTime.current = timestamp;
      const elapsed = timestamp - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out quart — snappier start, smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 4);
      const raw = target * eased;
      setCurrent(isFloat ? parseFloat(raw.toFixed(4)) : Math.round(raw));

      if (progress < 1) {
        rafId.current = requestAnimationFrame(animate);
      } else {
        setCurrent(target);
      }
    };

    rafId.current = requestAnimationFrame(animate);
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [target, duration, enabled, isFloat]);

  return current;
}

/** Format a number with comma separators, preserving up to `decimals` places */
function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const VALUE_SIZE_MAP = {
  sm: 'text-2xl',
  md: 'text-3xl',
  lg: 'text-4xl',
};

export function MetricCard({
  label,
  value,
  subtitle,
  trend,
  prefix,
  suffix,
  valueSize = 'md',
  accentColor,
  delay = 0,
  className,
  formatValue,
}: MetricCardProps) {
  const numericValue = typeof value === 'number' ? value : NaN;
  const isNumeric = !isNaN(numericValue);
  const isFloat = isNumeric && numericValue !== Math.floor(numericValue);
  const animated = useCountUp(isNumeric ? numericValue : 0, 1200, isNumeric);

  const displayValue = isNumeric
    ? formatValue
      ? formatValue(animated)
      : isFloat
      ? formatNumber(animated, numericValue < 1 ? 4 : 2)
      : formatNumber(animated, 0)
    : value;

  return (
    <Card
      variant={accentColor ? 'accent' : 'default'}
      accentColor={accentColor}
      delay={delay}
      className={className}
    >
      <CardContent className="p-4">
        {/* Label */}
        <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-nothing-text-muted mb-2">
          {label}
        </p>

        {/* Value */}
        <div className="flex items-end gap-1.5">
          {prefix && (
            <span className="font-mono text-base text-nothing-text-secondary mb-1">
              {prefix}
            </span>
          )}
          <span
            className={cn(
              'font-mono font-bold text-nothing-text leading-none',
              VALUE_SIZE_MAP[valueSize],
            )}
          >
            {displayValue}
          </span>
          {suffix && (
            <span className="font-mono text-sm text-nothing-text-secondary mb-1">
              {suffix}
            </span>
          )}
        </div>

        {/* Subtitle + trend */}
        <div className="flex items-center justify-between mt-2">
          {subtitle && (
            <p className="font-mono text-[9px] text-nothing-text-dim">{subtitle}</p>
          )}
          {trend && (
            <div
              className={cn(
                'flex items-center gap-1',
                trend.direction === 'up'
                  ? 'text-nothing-green'
                  : 'text-nothing-red',
              )}
            >
              {trend.direction === 'up' ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span className="font-mono text-[9px]">
                {trend.percentage.toFixed(1)}%
                {trend.label && (
                  <span className="text-nothing-text-dim ml-1">{trend.label}</span>
                )}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
