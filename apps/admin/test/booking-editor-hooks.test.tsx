import { ApiClientError } from '@sv/api-client';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { Platform, type AppStateStatus } from 'react-native';
import type { z } from 'zod';
import { useBookingEditor } from '../src/data/booking-editor';
import {
  editAssignment,
  editBooking,
  editCalendar,
  editCatalogue,
  editContext,
  editMovePreview,
  editSchedulePreview,
} from './booking-editor-fixtures';

jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { useNetInfo: () => mockNetwork },
}));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({
    api: mockApi,
    status: mockStatus,
    appLocked: mockLocked,
    user: mockUser ? { id: mockUser, role: mockRole } : null,
  }),
}));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: {
    get currentState() {
      return mockAppState;
    },
    addEventListener: () => {
      if (mockActivateDuringSubscribe) mockAppState = 'active';
      return { remove: jest.fn() };
    },
  },
}));
let mockAppState: AppStateStatus = 'active';
let mockActivateDuringSubscribe = false;
let mockFocused = true;
let mockNetwork = { isConnected: true, isInternetReachable: true };
let mockStatus = 'signed-in';
let mockLocked = false;
let mockUser: string | null = 'admin-one';
let mockRole = 'ADMIN';
const mockRequest = jest.fn<
  Promise<unknown>,
  [string, { schema: z.ZodType; method?: string; body?: unknown; signal?: AbortSignal }]
>();
const mockApi = { request: mockRequest };
const clients: QueryClient[] = [];

function readResult(path: string): unknown {
  if (path.endsWith('/edit-context')) return editContext;
  if (path.endsWith('/assignment-options')) return editAssignment;
  if (path.endsWith('/calendar')) return editCalendar;
  if (path.endsWith('/catalogue')) return editCatalogue;
  if (path.endsWith('/reprice-preview')) return editMovePreview;
  if (path.endsWith('/reschedule-preview')) return editSchedulePreview;
  if (path.includes('/address/postcode/'))
    return { postcode: 'G1 1AB', town: 'Glasgow', lat: 55.86, lng: -4.25 };
  return editBooking;
}
function mutationResult(body: unknown): { ok: true; id: string; version: number } {
  if (
    !body ||
    typeof body !== 'object' ||
    !('expectedVersion' in body) ||
    typeof body.expectedVersion !== 'number'
  )
    throw new Error('Expected a versioned mutation');
  return { ok: true, id: 'booking-one', version: body.expectedVersion + 1 };
}
function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, placeholderData: keepPreviousData },
      mutations: { retry: false, gcTime: Infinity },
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
beforeEach(() => {
  jest.useFakeTimers();
  mockFocused = true;
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockStatus = 'signed-in';
  mockLocked = false;
  mockUser = 'admin-one';
  mockRole = 'ADMIN';
  mockAppState = 'active';
  mockActivateDuringSubscribe = false;
  mockRequest
    .mockReset()
    .mockImplementation((path, options) => Promise.resolve(options.schema.parse(readResult(path))));
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  jest.useRealTimers();
});

it('loads the editor and sends validated contact changes with the displayed optimistic version', async () => {
  const context = setup();
  const hook = await renderHook(() => useBookingEditor('booking-one', 'details'), {
    wrapper: context.wrapper,
  });
  await waitFor(() => {
    expect(hook.result.current.context.data?.version).toBe(7);
  });
  const invalidate = jest.spyOn(context.client, 'invalidateQueries');
  mockRequest.mockImplementation((path, options) =>
    Promise.resolve(
      options.schema.parse(
        options.method === 'PATCH' ? { ok: true, id: 'booking-one', version: 8 } : readResult(path),
      ),
    ),
  );
  await act(async () => {
    await hook.result.current.save.mutateAsync({
      operation: 'details',
      input: { expectedVersion: 7, contact: { ...editContext.contact, name: 'Updated name' } },
    });
  });
  const request = mockRequest.mock.calls.find(([, options]) => options.method === 'PATCH');
  expect(request?.[0]).toBe('/api/v1/admin/bookings/booking-one');
  expect(request?.[1].body).toEqual({
    expectedVersion: 7,
    contact: { ...editContext.contact, name: 'Updated name' },
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'admin-one'] });
});

