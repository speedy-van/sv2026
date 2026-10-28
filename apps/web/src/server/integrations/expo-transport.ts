import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { AppError } from '@sv/contracts';
import { Expo } from 'expo-server-sdk';
import { Agent } from 'undici';
import { serverEnv } from '../env';

export const EXPO_REQUEST_TIMEOUT_MS = 10_000;

// The SDK does not expose an AbortSignal. Its public httpAgent option lets us
// cancel the actual request, including a hanging response body. Each operation
// owns its transport, so timing out one device batch cannot abort another batch.
export async function withExpoTransport<T>(operation: (client: Expo) => Promise<T>): Promise<T> {
  const accessToken = serverEnv().EXPO_ACCESS_TOKEN;
  if (!accessToken) throw new AppError('INTERNAL', 'EXPO_ACCESS_TOKEN is required for live push sending.');
  const agent = new Agent({ connect: { timeout: EXPO_REQUEST_TIMEOUT_MS } });
  const timeoutError = new AppError('UPSTREAM_UNAVAILABLE', 'The push service did not respond in time.');
  const state = { timedOut: false };
  let destroyed: Promise<void> | undefined;
  const destroy = (error?: Error): Promise<void> => {
    destroyed ??= agent.destroy(error ?? null).catch((cause: unknown) => {
      Sentry.captureException(cause, { tags: { feature: 'expo-transport-cleanup' } });
    });
    return destroyed;
  };
  const timer = setTimeout(() => {
    state.timedOut = true;
    void destroy(timeoutError);
  }, EXPO_REQUEST_TIMEOUT_MS);
  try {
    return await operation(new Expo({ accessToken, httpAgent: agent, retryMinTimeout: 1000 }));
  } catch (error) {
    if (state.timedOut) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
    await destroy();
  }
}
