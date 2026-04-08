'use client';

import { useEffect } from 'react';
import { useCommandPaletteStore } from '@/lib/stores/command-palette-store';

export { useCommandPaletteStore };
export function useCommandPalette() {
  const store = useCommandPaletteStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        store.isOpen ? store.close() : store.open();
      }
      if (e.key === 'Escape' && store.isOpen) {
        store.close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store]);

  return store;
}
