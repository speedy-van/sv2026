import { SpeedyVanApiClient, type ApiTokens, type TokenStorage } from '@sv/api-client';
import { AuthTokenResponseSchema, OtpRequestSchema, OtpVerifySchema } from '@sv/contracts';
import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useMemo, useState } from 'react';
import { z } from 'zod';

interface AuthContextValue {
  api: SpeedyVanApiClient;
  appLocked: boolean;
  lockApp(): void;
  requestCode(email: string): Promise<void>;
  signInWithCode(email: string, code: string): Promise<void>;
  status: 'idle' | 'signed-in' | 'submitting';
  unlock(): Promise<boolean>;
}

const tokenKey = 'sv-driver-tokens';
const AuthContext = createContext<AuthContextValue | null>(null);
const AcceptedSchema = z.object({ ok: z.boolean() }).strict();

class SecureTokenStorage implements TokenStorage {
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(tokenKey);
  }

  async get(): Promise<ApiTokens | null> {
    const raw = await SecureStore.getItemAsync(tokenKey);
    return raw ? JSON.parse(raw) as ApiTokens : null;
  }

  async set(tokens: ApiTokens): Promise<void> {
    await SecureStore.setItemAsync(tokenKey, JSON.stringify(tokens), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    });
  }
}

function apiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  return extra?.apiBaseUrl ?? 'http://127.0.0.1:3000';
}

function deviceId(): string {
  return Constants.sessionId;
}

export function AuthProvider(props: { children: React.ReactNode }): React.ReactElement {
  const [status, setStatus] = useState<AuthContextValue['status']>('idle');
  const [appLocked, setAppLocked] = useState(false);
  const storage = useMemo(() => new SecureTokenStorage(), []);
  const api = useMemo(() => new SpeedyVanApiClient({
    appVersion: 'driver@1.0.0',
    baseUrl: apiBaseUrl(),
    deviceId: deviceId(),
    onSignOut: () => { setStatus('idle'); },
    storage
  }), [storage]);

  async function requestCode(email: string): Promise<void> {
    setStatus('submitting');
    const body = OtpRequestSchema.parse({ app: 'driver', email });
    await api.request('/api/v1/auth/otp/request', { auth: false, body, schema: AcceptedSchema }).catch(() => undefined);
    setStatus('idle');
  }

  async function signInWithCode(email: string, code: string): Promise<void> {
    setStatus('submitting');
    const body = OtpVerifySchema.parse({
      app: 'driver',
      code,
      device: {
        appVersion: '1.0.0',
        deviceId: deviceId(),
        deviceName: Constants.deviceName ?? 'Driver iPhone',
        platform: 'ios'
      },
      email
    });
    const response = await api.request('/api/v1/auth/otp/verify', { auth: false, body, schema: AuthTokenResponseSchema });
    await api.setTokens({
      accessExpiresAt: response.accessExpiresAt,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken
    });
    setStatus('signed-in');
    setAppLocked(true);
  }

  async function unlock(): Promise<boolean> {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Speedy Van Driver' });
    setAppLocked(!result.success);
    return result.success;
  }

  const value = useMemo<AuthContextValue>(() => ({
    api,
    appLocked,
    lockApp: () => { setAppLocked(true); },
    requestCode,
    signInWithCode,
    status,
    unlock
  }), [api, appLocked, status]);

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
