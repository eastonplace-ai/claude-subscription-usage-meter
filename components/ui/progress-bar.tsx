'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface ProgressBarProps {
  value: number; // 0-100
  max?: number;
  variant?: 'auto' | 'green' | 'amber' | 'red' | 'blue';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  label?: string;
  className?: string;
  delay?: number;
}

const SIZE_MAP = {
  sm: 'h-1',
  md: 'h-1.5',
  lg: 'h-2',
};

function getAutoColor(value: number): string {
  if (value > 85) return '#D71921';
  if (value > 60) return '#D4A843';
  return '#4A9E5C';
}

const COLOR_MAP: Record<string, string> = {
  green: '#4A9E5C',
  amber: '#D4A843',
  red: '#D71921',
  blue: '#5B9BF6',
};

export function ProgressBar({
  value,
  max = 100,
  variant = 'auto',
  size = 'md',
  showLabel = false,
  label,
  className,
  delay = 0,
}: ProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const color =
    variant === 'auto'
      ? getAutoColor(percentage)
      : COLOR_MAP[variant] ?? '#4A9E5C';

  return (
    <div className={cn('w-full', className)}>
      {(showLabel || label) && (
        <div className="flex items-center justify-between mb-1.5">
          {label && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-nothing-text-muted">
              {label}
            </span>
          )}
          {showLabel && (
            <span className="font-mono text-[9px] text-nothing-text-dim">
              {percentage.toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {/* Track */}
      <div
        className={cn(
          'w-full rounded-full overflow-hidden',
          SIZE_MAP[size],
        )}
        style={{ backgroundColor: '#1A1A1A' }}
      >
        {/* Fill */}
        <motion.div
          className={cn('h-full rounded-full relative overflow-hidden')}
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{
            type: 'spring',
            stiffness: 80,
            damping: 18,
            delay,
          }}
        >
          {/* Shimmer sweep */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)`,
              backgroundSize: '200% 100%',
            }}
            animate={{ backgroundPosition: ['-200% 0', '200% 0'] }}
            transition={{
              duration: 2.2,
              repeat: Infinity,
              repeatDelay: 1.5,
              ease: 'easeInOut',
              delay: delay + 0.6,
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}
