import type { NextConfig } from 'next';

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://www.googletagmanager.com",
  'frame-src https://js.stripe.com https://hooks.stripe.com',
  "connect-src 'self' https://api.stripe.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
  "img-src 'self' data: blob: https://*.stripe.com https://www.googletagmanager.com https://*.google-analytics.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
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
    optimizePackageImports: ['@chakra-ui/react'],
  },
  headers: async () => {
    await Promise.resolve();
    return [
      {
        source: '/:path*',
        headers: [...securityHeaders],
      },
    ];
  },
  transpilePackages: ['@sv/contracts', '@sv/tokens'],
};

export default nextConfig;
