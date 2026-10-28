import { ApiClientError, MemoryTokenStorage, SpeedyVanApiClient, type ApiTokens, type TokenStorage } from '@sv/api-client';
import { AuthTokenResponseSchema, MeResponseSchema, OtpRequestSchema, OtpVerifySchema, PasswordLoginRequestSchema } from '@sv/contracts';
import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { uuid } from 'expo-modules-core';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { z } from 'zod';

interface AuthContextValue {
  api: SpeedyVanApiClient;
  appLocked: boolean;
  lockApp(): void;
  requestCode(email: string): Promise<void>;
  signInWithCode(email: string, code: string): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<void>;
  retryRestore(): Promise<void>;
  restoreError: string | null;
  sessionVersion: number;
  status: 'idle' | 'restoring' | 'signed-in' | 'submitting';
  unlock(): Promise<boolean>;
}

const tokenKey = 'sv-driver-tokens';
const deviceKey = 'sv-driver-device-id';
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const AuthContext = createContext<AuthContextValue | null>(null);
const AcceptedSchema = z.object({ ok: z.boolean() }).strict();
const TokensSchema = AuthTokenResponseSchema.omit({ user: true })
  .extend({ refreshRequestId: z.uuid().optional() }).strict();

class SecureTokenStorage implements TokenStorage {
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(tokenKey);
  }

  async get(): Promise<ApiTokens | null> {
    const raw = await SecureStore.getItemAsync(tokenKey);
    if (!raw) return null;
    let parsed: z.infer<typeof TokensSchema>;
    try { parsed = TokensSchema.parse(JSON.parse(raw) as unknown); }
    catch { throw new DriverSessionError('Your saved sign-in is invalid. Please sign in again.'); }
    return {
      accessToken: parsed.accessToken, accessExpiresAt: parsed.accessExpiresAt,
      refreshToken: parsed.refreshToken,
      ...(parsed.refreshRequestId ? { refreshRequestId: parsed.refreshRequestId } : {}),
    };
  }

  async set(tokens: ApiTokens): Promise<void> {
    await SecureStore.setItemAsync(tokenKey, JSON.stringify(TokensSchema.parse(tokens)), secureOptions);
  }
}

function apiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  return extra?.apiBaseUrl ?? 'http://127.0.0.1:3000';
}

const requestTimeoutMs = 15_000;
const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, requestTimeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = await response.text();
    return new Response(body || null, { headers: response.headers, status: response.status, statusText: response.statusText });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The request timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

type LoginResponse = z.infer<typeof AuthTokenResponseSchema>;
interface SessionRuntime { api: SpeedyVanApiClient; deviceId: string }
class DriverSessionError extends Error {}

function validDriver(user: LoginResponse['user']): void {
  if (user.role !== 'DRIVER' || user.status !== 'ACTIVE')
    throw new DriverSessionError('This account cannot sign in to Speedy Van Driver.');
}

