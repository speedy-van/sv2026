import { act, renderHook, waitFor } from '@testing-library/react-native';
import { type NotificationItem, type NotificationsResponse } from '@sv/contracts';
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import type { PropsWithChildren } from 'react';
import { Platform, type AppStateStatus } from 'react-native';
import type { z } from 'zod';
import { notificationQueryKey, useMarkNotificationsRead, useNotificationInbox, useNotificationsSummary } from '../src/data/notifications';
import { useNotificationBadge } from '../src/notifications/use-notification-badge';

jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { useNetInfo: () => mockNetwork },
}));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({ api: mockApi, status: mockStatus, appLocked: mockLocked, user: mockActor ? { id: mockActor } : null }),
}));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: {
    get currentState() { return mockAppState; },
    addEventListener: (_event: string, listener: (state: AppStateStatus) => void) => {
      mockAppListeners.add(listener);
      return { remove: () => { mockAppListeners.delete(listener); } };
    },
  },
}));

let mockNetwork = { isConnected: true, isInternetReachable: true };
let mockStatus = 'signed-in';
let mockLocked = false;
let mockFocused = true;
let mockActor: string | null = 'admin-one';
let mockAppState: AppStateStatus | null = 'active';
const mockAppListeners = new Set<(state: AppStateStatus) => void>();
const mockRequest = jest.fn<Promise<unknown>, [string, { schema: z.ZodType; method?: string; body?: unknown }]>();
const mockApi = { request: mockRequest };
const clients: QueryClient[] = [];
const notice: NotificationItem = {
  id: 'notification-one', type: 'contact.received', title: 'Website contact received', body: 'A customer has contacted the team.',
  data: { eventType: 'contact.received' }, readAt: null, createdAt: '2031-10-15T12:00:00.000Z',
};
const response = (count = 3): NotificationsResponse => ({ items: [{ ...notice, readAt: count === 0 ? '2031-10-15T12:10:00.000Z' : null }], nextCursor: null, unreadCount: count, badgeCount: count });

