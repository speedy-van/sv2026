import { ApiClientError } from '@sv/api-client';
import { BrowserAdminSession, resolveBrowserApiBaseUrl } from '../src/state/browser-session';

const access = {
  accessToken: 'fixture-access-token-more-than-20-characters',
  accessExpiresAt: '2031-10-15T12:15:00.000Z',
  user: {
    id: 'fixture-admin',
    name: 'Fixture Admin',
    email: 'admin@example.test',
    role: 'ADMIN',
    status: 'ACTIVE',
  },
};
function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
function setup() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
    removeItem: (key: string): void => {
      values.delete(key);
    },
  };
  const fetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
  const events = new EventTarget();
  const create = (): BrowserAdminSession =>
    new BrowserAdminSession({ baseUrl: 'https://api.example.test', fetch, storage, events });
  return { values, storage, fetch, events, create };
}
function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      if (!resolvePromise) throw new Error('Deferred response is not ready.');
      resolvePromise(value);
    },
  };
}

describe('protected persistent browser sessions', () => {
  it('uses cookie credentials and restores a new runtime without storing access or refresh tokens in JS storage', async () => {
    const context = setup();
    context.fetch.mockImplementation(() => Promise.resolve(response(access)));
    await expect(
      context.create().login('/api/v1/auth/password/login', { password: 'fixture-only' }),
    ).resolves.toEqual(access);
    await expect(context.create().restore()).resolves.toEqual(access);
    expect([...context.values]).toEqual([]);
    expect(context.fetch.mock.calls[1]?.[0]).toBe('https://api.example.test/api/v1/auth/browser/session');
    expect(context.fetch.mock.calls[1]?.[1]).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: '{}',
    });
    expect(new Headers(context.fetch.mock.calls[1]?.[1]?.headers).has('authorization')).toBe(false);
  });

  it.each([500, 429, 403])('retains the saved cookie session after a retryable HTTP %s', async (status) => {
    const context = setup();
    const session = context.create();
    context.fetch.mockResolvedValueOnce(response({}, status)).mockResolvedValueOnce(response(access));
    await expect(session.restore()).rejects.toBeInstanceOf(ApiClientError);
    expect(session.isSignedOut()).toBe(false);
    await expect(session.restore()).resolves.toEqual(access);
  });

  it('retains restoration after an offline request or malformed successful response', async () => {
    const context = setup();
    const session = context.create();
    context.fetch
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response(access));
    await expect(session.restore()).rejects.toThrow('Offline');
    await expect(session.restore()).rejects.toThrow();
    expect(session.isSignedOut()).toBe(false);
    await expect(session.restore()).resolves.toEqual(access);
  });

  it('preserves explicit offline sign-out across a fresh runtime until manual sign-in succeeds', async () => {
    const context = setup();
    context.fetch.mockRejectedValueOnce(new Error('Offline'));
    await expect(context.create().signOut()).rejects.toThrow('Offline');
    expect(context.values.get('sv-admin-signed-out')).toBe('1');
    const next = context.create();
    await expect(next.restore()).rejects.toMatchObject({ status: 401 });
    expect(context.fetch).toHaveBeenCalledTimes(1);
    context.fetch.mockResolvedValueOnce(response(access));
    await next.login('/api/v1/auth/password/login', {});
    expect(next.isSignedOut()).toBe(false);
    expect(context.values.size).toBe(0);
  });

  it('marks manual sign-out before sending its revocation request and validates the acknowledgement', async () => {
    const context = setup();
    context.fetch.mockImplementationOnce(() => {
      expect(context.values.get('sv-admin-signed-out')).toBe('1');
      return Promise.resolve(response({ ok: false }));
    });
    await expect(context.create().signOut()).rejects.toThrow();
    expect(context.create().isSignedOut()).toBe(true);
  });

  it('does not let an older successful restore undo manual logout', async () => {
    const context = setup();
    const pending = deferred<Response>();
    const started = deferred<boolean>();
    context.fetch
      .mockImplementationOnce(() => {
        started.resolve(true);
        return pending.promise;
      })
      .mockResolvedValueOnce(response({ ok: true }));
    const session = context.create();
    const restoring = session.restore();
    const rejected = expect(restoring).rejects.toThrow('cancelled');
    await started.promise;
    const signingOut = session.signOut();
    pending.resolve(response(access));
    await rejected;
    await signingOut;
    expect(session.isSignedOut()).toBe(true);
  });

  it('propagates manual logout to another tab and removes its listener cleanly', () => {
    const context = setup();
    const listener = jest.fn();
    const unsubscribe = context.create().subscribeToSignOut(listener, jest.fn());
    context.storage.setItem('sv-admin-signed-out', '1');
    context.events.dispatchEvent(new Event('storage'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    context.events.dispatchEvent(new Event('storage'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('preserves a plain 401 status for the provider to classify without fabricating a remembered user', async () => {
    const context = setup();
    context.fetch.mockResolvedValue(new Response('Sign in required', { status: 401 }));
    await expect(context.create().restore()).rejects.toMatchObject({ status: 401 });
  });

  it('keeps unreadable storage retryable and restores after storage access recovers', async () => {
    const context = setup();
    const getItem = jest.spyOn(context.storage, 'getItem');
    getItem.mockImplementation(() => {
      throw new Error('Storage is temporarily unavailable');
    });
    context.fetch.mockResolvedValueOnce(response(access));
    const session = context.create();
    expect(() => session.isSignedOut()).toThrow('could not read');
    await expect(session.restore()).rejects.toThrow('could not read');
    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.values.size).toBe(0);
    getItem.mockRestore();
    await expect(session.restore()).resolves.toEqual(access);
    expect(session.isSignedOut()).toBe(false);
  });

  it('reports a storage event read failure without treating it as manual logout', () => {
    const context = setup();
    const listener = jest.fn();
    const onStorageError = jest.fn();
    const unsubscribe = context.create().subscribeToSignOut(listener, onStorageError);
    jest.spyOn(context.storage, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    context.events.dispatchEvent(new Event('storage'));
    expect(listener).not.toHaveBeenCalled();
    expect(onStorageError).toHaveBeenCalledWith(expect.any(Error));
    expect(context.fetch).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('pairs local preview and API hostnames without rewriting production destinations', () => {
    expect(
      resolveBrowserApiBaseUrl('http://127.0.0.1:3000', {
        hostname: 'localhost',
        port: '8081',
        protocol: 'http:',
      }),
    ).toBe('http://localhost:3000');
    expect(
      resolveBrowserApiBaseUrl('http://localhost:3000', {
        hostname: '127.0.0.1',
        port: '8081',
        protocol: 'http:',
      }),
    ).toBe('http://127.0.0.1:3000');
    expect(
      resolveBrowserApiBaseUrl('https://api.example.test', {
        hostname: 'localhost',
        port: '8081',
        protocol: 'http:',
      }),
    ).toBe('https://api.example.test');
  });
});
