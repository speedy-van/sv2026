import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/env', () => ({ serverEnv: () => ({}) }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }));
vi.mock('@upstash/ratelimit', () => ({ Ratelimit: vi.fn() }));

beforeEach(() => { vi.resetModules(); });

describe('password login rate limits with isolated memory storage', () => {
  it('limits one IP before any expensive password processing while allowing a separate IP', async () => {
    const { enforceRateLimit } = await import('../src/server/rate-limit');
    const request = new Request('http://localhost/api/v1/auth/password/login', { headers: { 'x-forwarded-for': '198.51.100.11' } });
    for (let attempt = 0; attempt < 10; attempt += 1) await enforceRateLimit(request, 'authPasswordLogin');
    await expect(enforceRateLimit(request, 'authPasswordLogin')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(enforceRateLimit(new Request(request, { headers: { 'x-forwarded-for': '198.51.100.12' } }), 'authPasswordLogin')).resolves.toBeUndefined();
  });

  it('normalizes account identifiers and limits one account independently of client IP', async () => {
    const { enforcePasswordAccountRateLimit } = await import('../src/server/rate-limit');
    for (let attempt = 0; attempt < 10; attempt += 1) await enforcePasswordAccountRateLimit('staff@example.test');
    await expect(enforcePasswordAccountRateLimit(' STAFF@EXAMPLE.TEST ')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(enforcePasswordAccountRateLimit('different@example.test')).resolves.toBeUndefined();
  });

  it('expires the account limit after the existing one-hour window', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2031-03-01T12:00:00.000Z'));
      const { enforcePasswordAccountRateLimit } = await import('../src/server/rate-limit');
      for (let attempt = 0; attempt < 10; attempt += 1) await enforcePasswordAccountRateLimit('staff@example.test');
      await expect(enforcePasswordAccountRateLimit('staff@example.test')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      vi.setSystemTime(new Date('2031-03-01T13:00:00.001Z'));
      await expect(enforcePasswordAccountRateLimit('staff@example.test')).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
