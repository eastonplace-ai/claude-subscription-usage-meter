import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        nothing: {
          bg: 'var(--nothing-bg)',
          surface: 'var(--nothing-surface)',
          surface2: 'var(--nothing-surface2)',
          border: 'var(--nothing-border)',
          border2: 'var(--nothing-border2)',
          border3: 'var(--nothing-border3)',
          text: 'var(--nothing-text)',
          'text-secondary': 'var(--nothing-text-secondary)',
          'text-muted': 'var(--nothing-text-muted)',
          'text-dim': 'var(--nothing-text-dim)',
          green: 'var(--nothing-green)',
          amber: 'var(--nothing-amber)',
          red: 'var(--nothing-red)',
          blue: 'var(--nothing-blue)',
          purple: 'var(--nothing-purple)',
          cyan: 'var(--nothing-cyan)',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', '-apple-system', 'sans-serif'],
        mono: ['Space Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        nothing: '8px',
        'nothing-sm': '6px',
      },
    },
  },
  plugins: [],
};

export default config;
