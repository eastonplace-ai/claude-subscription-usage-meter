import './globals.css';
import type { Metadata } from 'next';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { CommandPalette } from '@/components/layout/command-palette';
import { ThemeProvider } from '@/lib/theme-provider';
import { FilterProvider } from '@/lib/filter-context';

export const metadata: Metadata = {
  title: 'Claude Usage Dashboard',
  description: 'Claude Code analytics and usage tracking',
};

const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('claude-dashboard-theme');
    if (stored === 'dark' || stored === 'light') {
      if (stored === 'dark') document.documentElement.classList.add('dark');
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  } catch(e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-nothing-bg text-nothing-text antialiased">
        <ThemeProvider>
          <FilterProvider>
            <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 flex flex-col overflow-hidden">
              <Header />
              <div className="flex-1 overflow-y-auto p-6" style={{ backgroundImage: 'radial-gradient(circle, var(--dot-color) 0.7px, transparent 0.7px)', backgroundSize: '16px 16px' }}>
                {children}
              </div>
            </main>
            </div>
            <CommandPalette />
          </FilterProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
