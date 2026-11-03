import { act, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Platform, Text } from 'react-native';
import { AuthProvider, useAuth } from '../src/state/auth';

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
const secureValues = new Map<string, string>();
const originalFetch = global.fetch;
const originalPlatform = Platform.OS;
const password = '  Admin-set test password  ';
const user = { id: 'driver-test', email: 'driver@example.test', name: 'Test Driver', role: 'DRIVER', status: 'ACTIVE' };
const tokens = {
  accessExpiresAt: '2031-10-15T12:15:00.000Z',
  accessToken: 'test-access-token-at-least-20-characters',
  refreshToken: 'test-refresh-token-at-least-20-characters',
};

function auth(): Auth {
  if (!currentAuth) throw new Error('Mount the driver auth provider first.');
  return currentAuth;
}
function AuthReader(): React.ReactElement {
  currentAuth = useAuth();
  return <Text>{currentAuth.status}</Text>;
}
async function mountProvider(): Promise<Awaited<ReturnType<typeof render>>> {
  const view = await render(<AuthProvider><AuthReader /></AuthProvider>);
  await waitFor(() => { expect(auth().status).not.toBe('restoring'); });
  return view;
}
function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' }, status });
}
function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('A JSON request body is required.');
  return JSON.parse(init.body) as unknown;
}
function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
function meResponse(): Response {
  return response({
    user, role: user.role, driverProfile: {},
    appConfig: { minVersion: '1.0.0', supportPhone: null, featureFlags: {}, slotWindows: {
      MORNING: { label: 'Morning', start: '08:00', end: '12:00' },
      AFTERNOON: { label: 'Afternoon', start: '12:00', end: '17:00' },
      EVENING: { label: 'Evening', start: '17:00', end: '21:00' },
    } },
  });
}

beforeEach(() => {
  currentAuth = null;
  jest.clearAllMocks();
  secureValues.clear();
  Platform.OS = 'ios';
  jest.mocked(SecureStore.getItemAsync).mockImplementation((key) => Promise.resolve(secureValues.get(key) ?? null));
  jest.mocked(SecureStore.setItemAsync).mockImplementation((key, value) => {
    secureValues.set(key, value); return Promise.resolve();
  });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation((key) => {
    secureValues.delete(key); return Promise.resolve();
  });
});
afterEach(() => { global.fetch = originalFetch; Platform.OS = originalPlatform; });

