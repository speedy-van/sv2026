import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MemoryTokenStorage, SpeedyVanApiClient } from '../src';

describe('@sv/api-client', () => {
  it('refreshes once for concurrent 401s and retries with the new access token', async () => {
    const storage = new MemoryTokenStorage();
    await storage.set({
      accessExpiresAt: '2030-01-01T00:00:00.000Z',
      accessToken: 'expired-access-token-0001',
      refreshToken: 'refresh-token-one-0001',
    });
    const seenAuth: string[] = [];
    let refreshCalls = 0;
    const fetchMock: typeof fetch = (input, init) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
      const headers = new Headers(init?.headers);
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(Response.json({
          accessExpiresAt: '2030-01-01T00:15:00.000Z',
          accessToken: 'fresh-access-token-0001',
          refreshToken: 'refresh-token-two-0001',
          user: { email: 'owner@example.test', id: 'user_1', name: 'Owner', role: 'OWNER', status: 'ACTIVE' },
        }));
      }
      seenAuth.push(headers.get('authorization') ?? '');
      if (headers.get('authorization') === 'Bearer expired-access-token-0001') {
        return Promise.resolve(Response.json({ error: { code: 'UNAUTHORIZED', message: 'expired', requestId: 'req_test' } }, { status: 401 }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    };
    const client = new SpeedyVanApiClient({
      appVersion: 'admin@1.0.0',
      baseUrl: 'https://api.example.test',
      deviceId: 'device-1',
      fetch: fetchMock,
      storage,
    });
    const schema = z.object({ ok: z.literal(true) }).strict();
    const results = await Promise.all([
      client.request('/api/v1/me', { schema }),
      client.request('/api/v1/notifications', { schema }),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
    expect(seenAuth).toEqual([
      'Bearer expired-access-token-0001',
      'Bearer expired-access-token-0001',
      'Bearer fresh-access-token-0001',
      'Bearer fresh-access-token-0001',
    ]);
  });
});
