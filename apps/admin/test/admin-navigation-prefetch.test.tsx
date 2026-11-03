import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import { MemoryTokenStorage, SpeedyVanApiClient } from '@sv/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { AdminNavigationPrefetch } from '../src/data/admin-navigation-prefetch';
import { adminToday, useBookings, useDashboard, useDrivers, useSchedule } from '../src/data/operations';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('../src/state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => mockNetwork }));

const idleCallbacks = new Map<number, () => void>();
const idleTestRuntime = globalThis as {
  requestIdleCallback?: (callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};
let idleId = 0;
const mockRequest = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
const api = new SpeedyVanApiClient({
  appVersion: 'admin@1.0.0', baseUrl: 'https://api.example.test', deviceId: 'test-device',
  storage: new MemoryTokenStorage(), fetch: mockRequest,
});
const mockAuth = {
  api, appLocked: false, status: 'signed-in',
  user: { id: 'test-admin', name: 'Unit admin', role: 'ADMIN', status: 'ACTIVE', email: 'admin@example.test' },
};
const mockNetwork = { isConnected: true, isInternetReachable: true };
let queries: QueryClient;

function Wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return <QueryClientProvider client={queries}>{children}</QueryClientProvider>;
}

async function flushIdle(): Promise<void> {
  const next = idleCallbacks.entries().next().value as [number, () => void] | undefined;
  if (!next) throw new Error('No navigation prefetch is scheduled.');
  idleCallbacks.delete(next[0]);
  await act(() => { next[1](); });
}

function inputUrl(input: Parameters<typeof fetch>[0] | undefined): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function responseFor(path: string): unknown {
  if (path.includes('/dashboard')) return {
    date: adminToday(), generatedAt: new Date().toISOString(), jobs: [],
    counts: { scheduled: 0, needsDriver: 0, inProgress: 0, completed: 0, pendingPayment: 0 },
    bookedValuePence: 0, paidPence: 0,
  };
  if (path.includes('/schedule')) return {
    date: adminToday(), generatedAt: new Date().toISOString(), jobs: [],
    slots: ['MORNING', 'AFTERNOON', 'EVENING'].map((slot) => ({
      slot, configuredCapacity: 1, capacity: 1, confirmedUnits: 0, heldUnits: 0,
      availableUnits: 1, manualClosure: null, closeAllowed: true, closeBlockedReason: null,
    })),
  };
  return { items: [], nextCursor: null };
}

beforeEach(() => {
  queries = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  idleCallbacks.clear();
  idleId = 0;
  idleTestRuntime.requestIdleCallback = jest.fn((callback) => {
    const handle = ++idleId;
    idleCallbacks.set(handle, () => { callback({ didTimeout: false, timeRemaining: () => 50 }); });
    return handle;
  });
  idleTestRuntime.cancelIdleCallback = jest.fn((handle) => { idleCallbacks.delete(handle); });
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  mockAuth.status = 'signed-in';
  mockAuth.appLocked = false;
  mockAuth.user.id = 'test-admin';
  mockNetwork.isConnected = true;
  mockNetwork.isInternetReachable = true;
  mockRequest.mockReset();
  mockRequest.mockImplementation((input) => Promise.resolve(new Response(JSON.stringify(responseFor(inputUrl(input))), { status: 200 })));
});

afterEach(() => { queries.clear(); });

it('prioritizes Today, warms one page per destination while idle, and shares the exact screen caches', async () => {
  const view = await render(<AdminNavigationPrefetch />, { wrapper: Wrapper });
  await waitFor(() => { expect(idleCallbacks.size).toBe(1); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(inputUrl(mockRequest.mock.calls[0]?.[0])).toContain('/dashboard?date=');
  for (let index = 0; index < 3; index += 1) {
    await flushIdle();
    await waitFor(() => { expect(mockRequest).toHaveBeenCalledTimes(index + 2); });
  }
  expect(idleCallbacks.size).toBe(0);
  const today = adminToday();
  const hooks = await renderHook(() => ({
    today: useDashboard(today), bookings: useBookings({ deleted: 'exclude' }),
    schedule: useSchedule(today), drivers: useDrivers({ date: today }),
  }), { wrapper: Wrapper });
  expect(hooks.result.current.today.isSuccess).toBe(true);
  expect(hooks.result.current.bookings.isSuccess).toBe(true);
  expect(hooks.result.current.schedule.isSuccess).toBe(true);
  expect(hooks.result.current.drivers.isSuccess).toBe(true);
  expect(mockRequest).toHaveBeenCalledTimes(4);
  await hooks.unmount();
  await view.unmount();
});

it.each(['signed-out', 'locked', 'offline', 'background'] as const)('does not prefetch while %s', async (reason) => {
  if (reason === 'signed-out') mockAuth.status = 'idle';
  if (reason === 'locked') mockAuth.appLocked = true;
  if (reason === 'offline') mockNetwork.isConnected = false;
  if (reason === 'background') AppState.currentState = 'background';
  const view = await render(<AdminNavigationPrefetch />, { wrapper: Wrapper });
  expect(mockRequest).not.toHaveBeenCalled();
  expect(idleCallbacks.size).toBe(0);
  await view.unmount();
});

it.each([null, 'unknown'] as const)('warms the first destination when native startup AppState is %s', async (state) => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, writable: true, value: state });
  const view = await render(<AdminNavigationPrefetch />, { wrapper: Wrapper });
  await waitFor(() => { expect(mockRequest).toHaveBeenCalledTimes(1); });
  expect(inputUrl(mockRequest.mock.calls[0]?.[0])).toContain('/dashboard?date=');
  await view.unmount();
});

