import {
  ApiClientError,
  MemoryTokenStorage,
  SpeedyVanApiClient,
  type ApiTokens,
  type TokenStorage,
} from '@sv/api-client';
import {
  AuthTokenResponseSchema,
  type BrowserAuthTokenResponse,
  MeResponseSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  PasswordLoginRequestSchema,
} from '@sv/contracts';
import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { uuid } from 'expo-modules-core';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { z } from 'zod';
import { BrowserAdminSession, resolveBrowserApiBaseUrl } from './browser-session';
import { resolveApiBaseUrl } from '@/lib/api-base-url.cjs';

type StaffUser = z.infer<typeof AuthTokenResponseSchema>['user'];
type LoginResponse = z.infer<typeof AuthTokenResponseSchema> | BrowserAuthTokenResponse;
interface AuthContextValue {
  api: SpeedyVanApiClient;
  appLocked: boolean;
  user: StaffUser | null;
  signOutWarning: string | null;
  restoreError: string | null;
  lockApp(): void;
  requestCode(email: string): Promise<void>;
  signInWithCode(email: string, code: string): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  retryRestore(): Promise<void>;
  status: 'idle' | 'restoring' | 'signed-in' | 'submitting';
  unlock(): Promise<boolean>;
}
const tokenKey = 'sv-admin-tokens';
const deviceKey = 'sv-admin-device-id';
const signedOutKey = 'sv-admin-signed-out';
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const AuthContext = createContext<AuthContextValue | null>(null);
const AcceptedSchema = z.object({ ok: z.boolean() }).strict();
const TokensSchema = AuthTokenResponseSchema.omit({ user: true })
  .extend({ refreshRequestId: z.uuid().optional() })
  .strict();
const requestTimeoutMs = 15_000;
class StaffSessionError extends Error {}
class LegacySessionError extends Error {}

class SecureTokenStorage implements TokenStorage {
  #active = true;
  async clear(): Promise<void> {
    this.#active = false;
    await SecureStore.deleteItemAsync(tokenKey);
  }
  async get(): Promise<ApiTokens | null> {
    if (!this.#active) return null;
    const raw = await SecureStore.getItemAsync(tokenKey);
    if (!this.#isActive() || !raw) return null;
    const parsed = TokensSchema.parse(JSON.parse(raw) as unknown);
    return {
      accessExpiresAt: parsed.accessExpiresAt,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      ...(parsed.refreshRequestId ? { refreshRequestId: parsed.refreshRequestId } : {}),
    };
  }
  #isActive(): boolean {
    return this.#active;
  }
  async set(tokens: ApiTokens): Promise<void> {
    const parsed = TokensSchema.parse(tokens);
    await SecureStore.setItemAsync(tokenKey, JSON.stringify(parsed), secureOptions);
    this.#active = true;
  }
}

// Revocable, serialized storage prevents an old API client from restoring tokens
// after logout, a new sign-in, provider teardown, or runtime replacement.
class SessionTokenStorage implements TokenStorage {
  readonly #storage: TokenStorage;
  #active = true;
  #pending: Promise<void> = Promise.resolve();
  constructor(storage: TokenStorage) {
    this.#storage = storage;
  }
  retire(): void {
    this.#active = false;
  }
  async get(): Promise<ApiTokens | null> {
    await this.#pending;
    const tokens = this.#active ? await this.#storage.get() : null;
    return this.#active ? tokens : null;
  }
  set(tokens: ApiTokens): Promise<void> {
    return this.#queue(async () => {
      if (this.#active) await this.#storage.set(tokens);
    });
  }
  clear(): Promise<void> {
    if (!this.#active) return this.#pending;
    this.#active = false;
    return this.#queue(() => this.#storage.clear());
  }
  #queue(operation: () => Promise<void>): Promise<void> {
    const next = this.#pending.then(operation, operation);
    this.#pending = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
interface SessionRuntime {
  api: SpeedyVanApiClient;
  storage: SessionTokenStorage;
  deviceId: string;
  version: number;
}
function configuredBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  return resolveApiBaseUrl(extra?.apiBaseUrl, Platform.OS !== 'web' && !__DEV__);
}
const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  if (init?.signal?.aborted) controller.abort();
  else init?.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = await response.text();
    return new Response(body || null, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    if (controller.signal.aborted && !init?.signal?.aborted)
      throw new Error('The request timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', abort);
  }
};
function validStaff(user: StaffUser): void {
  if (user.status !== 'ACTIVE' || (user.role !== 'OWNER' && user.role !== 'ADMIN'))
    throw new StaffSessionError('This account cannot sign in to SV Admin.');
}
function accessTokens(response: LoginResponse): ApiTokens {
  return {
    accessExpiresAt: response.accessExpiresAt,
    accessToken: response.accessToken,
    ...('refreshToken' in response ? { refreshToken: response.refreshToken } : {}),
  };
}

