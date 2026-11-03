import { act, render, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@sv/api-client';
import { BrowserAuthTokenResponseSchema, type BrowserAuthTokenResponse } from '@sv/contracts';
import * as LocalAuthentication from 'expo-local-authentication';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import type * as ExpoCore from 'expo-modules-core';
import { Platform, Text } from 'react-native';
import { z } from 'zod';
import { AuthProvider, useAuth } from '../src/state/auth';

const secureValues = new Map<string, string>();
const mockSignOutListeners = new Set<() => void>();
const mockStorageErrorListeners = new Set<(error: Error) => void>();
const mockOnlineListeners = new Set<(state: { isConnected: boolean | null }) => void>();
let mockSignedOut = false;
let mockStorageError: Error | null = null;
interface BrowserOptions {
  baseUrl: string;
  fetch: typeof global.fetch;
}
let mockBrowserOptions: BrowserOptions | undefined;
const mockBrowserRestore = jest.fn<Promise<BrowserAuthTokenResponse>, []>();
const mockBrowserLogin = jest.fn<Promise<BrowserAuthTokenResponse>, [string, unknown, BrowserOptions]>();
const mockBrowserSignOut = jest.fn<Promise<void>, []>();
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual<typeof ExpoCore>('expo-modules-core'),
  uuid: { v4: () => '30303030-3030-4030-8030-303030303030' },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: { isConnected: boolean | null }) => void) => {
      mockOnlineListeners.add(listener);
      return () => {
        mockOnlineListeners.delete(listener);
      };
    },
  },
}));
jest.mock('../src/state/browser-session', () => ({
  resolveBrowserApiBaseUrl: (value: string) => value,
  BrowserAdminSession: class {
    constructor(readonly mockOptions: BrowserOptions) {
      mockBrowserOptions = mockOptions;
    }
    login(path: string, body: unknown) {
      return mockBrowserLogin(path, body, this.mockOptions);
    }
    restore() {
      return mockBrowserRestore();
    }
    signOut() {
      return mockBrowserSignOut();
    }
    isSignedOut() {
      if (mockStorageError) throw mockStorageError;
      return mockSignedOut;
    }
    subscribeToSignOut(listener: () => void, onStorageError: (error: Error) => void) {
      mockSignOutListeners.add(listener);
      mockStorageErrorListeners.add(onStorageError);
      return () => {
        mockSignOutListeners.delete(listener);
        mockStorageErrorListeners.delete(onStorageError);
      };
    }
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    deviceName: 'Test iPhone',
    expoConfig: { extra: { apiBaseUrl: 'https://api.example.test' } },
    sessionId: 'test-session',
  },
}));

type Auth = ReturnType<typeof useAuth>;
let currentAuth: Auth | null = null;
const originalFetch = global.fetch;
const AcceptedSchema = z.object({ ok: z.boolean() }).strict();
const password = '  Only a test password  ';
const tokens = {
  accessExpiresAt: '2031-10-15T12:15:00.000Z',
  accessToken: 'test-access-token-at-least-20-characters',
  refreshToken: 'test-refresh-token-at-least-20-characters',
};
const user = {
  email: 'admin@example.test',
  id: 'test-admin',
  name: 'Test Admin',
  role: 'ADMIN',
  status: 'ACTIVE',
};

function auth(): Auth {
  if (!currentAuth) throw new Error('The provider must be mounted first.');
  return currentAuth;
}

function AuthReader(): React.ReactElement {
  currentAuth = useAuth();
  return <Text>{currentAuth.status}</Text>;
}

async function mountProvider(settled = true): Promise<Awaited<ReturnType<typeof render>>> {
  const view = await render(
    <AuthProvider>
      <AuthReader />
    </AuthProvider>,
  );
  if (settled)
    await waitFor(() => {
      expect(auth().status).not.toBe('restoring');
    });
  return view;
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' }, status });
}

function tokenResponse(nextTokens = tokens): Response {
  return response(
    Platform.OS === 'web'
      ? { accessToken: nextTokens.accessToken, accessExpiresAt: nextTokens.accessExpiresAt, user }
      : { ...nextTokens, user },
  );
}

function browserResponse(): BrowserAuthTokenResponse {
  return BrowserAuthTokenResponseSchema.parse({
    accessToken: tokens.accessToken,
    accessExpiresAt: tokens.accessExpiresAt,
    user,
  });
}