it.each(['locked', 'offline', 'signed-out', 'driver-role', 'unfocused', 'background'] as const)(
  'blocks private reads and saves while %s',
  async (state) => {
    if (state === 'locked') mockLocked = true;
    if (state === 'offline') mockNetwork.isConnected = false;
    if (state === 'signed-out') {
      mockUser = null;
      mockStatus = 'idle';
    }
    if (state === 'driver-role') mockRole = 'DRIVER';
    if (state === 'unfocused') mockFocused = false;
    if (state === 'background') mockAppState = 'background';
    const context = setup();
    const hook = await renderHook(() => useBookingEditor('booking-one', 'details'), {
      wrapper: context.wrapper,
    });
    expect(hook.result.current.enabled).toBe(false);
    await act(async () => {
      await expect(
        hook.result.current.save.mutateAsync({
          operation: 'details',
          input: { expectedVersion: 7, notes: 'Change' },
        }),
      ).rejects.toThrow('Open and unlock');
    });
    expect(mockRequest).not.toHaveBeenCalled();
  },
);

it('detects activation between rendering and subscribing to AppState', async () => {
  mockAppState = 'background';
  mockActivateDuringSubscribe = true;
  const context = setup();
  const hook = await renderHook(() => useBookingEditor('booking-one', 'details'), {
    wrapper: context.wrapper,
  });
  await waitFor(() => {
    expect(hook.result.current.context.data?.version).toBe(7);
  });
  expect(hook.result.current.enabled).toBe(true);
});

it('pauses private reads and writes while the web page is hidden', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const page = Object.assign(new EventTarget(), { hidden: true });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: page });
  try {
    const context = setup();
    const hook = await renderHook(() => useBookingEditor('booking-one', 'details'), { wrapper: context.wrapper });
    expect(hook.result.current.enabled).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
    await act(() => { page.hidden = false; page.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => { expect(hook.result.current.context.data?.version).toBe(7); });
    await act(() => { page.hidden = true; page.dispatchEvent(new Event('visibilitychange')); });
    expect(hook.result.current.enabled).toBe(false);
    await act(async () => { await expect(hook.result.current.save.mutateAsync({ operation: 'details', input: { expectedVersion: 7, notes: 'Hidden write' } })).rejects.toThrow('Open and unlock'); });
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
    jest.restoreAllMocks();
  }
});

it('removes private data on lock and prevents another account inheriting previous placeholder data', async () => {
  const context = setup();
  const hook = await renderHook(() => useBookingEditor('booking-one', 'details'), {
    wrapper: context.wrapper,
  });
  await waitFor(() => {
    expect(hook.result.current.context.data?.contact.name).toBe('Test customer');
  });
  mockLocked = true;
  await hook.rerender({});
  expect(hook.result.current.context.data).toBeUndefined();
  mockLocked = false;
  mockUser = 'admin-two';
  mockRequest.mockImplementation(() => new Promise(() => undefined));
  await hook.rerender({});
  expect(hook.result.current.context.data).toBeUndefined();
  expect(hook.result.current.booking.data).toBeUndefined();
});

it('refreshes the affected account after a conflict without overwriting the draft or replaying the write', async () => {
  const context = setup();
  const hook = await renderHook(() => useBookingEditor('booking-one', 'details'), {
    wrapper: context.wrapper,
  });
  await waitFor(() => {
    expect(hook.result.current.context.data?.version).toBe(7);
  });
  const invalidate = jest.spyOn(context.client, 'invalidateQueries');
  mockRequest.mockImplementation((path, options) =>
    options.method === 'PATCH'
      ? Promise.reject(new ApiClientError(409, 'Booking changed'))
      : Promise.resolve(options.schema.parse(readResult(path))),
  );
  await act(async () => {
    await expect(
      hook.result.current.save.mutateAsync({
        operation: 'details',
        input: { expectedVersion: 7, notes: 'My unsaved note' },
      }),
    ).rejects.toThrow('Booking changed');
  });
  expect(mockRequest.mock.calls.filter(([, options]) => options.method === 'PATCH')).toHaveLength(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'admin-one'] });
  expect(hook.result.current.context.data?.notes).toBe('Original internal note');
});

