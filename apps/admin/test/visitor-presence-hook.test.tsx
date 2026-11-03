import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AdminVisitorPresenceResponseSchema } from '@sv/contracts';
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type { AppStateStatus } from 'react-native';
import type { z } from 'zod';
import { useVisitorPresence } from '../src/data/visitor-presence';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true, default: { useNetInfo: () => mockNetwork },
}));
jest.mock('../src/state/auth', () => ({ useAuth: () => ({
  api: { request: mockRequest }, status: mockStatus, appLocked: mockLocked,
  user: mockActor ? { id: mockActor } : null,
}) }));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true, default: {
    get currentState() { return mockAppState; },
    addEventListener: (_event: string, listener: (state: AppStateStatus) => void) => {
      mockAppStateListener = listener;
      if (mockStateAtSubscription !== undefined) mockAppState = mockStateAtSubscription;
      return { remove: mockRemoveListener };
    },
  },
}));

let mockNetwork: { isConnected: boolean | null; isInternetReachable: boolean | null };
let mockStatus: 'idle' | 'submitting' | 'signed-in';
let mockLocked: boolean;
let mockActor: string | null;
const mockRequest = jest.fn<Promise<unknown>, [string, { method: 'GET'; schema: z.ZodType }]>();
const response = { activeVisitors: 7, generatedAt: '2031-10-15T12:00:00.000Z', activeWindowSeconds: 90, measurement: 'consenting-browsers' };
const clients: QueryClient[] = [];
let mockAppState: AppStateStatus = 'active';
let mockStateAtSubscription: AppStateStatus | undefined;
let mockAppStateListener: ((state: AppStateStatus) => void) | undefined;
const mockRemoveListener = jest.fn();

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: 3, retryDelay: 0, placeholderData: keepPreviousData } } });
  clients.push(client);
  return { client, wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
function changeState(state: AppStateStatus): void {
  if (!mockAppStateListener) throw new Error('The presence hook did not subscribe to app state.');
  mockAppStateListener(state);
}
function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve(value: T): void {
    if (!resolvePromise) throw new Error('The deferred request is not ready.');
    resolvePromise(value);
  } };
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2031-10-15T12:00:00Z') });
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockStatus = 'signed-in'; mockLocked = false; mockActor = 'test-admin';
  mockAppState = 'active'; mockAppStateListener = undefined; mockRemoveListener.mockClear();
  mockStateAtSubscription = undefined;
  mockRequest.mockReset().mockImplementation((_path, options) => Promise.resolve(options.schema.parse(response)));
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  jest.restoreAllMocks(); jest.useRealTimers();
});