function meResponse(returnedUser = user): Response {
  return response({
    user: returnedUser,
    role: returnedUser.role,
    driverProfile: null,
    appConfig: {
      minVersion: '1.0.0',
      supportPhone: null,
      featureFlags: {},
      slotWindows: {
        MORNING: { label: 'Morning', start: '08:00', end: '12:00' },
        AFTERNOON: { label: 'Afternoon', start: '12:00', end: '17:00' },
        EVENING: { label: 'Evening', start: '17:00', end: '21:00' },
      },
    },
  });
}

function savedNative(nextTokens: typeof tokens & { refreshRequestId?: string } = tokens): void {
  secureValues.set('sv-admin-tokens', JSON.stringify(nextTokens));
  secureValues.set('sv-admin-device-id', 'durable-native-device');
}

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('The request must have a JSON body.');
  return JSON.parse(init.body) as unknown;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) throw new Error('The deferred promise is not ready.');
      resolvePromise(value);
    },
  };
}

async function signIn(): Promise<void> {
  await act(async () => {
    await auth().signInWithPassword(user.email, password);
  });
}

describe('AuthProvider', () => {
  beforeEach(() => {
    currentAuth = null;
    jest.clearAllMocks();
    secureValues.clear();
    mockSignOutListeners.clear();
    mockStorageErrorListeners.clear();
    mockOnlineListeners.clear();
    mockSignedOut = false;
    mockStorageError = null;
    mockBrowserOptions = undefined;
    jest
      .mocked(SecureStore.getItemAsync)
      .mockReset()
      .mockImplementation((key) => Promise.resolve(secureValues.get(key) ?? null));
    jest
      .mocked(SecureStore.setItemAsync)
      .mockReset()
      .mockImplementation((key, value) => {
        secureValues.set(key, value);
        return Promise.resolve();
      });
    jest
      .mocked(SecureStore.deleteItemAsync)
      .mockReset()
      .mockImplementation((key) => {
        secureValues.delete(key);
        return Promise.resolve();
      });
    mockBrowserRestore.mockReset().mockRejectedValue(
      new ApiClientError(401, 'No saved browser session.', {
        error: { code: 'UNAUTHORIZED', message: 'No saved browser session.', requestId: 'test-no-session' },
      }),
    );
    mockBrowserLogin.mockReset().mockImplementation(async (path, body, options) => {
      const result = await options.fetch(`${options.baseUrl}${path}`, {
        body: JSON.stringify(body),
        credentials: 'include',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sv-app': 'admin@1.0.0' },
      });
      if (!result.ok) throw new ApiClientError(result.status, 'Sign-in could not be completed.');
      const parsed = BrowserAuthTokenResponseSchema.parse(await result.json());
      mockSignedOut = false;
      return parsed;
    });
    mockBrowserSignOut.mockReset().mockImplementation(async () => {
      mockSignedOut = true;
      mockSignOutListeners.forEach((listener) => {
        listener();
      });
      if (!mockBrowserOptions) throw new Error('Missing browser session.');
      const result = await mockBrowserOptions.fetch(
        `${mockBrowserOptions.baseUrl}/api/v1/auth/browser/logout`,
        { method: 'POST', credentials: 'include' },
      );
      if (!result.ok) throw new ApiClientError(result.status, 'Sign-out could not be completed.');
    });
    jest.replaceProperty(Platform, 'OS', 'web');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps browser tokens in memory and sends truthful device data without changing the password', async () => {
    const fetchMock = jest.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(response({ ok: true }));
    await mountProvider();
    await act(async () => {
      await auth().signInWithPassword(' ADMIN@example.test ', password);
    });

    const login = fetchMock.mock.calls[0];
    expect(login?.[0]).toBe('https://api.example.test/api/v1/auth/password/login');
    expect(requestBody(login?.[1])).toEqual({
      app: 'admin',
      device: { appVersion: '1.0.0', deviceId: 'test-session', deviceName: 'Test iPhone', platform: 'web' },
      email: 'admin@example.test',
      password,
    });
    expect(new Headers(login?.[1]?.headers).get('authorization')).toBeNull();
    expect(new Headers(login?.[1]?.headers).get('x-sv-app')).toBe('admin@1.0.0');
    expect(auth().status).toBe('signed-in');
    expect(auth().appLocked).toBe(false);
    await act(async () => {
      auth().lockApp();
      await auth().unlock();
    });
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();

    await auth().api.request('/api/v1/admin/test-read', { schema: AcceptedSchema });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${tokens.accessToken}`,
    );
  });

  it('reports the installed native version when registering the device and making API requests', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.replaceProperty(Constants, 'expoConfig', {
      ...Constants.expoConfig, name: 'SV Admin', slug: 'speedyvan-admin', version: '1.0.1',
    });
    const fetchMock = jest.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(response({ ok: true }));
    await mountProvider();
    await signIn();
    const login = fetchMock.mock.calls.find(([url]) => typeof url === 'string' && url.endsWith('/password/login'));
    expect(requestBody(login?.[1])).toMatchObject({ device: { appVersion: '1.0.1', platform: 'ios' } });
    expect(new Headers(login?.[1]?.headers).get('x-sv-app')).toBe('admin@1.0.1');
    await auth().api.request('/api/v1/admin/test-read', { schema: AcceptedSchema });
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get('x-sv-app')).toBe('admin@1.0.1');
  });

  it.each([
    ['invalid email', 'not-an-email', password],
    ['empty password', user.email, ''],
  ])('returns to idle after %s validation and permits retry', async (_label, email, inputPassword) => {
    await mountProvider();
    await act(async () => {
      await expect(auth().signInWithPassword(email, inputPassword)).rejects.toThrow();
    });
    expect(auth().status).toBe('idle');
    expect(global.fetch).not.toHaveBeenCalled();
    jest.mocked(global.fetch).mockResolvedValueOnce(tokenResponse());
    await signIn();
    expect(auth().status).toBe('signed-in');
  });

  it('propagates failed password login without attempting token refresh or leaving the form submitting', async () => {
    jest.mocked(global.fetch).mockResolvedValueOnce(response({ error: 'not signed in' }, 401));
    await mountProvider();
    await act(async () => {
      await expect(auth().signInWithPassword(user.email, password)).rejects.toThrow();
    });
    expect(auth().status).toBe('idle');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not accept a malformed token response as a signed-in session', async () => {
    jest.mocked(global.fetch).mockResolvedValueOnce(response({ ...tokens, accessToken: '', user }));
    await mountProvider();
    await act(async () => {
      await expect(auth().signInWithPassword(user.email, password)).rejects.toThrow();
    });
    expect(auth().status).toBe('idle');
  });

  it.each([
    ['a driver', { ...user, role: 'DRIVER' }],
    ['a disabled account', { ...user, status: 'DISABLED' }],
    ['an invited account', { ...user, status: 'INVITED' }],
  ])('rejects %s even if a malformed server success reaches the client', async (_label, returnedUser) => {
    jest.mocked(global.fetch).mockResolvedValueOnce(
      response({
        accessExpiresAt: tokens.accessExpiresAt,
        accessToken: tokens.accessToken,
        user: returnedUser,
      }),
    );
    await mountProvider();
    await act(async () => {
      await expect(auth().signInWithPassword(user.email, password)).rejects.toThrow(
        'This account cannot sign in',
      );
    });
    expect(auth().status).toBe('idle');
    expect(auth().appLocked).toBe(false);
  });

  it('prevents duplicate form submissions while a sign-in is pending', async () => {
    const pending = deferred<Response>();
    jest.mocked(global.fetch).mockReturnValueOnce(pending.promise);
    await mountProvider();
    let first: Promise<void> | undefined;
    await act(async () => {
      first = auth().signInWithPassword(user.email, password);
      await Promise.resolve();
    });
    expect(auth().status).toBe('submitting');
    await expect(auth().signInWithPassword(user.email, password)).rejects.toThrow('already in progress');
    await act(async () => {
      pending.resolve(tokenResponse());
      await first;
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(auth().status).toBe('signed-in');
  });

  it('surfaces OTP request errors and keeps the existing code sign-in usable on web', async () => {
    const fetchMock = jest.mocked(global.fetch);
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(tokenResponse());
    await mountProvider();
    await act(async () => {
      await expect(auth().requestCode(user.email)).rejects.toThrow('Network unavailable');
    });
    expect(auth().status).toBe('idle');
    await act(async () => {
      await auth().signInWithCode(user.email, '123456');
    });
    expect(auth().status).toBe('signed-in');
    expect(requestBody(fetchMock.mock.calls[1]?.[1])).toMatchObject({
      app: 'admin',
      code: '123456',
      device: { platform: 'web' },
    });
  });

  it.each(['ios', 'android'] as const)(
    'stores native %s tokens securely and retains the biometric gate',
    async (platform) => {
      jest.replaceProperty(Platform, 'OS', platform);
      jest.mocked(global.fetch).mockResolvedValueOnce(tokenResponse());
      await mountProvider();
      await signIn();
      expect(requestBody(jest.mocked(global.fetch).mock.calls[0]?.[1])).toMatchObject({
        device: { platform },
      });
      const saved = secureValues.get('sv-admin-tokens');
      if (!saved) throw new Error('The native session must be saved.');
      const parsed: unknown = JSON.parse(saved);
      expect(parsed).toEqual(tokens);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith('sv-admin-tokens', saved, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      expect(auth().appLocked).toBe(true);
      jest
        .mocked(LocalAuthentication.authenticateAsync)
        .mockResolvedValueOnce({ error: 'user_cancel', success: false });
      await act(async () => {
        expect(await auth().unlock()).toBe(false);
      });
      expect(auth().appLocked).toBe(true);
      await act(async () => {
        expect(await auth().unlock()).toBe(true);
      });
      expect(auth().appLocked).toBe(false);
    },
  );

  it('fails closed when native secure storage cannot save a login and allows a later retry', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(global.fetch).mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(tokenResponse());
    const write = jest.mocked(SecureStore.setItemAsync).getMockImplementation();
    let fail = true;
    jest.mocked(SecureStore.setItemAsync).mockImplementation((key, value, options) => {
      if (key === 'sv-admin-tokens' && fail) {
        fail = false;
        return Promise.reject(new Error('Secure storage unavailable'));
      }
      return write ? write(key, value, options) : Promise.resolve();
    });
    await mountProvider();
    await act(async () => {
      await expect(auth().signInWithPassword(user.email, password)).rejects.toThrow(
        'Secure storage unavailable',
      );
    });
    expect(auth().status).toBe('idle');
    await signIn();
    expect(auth().status).toBe('signed-in');
  });

  it('aborts a stalled login after 15 seconds and makes the next attempt available', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.mocked(global.fetch);
    fetchMock.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('Aborted'));
            },
            { once: true },
          );
        }),
    );
    await mountProvider();
    let failedLogin: Promise<void> | undefined;
    await act(async () => {
      failedLogin = auth().signInWithPassword(user.email, password);
      void failedLogin.catch(() => undefined);
      await Promise.resolve();
    });
    expect(auth().status).toBe('submitting');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(15_000);
      await expect(failedLogin).rejects.toThrow('timed out');
    });
    expect(auth().status).toBe('idle');
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    fetchMock.mockResolvedValueOnce(tokenResponse());
    await signIn();
    expect(auth().status).toBe('signed-in');
  });

  it('also times out when response headers arrive but the login body stalls', async () => {
    jest.useFakeTimers();
    jest.mocked(global.fetch).mockImplementationOnce((_input, init) => {
      const headersOnly = response({});
      jest.spyOn(headersOnly, 'text').mockImplementationOnce(
        () =>
          new Promise<string>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                reject(new Error('Body aborted'));
              },
              { once: true },
            );
          }),
      );
      return Promise.resolve(headersOnly);
    });
    await mountProvider();
    let failedLogin: Promise<void> | undefined;
    await act(async () => {
      failedLogin = auth().signInWithPassword(user.email, password);
      void failedLogin.catch(() => undefined);
      await Promise.resolve();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(15_000);
      await expect(failedLogin).rejects.toThrow('timed out');
    });
    expect(auth().status).toBe('idle');
  });

  it('revokes the server session with its bearer before removing local tokens', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const fetchMock = jest.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ ok: true }));
    await mountProvider();
    await signIn();
    const signedInClient = auth().api;
    await act(async () => {
      await auth().signOut();
    });
    const logout = fetchMock.mock.calls[1];
    expect(logout?.[0]).toBe('https://api.example.test/api/v1/auth/logout');
    expect(logout?.[1]?.method).toBe('POST');
    expect(new Headers(logout?.[1]?.headers).get('authorization')).toBe(`Bearer ${tokens.accessToken}`);
    expect(auth().status).toBe('idle');
    expect(auth().api).not.toBe(signedInClient);
    await auth().api.request('/api/v1/admin/test-read', { schema: AcceptedSchema });
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('authorization')).toBeNull();
  });

  it('still signs out locally when server logout fails and exposes the error to the UI', async () => {
    const fetchMock = jest.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(response({ ok: true }));
    await mountProvider();
    await signIn();
    await act(async () => {
      await expect(auth().signOut()).rejects.toThrow('Offline');
    });
    expect(auth().status).toBe('idle');
    await auth().api.request('/api/v1/admin/test-read', { schema: AcceptedSchema });
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('authorization')).toBeNull();
  });

  it('returns to the signed-out screen and reports a native storage deletion failure', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest
      .mocked(global.fetch)
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(response({ ok: true }));
    await mountProvider();
    await signIn();
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Secure storage unavailable'));
    await act(async () => {
      await expect(auth().signOut()).rejects.toThrow('Secure storage unavailable');
    });
    expect(auth().status).toBe('idle');
    expect(auth().appLocked).toBe(false);
  });

  it('does not resurrect or overwrite a new session when an old refresh finishes after logout', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const refresh = deferred<Response>();
    const refreshStarted = deferred<undefined>();
    const newTokens = {
      ...tokens,
      accessToken: 'new-session-access-at-least-20-characters',
      refreshToken: 'new-session-refresh-at-least-20-characters',
    };
    const fetchMock = jest.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(tokenResponse());
    await mountProvider();
    await signIn();
    const oldClient = auth().api;
    fetchMock.mockImplementation((input) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (path.endsWith('/auth/refresh')) {
        refreshStarted.resolve(undefined);
        return refresh.promise;
      }
      if (path.endsWith('/auth/logout')) return Promise.resolve(response({ ok: true }));
      if (path.endsWith('/auth/password/login')) return Promise.resolve(tokenResponse(newTokens));
      if (path.endsWith('/admin/old-request')) return Promise.resolve(response({ error: 'expired' }, 401));
      return Promise.resolve(response({ ok: true }));
    });
    const oldRequest = oldClient.request('/api/v1/admin/old-request', { schema: AcceptedSchema });
    void oldRequest.catch(() => undefined);
    await refreshStarted.promise;
    await act(async () => {
      await auth().signOut();
    });
    await signIn();
    const newClient = auth().api;
    await act(async () => {
      refresh.resolve(
        tokenResponse({ ...tokens, accessToken: 'stale-refresh-access-at-least-20-characters' }),
      );
      await expect(oldRequest).rejects.toThrow();
    });
    expect(auth().status).toBe('signed-in');
    expect(auth().api).toBe(newClient);
    await auth().api.request('/api/v1/admin/new-request', { schema: AcceptedSchema });
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(new Headers(lastCall?.[1]?.headers).get('authorization')).toBe(`Bearer ${newTokens.accessToken}`);
  });

  it('restores the browser cookie session after remount without persisting JavaScript refresh credentials', async () => {
    const fetchMock = jest.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(response({ ok: true }));
    const mounted = await mountProvider();
    await signIn();
    await mounted.unmount();
    mockBrowserRestore.mockResolvedValueOnce(browserResponse());
    await mountProvider();
    expect(auth().status).toBe('signed-in');
    await auth().api.request('/api/v1/admin/test-read', { schema: AcceptedSchema });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${tokens.accessToken}`,
    );
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('shows no false expired-session warning when the browser has never had a session cookie', async () => {
    await mountProvider();
    expect(auth().status).toBe('idle');
    expect(auth().signOutWarning).toBeNull();
    expect(mockBrowserSignOut).not.toHaveBeenCalled();
  });

  it.each([
    new Error('Mock offline connection'),
    new ApiClientError(503, 'Mock service unavailable'),
    new ApiClientError(429, 'Mock rate limit'),
    new ApiClientError(403, 'Mock browser origin rejected'),
    new ApiClientError(426, 'Mock app update required'),
    new ApiClientError(401, 'Mock malformed proxy response'),
  ])('retains a retryable browser restore gate after %s', async (error) => {
    mockBrowserRestore.mockRejectedValueOnce(error);
    await mountProvider(false);
    await waitFor(() => {
      expect(auth().restoreError).not.toBeNull();
    });
    expect(auth().status).toBe('restoring');
    expect(auth().user).toBeNull();
    expect(mockBrowserSignOut).not.toHaveBeenCalled();
    mockBrowserRestore.mockResolvedValueOnce(browserResponse());
    await act(async () => {
      await auth().retryRestore();
    });
    expect(auth().status).toBe('signed-in');
    expect(auth().restoreError).toBeNull();
    expect(auth().appLocked).toBe(false);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('restores native tokens through the authoritative account endpoint and starts behind the app lock', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    savedNative();
    jest.mocked(global.fetch).mockResolvedValueOnce(meResponse());
    await mountProvider();
    expect(jest.mocked(global.fetch).mock.calls[0]?.[0]).toBe('https://api.example.test/api/v1/me');
    expect(new Headers(jest.mocked(global.fetch).mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${tokens.accessToken}`,
    );
    expect(auth().user?.id).toBe(user.id);
    expect(auth().appLocked).toBe(true);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('keeps the browser restore retryable when storage cannot be read without revoking its cookie', async () => {
    mockStorageError = new Error('Mock browser storage unavailable');
    await mountProvider(false);
    await waitFor(() => {
      expect(auth().restoreError).toMatch(/storage/);
    });
    expect(auth().status).toBe('restoring');
    expect(mockBrowserRestore).not.toHaveBeenCalled();
    expect(mockBrowserSignOut).not.toHaveBeenCalled();
    mockStorageError = null;
    mockBrowserRestore.mockResolvedValueOnce(browserResponse());
    await act(async () => {
      await auth().retryRestore();
    });
    expect(auth().status).toBe('signed-in');
    expect(auth().restoreError).toBeNull();
  });

  it('retains an active browser session when online or cross-tab storage checks fail', async () => {
    mockBrowserRestore.mockResolvedValueOnce(browserResponse());
    await mountProvider();
    await act(() => {
      mockStorageError = new Error('Mock storage read failed');
      mockOnlineListeners.forEach((listener) => {
        listener({ isConnected: true });
      });
      mockStorageErrorListeners.forEach((listener) => {
        listener(new Error('Mock cross-tab storage read failed'));
      });
    });
    expect(auth().status).toBe('signed-in');
    expect(auth().user?.id).toBe(user.id);
    expect(auth().signOutWarning).toMatch(/current sign-in has been kept/);
    expect(mockBrowserSignOut).not.toHaveBeenCalled();
    jest.mocked(global.fetch).mockResolvedValueOnce(response({ ok: true }));
    await auth().api.request('/api/v1/admin/retained-session', { schema: AcceptedSchema });
    expect(new Headers(jest.mocked(global.fetch).mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${tokens.accessToken}`,
    );
  });

  it.each([401, 403])(
    'retains native credentials after an unstructured %s bootstrap response',
    async (status) => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      savedNative();
      const fetchMock = jest.mocked(global.fetch);
      if (status === 401) fetchMock.mockResolvedValueOnce(response({}, 401));
      fetchMock.mockResolvedValueOnce(response({ error: 'Mock proxy response' }, status));
      await mountProvider(false);
      await waitFor(() => {
        expect(auth().restoreError).not.toBeNull();
      });
      expect(auth().status).toBe('restoring');
      expect(secureValues.has('sv-admin-tokens')).toBe(true);
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      fetchMock.mockResolvedValueOnce(meResponse());
      await act(async () => {
        await auth().retryRestore();
      });
      expect(auth().status).toBe('signed-in');
      expect(auth().appLocked).toBe(true);
    },
  );

  it('clears a native session when the authoritative endpoint returns a structured role denial', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    savedNative();
    jest
      .mocked(global.fetch)
      .mockResolvedValueOnce(
        response(
          { error: { code: 'FORBIDDEN', message: 'Staff access is unavailable.', requestId: 'test-denied' } },
          403,
        ),
      );
    await mountProvider();
    expect(auth().status).toBe('idle');
    expect(auth().user).toBeNull();
    expect(secureValues.has('sv-admin-tokens')).toBe(false);
    expect(auth().signOutWarning).toMatch(/no longer valid/);
  });

  it('keeps the saved native device identifier across a new app launch', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(global.fetch).mockResolvedValueOnce(tokenResponse());
    const view = await mountProvider();
    await signIn();
    expect(secureValues.get('sv-admin-device-id')).toBe('test-session');
    await view.unmount();
    jest.replaceProperty(Constants, 'sessionId', 'another-launch-session');
    jest.mocked(global.fetch).mockResolvedValueOnce(meResponse());
    await mountProvider();
    jest
      .mocked(global.fetch)
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(response({ ok: true }));
    await auth().api.request('/api/v1/admin/refresh-read', { schema: AcceptedSchema });
    const refresh = jest
      .mocked(global.fetch)
      .mock.calls.find(([url]) => typeof url === 'string' && url.endsWith('/auth/refresh'));
    expect(requestBody(refresh?.[1])).toMatchObject({ deviceId: 'test-session' });
    expect(secureValues.get('sv-admin-device-id')).toBe('test-session');
  });

  it('retains a pending native refresh receipt and uses it during silent restoration', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const requestId = '40404040-4040-4040-8040-404040404040';
    savedNative({ ...tokens, refreshRequestId: requestId });
    const fetchMock = jest.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(meResponse());
    await mountProvider();
    expect(auth().status).toBe('signed-in');
    expect(requestBody(fetchMock.mock.calls[1]?.[1])).toMatchObject({
      deviceId: 'durable-native-device',
      requestId,
      refreshToken: tokens.refreshToken,
    });
    const stored: unknown = JSON.parse(secureValues.get('sv-admin-tokens') ?? 'null');
    expect(stored).toEqual(tokens);
  });

  it('keeps native credentials on a network failure and restores successfully on explicit retry', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    savedNative();
    jest.mocked(global.fetch).mockRejectedValueOnce(new Error('Mock offline connection'));
    await mountProvider(false);
    await waitFor(() => {
      expect(auth().restoreError).not.toBeNull();
    });
    expect(auth().status).toBe('restoring');
    expect(secureValues.get('sv-admin-tokens')).toBe(JSON.stringify(tokens));
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    jest.mocked(global.fetch).mockResolvedValueOnce(meResponse());
    await act(async () => {
      await auth().retryRestore();
    });
    expect(auth().status).toBe('signed-in');
    expect(auth().appLocked).toBe(true);
  });

  it('retains native credentials if SecureStore is temporarily unavailable', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    savedNative();
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Device still locked'));
    await mountProvider(false);
    await waitFor(() => {
      expect(auth().restoreError).not.toBeNull();
    });
    expect(auth().status).toBe('restoring');
    expect(secureValues.has('sv-admin-tokens')).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    jest.mocked(global.fetch).mockResolvedValueOnce(meResponse());
    await act(async () => {
      await auth().retryRestore();
    });
    expect(auth().status).toBe('signed-in');
  });

  it('keeps malformed stored tokens behind the retryable restore gate rather than accepting a cached user', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    savedNative();
    secureValues.set('sv-admin-tokens', '{invalid');
    await mountProvider(false);
    await waitFor(() => {
      expect(auth().restoreError).not.toBeNull();
    });
    expect(auth().status).toBe('restoring');
    expect(auth().user).toBeNull();
    expect(secureValues.get('sv-admin-tokens')).toBe('{invalid');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...user, role: 'DRIVER' },
    { ...user, status: 'DISABLED' },
  ])('rejects a no-longer-authorized native account returned by /me: %s', async (returnedUser) => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    savedNative();
    jest.mocked(global.fetch).mockResolvedValueOnce(meResponse(returnedUser));
    await mountProvider();
    expect(auth().status).toBe('idle');
    expect(auth().user).toBeNull();
    expect(secureValues.has('sv-admin-tokens')).toBe(false);
  });

  it('asks for one explicit renewal when legacy native tokens have no recoverable device binding', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    secureValues.set('sv-admin-tokens', JSON.stringify(tokens));
    await mountProvider();
    expect(auth().status).toBe('idle');
    expect(auth().signOutWarning).toMatch(/sign in once more/);
    expect(global.fetch).not.toHaveBeenCalled();
    jest.mocked(global.fetch).mockResolvedValueOnce(tokenResponse());
    await signIn();
    expect(auth().status).toBe('signed-in');
    expect(secureValues.get('sv-admin-device-id')).toBe('test-session');
  });

  it('honors the native manual sign-out marker even if old tokens survived a previous storage deletion failure', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    savedNative();
    secureValues.set('sv-admin-signed-out', '1');
    await mountProvider();
    expect(auth().status).toBe('idle');
    expect(auth().user).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(secureValues.has('sv-admin-tokens')).toBe(false);
    expect(secureValues.get('sv-admin-device-id')).toBe('durable-native-device');
  });

  it('does not revive a delayed browser restore after explicit sign-out', async () => {
    const restored = deferred<BrowserAuthTokenResponse>();
    mockBrowserRestore.mockReturnValueOnce(restored.promise);
    jest.mocked(global.fetch).mockResolvedValueOnce(response({ ok: true }));
    await mountProvider(false);
    expect(auth().status).toBe('restoring');
    await act(async () => {
      await auth().signOut();
    });
    await act(async () => {
      restored.resolve(browserResponse());
      await Promise.resolve();
    });
    expect(auth().status).toBe('idle');
    expect(auth().user).toBeNull();
    expect(mockSignedOut).toBe(true);
  });

  it('clears old browser memory on another tab sign-out without sending another logout request', async () => {
    jest.mocked(global.fetch).mockResolvedValueOnce(tokenResponse());
    await mountProvider();
    await signIn();
    await act(() => {
      mockSignedOut = true;
      mockSignOutListeners.forEach((listener) => {
        listener();
      });
    });
    await waitFor(() => {
      expect(auth().status).toBe('idle');
    });
    expect(mockBrowserSignOut).not.toHaveBeenCalled();
    expect(auth().user).toBeNull();
  });

  it('does not apply a different cookie account to an old account query during refresh', async () => {
    const fetchMock = jest.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(tokenResponse());
    await mountProvider();
    await signIn();
    mockBrowserRestore.mockResolvedValueOnce({
      ...browserResponse(),
      user: { ...browserResponse().user, id: 'other-account' },
    });
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({ ok: true }));
    await act(async () => {
      await expect(
        auth().api.request('/api/v1/admin/old-account', { schema: AcceptedSchema }),
      ).rejects.toThrow(/account changed/);
    });
    expect(auth().status).toBe('idle');
    expect(mockBrowserSignOut).not.toHaveBeenCalled();
    await auth().api.request('/api/v1/admin/unsigned-read', { schema: AcceptedSchema });
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get('authorization')).toBeNull();
  });

  it('does not unlock a later native session when an old biometric prompt finishes', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const verified = deferred<LocalAuthentication.LocalAuthenticationResult>();
    jest
      .mocked(global.fetch)
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(tokenResponse());
    await mountProvider();
    await signIn();
    jest.mocked(LocalAuthentication.authenticateAsync).mockReturnValueOnce(verified.promise);
    let pending: Promise<boolean> | undefined;
    await act(async () => {
      pending = auth().unlock();
      await Promise.resolve();
    });
    await act(async () => {
      await auth().signOut();
    });
    await signIn();
    await act(async () => {
      verified.resolve({ success: true });
      expect(await pending).toBe(false);
    });
    expect(auth().status).toBe('signed-in');
    expect(auth().appLocked).toBe(true);
  });

  it('keeps manual native logout durable when an older login marker deletion finishes late', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const deletionStarted = deferred<undefined>();
    const finishDeletion = deferred<undefined>();
    const deleteItem = jest.mocked(SecureStore.deleteItemAsync).getMockImplementation();
    jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      if (key === 'sv-admin-signed-out') {
        deletionStarted.resolve(undefined);
        await finishDeletion.promise;
      } else if (key === 'sv-admin-tokens') {
        throw new Error('Mock token deletion unavailable');
      }
      await deleteItem?.(key);
    });
    jest
      .mocked(global.fetch)
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(response({ ok: true }));
    const view = await mountProvider();
    let login: Promise<void> | undefined;
    await act(async () => {
      login = auth().signInWithPassword(user.email, password);
      void login.catch(() => undefined);
      await deletionStarted.promise;
    });
    let logout: Promise<void> | undefined;
    await act(async () => {
      logout = auth().signOut();
      void logout.catch(() => undefined);
      await Promise.resolve();
    });
    await act(async () => {
      finishDeletion.resolve(undefined);
      await expect(login).rejects.toThrow(/cancelled/);
      await expect(logout).rejects.toThrow('Mock token deletion unavailable');
    });
    expect(auth().status).toBe('idle');
    expect(secureValues.get('sv-admin-signed-out')).toBe('1');
    expect(secureValues.has('sv-admin-tokens')).toBe(true);
    await view.unmount();
    jest.mocked(SecureStore.deleteItemAsync).mockImplementation((key) => {
      secureValues.delete(key);
      return Promise.resolve();
    });
    jest.mocked(global.fetch).mockClear();
    await mountProvider();
    expect(auth().status).toBe('idle');
    expect(auth().user).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