it('uses typed previews and rejects a mismatched booking or version before they can be applied', async () => {
  const context = setup();
  const hook = await renderHook(() => useBookingEditor('booking-one', 'move'), { wrapper: context.wrapper });
  await waitFor(() => {
    expect(hook.result.current.context.data).toBeDefined();
  });
  const changes = editContext.changes;
  if (!changes) throw new Error('Fixture move details are missing');
  await act(async () => {
    await hook.result.current.previewMove.mutateAsync({ expectedVersion: 7, changes });
  });
  await waitFor(() => {
    expect(hook.result.current.previewMove.data?.settlementAmountPence).toBe(8000);
  });
  const request = mockRequest.mock.calls.find(([path]) => path.endsWith('/reprice-preview'));
  expect(request?.[1].body).toEqual({ expectedVersion: 7, changes });
  mockRequest.mockImplementation((path, options) =>
    Promise.resolve(
      options.schema.parse(
        path.endsWith('/reprice-preview') ? { ...editMovePreview, id: 'another-booking' } : readResult(path),
      ),
    ),
  );
  await act(async () => {
    await expect(
      hook.result.current.previewMove.mutateAsync({ expectedVersion: 7, changes }),
    ).rejects.toThrow('older booking');
  });
});

it('routes date changes, assignments and unassignments through their versioned APIs', async () => {
  const context = setup();
  const hook = await renderHook(() => useBookingEditor('booking-one', 'driver'), {
    wrapper: context.wrapper,
  });
  await waitFor(() => {
    expect(hook.result.current.assignment.data?.drivers).toHaveLength(2);
  });
  mockRequest.mockImplementation((path, options) =>
    Promise.resolve(
      options.schema.parse(options.method === 'POST' ? mutationResult(options.body) : readResult(path)),
    ),
  );
  await act(async () => {
    await hook.result.current.save.mutateAsync({
      operation: 'assign',
      input: { expectedVersion: 7, driverId: 'driver-one', vanId: 'van-one', mode: 'DIRECT' },
    });
  });
  await act(async () => {
    await hook.result.current.save.mutateAsync({
      operation: 'unassign',
      input: { expectedVersion: 8, reason: 'Driver unavailable' },
    });
  });
  await act(async () => {
    await hook.result.current.save.mutateAsync({
      operation: 'schedule',
      input: {
        expectedVersion: 9,
        date: '2031-10-16',
        slot: 'MORNING',
        priceMode: 'KEEP_PRICE',
        reason: 'Customer requested',
        expectedTotalPence: 21000,
        expectedSettlementPence: 0,
        settle: 'NONE',
      },
    });
  });
  expect(
    mockRequest.mock.calls.filter(([, options]) => options.method === 'POST').map(([path]) => path),
  ).toEqual([
    '/api/v1/admin/bookings/booking-one/assign',
    '/api/v1/admin/bookings/booking-one/unassign',
    '/api/v1/admin/bookings/booking-one/reschedule',
  ]);
});

it('normalises postcode lookup and rejects a late result after the app is locked', async () => {
  const context = setup();
  const hook = await renderHook(() => useBookingEditor('booking-one', 'move'), { wrapper: context.wrapper });
  await act(async () => {
    await expect(hook.result.current.lookupPostcode('g11ab')).resolves.toMatchObject({ postcode: 'G1 1AB' });
  });
  expect(mockRequest.mock.calls.some(([path]) => path === '/api/v1/address/postcode/G1%201AB')).toBe(true);
  let finish: ((result: unknown) => void) | undefined;
  mockRequest.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending: Promise<unknown> | undefined;
  await act(() => {
    pending = hook.result.current.lookupPostcode('g11ab').catch((error: unknown) => error);
  });
  mockLocked = true;
  await hook.rerender({});
  await act(async () => {
    finish?.({ postcode: 'G1 1AB', town: 'Glasgow', lat: 55.86, lng: -4.25 });
    await pending;
  });
  await expect(pending).resolves.toEqual(
    expect.objectContaining({ message: 'The editing session changed. Verify the address again.' }),
  );
});
