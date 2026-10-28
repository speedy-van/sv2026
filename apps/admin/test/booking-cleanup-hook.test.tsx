import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@sv/api-client';
import { AdminBookingCleanupResponseSchema, type AdminBookingCleanupResponse } from '@sv/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type { z } from 'zod';
import { useBookingCleanup, type BookingCleanupVariables } from '../src/data/operations';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({ api: { request: mockRequest }, status: mockStatus, appLocked: mockLocked, user: { id: 'test-admin' } })
}));

interface CleanupRequest {
  body?: unknown;
  method?: 'DELETE' | 'POST';
  schema: z.ZodType;
}
const mockRequest = jest.fn<Promise<unknown>, [string, CleanupRequest]>();
let mockStatus: 'idle' | 'signed-in' | 'submitting' = 'signed-in';
let mockLocked = false;
const acknowledgement: AdminBookingCleanupResponse = {
  id: 'job/with space?#', deletedAt: '2031-10-15T12:00:00.000Z', version: 8, status: 'CANCELLED'
};
let mockResponse: unknown = acknowledgement;
const variables: BookingCleanupVariables = { id: acknowledgement.id, expectedVersion: 7, operation: 'delete' };
const clients: QueryClient[] = [];

function setup(): { client: QueryClient; wrapper: (props: PropsWithChildren) => React.ReactElement } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: 3, retryDelay: 0 }
    }
  });
  clients.push(client);
  return { client, wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}

function seedCache(client: QueryClient) {
  const currentKeys = [
    ['admin', 'test-admin', 'bookings', { deleted: 'exclude' }],
    ['admin', 'test-admin', 'bookings', { deleted: 'only' }],
    ['admin', 'test-admin', 'booking', acknowledgement.id],
    ['admin', 'test-admin', 'dashboard', '2031-10-15']
  ];
  const otherKey = ['admin', 'other-admin', 'bookings'];
  const publicKey = ['public', 'catalogue'];
  const data = { marker: 'cached before the mutation' };
  for (const key of [...currentKeys, otherKey, publicKey]) client.setQueryData(key, data);
  return { currentKeys, otherKey, publicKey, data };
}

function deferred<T>() {
  let rejectPromise: ((reason: Error) => void) | undefined;
  const promise = new Promise<T>((_resolve, reject) => { rejectPromise = reject; });
  return {
    promise,
    reject: (reason: Error): void => {
      if (!rejectPromise) throw new Error('The deferred request is not ready.');
      rejectPromise(reason);
    }
  };
}

