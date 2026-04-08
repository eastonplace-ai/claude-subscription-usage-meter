'use client';

import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { CommandPalette } from '@/components/layout/command-palette';
import { ThemeProvider } from '@/lib/theme-provider';
import { FilterProvider } from '@/lib/filter-context';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <FilterProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 flex flex-col overflow-hidden">
            <Header />
            <div
              className="flex-1 overflow-y-auto p-6"
              style={{
                backgroundImage: 'radial-gradient(circle, var(--dot-color) 0.7px, transparent 0.7px)',
                backgroundSize: '16px 16px',
              }}
            >
              {children}
            </div>
          </main>
        </div>
        <CommandPalette />
      </FilterProvider>
    </ThemeProvider>
  );
}