export function AuthProvider(props: { children: React.ReactNode }): React.ReactElement {
  const [status, setStatus] = useState<AuthContextValue['status']>('restoring');
  const [appLocked, setAppLocked] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const initialising = useRef<Promise<SessionRuntime> | null>(null);
  const restoring = useRef<Promise<void> | null>(null);
  const storage = useMemo(() => Platform.OS === 'web' ? new MemoryTokenStorage() : new SecureTokenStorage(), []);
  const [runtime, setRuntime] = useState<SessionRuntime>(() => createRuntime(Constants.sessionId));
  const runtimeRef = useRef(runtime);

  function isMounted(): boolean { return mounted.current; }

  function createRuntime(deviceId: string): SessionRuntime {
    return {
      deviceId,
      api: new SpeedyVanApiClient({
        appVersion: 'driver@1.0.0', baseUrl: apiBaseUrl(), deviceId,
        createRefreshRequestId: uuid.v4, fetch: fetchWithTimeout, storage,
        onSignOut: () => {
          if (mounted.current) { setSessionVersion((current) => current + 1); setStatus('idle'); setAppLocked(false); }
        },
      }),
    };
  }

  async function session(): Promise<SessionRuntime> {
    if (!initialising.current) {
      initialising.current = (async () => {
        if (Platform.OS === 'web') return runtimeRef.current;
        const saved = await SecureStore.getItemAsync(deviceKey);
        const nextId = saved ?? Constants.sessionId;
        if (!nextId.trim() || nextId.length > 160) throw new Error('The saved device identifier is invalid.');
        // Older sessions used a transient ID, so they cannot safely be refreshed on another launch.
        if (!saved) {
          await storage.clear();
          await SecureStore.setItemAsync(deviceKey, nextId, secureOptions);
        }
        const active = runtimeRef.current.deviceId === nextId ? runtimeRef.current : createRuntime(nextId);
        runtimeRef.current = active;
        if (mounted.current) setRuntime(active);
        return active;
      })();
    }
    try { return await initialising.current; }
    catch (error) { initialising.current = null; throw error; }
  }

  function deviceDetails(id: string) {
    return {
      appVersion: '1.0.0', deviceId: id,
      deviceName: Constants.deviceName ?? (Platform.OS === 'web' ? 'Driver web preview' : 'Driver device'),
      platform: Platform.OS === 'web' ? 'web' as const : Platform.OS === 'android' ? 'android' as const : 'ios' as const,
    };
  }

  async function retryRestore(): Promise<void> {
    if (restoring.current) return restoring.current;
    const pending = (async () => {
      if (mounted.current) { setStatus('restoring'); setRestoreError(null); }
      try {
        const active = await session();
        const tokens = await storage.get();
        if (!tokens) { if (mounted.current) setStatus('idle'); return; }
        const me = await active.api.request('/api/v1/me', { schema: MeResponseSchema });
        validDriver(me.user);
        if (me.role !== 'DRIVER') throw new DriverSessionError('This account cannot use the driver app.');
        if (mounted.current) { setSessionVersion((current) => current + 1); setAppLocked(Platform.OS !== 'web'); setStatus('signed-in'); }
      } catch (error) {
        if (!mounted.current) return;
        if (error instanceof DriverSessionError || (error instanceof ApiClientError && error.status === 401 && error.envelope?.error.code === 'UNAUTHORIZED')) {
          try { await runtimeRef.current.api.signOut(); }
          catch { setRestoreError('Your saved sign-in could not be cleared safely. Check device storage and try again.'); }
        } else {
          setRestoreError('Your saved sign-in could not be checked. Check your connection or device storage, then try again.');
        }
      }
    })();
    restoring.current = pending;
    try { await pending; }
    finally { if (restoring.current === pending) restoring.current = null; }
  }

  useEffect(() => {
    mounted.current = true;
    void retryRestore();
    return () => { mounted.current = false; };
  }, []);

  async function submitAuth(operation: (active: SessionRuntime) => Promise<void>): Promise<void> {
    if (submitting.current) throw new Error('A sign-in request is already in progress.');
    submitting.current = true;
    setStatus('submitting');
    try {
      const active = await session();
      if (!mounted.current) throw new Error('Sign-in was cancelled.');
      await operation(active);
    } finally {
      submitting.current = false;
      if (mounted.current) setStatus((current) => current === 'submitting' ? 'idle' : current);
    }
  }

  async function completeSignIn(active: SessionRuntime, response: LoginResponse): Promise<void> {
    validDriver(response.user);
    if (!isMounted()) throw new Error('Sign-in was cancelled.');
    await active.api.setTokens({
      accessExpiresAt: response.accessExpiresAt,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    });
    if (isMounted()) { setSessionVersion((current) => current + 1); setStatus('signed-in'); setAppLocked(Platform.OS !== 'web'); }
  }

  async function requestCode(email: string): Promise<void> {
    await submitAuth(async (active) => {
      const body = OtpRequestSchema.parse({ app: 'driver', email });
      await active.api.request('/api/v1/auth/otp/request', { auth: false, body, schema: AcceptedSchema });
    });
  }

  async function signInWithCode(email: string, code: string): Promise<void> {
    await submitAuth(async (active) => {
      const body = OtpVerifySchema.parse({ app: 'driver', code, device: deviceDetails(active.deviceId), email });
      const response = await active.api.request('/api/v1/auth/otp/verify', { auth: false, body, schema: AuthTokenResponseSchema });
      await completeSignIn(active, response);
    });
  }

  async function signInWithPassword(email: string, password: string): Promise<void> {
    await submitAuth(async (active) => {
      const body = PasswordLoginRequestSchema.parse({ app: 'driver', email, password, device: deviceDetails(active.deviceId) });
      const response = await active.api.request('/api/v1/auth/password/login', { auth: false, body, schema: AuthTokenResponseSchema });
      await completeSignIn(active, response);
    });
  }

  async function unlock(): Promise<boolean> {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Speedy Van Driver' });
    setAppLocked(!result.success);
    return result.success;
  }

  const value = useMemo<AuthContextValue>(() => ({
    api: runtime.api,
    appLocked,
    lockApp: () => { setAppLocked(true); },
    requestCode,
    signInWithCode,
    signInWithPassword,
    retryRestore,
    restoreError,
    sessionVersion,
    status,
    unlock
  }), [runtime, appLocked, status, restoreError, sessionVersion]);

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
