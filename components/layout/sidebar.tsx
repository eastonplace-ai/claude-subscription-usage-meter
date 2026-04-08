'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  FolderKanban,
  MessageSquare,
  Wrench,
  Activity,
  FileText,
  Bot,
  Settings,
  Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/rate-limits', label: 'Rate Limits', icon: Gauge },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/sessions', label: 'Sessions', icon: MessageSquare },
  { href: '/activity', label: 'Activity & Costs', icon: Activity },
  { href: '/tools', label: 'Tools', icon: Wrench },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/plans', label: 'Plans', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <aside
      className="relative flex flex-col h-screen bg-nothing-surface border-r border-nothing-border shrink-0 overflow-hidden"
      style={{ width: 240, paddingTop: 52 }} // 52px clears macOS traffic lights (at y:16, ~28px tall + margin)
    >
      {/* Logo area */}
      <div className="flex items-center px-4 py-3 border-b border-nothing-border">
        <div className="w-6 h-6 shrink-0 flex items-center justify-center">
          <div className="w-4 h-4 rounded-sm bg-nothing-text opacity-90" />
        </div>
        <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.15em] text-nothing-text whitespace-nowrap">
          Claude Usage
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
        <ul className="space-y-0.5 px-2">
          {NAV_ITEMS.map((item, i) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <motion.li
                key={item.href}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: i * 0.03, ease: 'easeOut' }}
              >
                <motion.div
                  whileHover={!isActive ? { scale: 1.01, x: 1 } : {}}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.12, ease: 'easeOut' }}
                >
                  <Link
                    href={item.href}
                    className={cn(
                      'relative flex items-center gap-3 px-2 py-2 rounded-[6px] transition-colors duration-150 group',
                      isActive
                        ? 'text-nothing-text'
                        : 'text-nothing-text-muted hover:text-nothing-text-secondary',
                    )}
                    style={{
                      backgroundColor: isActive
                        ? 'var(--nothing-surface2)'
                        : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor =
                          'var(--nothing-surface2)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = '';
                      }
                    }}
                  >
                    {/* Active indicator — slides between items via layoutId */}
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-active"
                        className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full"
                        style={{ backgroundColor: 'var(--nothing-text)' }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      />
                    )}

                    <motion.span
                      animate={isActive ? { opacity: 1 } : { opacity: 0.5 }}
                      whileHover={{ opacity: 0.85 }}
                      transition={{ duration: 0.15 }}
                      className="shrink-0"
                    >
                      <Icon className="w-4 h-4" />
                    </motion.span>

                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] whitespace-nowrap">
                      {item.label}
                    </span>
                  </Link>
                </motion.div>
              </motion.li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom branding */}
      <div className="px-4 py-3 border-t border-nothing-border">
        <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-nothing-text-dim">
          Claude Usage
        </p>
        <p className="font-mono text-[8px] text-nothing-text-dim mt-0.5">
          v0.1.0
        </p>
      </div>
    </aside>
  );
}
