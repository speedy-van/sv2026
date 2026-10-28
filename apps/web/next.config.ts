import type { NextConfig } from 'next';
import { redirects } from './src/content/redirects';

const developmentScriptPolicy = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
const previewRobotsHeaders = ['preview', 'development'].includes(process.env.VERCEL_ENV ?? '')
  ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
  : [];

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${developmentScriptPolicy} https://js.stripe.com https://www.googletagmanager.com`,
  'frame-src https://js.stripe.com https://hooks.stripe.com',
  "connect-src 'self' https://api.stripe.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
  "img-src 'self' data: blob: https://*.stripe.com https://www.googletagmanager.com https://*.google-analytics.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // WebKit upgrades even localhost assets to HTTPS; the dev server serves HTTP.
  ...(process.env.NODE_ENV === 'development' ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")',
  },
  {
    key: 'Content-Security-Policy',
    value: csp,
  },
] as const;

const nextConfig: NextConfig = {
  experimental: {
    // Prerendered SEO pages read live pricing and capacity; bound DB concurrency.
    cpus: 4,
    optimizePackageImports: ['@chakra-ui/react'],
  },
  headers: async () => {
    await Promise.resolve();
    return [
      {
        source: '/:path*',
        headers: [...securityHeaders, ...previewRobotsHeaders],
      },
    ];
  },
  redirects: async () => {
    await Promise.resolve();
    return redirects;
  },
  transpilePackages: ['@sv/contracts', '@sv/db', '@sv/pricing', '@sv/tokens'],
};

export default nextConfig;
