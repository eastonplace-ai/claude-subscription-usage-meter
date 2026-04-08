import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // API routes require server mode — Electron connects to the Next.js dev server
  // output: 'export' removed to enable API routes
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
