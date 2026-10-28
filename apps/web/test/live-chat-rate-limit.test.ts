import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/env', () => ({ serverEnv: () => ({}) }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }));
vi.mock('@upstash/ratelimit', () => ({ Ratelimit: vi.fn() }));
beforeEach(() => { vi.resetModules(); });

describe('live chat independent hashed rate limits', () => {
  it('gives authenticated staff their separate per-user budget without sharing anonymous IP limits', async () => {
    const { enforceAdminChatRateLimit } = await import('../src/server/rate-limit');
    for (let attempt = 0; attempt < 300; attempt += 1) await enforceAdminChatRateLimit('staff_1');
    await expect(enforceAdminChatRateLimit('staff_1')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(enforceAdminChatRateLimit('staff_2')).resolves.toBeUndefined();
  });
  it('bounds anonymous handshakes and writes while permitting a separate IP', async () => {
    const { enforceRateLimit } = await import('../src/server/rate-limit');
    const request = new Request('http://localhost/api/v1/chat/session', { headers: { 'x-forwarded-for': '198.51.100.91' } });
    for (let attempt = 0; attempt < 20; attempt += 1) await enforceRateLimit(request, 'chatWrite');
    await expect(enforceRateLimit(request, 'chatWrite')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(enforceRateLimit(new Request(request, { headers: { 'x-forwarded-for': '198.51.100.92' } }), 'chatWrite')).resolves.toBeUndefined();
    await expect(enforceRateLimit(request, 'chatRead')).resolves.toBeUndefined();
  });

  it('caps one session independently of IP and expires its minute window', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
      const { enforceChatSessionRateLimit } = await import('../src/server/rate-limit');
      for (let attempt = 0; attempt < 20; attempt += 1) await enforceChatSessionRateLimit('thread_1');
      await expect(enforceChatSessionRateLimit('thread_1')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      await expect(enforceChatSessionRateLimit('thread_2')).resolves.toBeUndefined();
      vi.advanceTimersByTime(60_001);
      await expect(enforceChatSessionRateLimit('thread_1')).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it('also caps sustained messages across successive minute windows', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
      const { enforceChatSessionRateLimit } = await import('../src/server/rate-limit');
      for (let minute = 0; minute < 5; minute += 1) {
        for (let attempt = 0; attempt < 20; attempt += 1) await enforceChatSessionRateLimit('thread_hourly');
        vi.advanceTimersByTime(60_001);
      }
      await expect(enforceChatSessionRateLimit('thread_hourly')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    } finally { vi.useRealTimers(); }
  });
});