function setup() {
  const client = new QueryClient({ defaultOptions: {
    queries: { gcTime: Infinity, retry: false, placeholderData: keepPreviousData },
    mutations: { gcTime: Infinity, retry: false },
  } });
  clients.push(client);
  return { client, wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}

function useObservedNotifications() {
  const summary = useNotificationsSummary();
  const read = useMarkNotificationsRead();
  return { ...summary, read };
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2031-10-15T12:02:00Z') });
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockStatus = 'signed-in'; mockLocked = false; mockFocused = true; mockActor = 'admin-one'; mockAppState = 'active';
  mockAppListeners.clear();
  mockRequest.mockReset().mockImplementation((_path, options) => Promise.resolve(options.schema.parse(response())));
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('uses the server total beyond the first page and refreshes 3 to 2 to 0 only after acknowledged reads', async () => {
  const context = setup();
  let count = 3;
  mockRequest.mockImplementation((_path, options) => {
    if (options.method === 'POST') {
      count = options.body && typeof options.body === 'object' && 'all' in options.body ? 0 : 2;
      return Promise.resolve(options.schema.parse({ ok: true }));
    }
    return Promise.resolve(options.schema.parse(response(count)));
  });
  const hook = await renderHook(useObservedNotifications, { wrapper: context.wrapper });
  await waitFor(() => { expect(hook.result.current.query.data?.unreadCount).toBe(3); });
  expect(hook.result.current.query.data?.items).toHaveLength(1);
  expect(mockRequest.mock.calls.every(([, options]) => options.method !== 'POST')).toBe(true);
  await act(async () => { await hook.result.current.read.mutateAsync({ ids: [notice.id] }); });
  await waitFor(() => { expect(hook.result.current.query.data?.badgeCount).toBe(2); });
  await act(async () => { await hook.result.current.read.mutateAsync({ all: true }); });
  await waitFor(() => { expect(hook.result.current.query.data?.badgeCount).toBe(0); });
  expect(mockRequest.mock.calls.filter(([, options]) => options.method === 'POST').map(([, options]) => options.body)).toEqual([{ ids: [notice.id] }, { all: true }]);
});

it('preserves unread data while a read request is pending and after it fails', async () => {
  const context = setup();
  const hook = await renderHook(useObservedNotifications, { wrapper: context.wrapper });
  await waitFor(() => { expect(hook.result.current.query.data?.unreadCount).toBe(3); });
  let rejectRead: ((error: Error) => void) | undefined;
  mockRequest.mockImplementation((_path, options) => options.method === 'POST'
    ? new Promise((_resolve, reject) => { rejectRead = reject; })
    : Promise.resolve(response()));
  let pending: Promise<unknown> | undefined;
  await act(() => { pending = hook.result.current.read.mutateAsync({ all: true }).catch((error: unknown) => error); });
  expect(hook.result.current.query.data?.unreadCount).toBe(3);
  await act(async () => { rejectRead?.(new Error('Unavailable')); await pending; });
  expect(hook.result.current.query.data?.unreadCount).toBe(3);
  expect(hook.result.current.query.data?.items[0]?.readAt).toBeNull();
  await waitFor(() => { expect(hook.result.current.read.isError).toBe(true); });
});

it('acknowledges booking alerts through the feed endpoint and refreshes both counts only after success', async () => {
  const context = setup();
  let count = 3;
  let rejectBookingRead = true;
  mockRequest.mockImplementation((path, options) => {
    if (options.method === 'POST') {
      if (rejectBookingRead) return Promise.reject(new Error('Booking acknowledgement unavailable'));
      expect(path).toBe('/api/v1/admin/feed/read');
      expect(options.body).toEqual({ bookingId: 'booking-one' });
      count = 2;
      return Promise.resolve(options.schema.parse({ ok: true }));
    }
    return Promise.resolve(options.schema.parse(response(count)));
  });
  const hook = await renderHook(() => ({ ...useObservedNotifications(), inbox: useNotificationInbox().query }), { wrapper: context.wrapper });
  await waitFor(() => {
    expect(hook.result.current.query.data?.badgeCount).toBe(3);
    expect(hook.result.current.inbox.data?.pages[0]?.unreadCount).toBe(3);
  });
  expect(mockRequest.mock.calls.every(([, options]) => options.method !== 'POST')).toBe(true);
  await act(async () => {
    await expect(hook.result.current.read.mutateAsync({ bookingId: 'booking-one' })).rejects.toThrow('Booking acknowledgement unavailable');
  });
  expect(hook.result.current.query.data?.badgeCount).toBe(3);
  expect(hook.result.current.inbox.data?.pages[0]?.unreadCount).toBe(3);
  expect(hook.result.current.inbox.data?.pages[0]?.items[0]?.readAt).toBeNull();
  rejectBookingRead = false;
  await act(async () => { await hook.result.current.read.mutateAsync({ bookingId: 'booking-one' }); });
  await waitFor(() => {
    expect(hook.result.current.query.data?.badgeCount).toBe(2);
    expect(hook.result.current.inbox.data?.pages[0]?.unreadCount).toBe(2);
  });
  expect(mockRequest.mock.calls.filter(([, options]) => options.method === 'POST').map(([path]) => path)).toEqual([
    '/api/v1/admin/feed/read', '/api/v1/admin/feed/read',
  ]);
});

it.each(['locked', 'offline', 'signed-out'] as const)('blocks reads and mutations while %s', async (state) => {
  if (state === 'locked') mockLocked = true;
  if (state === 'offline') mockNetwork.isConnected = false;
  if (state === 'signed-out') { mockStatus = 'idle'; mockActor = null; }
  const context = setup();
  const hook = await renderHook(useObservedNotifications, { wrapper: context.wrapper });
  expect(hook.result.current.enabled).toBe(false);
  await act(async () => { await expect(hook.result.current.read.mutateAsync({ all: true })).rejects.toThrow('Open and unlock'); });
  expect(mockRequest).not.toHaveBeenCalled();
});

it('refreshes immediately on foreground even when its cache is fresh', async () => {
  const context = setup();
  const hook = await renderHook(useNotificationsSummary, { wrapper: context.wrapper });
  await waitFor(() => { expect(hook.result.current.query.data?.unreadCount).toBe(3); });
  await act(() => { mockAppState = 'background'; for (const listener of mockAppListeners) listener('background'); });
  mockRequest.mockResolvedValue(response(2));
  await act(() => { mockAppState = 'active'; for (const listener of mockAppListeners) listener('active'); });
  await waitFor(() => { expect(hook.result.current.query.data?.unreadCount).toBe(2); });
  expect(mockRequest).toHaveBeenCalledTimes(2);
});

it('hides private cached items on lock and never displays another account through placeholderData', async () => {
  const context = setup();
  const hook = await renderHook(useNotificationsSummary, { wrapper: context.wrapper });
  await waitFor(() => { expect(hook.result.current.query.data?.items[0]?.id).toBe(notice.id); });
  mockLocked = true;
  await hook.rerender({});
  expect(hook.result.current.query.data).toBeUndefined();
  mockActor = 'admin-two'; mockLocked = false;
  mockRequest.mockImplementation(() => new Promise(() => undefined));
  await hook.rerender({});
  expect(hook.result.current.query.data).toBeUndefined();
});

it('loads older pages using the server cursor and preserves exact total counts', async () => {
  const context = setup();
  mockRequest.mockImplementation((path, options) => Promise.resolve(options.schema.parse(path.includes('cursor=')
    ? { ...response(70), items: [{ ...notice, id: 'older-contact' }] }
    : { ...response(70), nextCursor: 'notification-one' })));
  const hook = await renderHook(useNotificationInbox, { wrapper: context.wrapper });
  await waitFor(() => { expect(hook.result.current.query.hasNextPage).toBe(true); });
  await act(async () => { await hook.result.current.query.fetchNextPage(); });
  await waitFor(() => { expect(hook.result.current.query.data?.pages).toHaveLength(2); });
  expect(hook.result.current.query.data?.pages[0]?.unreadCount).toBe(70);
  expect(mockRequest.mock.calls[1]?.[0]).toBe('/api/v1/notifications?limit=50&cursor=notification-one');
});

it('restarts at page one and recalculates cursors after a read changes unread-first ordering', async () => {
  const context = setup();
  const items = ['first', 'second', 'third', 'fourth'].map((id) => ({ ...notice, id }));
  let markedRead = false;
  mockRequest.mockImplementation((path, options) => {
    if (options.method === 'POST') {
      markedRead = true;
      return Promise.resolve(options.schema.parse({ ok: true }));
    }
    const firstPage = !path.includes('cursor=');
    const ordered = markedRead ? [items[1], items[2], items[0], items[3]] : items;
    return Promise.resolve(options.schema.parse({
      items: ordered.slice(firstPage ? 0 : 2, firstPage ? 2 : 4).map((item) => ({
        ...item,
        readAt: item?.id === 'fourth' || (markedRead && item?.id === 'first') ? '2031-10-15T12:10:00.000Z' : null,
      })),
      nextCursor: firstPage ? markedRead ? 'third' : 'second' : null,
      unreadCount: markedRead ? 2 : 3,
      badgeCount: markedRead ? 2 : 3,
    }));
  });
  const hook = await renderHook(() => ({ ...useNotificationInbox(), read: useMarkNotificationsRead() }), { wrapper: context.wrapper });
  await waitFor(() => { expect(hook.result.current.query.hasNextPage).toBe(true); });
  await act(async () => { await hook.result.current.query.fetchNextPage(); });
  await waitFor(() => { expect(hook.result.current.query.data?.pages).toHaveLength(2); });
  await act(async () => { await hook.result.current.read.mutateAsync({ ids: ['first'] }); });
  await waitFor(() => {
    expect(hook.result.current.query.data?.pages.flatMap((page) => page.items.map((item) => item.id))).toEqual(['second', 'third', 'first', 'fourth']);
  });
  expect(mockRequest.mock.calls.slice(-2).map(([path]) => path)).toEqual([
    '/api/v1/notifications?limit=50',
    '/api/v1/notifications?limit=50&cursor=third',
  ]);
  expect(hook.result.current.query.data?.pages[0]?.unreadCount).toBe(2);
});

it('integrates confirmed reads with the native badge and waits for a fresh response after foregrounding', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const nativeBadge = jest.mocked(Notifications.setBadgeCountAsync).mockReset().mockResolvedValue(true);
  const context = setup();
  let count = 3;
  let holdRefresh = false;
  let completeRefresh: (() => void) | undefined;
  mockRequest.mockImplementation((_path, options) => {
    if (options.method === 'POST') {
      count = options.body && typeof options.body === 'object' && 'all' in options.body ? 0 : 2;
      return Promise.resolve(options.schema.parse({ ok: true }));
    }
    if (holdRefresh) {
      return new Promise((resolve) => {
        completeRefresh = () => { resolve(options.schema.parse(response(count))); };
      });
    }
    return Promise.resolve(options.schema.parse(response(count)));
  });
  const hook = await renderHook(() => ({ badge: useNotificationBadge(), read: useMarkNotificationsRead() }), { wrapper: context.wrapper });
  await waitFor(() => { expect(nativeBadge).toHaveBeenLastCalledWith(3); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(mockRequest.mock.calls[0]?.[0]).toBe('/api/v1/notifications?limit=50');
  expect(mockRequest.mock.calls[0]?.[1].method).toBeUndefined();
  await act(async () => { await hook.result.current.read.mutateAsync({ ids: [notice.id] }); });
  await waitFor(() => { expect(nativeBadge).toHaveBeenLastCalledWith(2); });
  await act(async () => { await hook.result.current.read.mutateAsync({ all: true }); });
  await waitFor(() => { expect(nativeBadge).toHaveBeenLastCalledWith(0); });
  expect(nativeBadge.mock.calls.map(([badgeCount]) => badgeCount)).toEqual([3, 2, 0]);

  await act(() => { mockAppState = 'background'; for (const listener of mockAppListeners) listener('background'); });
  count = 4; holdRefresh = true;
  const requestsBeforeResume = mockRequest.mock.calls.length;
  await act(() => { mockAppState = 'active'; for (const listener of mockAppListeners) listener('active'); });
  await waitFor(() => { expect(mockRequest).toHaveBeenCalledTimes(requestsBeforeResume + 1); });
  expect(context.client.getQueryData<NotificationsResponse>(notificationQueryKey('admin-one'))?.badgeCount).toBe(0);
  expect(nativeBadge.mock.calls.map(([badgeCount]) => badgeCount)).toEqual([3, 2, 0]);
  await act(async () => {
    // The delayed server response arrives after the cached response timestamp.
    jest.setSystemTime(Date.now() + 1);
    completeRefresh?.();
    await Promise.resolve();
  });
  await waitFor(() => { expect(nativeBadge).toHaveBeenLastCalledWith(4); });
  expect(nativeBadge.mock.calls.map(([badgeCount]) => badgeCount)).toEqual([3, 2, 0, 4]);
  expect(hook.result.current.badge.error).toBeNull();
});
