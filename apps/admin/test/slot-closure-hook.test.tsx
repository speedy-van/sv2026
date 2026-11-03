import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@sv/api-client';
import {
  AdminSlotClosureResponseSchema,
  type AdminScheduleResponse,
  type AdminScheduleSlot,
  type AdminSlotClosureRequest,
  type AdminSlotClosureResponse,
} from '@sv/contracts';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type { z } from 'zod';
import { useSlotClosure } from '../src/data/operations';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({
    api: { request: mockRequest },
    status: mockStatus,
    appLocked: mockLocked,
    user: mockActorId ? { id: mockActorId } : null,
  }),
}));

interface ClosureRequestOptions {
  body: unknown;
  method: 'PUT';
  schema: z.ZodType;
}
const mockRequest = jest.fn<Promise<unknown>, [string, ClosureRequestOptions]>();
let mockStatus: 'idle' | 'signed-in' | 'submitting' = 'signed-in';
let mockLocked = false;
let mockActorId: string | null = 'test-admin';
const input: AdminSlotClosureRequest = {
  date: '2031-10-15',
  slot: 'EVENING',
  closed: true,
  expectedClosureId: null,
  reason: 'Staff training',
};
const openWindow: AdminScheduleSlot = {
  slot: 'EVENING',
  capacity: 5,
  configuredCapacity: 5,
  confirmedUnits: 0,
  heldUnits: 0,
  availableUnits: 5,
  manualClosure: null,
  closeAllowed: true,
  closeBlockedReason: null,
};
const acknowledgement: AdminSlotClosureResponse = {
  date: input.date,
  generatedAt: '2031-10-15T12:01:00.000Z',
  window: {
    ...openWindow,
    capacity: 0,
    availableUnits: 0,
    manualClosure: { id: 'closure-unit', reason: input.reason, createdAt: '2031-10-15T12:01:00.000Z' },
  },
};
const schedule: AdminScheduleResponse = {
  date: input.date,
  generatedAt: '2031-10-15T12:00:00.000Z',
  jobs: [],
  slots: [{ ...openWindow, slot: 'MORNING' }, { ...openWindow, slot: 'AFTERNOON' }, openWindow],
};
let mockResponse: unknown = acknowledgement;
const clients: QueryClient[] = [];

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: 3, retryDelay: 0 },
    },
  });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

function seedCache(client: QueryClient) {
  const scheduleKey = ['admin', 'test-admin', 'schedule', input.date];
  const otherDateKey = ['admin', 'test-admin', 'schedule', '2031-10-16'];
  const bookingsKey = ['admin', 'test-admin', 'bookings'];
  const dashboardKey = ['admin', 'test-admin', 'dashboard', input.date];
  const otherActorKey = ['admin', 'other-admin', 'schedule', input.date];
  const publicKey = ['public', 'calendar'];
  client.setQueryData(scheduleKey, schedule);
  client.setQueryData(otherDateKey, { ...schedule, date: '2031-10-16' });
  client.setQueryData(otherActorKey, schedule);
  for (const key of [bookingsKey, dashboardKey, publicKey])
    client.setQueryData(key, { marker: 'original data' });
  return { scheduleKey, otherDateKey, bookingsKey, dashboardKey, otherActorKey, publicKey };
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value: T): void => {
      if (!resolvePromise) throw new Error('The deferred request is not ready.');
      resolvePromise(value);
    },
    reject: (reason: Error): void => {
      if (!rejectPromise) throw new Error('The deferred request is not ready.');
      rejectPromise(reason);
    },
  };
}