it('rechecks native state after attaching its listener so a foreground transition cannot be missed', async () => {
  AppState.currentState = 'background';
  jest.spyOn(AppState, 'addEventListener').mockImplementationOnce(() => {
    AppState.currentState = 'active';
    return { remove: jest.fn() };
  });
  const view = await render(<AdminNavigationPrefetch />, { wrapper: Wrapper });
  await waitFor(() => { expect(mockRequest).toHaveBeenCalledTimes(1); });
  await view.unmount();
});

it('deduplicates the in-flight dashboard request instead of racing the visible screen', async () => {
  let finish: ((response: Response) => void) | undefined;
  mockRequest.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = await render(<AdminNavigationPrefetch />, { wrapper: Wrapper });
  const hook = await renderHook(() => useDashboard(adminToday()), { wrapper: Wrapper });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  await act(() => { finish?.(new Response(JSON.stringify(responseFor('/dashboard')), { status: 200 })); });
  await waitFor(() => { expect(hook.result.current.isSuccess).toBe(true); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  await hook.unmount();
  await view.unmount();
});

it.each(['locked', 'signed-out'] as const)('aborts transport and prevents private cache writes or queued work after %s', async (reason) => {
  let finish: ((response: Response) => void) | undefined;
  mockRequest.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = await render(<AdminNavigationPrefetch />, { wrapper: Wrapper });
  await waitFor(() => { expect(mockRequest).toHaveBeenCalledTimes(1); });
  const signal = mockRequest.mock.calls[0]?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  if (reason === 'locked') mockAuth.appLocked = true;
  else mockAuth.status = 'idle';
  await view.rerender(<AdminNavigationPrefetch />);
  expect(signal?.aborted).toBe(true);
  await act(() => { finish?.(new Response(JSON.stringify(responseFor('/dashboard')), { status: 200 })); });
  expect(queries.getQueryData(['admin', 'test-admin', 'dashboard', adminToday()])).toBeUndefined();
  expect(idleCallbacks.size).toBe(0);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  await view.unmount();
});

it('keeps account caches separate when the signed-in admin changes', async () => {
  const view = await render(<AdminNavigationPrefetch />, { wrapper: Wrapper });
  await waitFor(() => { expect(idleCallbacks.size).toBe(1); });
  mockAuth.user.id = 'second-admin';
  await view.rerender(<AdminNavigationPrefetch />);
  await waitFor(() => { expect(mockRequest).toHaveBeenCalledTimes(2); });
  expect(queries.getQueryData(['admin', 'test-admin', 'dashboard', adminToday()])).toBeDefined();
  expect(queries.getQueryData(['admin', 'second-admin', 'dashboard', adminToday()])).toBeDefined();
  await view.unmount();
});
