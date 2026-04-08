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
        {children}
      </body>
    </html>
  );
}
