import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('deployment indexing headers', () => {
  it.each(['development', 'production', 'test'])('keeps HTTPS upgrading outside the HTTP development server (%s)', async (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.resetModules();
    const { default: config } = await import('../next.config');
    if (!config.headers) throw new Error('Security headers must be configured.');
    const routes = await config.headers();
    const policy = routes.find((route) => route.source === '/:path*')?.headers.find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(policy).toBeDefined();
    expect(policy?.includes('upgrade-insecure-requests')).toBe(environment !== 'development');
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
  });
  it.each(['preview', 'development', 'production', undefined])(
    'scopes noindex to explicit preview/development deployments (%s)',
    async (deployment) => {
      vi.stubEnv('VERCEL_ENV', deployment);
      vi.resetModules();
      const { default: config } = await import('../next.config');
      if (!config.headers) throw new Error('Security and indexing headers must be configured.');
      const routes = await config.headers();
      const headers = routes.find((route) => route.source === '/:path*')?.headers;
      expect(headers).toBeDefined();
      const noindex = headers?.find((header) => header.key.toLowerCase() === 'x-robots-tag');
      if (deployment === 'preview' || deployment === 'development') {
        expect(noindex?.value).toBe('noindex, nofollow');
      } else {
        expect(noindex).toBeUndefined();
      }
      expect(headers).toContainEqual(expect.objectContaining({ key: 'Content-Security-Policy' }));
      expect(headers).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
    },
  );
});
