import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), sdk: vi.fn(), destroy: vi.fn(), capture: vi.fn() }));
vi.mock('undici', () => ({
  Agent: class {
    constructor(options: unknown) {
      mocks.create(options);
    }
    destroy(error?: Error | null): Promise<void> {
      return mocks.destroy(error) as Promise<void>;
    }
  },
}));
vi.mock('expo-server-sdk', () => ({
  Expo: function Expo(options: unknown) {
    mocks.sdk(options);
  },
}));
vi.mock('../src/server/env', () => ({ serverEnv: () => ({ EXPO_ACCESS_TOKEN: 'unit-fake-token' }) }));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture }));

import { EXPO_REQUEST_TIMEOUT_MS, withExpoTransport } from '../src/server/integrations/expo-transport';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.destroy.mockResolvedValue(undefined);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
describe('cancelling Expo SDK transport deadlines', () => {
  it('uses a dedicated public SDK transport and destroys its sockets after success', async () => {
    await expect(withExpoTransport(() => Promise.resolve('ticket-unit'))).resolves.toBe('ticket-unit');
    expect(mocks.create).toHaveBeenCalledWith({ connect: { timeout: EXPO_REQUEST_TIMEOUT_MS } });
    expect(mocks.sdk).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'unit-fake-token', retryMinTimeout: 1000 }),
    );
    expect(mocks.destroy).toHaveBeenCalledExactlyOnceWith(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroys the active transport on timeout, causing the real pending operation to reject instead of leaving a raced request running', async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    mocks.destroy.mockImplementation((error: Error | null) => {
      if (error) rejectRequest?.(error);
      return Promise.resolve();
    });
    const request = withExpoTransport(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const outcome = expect(request).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'The push service did not respond in time.',
    });
    await vi.advanceTimersByTimeAsync(EXPO_REQUEST_TIMEOUT_MS);
    await outcome;
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves an upstream rejection while cancelling timers and cleaning up the dedicated transport', async () => {
    const failure = new Error('Unit upstream failure');
    await expect(withExpoTransport(() => Promise.reject(failure))).rejects.toBe(failure);
    expect(mocks.destroy).toHaveBeenCalledExactlyOnceWith(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports cleanup errors without masking successful delivery and gives concurrent operations separate transports', async () => {
    mocks.destroy.mockRejectedValueOnce(new Error('Unit cleanup failure')).mockResolvedValue(undefined);
    await expect(
      Promise.all([
        withExpoTransport(() => Promise.resolve('one')),
        withExpoTransport(() => Promise.resolve('two')),
      ]),
    ).resolves.toEqual(['one', 'two']);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.capture).toHaveBeenCalledWith(expect.any(Error), {
      tags: { feature: 'expo-transport-cleanup' },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
