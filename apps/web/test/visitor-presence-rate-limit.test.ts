import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/env', () => ({ serverEnv: () => ({}) }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }));
vi.mock('@upstash/ratelimit', () => ({ Ratelimit: vi.fn() }));
beforeEach(() => { vi.resetModules(); });

describe('visitor heartbeat hashed-IP security limiter', () => {
  it('bounds public writes per IP while allowing a separate IP and resetting after its one-minute window', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2031-03-01T12:00:00.000Z'));
      const { enforceRateLimit } = await import('../src/server/rate-limit');
      const request = new Request('http://localhost/api/v1/visitors/presence', { headers: { 'x-forwarded-for': '198.51.100.61' } });
      for (let attempt = 0; attempt < 120; attempt += 1) await enforceRateLimit(request, 'visitorPresence');
      await expect(enforceRateLimit(request, 'visitorPresence')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      await expect(enforceRateLimit(new Request(request, { headers: { 'x-forwarded-for': '198.51.100.62' } }), 'visitorPresence')).resolves.toBeUndefined();
      vi.setSystemTime(new Date('2031-03-01T12:01:00.001Z'));
      await expect(enforceRateLimit(request, 'visitorPresence')).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
});
