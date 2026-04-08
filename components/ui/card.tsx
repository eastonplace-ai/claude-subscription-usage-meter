'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'accent' | 'interactive';
  accentColor?: string;
  delay?: number;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', accentColor, delay = 0, children, ...props }, ref) => {
    const isInteractive = variant === 'interactive';
    const hasAccent = variant === 'accent';

    return (
      <motion.div
        ref={ref as React.Ref<HTMLDivElement>}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay, ease: 'easeOut' }}
        whileHover={
          isInteractive
            ? { scale: 1.005, borderColor: '#222222' }
            : { borderColor: '#222222' }
        }
        className={cn(
          'relative rounded-nothing border border-nothing-border bg-nothing-surface overflow-hidden',
          isInteractive && 'cursor-pointer',
          className,
        )}
        {...(props as React.ComponentProps<typeof motion.div>)}
      >
        {/* Accent top bar */}
        {hasAccent && (
          <div
            className="absolute top-0 left-0 right-0 h-0.5"
            style={{ backgroundColor: accentColor ?? '#5B9BF6' }}
          />
        )}
        {children}
      </motion.div>
    );
  },
);

Card.displayName = 'Card';

export function CardHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-between px-4 py-3 border-b border-nothing-border', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('font-mono text-[9px] uppercase tracking-[0.12em] text-nothing-text-muted', className)}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-4', className)} {...props}>
      {children}
    </div>
  );
}
