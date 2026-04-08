'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCommandPalette } from '@/lib/hooks/use-command-palette';
import type { Command } from '@/lib/stores/command-palette-store';

export function CommandPalette() {
  const { isOpen, close, query, setQuery, commands } = useCommandPalette();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Filter commands by query
  const filtered = query.trim()
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.group.toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  // Group results
  const grouped = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    if (!acc[cmd.group]) acc[cmd.group] = [];
    acc[cmd.group].push(cmd);
    return acc;
  }, {});

  // Flat list for keyboard nav
  const flatList = filtered;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const executeCommand = (cmd: Command) => {
    close();
    if (cmd.href) {
      router.push(cmd.href);
    } else if (cmd.action) {
      cmd.action();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = flatList[selectedIndex];
      if (cmd) executeCommand(cmd);
    }
  };

  let flatIndex = -1;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <AnimatePresence>
          {isOpen && (
            <>
              <Dialog.Overlay asChild>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                />
              </Dialog.Overlay>

              <Dialog.Content asChild onKeyDown={handleKeyDown}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -8 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-full max-w-[560px] mx-4"
                >
                  <div className="bg-nothing-surface border border-nothing-border2 rounded-nothing overflow-hidden shadow-2xl">
                    {/* Search input */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-nothing-border">
                      <Search className="w-4 h-4 text-nothing-text-muted shrink-0" />
                      <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search pages, sessions, commands..."
                        className="flex-1 bg-transparent font-mono text-sm text-nothing-text placeholder:text-nothing-text-dim outline-none"
                      />
                      <kbd className="font-mono text-[9px] text-nothing-text-dim bg-nothing-surface2 border border-nothing-border px-1.5 py-0.5 rounded">
                        ESC
                      </kbd>
                    </div>

                    {/* Results */}
                    <div className="max-h-[360px] overflow-y-auto py-2">
                      {Object.keys(grouped).length === 0 ? (
                        <div className="px-4 py-8 text-center font-mono text-[11px] text-nothing-text-dim">
                          No results for &ldquo;{query}&rdquo;
                        </div>
                      ) : (
                        Object.entries(grouped).map(([group, items]) => (
                          <div key={group}>
                            <div className="px-4 py-1.5">
                              <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-nothing-text-dim">
                                {group}
                              </span>
                            </div>
                            {items.map((cmd) => {
                              flatIndex++;
                              const idx = flatIndex;
                              const isSelected = selectedIndex === idx;
                              return (
                                <button
                                  key={cmd.id}
                                  onClick={() => executeCommand(cmd)}
                                  onMouseEnter={() => setSelectedIndex(idx)}
                                  className={cn(
                                    'w-full flex items-center justify-between px-4 py-2 text-left transition-colors duration-100',
                                    isSelected
                                      ? 'bg-nothing-surface2 text-nothing-text'
                                      : 'text-nothing-text-secondary hover:bg-nothing-surface2',
                                  )}
                                >
                                  <span className="font-mono text-[11px]">
                                    {cmd.label}
                                  </span>
                                  {isSelected && (
                                    <CornerDownLeft className="w-3 h-3 text-nothing-text-muted" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ))
                      )}
                    </div>

                    {/* Footer */}
                    <div className="px-4 py-2 border-t border-nothing-border flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <kbd className="font-mono text-[8px] text-nothing-text-dim bg-nothing-surface2 border border-nothing-border px-1 py-0.5 rounded">
                          ↑↓
                        </kbd>
                        <span className="font-mono text-[8px] text-nothing-text-dim">navigate</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <kbd className="font-mono text-[8px] text-nothing-text-dim bg-nothing-surface2 border border-nothing-border px-1 py-0.5 rounded">
                          ↵
                        </kbd>
                        <span className="font-mono text-[8px] text-nothing-text-dim">select</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </Dialog.Content>
            </>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