export function AuthProvider(props: { children: React.ReactNode }): React.ReactElement {
  const [status, setStatus] = useState<AuthContextValue['status']>('restoring');
  const [appLocked, setAppLocked] = useState(false);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [signOutWarning, setSignOutWarning] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const mounted = useRef(true);
  const currentSessionVersion = useRef(0);
  const operationVersion = useRef(0);
  const authSubmitting = useRef(false);
  const ownSignOut = useRef(false);
  const restoreInFlight = useRef<Promise<void> | null>(null);
  const nativeDevice = useRef<Promise<string> | null>(null);
  const nativeDeviceReady = useRef<string | null>(null);
  const nativeMarkerWrites = useRef<Promise<void>>(Promise.resolve());
  const currentUser = useRef<StaffUser | null>(null);
  const baseUrl = useMemo(
    () => (Platform.OS === 'web' ? resolveBrowserApiBaseUrl(configuredBaseUrl()) : configuredBaseUrl()),
    [],
  );
  const storage = useMemo(
    () => (Platform.OS === 'web' ? new MemoryTokenStorage() : new SecureTokenStorage()),
    [],
  );
  const browser = useMemo(
    () => (Platform.OS === 'web' ? new BrowserAdminSession({ baseUrl, fetch: fetchWithTimeout }) : null),
    [baseUrl],
  );
  const [runtime, setRuntime] = useState<SessionRuntime>(() => makeRuntime(Constants.sessionId, 0));
  const runtimeRef = useRef(runtime);

  function isCurrentOperation(version: number): boolean {
    return mounted.current && operationVersion.current === version;
  }
  function signedInUser(): StaffUser | null {
    return currentUser.current;
  }
  function queueNativeMarker(operation: () => Promise<void>): Promise<void> {
    const next = nativeMarkerWrites.current.then(operation, operation);
    nativeMarkerWrites.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  function browserStorageError(): void {
    if (!mounted.current) return;
    if (!currentUser.current && !authSubmitting.current) {
      setStatus('restoring');
      setRestoreError('Your saved sign-in could not be checked. Allow browser storage, then try again.');
    } else {
      setSignOutWarning('Your browser storage is unavailable. Your current sign-in has been kept.');
    }
  }

  function makeRuntime(deviceId: string, version: number): SessionRuntime {
    const sessionStorage = new SessionTokenStorage(storage);
    const api = new SpeedyVanApiClient({
      appVersion: `admin@${Constants.expoConfig?.version ?? '1.0.0'}`,
      baseUrl,
      deviceId,
      fetch: fetchWithTimeout,
      storage: sessionStorage,
      onSignOut: () => {
        finishSignOut(version);
      },
      ...(browser
        ? {
            refreshTokens: async (): Promise<ApiTokens> => {
              const response = await browser.restore();
              if (!mounted.current || version !== currentSessionVersion.current)
                throw new Error('The sign-in changed.');
              try {
                validStaff(response.user);
                if (currentUser.current && currentUser.current.id !== response.user.id)
                  throw new StaffSessionError('The signed-in account changed. Please open SV Admin again.');
              } catch (error) {
                await sessionStorage.clear();
                finishSignOut(version);
                throw error;
              }
              return accessTokens(response);
            },
          }
        : { createRefreshRequestId: uuid.v4 }),
    });
    return { api, storage: sessionStorage, deviceId, version };
  }
  function replaceRuntime(deviceId: string, version: number): SessionRuntime {
    runtimeRef.current.storage.retire();
    const next = makeRuntime(deviceId, version);
    runtimeRef.current = next;
    if (mounted.current) setRuntime(next);
    return next;
  }
  function finishSignOut(version: number): void {
    if (!mounted.current || currentSessionVersion.current !== version) return;
    operationVersion.current += 1;
    authSubmitting.current = false;
    currentUser.current = null;
    setStatus('idle');
    setAppLocked(false);
    setUser(null);
    setRestoreError(null);
    const next = ++currentSessionVersion.current;
    replaceRuntime(runtimeRef.current.deviceId, next);
  }
  async function ensureNativeDevice(): Promise<string> {
    if (nativeDeviceReady.current) return nativeDeviceReady.current;
    if (!nativeDevice.current) {
      nativeDevice.current = (async () => {
        const [saved, existingTokens] = await Promise.all([
          SecureStore.getItemAsync(deviceKey),
          storage.get(),
        ]);
        if (saved) {
          if (saved.length > 160 || !saved.trim()) throw new Error('The saved device identifier is invalid.');
          return saved;
        }
        if (existingTokens)
          throw new LegacySessionError(
            'Please sign in once more to renew this saved session for your device.',
          );
        await SecureStore.setItemAsync(deviceKey, Constants.sessionId, secureOptions);
        return Constants.sessionId;
      })();
    }
    try {
      const id = await nativeDevice.current;
      nativeDeviceReady.current = id;
      return id;
    } catch (error) {
      nativeDevice.current = null;
      throw error;
    }
  }
  function deviceDetails(deviceId: string) {
    return {
      appVersion: Constants.expoConfig?.version ?? '1.0.0',
      deviceId,
      deviceName: Constants.deviceName ?? (Platform.OS === 'web' ? 'Web browser' : 'SV Admin device'),
      platform:
        Platform.OS === 'web'
          ? ('web' as const)
          : Platform.OS === 'android'
            ? ('android' as const)
            : ('ios' as const),
    };
  }
  async function restore(): Promise<void> {
    const operation = ++operationVersion.current;
    const version = currentSessionVersion.current;
    const isCurrent = (): boolean =>
      mounted.current && operation === operationVersion.current && version === currentSessionVersion.current;
    setStatus('restoring');
    setRestoreError(null);
    try {
      if (browser) {
        if (browser.isSignedOut()) {
          if (isCurrent()) setStatus('idle');
          void browser.signOut().catch(() => {
            if (mounted.current && !currentUser.current)
              setSignOutWarning(
                'Signed out on this device. Server cleanup will be retried when you reconnect.',
              );
          });
          return;
        }
        const response = await browser.restore();
        if (!isCurrent()) return;
        validStaff(response.user);
        await runtimeRef.current.api.setTokens(accessTokens(response));
        if (!isCurrent()) return;
        currentUser.current = response.user;
        setUser(response.user);
        setAppLocked(false);
        setStatus('signed-in');
        return;
      }
      const marker = await SecureStore.getItemAsync(signedOutKey);
      if (!isCurrent()) return;
      if (marker === '1') {
        const active = runtimeRef.current;
        try {
          await active.api.signOut();
        } catch {
          finishSignOut(active.version);
          if (mounted.current)
            setSignOutWarning('Signed out. Your device could not finish clearing its saved session.');
        }
        return;
      }
      const deviceId = await ensureNativeDevice();
      if (!isCurrent()) return;
      const active =
        runtimeRef.current.deviceId === deviceId ? runtimeRef.current : replaceRuntime(deviceId, version);
      if (!(await active.storage.get())) {
        if (isCurrent()) setStatus('idle');
        return;
      }
      const me = await active.api.request('/api/v1/me', { schema: MeResponseSchema });
      if (!isCurrent()) return;
      validStaff(me.user);
      if (me.role !== me.user.role) throw new StaffSessionError('This account cannot sign in to SV Admin.');
      currentUser.current = me.user;
      setUser(me.user);
      setAppLocked(true);
      setStatus('signed-in');
    } catch (error) {
      if (!isCurrent()) return;
      if (
        error instanceof LegacySessionError ||
        error instanceof StaffSessionError ||
        (error instanceof ApiClientError &&
          ((error.status === 401 && error.envelope?.error.code === 'UNAUTHORIZED') ||
            (!browser && error.status === 403 && error.envelope?.error.code === 'FORBIDDEN')))
      ) {
        try {
          if (error instanceof LegacySessionError)
            await queueNativeMarker(() => SecureStore.setItemAsync(signedOutKey, '1', secureOptions));
          await runtimeRef.current.api.signOut();
          if (mounted.current)
            setSignOutWarning(
              error instanceof LegacySessionError
                ? error.message
                : browser && error instanceof ApiClientError && error.status === 401
                  ? null
                  : 'Your saved sign-in is no longer valid. Please sign in again.',
            );
        } catch {
          if (mounted.current)
            setRestoreError(
              'Your saved sign-in could not be cleared safely. Check your device storage and try again.',
            );
        }
      } else {
        setRestoreError(
          'Your saved sign-in could not be restored. Check your connection or device storage, then try again.',
        );
      }
    }
  }
  async function retryRestore(): Promise<void> {
    if (authSubmitting.current) return;
    if (restoreInFlight.current) return restoreInFlight.current;
    const pending = restore();
    restoreInFlight.current = pending;
    try {
      await pending;
    } finally {
      if (restoreInFlight.current === pending) restoreInFlight.current = null;
    }
  }
  useEffect(() => {
    mounted.current = true;
    const version = ++currentSessionVersion.current;
    replaceRuntime(runtimeRef.current.deviceId, version);
    void retryRestore();
    const unsubscribe = browser?.subscribeToSignOut(() => {
      if (ownSignOut.current) return;
      const active = runtimeRef.current;
      operationVersion.current += 1;
      void active.api.signOut().catch(() => {
        finishSignOut(active.version);
      });
    }, browserStorageError);
    function online(): void {
      try {
        if (browser?.isSignedOut()) void browser.signOut().catch(() => undefined);
      } catch {
        browserStorageError();
      }
    }
    const unsubscribeOnline = browser
      ? NetInfo.addEventListener((state) => {
          if (state.isConnected === true) online();
        })
      : null;
    return () => {
      mounted.current = false;
      operationVersion.current += 1;
      restoreInFlight.current = null;
      runtimeRef.current.storage.retire();
      unsubscribe?.();
      unsubscribeOnline?.();
    };
  }, []);

  async function submitAuth(
    operation: (active: SessionRuntime, version: number) => Promise<void>,
  ): Promise<void> {
    if (authSubmitting.current) throw new Error('A sign-in request is already in progress.');
    authSubmitting.current = true;
    const version = ++operationVersion.current;
    setStatus('submitting');
    setSignOutWarning(null);
    setRestoreError(null);
    try {
      let active = runtimeRef.current;
      if (!browser) {
        const id = await ensureNativeDevice();
        if (!mounted.current || operationVersion.current !== version)
          throw new Error('Sign-in was cancelled. Please try again.');
        if (active.deviceId !== id) active = replaceRuntime(id, currentSessionVersion.current);
      }
      await operation(active, version);
    } finally {
      if (mounted.current && operationVersion.current === version) {
        authSubmitting.current = false;
        setStatus((current) => (current === 'submitting' ? 'idle' : current));
      }
    }
  }
  async function completeSignIn(
    response: LoginResponse,
    active: SessionRuntime,
    version: number,
  ): Promise<void> {
    validStaff(response.user);
    if (!isCurrentOperation(version)) throw new Error('Sign-in was cancelled. Please try again.');
    await active.api.setTokens(accessTokens(response));
    if (!isCurrentOperation(version)) throw new Error('Sign-in was cancelled. Please try again.');
    if (!browser)
      await queueNativeMarker(async () => {
        if (isCurrentOperation(version)) await SecureStore.deleteItemAsync(signedOutKey);
      });
    if (!isCurrentOperation(version)) throw new Error('Sign-in was cancelled. Please try again.');
    currentUser.current = response.user;
    setUser(response.user);
    setStatus('signed-in');
    setAppLocked(!browser);
  }
  async function requestCode(email: string): Promise<void> {
    await submitAuth(async (active) => {
      const body = OtpRequestSchema.parse({ app: 'admin', email });
      await active.api.request('/api/v1/auth/otp/request', { auth: false, body, schema: AcceptedSchema });
    });
  }
  async function signInWithCode(email: string, code: string): Promise<void> {
    await submitAuth(async (active, version) => {
      const body = OtpVerifySchema.parse({
        app: 'admin',
        code,
        device: deviceDetails(active.deviceId),
        email,
      });
      const response = browser
        ? await browser.login('/api/v1/auth/otp/verify', body)
        : await active.api.request('/api/v1/auth/otp/verify', {
            auth: false,
            body,
            schema: AuthTokenResponseSchema,
          });
      await completeSignIn(response, active, version);
    });
  }
  async function signInWithPassword(email: string, password: string): Promise<void> {
    await submitAuth(async (active, version) => {
      const body = PasswordLoginRequestSchema.parse({
        app: 'admin',
        device: deviceDetails(active.deviceId),
        email,
        password,
      });
      const response = browser
        ? await browser.login('/api/v1/auth/password/login', body)
        : await active.api.request('/api/v1/auth/password/login', {
            auth: false,
            body,
            schema: AuthTokenResponseSchema,
          });
      await completeSignIn(response, active, version);
    });
  }
  async function signOut(): Promise<void> {
    if (ownSignOut.current) return;
    const active = runtimeRef.current;
    ownSignOut.current = true;
    authSubmitting.current = true;
    const version = ++operationVersion.current;
    setStatus('submitting');
    setAppLocked(false);
    setRestoreError(null);
    const failure: { error: unknown; failed: boolean } = { error: undefined, failed: false };
    function record(error: unknown, message: string): void {
      failure.error = error;
      failure.failed = true;
      if (mounted.current && operationVersion.current === version) setSignOutWarning(message);
    }
    if (!browser) {
      try {
        await queueNativeMarker(() => SecureStore.setItemAsync(signedOutKey, '1', secureOptions));
      } catch (error) {
        record(error, 'Sign-out could not be remembered on this device. Please try signing out again.');
      }
    }
    try {
      if (browser) await browser.signOut();
      else if (await active.storage.get())
        await active.api.request('/api/v1/auth/logout', { method: 'POST', schema: AcceptedSchema });
    } catch (error) {
      record(error, 'Signed out on this device. The server could not confirm session revocation.');
    }
    try {
      await active.api.signOut();
    } catch (error) {
      record(error, 'Signed out of the app. Your device could not finish clearing its saved session.');
    } finally {
      finishSignOut(active.version);
      ownSignOut.current = false;
    }
    if (failure.failed) throw failure.error;
  }
  async function unlock(): Promise<boolean> {
    if (browser || !currentUser.current) return false;
    const version = currentSessionVersion.current;
    const operation = operationVersion.current;
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock SV Admin' });
    if (
      !mounted.current ||
      version !== currentSessionVersion.current ||
      operation !== operationVersion.current ||
      !signedInUser()
    )
      return false;
    setAppLocked(!result.success);
    return result.success;
  }
  const value = useMemo<AuthContextValue>(
    () => ({
      api: runtime.api,
      appLocked,
      user,
      signOutWarning,
      restoreError,
      lockApp: () => {
        if (!browser) setAppLocked(true);
      },
      requestCode,
      signInWithCode,
      signInWithPassword,
      signOut,
      retryRestore,
      status,
      unlock,
    }),
    [runtime.api, appLocked, user, signOutWarning, restoreError, status],
  );
  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
