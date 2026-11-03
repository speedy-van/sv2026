import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ApiClientError,
  MemoryTokenStorage,
  SpeedyVanApiClient,
  type ApiTokens,
  type TokenStorage,
} from '../src';

const expired: ApiTokens = {
  accessExpiresAt: '2030-01-01T00:00:00.000Z',
  accessToken: 'expired-access-token-0001',
  refreshToken: 'refresh-token-one-0001',
};
const fresh: ApiTokens = {
  accessExpiresAt: '2030-01-01T00:15:00.000Z',
  accessToken: 'fresh-access-token-0001',
  refreshToken: 'refresh-token-two-0001',
};
const requestId = '5f0a6f76-9246-4462-b852-9ccf1d9edca7';
const okSchema = z.object({ ok: z.literal(true) }).strict();
function unauthorized(): Response {
  return Response.json(
    { error: { code: 'UNAUTHORIZED', message: 'Sign in required.', requestId: 'req_test' } },
    { status: 401 },
  );
}
function refreshed(tokens: ApiTokens = fresh): Response {
  return Response.json({
    ...tokens,
    user: { email: 'owner@example.test', id: 'user_1', name: 'Owner', role: 'OWNER', status: 'ACTIVE' },
  });
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred not initialized.');
  };
  let reject: (reason?: unknown) => void = () => {
    throw new Error('Deferred not initialized.');
  };
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
async function setup(
  fetchMock: typeof fetch,
  options: { storage?: TokenStorage; refreshTokens?: () => Promise<ApiTokens> } = {},
) {
  const storage = options.storage ?? new MemoryTokenStorage();
  await storage.set(expired);
  const onSignOut = vi.fn();
  const createRefreshRequestId = vi.fn(() => requestId);
  const client = new SpeedyVanApiClient({
    appVersion: 'admin@1.0.0',
    baseUrl: 'https://api.example.test',
    deviceId: 'device-1',
    fetch: fetchMock,
    createRefreshRequestId,
    onSignOut,
    storage,
    ...(options.refreshTokens ? { refreshTokens: options.refreshTokens } : {}),
  });
  return { client, storage, onSignOut, createRefreshRequestId };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
}
function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('Expected JSON request body.');
  return JSON.parse(init.body) as unknown;
}