describe('foreground authenticated visitor presence', () => {
  it('loads real presence with the shared validator and the actor-specific cache key', async () => {
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await waitFor(() => { expect(hook.result.current.query.isSuccess).toBe(true); });
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/admin/visitors/presence', { method: 'GET', schema: AdminVisitorPresenceResponseSchema });
    expect(context.client.getQueryData(['admin', 'test-admin', 'visitors', 'presence'])).toEqual(response);
    expect(hook.result.current).toMatchObject({ authorized: true, foreground: true, offline: false, outdated: false });
  });

  it('starts reading visitors when native launch state is unknown without waiting for a state event', async () => {
    mockAppState = 'unknown';
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await waitFor(() => { expect(hook.result.current.query.isSuccess).toBe(true); });
    expect(hook.result.current.foreground).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('rechecks native state after subscribing when it became active before the listener was registered', async () => {
    mockAppState = 'background';
    mockStateAtSubscription = 'active';
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await waitFor(() => { expect(hook.result.current.query.isSuccess).toBe(true); });
    expect(hook.result.current.foreground).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('refreshes a cached zero immediately after a short background visit instead of waiting for staleness', async () => {
    mockRequest.mockImplementation((_path, options) => Promise.resolve(options.schema.parse({ ...response, activeVisitors: 0 })));
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await waitFor(() => { expect(hook.result.current.query.data?.activeVisitors).toBe(0); });
    await act(() => { changeState('background'); });
    const calls = mockRequest.mock.calls.length;
    await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    expect(mockRequest).toHaveBeenCalledTimes(calls);
    mockRequest.mockImplementation((_path, options) => Promise.resolve(options.schema.parse(response)));
    await act(() => { changeState('active'); });
    await waitFor(() => { expect(hook.result.current.query.data?.activeVisitors).toBe(7); });
    expect(mockRequest).toHaveBeenCalledTimes(calls + 1);
  });

  it.each([
    ['idle', false, 'test-admin'], ['submitting', false, 'test-admin'],
    ['signed-in', true, 'test-admin'], ['signed-in', false, null],
  ] as const)('does not fetch while status=%s locked=%s actor=%s', async (status, locked, actor) => {
    mockStatus = status; mockLocked = locked; mockActor = actor;
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await act(async () => { await jest.advanceTimersByTimeAsync(45_000); });
    expect(hook.result.current.authorized).toBe(false);
    expect(hook.result.current.query.data).toBeUndefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each(['disconnected', 'unreachable', 'background'] as const)('pauses initial polling when %s', async (condition) => {
    if (condition === 'disconnected') mockNetwork.isConnected = false;
    if (condition === 'unreachable') mockNetwork.isInternetReachable = false;
    if (condition === 'background') mockAppState = 'background';
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await act(async () => { await jest.advanceTimersByTimeAsync(45_000); });
    expect(hook.result.current.query.data).toBeUndefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('polls every 15 seconds only while foreground and resumes after returning to the app', async () => {
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await waitFor(() => { expect(hook.result.current.query.isSuccess).toBe(true); });
    const initialCalls = mockRequest.mock.calls.length;
    await act(async () => { await jest.advanceTimersByTimeAsync(14_000); });
    expect(mockRequest).toHaveBeenCalledTimes(initialCalls);
    await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
    expect(mockRequest).toHaveBeenCalledTimes(initialCalls + 1);
    await act(() => { changeState('background'); });
    const backgroundCalls = mockRequest.mock.calls.length;
    await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
    expect(mockRequest).toHaveBeenCalledTimes(backgroundCalls);
    expect(hook.result.current.outdated).toBe(true);
    await act(() => { changeState('active'); });
    await waitFor(() => { expect(mockRequest.mock.calls.length).toBeGreaterThan(backgroundCalls); });
    await waitFor(() => { expect(hook.result.current.outdated).toBe(false); });
  });

  it('keeps a genuine last count explicitly outdated while offline and stops polling', async () => {
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await waitFor(() => { expect(hook.result.current.query.isSuccess).toBe(true); });
    mockNetwork = { isConnected: false, isInternetReachable: false };
    await hook.rerender({});
    const calls = mockRequest.mock.calls.length;
    await act(async () => { await jest.advanceTimersByTimeAsync(45_000); });
    expect(mockRequest).toHaveBeenCalledTimes(calls);
    expect(hook.result.current.query.data).toEqual(response);
    expect(hook.result.current).toMatchObject({ offline: true, outdated: true });
  });

  it('reports an unavailable error without automatic request retries or a fabricated zero', async () => {
    mockRequest.mockRejectedValue(new Error('Connection failed'));
    const context = setup();
    const hook = await renderHook(() => {
      const presence = useVisitorPresence();
      return { ...presence, isError: presence.query.isError };
    }, { wrapper: context.wrapper });
    await waitFor(() => { expect(hook.result.current.isError).toBe(true); });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(hook.result.current.query.data).toBeUndefined();
  });

  it('rejects an invalid upstream count instead of treating it as data', async () => {
    mockRequest.mockImplementation((_path, options) => Promise.resolve().then(() => options.schema.parse({ ...response, activeVisitors: -1 })));
    const context = setup();
    const hook = await renderHook(() => {
      const presence = useVisitorPresence();
      return { ...presence, isError: presence.query.isError };
    }, { wrapper: context.wrapper });
    await waitFor(() => { expect(hook.result.current.isError).toBe(true); });
    expect(hook.result.current.query.data).toBeUndefined();
  });

  it('never uses previous-actor placeholder data and ignores that account’s late response in the current view', async () => {
    const late = deferred<unknown>();
    const current = deferred<unknown>();
    mockRequest.mockReturnValueOnce(late.promise).mockReturnValueOnce(current.promise);
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await waitFor(() => { expect(mockRequest).toHaveBeenCalledTimes(1); });
    mockActor = 'other-admin';
    await hook.rerender({});
    await waitFor(() => { expect(mockRequest).toHaveBeenCalledTimes(2); });
    expect(hook.result.current.query.data).toBeUndefined();
    await act(async () => { late.resolve(response); await Promise.resolve(); });
    expect(hook.result.current.query.data).toBeUndefined();
    await act(() => { current.resolve({ ...response, activeVisitors: 3 }); });
    await waitFor(() => { expect(hook.result.current.query.data?.activeVisitors).toBe(3); });
    expect(hook.result.current.actorId).toBe('other-admin');
  });

  it('does not carry a loaded previous-actor count into an account with no response yet', async () => {
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await waitFor(() => { expect(hook.result.current.query.data?.activeVisitors).toBe(7); });
    mockActor = 'other-admin';
    const pending = deferred<unknown>();
    mockRequest.mockReturnValueOnce(pending.promise);
    await hook.rerender({});
    await waitFor(() => { expect(mockRequest).toHaveBeenCalledTimes(2); });
    expect(hook.result.current.query.data).toBeUndefined();
    await act(() => { pending.resolve({ ...response, activeVisitors: 2 }); });
    await waitFor(() => { expect(hook.result.current.query.data?.activeVisitors).toBe(2); });
  });

  it('removes its app-state listener on unmount', async () => {
    const context = setup();
    const hook = await renderHook(useVisitorPresence, { wrapper: context.wrapper });
    await waitFor(() => { expect(hook.result.current.query.isSuccess).toBe(true); });
    await hook.unmount();
    expect(mockRemoveListener).toHaveBeenCalledTimes(1);
  });
});