describe('useBookingCleanup', () => {
  beforeEach(() => {
    mockStatus = 'signed-in';
    mockLocked = false;
    mockResponse = acknowledgement;
    mockRequest.mockReset().mockImplementation((...args) => Promise.resolve().then(() => args[1].schema.parse(mockResponse)));
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.clear();
  });

  it('sends DELETE with an encoded booking id, expected version and the shared response validator', async () => {
    const context = setup();
    const hook = await renderHook(() => useBookingCleanup(), { wrapper: context.wrapper });
    await act(async () => { expect(await hook.result.current.mutateAsync(variables)).toEqual(acknowledgement); });
    await waitFor(() => { expect(hook.result.current.isSuccess).toBe(true); });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/bookings/job%2Fwith%20space%3F%23', {
      method: 'DELETE', body: { expectedVersion: 7 }, schema: AdminBookingCleanupResponseSchema
    });
  });

  it('uses POST restore and preserves the acknowledged cancelled status instead of reactivating the checkout', async () => {
    mockResponse = { ...acknowledgement, deletedAt: null };
    const context = setup();
    const hook = await renderHook(() => useBookingCleanup(), { wrapper: context.wrapper });
    await act(async () => {
      expect(await hook.result.current.mutateAsync({ ...variables, operation: 'restore' })).toEqual({ ...acknowledgement, deletedAt: null });
    });
    await waitFor(() => { expect(hook.result.current.isSuccess).toBe(true); });
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/bookings/job%2Fwith%20space%3F%23/restore', {
      method: 'POST', body: { expectedVersion: 7 }, schema: AdminBookingCleanupResponseSchema
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid expected version %s before calling the API', async (expectedVersion) => {
    const context = setup();
    const hook = await renderHook(() => useBookingCleanup(), { wrapper: context.wrapper });
    await act(async () => { await expect(hook.result.current.mutateAsync({ ...variables, expectedVersion })).rejects.toThrow(); });
    await waitFor(() => { expect(hook.result.current.isError).toBe(true); });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['idle', false], ['submitting', false], ['signed-in', true]
  ] as const)('blocks cleanup when status=%s and locked=%s', async (status, locked) => {
    mockStatus = status;
    mockLocked = locked;
    const context = setup();
    const hook = await renderHook(() => useBookingCleanup(), { wrapper: context.wrapper });
    await act(async () => { await expect(hook.result.current.mutateAsync(variables)).rejects.toThrow('Sign in and unlock'); });
    await waitFor(() => { expect(hook.result.current.isError).toBe(true); });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('never retries a failed cleanup even when the application mutation defaults request retries', async () => {
    mockRequest.mockRejectedValue(new Error('Connection lost'));
    const context = setup();
    const hook = await renderHook(() => useBookingCleanup(), { wrapper: context.wrapper });
    await act(async () => { await expect(hook.result.current.mutateAsync(variables)).rejects.toThrow('Connection lost'); });
    await waitFor(() => { expect(hook.result.current.isError).toBe(true); });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it.each(['delete', 'restore'] as const)('invalidates only the acting account after an acknowledged %s', async (operation) => {
    const context = setup();
    const cache = seedCache(context.client);
    mockResponse = { ...acknowledgement, deletedAt: operation === 'restore' ? null : acknowledgement.deletedAt };
    const hook = await renderHook(() => useBookingCleanup(), { wrapper: context.wrapper });
    await act(async () => { await hook.result.current.mutateAsync({ ...variables, operation }); });
    await waitFor(() => { expect(hook.result.current.isSuccess).toBe(true); });
    for (const key of cache.currentKeys) {
      expect(context.client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(context.client.getQueryData(key)).toBe(cache.data);
    }
    expect(context.client.getQueryState(cache.otherKey)?.isInvalidated).toBe(false);
    expect(context.client.getQueryState(cache.publicKey)?.isInvalidated).toBe(false);
  });

  it('refreshes the acting account after a 409 conflict without invalidating another account', async () => {
    mockRequest.mockRejectedValue(new ApiClientError(409, 'This booking changed.'));
    const context = setup();
    const cache = seedCache(context.client);
    const hook = await renderHook(() => useBookingCleanup(), { wrapper: context.wrapper });
    await act(async () => { await expect(hook.result.current.mutateAsync(variables)).rejects.toThrow('This booking changed.'); });
    await waitFor(() => { expect(hook.result.current.isError).toBe(true); });
    for (const key of cache.currentKeys) expect(context.client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(context.client.getQueryState(cache.otherKey)?.isInvalidated).toBe(false);
    expect(context.client.getQueryState(cache.publicKey)?.isInvalidated).toBe(false);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('does not treat an invalid acknowledgement as success or invalidate the cache', async () => {
    mockResponse = { ...acknowledgement, version: -1 };
    const context = setup();
    const cache = seedCache(context.client);
    const hook = await renderHook(() => useBookingCleanup(), { wrapper: context.wrapper });
    await act(async () => { await expect(hook.result.current.mutateAsync(variables)).rejects.toThrow(); });
    await waitFor(() => { expect(hook.result.current.isError).toBe(true); });
    for (const key of cache.currentKeys) {
      expect(context.client.getQueryState(key)?.isInvalidated).toBe(false);
      expect(context.client.getQueryData(key)).toBe(cache.data);
    }
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps cached data unchanged while an outcome is unknown and never claims optimistic success', async () => {
    const pending = deferred<unknown>();
    mockRequest.mockReturnValueOnce(pending.promise);
    const context = setup();
    const cache = seedCache(context.client);
    const onSuccess = jest.fn();
    const hook = await renderHook(() => useBookingCleanup(), { wrapper: context.wrapper });
    let mutation: Promise<AdminBookingCleanupResponse> | undefined;
    await act(async () => {
      mutation = hook.result.current.mutateAsync(variables, { onSuccess });
      void mutation.catch(() => undefined);
      await Promise.resolve();
    });
    await waitFor(() => { expect(hook.result.current.isPending).toBe(true); });
    for (const key of cache.currentKeys) expect(context.client.getQueryData(key)).toBe(cache.data);
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => {
      pending.reject(new Error('The server response was lost'));
      await expect(mutation).rejects.toThrow('response was lost');
    });
    await waitFor(() => { expect(hook.result.current.isError).toBe(true); });
    for (const key of cache.currentKeys) {
      expect(context.client.getQueryData(key)).toBe(cache.data);
      expect(context.client.getQueryState(key)?.isInvalidated).toBe(false);
    }
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
