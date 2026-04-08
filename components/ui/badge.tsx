'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'live' | 'estimated' | 'reset' | 'model' | 'purple' | 'amber' | 'red';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  showDot?: boolean;
  className?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  live: 'bg-nothing-green/10 text-nothing-green border-nothing-green/20',
  estimated: 'bg-nothing-surface2 text-nothing-text-muted border-nothing-border2',
  reset: 'bg-transparent text-nothing-text-muted border-nothing-border2',
  model: 'bg-nothing-blue/10 text-nothing-blue border-nothing-blue/20',
  purple: 'bg-nothing-purple/10 text-nothing-purple border-nothing-purple/20',
  amber: 'bg-nothing-amber/10 text-nothing-amber border-nothing-amber/20',
  red: 'bg-nothing-red/10 text-nothing-red border-nothing-red/20',
};

const DOT_COLORS: Partial<Record<BadgeVariant, string>> = {
  live: '#4A9E5C',
  model: '#5B9BF6',
  purple: '#AF52DE',
  amber: '#D4A843',
  red: '#D71921',
};

export function Badge({
  variant = 'estimated',
  children,
  showDot = false,
  className,
}: BadgeProps) {
  const dotColor = DOT_COLORS[variant];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-mono text-[8px] uppercase tracking-[0.1em]',
        VARIANT_STYLES[variant],
        className,
      )}
    >
      {showDot && dotColor && (
        <motion.span
          className="w-1.5 h-1.5 rounded-full shrink-0 relative"
          style={{ backgroundColor: dotColor }}
          animate={
            variant === 'live'
              ? {
                  opacity: [1, 0.4, 1],
                  scale: [1, 0.75, 1],
                  boxShadow: [
                    `0 0 4px 1px ${dotColor}80`,
                    `0 0 1px 0px ${dotColor}00`,
                    `0 0 4px 1px ${dotColor}80`,
                  ],
                }
              : {}
          }
          transition={
            variant === 'live'
              ? {
                  duration: 1.6,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }
              : {}
          }
        />
      )}
      {children}
    </span>
  );
}
