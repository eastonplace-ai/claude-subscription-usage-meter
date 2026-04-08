'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFilter } from '@/lib/filter-context';
import { useCommandPalette } from '@/lib/hooks/use-command-palette';
import { ThemeToggle } from '@/components/ui/theme-toggle';

const TIME_FILTERS = ['1H', '24H', '7D', '30D'] as const;

const PAGE_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/projects': 'Projects',
  '/sessions': 'Sessions',
  '/costs': 'Costs',
  '/tools': 'Tools',
  '/activity': 'Activity',
  '/history': 'History',
  '/plans': 'Plans',
  '/agents': 'Agents',
  '/settings': 'Settings',
};

export function Header() {
  const pathname = usePathname();
  const { timeFilter: activeFilter, setTimeFilter: setActiveFilter } = useFilter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { open: openPalette } = useCommandPalette();

  const title = PAGE_TITLES[pathname] ?? 'Claude Usage';

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  };

  return (
    <header
      className="flex items-center justify-between px-6 border-b border-nothing-border bg-nothing-bg shrink-0"
      style={
        {
          height: 48 + 36,
          paddingTop: 36,
          WebkitAppRegion: 'drag',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      }
    >
      {/* Page title */}
      <motion.h1
        key={pathname}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="font-mono text-[11px] uppercase tracking-[0.15em] text-nothing-text-secondary"
      >
        {title}
      </motion.h1>

      {/* Right controls */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties & { WebkitAppRegion: string }}
      >
        {/* Time filter pills */}
        <div className="flex items-center gap-1 bg-nothing-surface border border-nothing-border rounded-full px-1 py-1">
          {TIME_FILTERS.map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={cn(
                'px-2.5 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-wider transition-all duration-150',
                activeFilter === filter
                  ? 'bg-nothing-surface2 text-nothing-text border border-nothing-border2'
                  : 'text-nothing-text-muted hover:text-nothing-text-secondary',
              )}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Theme toggle */}
        <ThemeToggle />

        {/* Refresh */}
        <button
          onClick={handleRefresh}
          className="flex items-center justify-center w-7 h-7 rounded-[6px] text-nothing-text-muted hover:text-nothing-text hover:bg-nothing-surface transition-all duration-150"
        >
          <motion.div
            animate={{ rotate: isRefreshing ? 360 : 0 }}
            transition={{ duration: 0.6, ease: 'linear' }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </motion.div>
        </button>

        {/* ⌘K search */}
        <button
          onClick={openPalette}
          className="flex items-center gap-2 px-2.5 py-1 rounded-[6px] bg-nothing-surface border border-nothing-border text-nothing-text-muted hover:text-nothing-text hover:border-nothing-border2 transition-all duration-150"
        >
          <Search className="w-3 h-3" />
          <span className="font-mono text-[9px] text-nothing-text-dim">⌘K</span>
        </button>
      </div>
    </header>
  );
}