describe('useSlotClosure', () => {
  beforeEach(() => {
    mockStatus = 'signed-in';
    mockLocked = false;
    mockActorId = 'test-admin';
    mockResponse = acknowledgement;
    mockRequest
      .mockReset()
      .mockImplementation((_path, options) =>
        Promise.resolve().then(() => options.schema.parse(mockResponse)),
      );
  });
  afterEach(() => {
    onlineManager.setOnline(true);
    for (const client of clients.splice(0)) client.clear();
    jest.restoreAllMocks();
  });

  it('sends a strict PUT request, trims the reason and returns the validated acknowledgement', async () => {
    const context = setup();
    const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
    await act(async () => {
      expect(await hook.result.current.mutateAsync({ ...input, reason: '  Staff training  ' })).toEqual(
        acknowledgement,
      );
    });
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/capacity/closures', {
      method: 'PUT',
      body: input,
      schema: AdminSlotClosureResponseSchema,
    });
  });

  it('reopens the exact recorded manual closure and accepts the server capacity', async () => {
    mockResponse = { ...acknowledgement, window: openWindow };
    const context = setup();
    const cache = seedCache(context.client);
    const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
    const request = {
      ...input,
      closed: false,
      expectedClosureId: 'closure-unit',
      reason: 'Training finished',
    };
    await act(async () => {
      await hook.result.current.mutateAsync(request);
    });
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/v1/admin/capacity/closures',
      expect.objectContaining({ body: request }),
    );
    expect(context.client.getQueryData<AdminScheduleResponse>(cache.scheduleKey)?.slots[2]).toEqual(
      openWindow,
    );
  });

  it.each([
    { ...input, date: '2031-02-30' },
    { ...input, slot: 'NIGHT' },
    { ...input, reason: '  x  ' },
    { ...input, reason: 'x'.repeat(201) },
    { ...input, expectedClosureId: '' },
    { ...input, extra: true },
    { ...input, closed: 'true' },
  ])('rejects invalid runtime input %# before sending a request', async (invalid) => {
    const context = setup();
    const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
    await act(async () => {
      await expect(hook.result.current.mutateAsync(invalid as AdminSlotClosureRequest)).rejects.toThrow();
    });
    await waitFor(() => {
      expect(hook.result.current.isError).toBe(true);
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['idle', false, 'test-admin'],
    ['submitting', false, 'test-admin'],
    ['signed-in', true, 'test-admin'],
    ['signed-in', false, null],
  ] as const)('blocks changes for status=%s locked=%s actor=%s', async (status, locked, actor) => {
    mockStatus = status;
    mockLocked = locked;
    mockActorId = actor;
    const context = setup();
    const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
    await act(async () => {
      await expect(hook.result.current.mutateAsync(input)).rejects.toThrow('Sign in and unlock');
    });
    await waitFor(() => {
      expect(hook.result.current.isError).toBe(true);
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('replaces only the acknowledged window and refreshes only the acting account after success', async () => {
    const context = setup();
    const cache = seedCache(context.client);
    const otherDate = context.client.getQueryData(cache.otherDateKey);
    const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync(input);
    });
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    const updated = context.client.getQueryData<AdminScheduleResponse>(cache.scheduleKey);
    expect(updated).toEqual({
      ...schedule,
      generatedAt: acknowledgement.generatedAt,
      slots: [schedule.slots[0], schedule.slots[1], acknowledgement.window],
    });
    expect(updated?.jobs).toBe(schedule.jobs);
    expect(updated?.slots[0]).toBe(schedule.slots[0]);
    expect(context.client.getQueryData(cache.otherDateKey)).toBe(otherDate);
    expect(context.client.getQueryData(cache.otherActorKey)).toBe(schedule);
    for (const key of [cache.scheduleKey, cache.otherDateKey, cache.bookingsKey, cache.dashboardKey])
      expect(context.client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(context.client.getQueryState(cache.otherActorKey)?.isInvalidated).toBe(false);
    expect(context.client.getQueryState(cache.publicKey)?.isInvalidated).toBe(false);
  });

  it('does not invent a schedule cache when its previous data has been cleared', async () => {
    const context = setup();
    const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync(input);
    });
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    expect(context.client.getQueryData(['admin', 'test-admin', 'schedule', input.date])).toBeUndefined();
  });

  it.each(['date', 'slot'] as const)(
    'rejects an otherwise valid acknowledgement for a different %s without changing cache',
    async (mismatch) => {
      mockResponse =
        mismatch === 'date'
          ? { ...acknowledgement, date: '2031-10-16' }
          : { ...acknowledgement, window: { ...acknowledgement.window, slot: 'MORNING' } };
      const context = setup();
      const cache = seedCache(context.client);
      const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
      await act(async () => {
        await expect(hook.result.current.mutateAsync(input)).rejects.toThrow('did not match');
      });
      await waitFor(() => {
        expect(hook.result.current.isError).toBe(true);
      });
      expect(context.client.getQueryData(cache.scheduleKey)).toBe(schedule);
      expect(context.client.getQueryState(cache.scheduleKey)?.isInvalidated).toBe(false);
    },
  );

  it.each([
    { ...acknowledgement, unknown: true },
    { ...acknowledgement, window: { ...acknowledgement.window, capacity: -1 } },
  ])('rejects malformed server acknowledgements %# without optimistic success', async (invalid) => {
    mockResponse = invalid;
    const context = setup();
    const cache = seedCache(context.client);
    const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
    await act(async () => {
      await expect(hook.result.current.mutateAsync(input)).rejects.toThrow();
    });
    await waitFor(() => {
      expect(hook.result.current.isError).toBe(true);
    });
    expect(context.client.getQueryData(cache.scheduleKey)).toBe(schedule);
    expect(context.client.getQueryState(cache.scheduleKey)?.isInvalidated).toBe(false);
  });

  it('attempts once while offline instead of leaving the operation paused, and keeps unknown outcomes unchanged', async () => {
    onlineManager.setOnline(false);
    const pending = deferred<unknown>();
    mockRequest.mockReturnValueOnce(pending.promise);
    const context = setup();
    const cache = seedCache(context.client);
    const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
    let mutation: Promise<AdminSlotClosureResponse> | undefined;
    await act(async () => {
      mutation = hook.result.current.mutateAsync(input);
      void mutation.catch(() => undefined);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(hook.result.current.isPending).toBe(true);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
    expect(hook.result.current.isPaused).toBe(false);
    expect(context.client.getQueryData(cache.scheduleKey)).toBe(schedule);
    await act(async () => {
      pending.reject(new Error('The response was lost'));
      await expect(mutation).rejects.toThrow('response was lost');
    });
    await waitFor(() => {
      expect(hook.result.current.isError).toBe(true);
    });
    expect(context.client.getQueryData(cache.scheduleKey)).toBe(schedule);
    expect(context.client.getQueryState(cache.scheduleKey)?.isInvalidated).toBe(false);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps the operation pending until the acknowledged cache refresh finishes', async () => {
    const context = setup();
    const cache = seedCache(context.client);
    const refresh = deferred<undefined>();
    jest.spyOn(context.client, 'invalidateQueries').mockReturnValue(refresh.promise);
    const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
    let mutation: Promise<AdminSlotClosureResponse> | undefined;
    await act(async () => {
      mutation = hook.result.current.mutateAsync(input);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(context.client.getQueryData<AdminScheduleResponse>(cache.scheduleKey)?.slots[2]).toEqual(
        acknowledgement.window,
      );
      expect(hook.result.current.isPending).toBe(true);
    });
    await act(async () => {
      refresh.resolve(undefined);
      await mutation;
    });
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
  });

  it.each(['success', 'conflict'] as const)(
    'keeps a late %s bound to the account that started the mutation',
    async (outcome) => {
      const pending = deferred<unknown>();
      mockRequest.mockReturnValueOnce(pending.promise);
      const context = setup();
      const cache = seedCache(context.client);
      const hook = await renderHook(() => useSlotClosure(), { wrapper: context.wrapper });
      let mutation: Promise<AdminSlotClosureResponse> | undefined;
      await act(async () => {
        mutation = hook.result.current.mutateAsync(input);
        void mutation.catch(() => undefined);
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledTimes(1);
      });
      mockActorId = 'other-admin';
      await hook.rerender({});
      await act(async () => {
        if (outcome === 'success') {
          pending.resolve(acknowledgement);
          await mutation;
        } else {
          pending.reject(new ApiClientError(409, 'This window changed.'));
          await expect(mutation).rejects.toThrow('window changed');
        }
      });
      await waitFor(() => {
        expect(hook.result.current.isPending).toBe(false);
      });
      expect(context.client.getQueryState(cache.scheduleKey)?.isInvalidated).toBe(true);
      expect(context.client.getQueryState(cache.otherActorKey)?.isInvalidated).toBe(false);
      expect(context.client.getQueryData(cache.otherActorKey)).toBe(schedule);
      expect(context.client.getQueryData<AdminScheduleResponse>(cache.scheduleKey)?.slots[2]).toEqual(
        outcome === 'success' ? acknowledgement.window : openWindow,
      );
    },
  );
});