describe('driver password authentication without external requests', () => {
  it.each(['ios', 'android'] as const)('sends the unchanged admin-set password and actual %s device payload, storing tokens only in secure storage', async (platform) => {
    Platform.OS = platform;
    const requests: Array<{ url: string; body: unknown }> = [];
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: requestUrl(input), body: requestBody(init) });
      return Promise.resolve(response({ ...tokens, user }));
    });
    await mountProvider();
    await act(async () => { await auth().signInWithPassword(user.email, password); });
    expect(auth().status).toBe('signed-in');
    expect(auth().appLocked).toBe(true);
    expect(requests).toEqual([{
      url: 'https://api.example.test/api/v1/auth/password/login',
      body: { email: user.email, password, app: 'driver', device: {
        appVersion: '1.0.0', deviceId: 'test-session', deviceName: 'Test iPhone', platform,
      } },
    }]);
    expect(JSON.parse(secureValues.get('sv-driver-tokens') ?? '{}')).toEqual(tokens);
    expect(secureValues.get('sv-driver-device-id')).toBe('test-session');
    expect([...secureValues.values()].some((value) => value.includes(password))).toBe(false);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('sv-driver-tokens', JSON.stringify({
      accessToken: tokens.accessToken, accessExpiresAt: tokens.accessExpiresAt, refreshToken: tokens.refreshToken,
    }), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });

  it('recovers from a rejected password without retaining credentials or signing in', async () => {
    global.fetch = jest.fn(() => Promise.resolve(response({ error: {
      code: 'UNAUTHORIZED', message: 'Invalid email or password.', requestId: 'test-request',
    } }, 401)));
    await mountProvider();
    await act(async () => {
      await expect(auth().signInWithPassword(user.email, password)).rejects.toThrow('Invalid email or password.');
    });
    expect(auth().status).toBe('idle');
    expect(auth().appLocked).toBe(false);
    expect(secureValues.has('sv-driver-tokens')).toBe(false);
  });

  it.each(['OWNER', 'ADMIN'])('rejects an unexpected %s response before storing credentials', async (role) => {
    global.fetch = jest.fn(() => Promise.resolve(response({ ...tokens, user: { ...user, role } })));
    await mountProvider();
    await act(async () => {
      await expect(auth().signInWithPassword(user.email, password)).rejects.toThrow('This account cannot sign in');
    });
    expect(auth().status).toBe('idle');
    expect(secureValues.has('sv-driver-tokens')).toBe(false);
  });

  it('retains the code alternative with the same driver audience and device binding', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      requests.push({ url, body: requestBody(init) });
      return Promise.resolve(response(url.endsWith('/request') ? { ok: true } : { ...tokens, user }));
    });
    secureValues.set('sv-driver-device-id', 'durable-driver-device');
    await mountProvider();
    await act(async () => { await auth().requestCode(user.email); });
    expect(auth().status).toBe('idle');
    await act(async () => { await auth().signInWithCode(user.email, '123456'); });
    expect(requests[0]?.body).toEqual({ app: 'driver', email: user.email });
    expect(requests[1]?.body).toEqual({ app: 'driver', email: user.email, code: '123456', device: {
      appVersion: '1.0.0', deviceId: 'durable-driver-device', deviceName: 'Test iPhone', platform: 'ios',
    } });
    expect(auth().status).toBe('signed-in');
  });

  it('exposes code-request network failures and resets submitting so they can be retried', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Test-only offline')));
    await mountProvider();
    await act(async () => {
      await expect(auth().requestCode(user.email)).rejects.toThrow('Test-only offline');
    });
    expect(auth().status).toBe('idle');
    expect(secureValues.has('sv-driver-tokens')).toBe(false);
  });

  it('uses memory-only tokens in the web preview and sends the actual web platform', async () => {
    Platform.OS = 'web';
    const bodies: unknown[] = [];
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(requestBody(init)); return Promise.resolve(response({ ...tokens, user }));
    });
    await mountProvider();
    await act(async () => { await auth().signInWithPassword(user.email, password); });
    expect(bodies[0]).toMatchObject({ app: 'driver', password, device: { platform: 'web' } });
    expect(auth().status).toBe('signed-in');
    expect(auth().appLocked).toBe(false);
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('restores a native DRIVER session using its durable device and locks private screens', async () => {
    secureValues.set('sv-driver-device-id', 'durable-driver-device');
    secureValues.set('sv-driver-tokens', JSON.stringify(tokens));
    const requests: Array<{ url: string; method: string | undefined; token: string | null }> = [];
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: requestUrl(input), method: init?.method, token: new Headers(init?.headers).get('authorization') });
      return Promise.resolve(meResponse());
    });
    await mountProvider();
    expect(auth().status).toBe('signed-in');
    expect(auth().appLocked).toBe(true);
    expect(requests).toEqual([{ url: 'https://api.example.test/api/v1/me', method: 'GET', token: `Bearer ${tokens.accessToken}` }]);
  });

  it('keeps an unavailable restore retryable without clearing a valid saved session', async () => {
    secureValues.set('sv-driver-device-id', 'durable-driver-device');
    secureValues.set('sv-driver-tokens', JSON.stringify(tokens));
    global.fetch = jest.fn(() => Promise.reject(new Error('Test-only offline')));
    await render(<AuthProvider><AuthReader /></AuthProvider>);
    await waitFor(() => { expect(auth().restoreError).toBeTruthy(); });
    expect(auth().status).toBe('restoring');
    expect(secureValues.has('sv-driver-tokens')).toBe(true);
    global.fetch = jest.fn(() => Promise.resolve(meResponse()));
    await act(async () => { await auth().retryRestore(); });
    expect(auth().restoreError).toBeNull();
    expect(auth().status).toBe('signed-in');
  });

  it('clears malformed saved credentials so the driver can use the password form again', async () => {
    secureValues.set('sv-driver-device-id', 'durable-driver-device');
    secureValues.set('sv-driver-tokens', 'test-invalid-json');
    global.fetch = jest.fn();
    await mountProvider();
    expect(auth().status).toBe('idle');
    expect(auth().restoreError).toBeNull();
    expect(secureValues.has('sv-driver-tokens')).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