describe('@sv/api-client', () => {
  it('passes query cancellation to the transport without clearing the session', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    }));
    const { client, storage, onSignOut } = await setup(fetchMock);
    const pending = client.request('/api/v1/admin/dashboard', { schema: okSchema, signal: controller.signal });
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledOnce(); });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    expect(await storage.get()).toEqual(expired);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('does not send an already canceled query', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>();
    const { client, storage, onSignOut } = await setup(fetchMock);
    await expect(client.request('/api/v1/admin/dashboard', { schema: okSchema, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await storage.get()).toEqual(expired);
    expect(onSignOut).not.toHaveBeenCalled();
  });
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
        return Promise.resolve(
          Response.json({
            accessExpiresAt: '2030-01-01T00:15:00.000Z',
            accessToken: 'fresh-access-token-0001',
            refreshToken: 'refresh-token-two-0001',
            user: {
              email: 'owner@example.test',
              id: 'user_1',
              name: 'Owner',
              role: 'OWNER',
              status: 'ACTIVE',
            },
          }),
        );
      }
      seenAuth.push(headers.get('authorization') ?? '');
      if (headers.get('authorization') === 'Bearer expired-access-token-0001') {
        return Promise.resolve(
          Response.json(
            { error: { code: 'UNAUTHORIZED', message: 'expired', requestId: 'req_test' } },
            { status: 401 },
          ),
        );
      }
      return Promise.resolve(Response.json({ ok: true }));
    };
    const client = new SpeedyVanApiClient({
      appVersion: 'admin@1.0.0',
      baseUrl: 'https://api.example.test',
      deviceId: 'device-1',
      fetch: fetchMock,
      createRefreshRequestId: () => requestId,
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

  it.each([
    ['network failure', () => Promise.reject(new TypeError('Offline'))],
    ['timeout', () => Promise.reject(new DOMException('Timeout', 'TimeoutError'))],
    [
      'server error',
      () =>
        Promise.resolve(
          Response.json(
            { error: { code: 'INTERNAL', message: 'Try later.', requestId: 'req_test' } },
            { status: 503 },
          ),
        ),
    ],
    [
      'rate limit',
      () =>
        Promise.resolve(
          Response.json(
            { error: { code: 'RATE_LIMITED', message: 'Try later.', requestId: 'req_test' } },
            { status: 429 },
          ),
        ),
    ],
    ['invalid JSON', () => Promise.resolve(new Response('not json', { status: 200 }))],
    ['schema mismatch', () => Promise.resolve(Response.json({ accessToken: 'invalid' }))],
    ['unrecognized 401', () => Promise.resolve(new Response('unavailable', { status: 401 }))],
  ] as const)(
    'retains the durable session and pending retry ID after a refresh %s',
    async (_name, response) => {
      const { client, storage, onSignOut } = await setup((input) =>
        requestUrl(input).endsWith('/auth/refresh') ? response() : Promise.resolve(unauthorized()),
      );
      await expect(client.request('/api/v1/me', { schema: okSchema })).rejects.toBeDefined();
      expect(await storage.get()).toEqual({ ...expired, refreshRequestId: requestId });
      expect(onSignOut).not.toHaveBeenCalled();
    },
  );

  it('persists a refresh ID before sending and reuses it after a lost response', async () => {
    const bodies: unknown[] = [];
    let attempts = 0;
    const storage = new MemoryTokenStorage();
    const { client, createRefreshRequestId } = await setup(
      async (input, init) => {
        if (!requestUrl(input).endsWith('/auth/refresh'))
          return new Headers(init?.headers).get('authorization') === `Bearer ${fresh.accessToken}`
            ? Response.json({ ok: true })
            : unauthorized();
        expect(await storage.get()).toEqual({ ...expired, refreshRequestId: requestId });
        bodies.push(requestBody(init));
        if (attempts++ === 0) throw new TypeError('Response lost');
        return refreshed();
      },
      { storage },
    );
    await expect(client.request('/api/v1/me', { schema: okSchema })).rejects.toThrow('Response lost');
    expect(await client.request('/api/v1/me', { schema: okSchema })).toEqual({ ok: true });
    expect(bodies).toEqual(
      Array.from({ length: 2 }, () => ({
        deviceId: 'device-1',
        refreshToken: expired.refreshToken,
        requestId,
      })),
    );
    expect(createRefreshRequestId).toHaveBeenCalledOnce();
    expect(await storage.get()).toEqual(fresh);
  });

  it('does not send refresh when its retry ID cannot be saved', async () => {
    const memory = new MemoryTokenStorage();
    const storage: TokenStorage = {
      clear: () => memory.clear(),
      get: () => memory.get(),
      set: (tokens) =>
        tokens.refreshRequestId
          ? Promise.reject(new Error('Secure storage unavailable'))
          : memory.set(tokens),
    };
    let refreshCalls = 0;
    const { client, onSignOut } = await setup(
      (input) => {
        if (requestUrl(input).endsWith('/auth/refresh')) refreshCalls += 1;
        return Promise.resolve(unauthorized());
      },
      { storage },
    );
    await expect(client.request('/api/v1/me', { schema: okSchema })).rejects.toThrow(
      'Secure storage unavailable',
    );
    expect(refreshCalls).toBe(0);
    expect(await storage.get()).toEqual(expired);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('keeps the retry receipt if saving rotated tokens fails, allowing the same rotation to recover', async () => {
    const memory = new MemoryTokenStorage();
    let failSave = true;
    const storage: TokenStorage = {
      clear: () => memory.clear(),
      get: () => memory.get(),
      set: (tokens) => {
        if (tokens.accessToken === fresh.accessToken && failSave) {
          failSave = false;
          return Promise.reject(new Error('Write failed'));
        }
        return memory.set(tokens);
      },
    };
    const ids: unknown[] = [];
    const { client, onSignOut } = await setup(
      (input, init) => {
        if (requestUrl(input).endsWith('/auth/refresh')) {
          ids.push((requestBody(init) as { requestId: unknown }).requestId);
          return Promise.resolve(refreshed());
        }
        return Promise.resolve(
          new Headers(init?.headers).get('authorization') === `Bearer ${fresh.accessToken}`
            ? Response.json({ ok: true })
            : unauthorized(),
        );
      },
      { storage },
    );
    await expect(client.request('/api/v1/me', { schema: okSchema })).rejects.toThrow('Write failed');
    expect(await storage.get()).toEqual({ ...expired, refreshRequestId: requestId });
    await expect(client.request('/api/v1/me', { schema: okSchema })).resolves.toEqual({ ok: true });
    expect(ids).toEqual([requestId, requestId]);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('clears a definitively revoked refresh once for concurrent callers', async () => {
    const { client, storage, onSignOut } = await setup(() => Promise.resolve(unauthorized()));
    const results = await Promise.allSettled([
      client.request('/one', { schema: okSchema }),
      client.request('/two', { schema: okSchema }),
    ]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(await storage.get()).toBeNull();
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('uses the latest token for a delayed old 401 without rotating a second time', async () => {
    const delayed = deferred<Response>();
    const started = deferred<undefined>();
    let refreshCalls = 0;
    const { client } = await setup((input, init) => {
      if (requestUrl(input).endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(refreshed());
      }
      if (new Headers(init?.headers).get('authorization') === `Bearer ${fresh.accessToken}`)
        return Promise.resolve(Response.json({ ok: true }));
      if (requestUrl(input).endsWith('/delayed')) {
        started.resolve(undefined);
        return delayed.promise;
      }
      return Promise.resolve(unauthorized());
    });
    const oldRequest = client.request('/delayed', { schema: okSchema });
    await started.promise;
    await client.request('/fast', { schema: okSchema });
    delayed.resolve(unauthorized());
    await expect(oldRequest).resolves.toEqual({ ok: true });
    expect(refreshCalls).toBe(1);
  });

  it('does not resurrect a session when sign-out occurs during refresh', async () => {
    const pending = deferred<Response>();
    const started = deferred<undefined>();
    const { client, storage, onSignOut } = await setup((input) => {
      if (requestUrl(input).endsWith('/auth/refresh')) {
        started.resolve(undefined);
        return pending.promise;
      }
      return Promise.resolve(unauthorized());
    });
    const request = client.request('/api/v1/me', { schema: okSchema });
    const rejected = expect(request).rejects.toBeInstanceOf(ApiClientError);
    await started.promise;
    await client.signOut();
    pending.resolve(refreshed());
    await rejected;
    expect(await storage.get()).toBeNull();
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('does not overwrite or sign out a newer explicit login after an old refresh fails', async () => {
    const pending = deferred<Response>();
    const started = deferred<undefined>();
    const { client, storage, onSignOut } = await setup((input) => {
      if (requestUrl(input).endsWith('/auth/refresh')) {
        started.resolve(undefined);
        return pending.promise;
      }
      return Promise.resolve(unauthorized());
    });
    const request = client.request('/api/v1/me', { schema: okSchema });
    const rejected = expect(request).rejects.toBeInstanceOf(ApiClientError);
    await started.promise;
    const other = {
      ...fresh,
      accessToken: 'other-account-access-token',
      refreshToken: 'other-account-refresh-token',
    };
    await client.setTokens(other);
    pending.resolve(unauthorized());
    await rejected;
    expect(await storage.get()).toEqual(other);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('clears only the current rotated credentials after a second actual 401', async () => {
    const { client, storage, onSignOut } = await setup((input) =>
      Promise.resolve(requestUrl(input).endsWith('/auth/refresh') ? refreshed() : unauthorized()),
    );
    await expect(client.request('/api/v1/me', { schema: okSchema })).rejects.toMatchObject({ status: 401 });
    expect(await storage.get()).toBeNull();
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it.each([
    ['non-JSON proxy response', () => new Response('Gateway authentication unavailable', { status: 401 })],
    [
      'unexpected structured error',
      () =>
        Response.json(
          { error: { code: 'INTERNAL', message: 'Try later.', requestId: 'req_test' } },
          { status: 401 },
        ),
    ],
  ] as const)(
    'retains successfully refreshed credentials when the retry401 is a %s',
    async (_name, retryResponse) => {
      let refreshCalls = 0;
      const { client, storage, onSignOut } = await setup((input, init) => {
        if (requestUrl(input).endsWith('/auth/refresh')) {
          refreshCalls += 1;
          return Promise.resolve(refreshed());
        }
        return Promise.resolve(
          new Headers(init?.headers).get('authorization') === `Bearer ${fresh.accessToken}`
            ? retryResponse()
            : unauthorized(),
        );
      });
      await expect(client.request('/api/v1/me', { schema: okSchema })).rejects.toMatchObject({ status: 401 });
      expect(refreshCalls).toBe(1);
      expect(await storage.get()).toEqual(fresh);
      expect(onSignOut).not.toHaveBeenCalled();
    },
  );

  it('does not clear a newer login when the retry receives a delayed 401', async () => {
    const pending = deferred<Response>();
    const started = deferred<undefined>();
    const { client, storage, onSignOut } = await setup((input, init) => {
      if (requestUrl(input).endsWith('/auth/refresh')) return Promise.resolve(refreshed());
      if (new Headers(init?.headers).get('authorization') === `Bearer ${fresh.accessToken}`) {
        started.resolve(undefined);
        return pending.promise;
      }
      return Promise.resolve(unauthorized());
    });
    const request = client.request('/api/v1/me', { schema: okSchema });
    const rejected = expect(request).rejects.toBeInstanceOf(ApiClientError);
    await started.promise;
    const other = {
      ...fresh,
      accessToken: 'another-account-access-token',
      refreshToken: 'another-account-refresh-token',
    };
    await client.setTokens(other);
    pending.resolve(unauthorized());
    await rejected;
    expect(await storage.get()).toEqual(other);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('supports access-only browser tokens through the cookie restore callback', async () => {
    const accessOnly = { accessExpiresAt: fresh.accessExpiresAt, accessToken: fresh.accessToken };
    const restore = vi.fn(() => Promise.resolve(accessOnly));
    const { client, storage } = await setup(
      (_input, init) =>
        Promise.resolve(
          new Headers(init?.headers).get('authorization') === `Bearer ${fresh.accessToken}`
            ? Response.json({ ok: true })
            : unauthorized(),
        ),
      { refreshTokens: restore },
    );
    await client.setTokens({ accessExpiresAt: expired.accessExpiresAt, accessToken: expired.accessToken });
    await expect(client.request('/api/v1/me', { schema: okSchema })).resolves.toEqual({ ok: true });
    expect(restore).toHaveBeenCalledOnce();
    expect(await storage.get()).toEqual(accessOnly);
  });

  it('preserves access-only browser tokens on a transient cookie restore failure', async () => {
    const restore = vi.fn(() => Promise.reject(new ApiClientError(503, 'Try again.')));
    const { client, storage, onSignOut } = await setup(() => Promise.resolve(unauthorized()), {
      refreshTokens: restore,
    });
    const accessOnly = { accessExpiresAt: expired.accessExpiresAt, accessToken: expired.accessToken };
    await client.setTokens(accessOnly);
    await expect(client.request('/api/v1/me', { schema: okSchema })).rejects.toMatchObject({ status: 503 });
    expect(await storage.get()).toEqual(accessOnly);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('does not read storage for public login requests or sign out for forbidden responses', async () => {
    const readStorage = vi.fn(() => Promise.reject(new Error('Unavailable')));
    const storage: TokenStorage = { clear: vi.fn(), get: readStorage, set: vi.fn() };
    const client = new SpeedyVanApiClient({
      appVersion: 'admin@1.0.0',
      baseUrl: 'https://api.example.test',
      deviceId: 'device-1',
      storage,
      fetch: () => Promise.resolve(Response.json({ ok: true })),
    });
    await expect(
      client.request('/api/v1/auth/password/login', { auth: false, body: {}, schema: okSchema }),
    ).resolves.toEqual({ ok: true });
    expect(readStorage).not.toHaveBeenCalled();
    const authenticated = await setup(() =>
      Promise.resolve(
        Response.json(
          { error: { code: 'FORBIDDEN', message: 'Forbidden.', requestId: 'req_test' } },
          { status: 403 },
        ),
      ),
    );
    await expect(authenticated.client.request('/admin-only', { schema: okSchema })).rejects.toMatchObject({
      status: 403,
    });
    expect(await authenticated.storage.get()).toEqual(expired);
    expect(authenticated.onSignOut).not.toHaveBeenCalled();
  });
});
