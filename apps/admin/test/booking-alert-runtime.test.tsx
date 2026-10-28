import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { Platform, type AppStateStatus } from 'react-native';
import type { z } from 'zod';
import { foregroundNotificationBehavior, useBookingAlerts } from '../src/notifications/use-booking-alerts';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { useNetInfo: () => mockNetwork },
}));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({
    api: mockApi,
    status: mockStatus,
    appLocked: mockLocked,
    user: { id: mockUserId },
  }),
}));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: {
    get currentState() {
      return mockAppState;
    },
    addEventListener: (_event: string, listener: (state: AppStateStatus) => void) => {
      mockAppListeners.add(listener);
      if (mockStateOnSubscribe) mockAppState = mockStateOnSubscribe;
      return {
        remove: () => {
          mockAppListeners.delete(listener);
        },
      };
    },
  },
}));

const mockRequest = jest.fn<
  Promise<unknown>,
  [string, { body?: unknown; schema: z.ZodType; method?: string }]
>();
let mockApi = { request: mockRequest };
let mockStatus: 'signed-in' | 'idle' | 'restoring' = 'signed-in';
let mockLocked = false;
let mockUserId = 'admin-one';
let mockAppState: AppStateStatus | null = 'active';
let mockStateOnSubscribe: AppStateStatus | undefined;
let mockNetwork = { isConnected: true, isInternetReachable: true };
const mockAppListeners = new Set<(state: AppStateStatus) => void>();
const clients: QueryClient[] = [];
const data = {
  bookingId: 'booking-one',
  deliveryKey: 'event-one:notification:admin-one',
  eventType: 'booking.confirmed',
  type: 'NEW_BOOKING',
  reference: 'SV-ONE',
  pricePence: 21000,
  route: 'Paisley to Edinburgh',
  service: 'man_and_van',
  slot: 'MORNING',
  moveDate: '2031-10-16',
} as const;
const item = {
  id: 'row-one',
  createdAt: '2031-10-15T12:00:00.000Z',
  title: 'New booking',
  body: 'Move tomorrow',
  data,
};
const empty = { items: [], nextCursor: null, generatedAt: '2031-10-15T12:00:00.000Z' };

function wrapper({ children }: PropsWithChildren): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function notification(payload: Record<string, unknown> = data): Notifications.Notification {
  return {
    date: Date.now(),
    request: {
      identifier: 'apns-delivery',
      trigger: { type: 'push' },
      content: {
        title: 'New booking',
        subtitle: null,
        body: null,
        categoryIdentifier: 'NEW_BOOKING',
        sound: null,
        data: payload,
      },
    },
  };
}
function push(): (value: Notifications.Notification) => void {
  const listener = jest.mocked(Notifications.addNotificationReceivedListener).mock.calls.at(-1)?.[0];
  if (!listener) throw new Error('Expected a foreground notification listener.');
  return listener;
}
function response(action = Notifications.DEFAULT_ACTION_IDENTIFIER): Notifications.NotificationResponse {
  return { actionIdentifier: action, notification: notification() };
}
function responseListener(): (value: Notifications.NotificationResponse) => void {
  const listener = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls.at(-1)?.[0];
  if (!listener) throw new Error('Expected notification tap handling.');
  return listener;
}
function state(value: AppStateStatus): void {
  mockAppState = value;
  for (const listener of mockAppListeners) listener(value);
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  mockStatus = 'signed-in';
  mockLocked = false;
  mockUserId = 'admin-one';
  mockAppState = 'active';
  mockStateOnSubscribe = undefined;
  mockAppListeners.clear();
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockApi = { request: mockRequest };
  mockRequest
    .mockReset()
    .mockImplementation((_path, options) => Promise.resolve(options.schema.parse(empty)));
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(null);
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each([null, 'unknown'] as const)(
  'starts the authenticated booking feed when native launch state is %s and stops it in the background',
  async (initialState) => {
    mockAppState = initialState;
    mockRequest.mockImplementation((_path, options) =>
      Promise.resolve(options.schema.parse({ ...empty, items: [item] })),
    );
    const hook = await renderHook(useBookingAlerts, { wrapper });
    await waitFor(() => {
      expect(hook.result.current.alerts).toHaveLength(1);
    });
    expect(Notifications.addNotificationReceivedListener).toHaveBeenCalledTimes(1);
    await act(() => {
      state('background');
    });
    expect(hook.result.current.alerts).toEqual([]);
    const calls = mockRequest.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(mockRequest).toHaveBeenCalledTimes(calls);
    expect(foregroundNotificationBehavior(data, 'background-delivery')).toMatchObject({
      shouldPlaySound: true,
      shouldShowBanner: true,
    });
  },
);

it('rechecks native launch state after subscribing so a missed activation does not strand booking alerts', async () => {
  mockAppState = 'inactive';
  mockStateOnSubscribe = 'active';
  const hook = await renderHook(useBookingAlerts, { wrapper });
  await waitFor(() => {
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
  expect(hook.result.current.error).toBeNull();
  expect(Notifications.addNotificationReceivedListener).toHaveBeenCalledTimes(1);
});

it('never uses unknown startup state to bypass the private app-lock gate', async () => {
  mockAppState = null;
  mockLocked = true;
  const hook = await renderHook(useBookingAlerts, { wrapper });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000);
  });
  expect(mockRequest).not.toHaveBeenCalled();
  expect(Notifications.addNotificationReceivedListener).not.toHaveBeenCalled();
  expect(hook.result.current.alerts).toEqual([]);
  expect(foregroundNotificationBehavior(data, 'locked-delivery')).toMatchObject({
    shouldPlaySound: true,
    shouldShowBanner: true,
  });
});

it('finds a missed paid booking through the feed and dedupes push, polling and repeat deliveries', async () => {
  mockRequest.mockImplementation((_path, options) =>
    Promise.resolve(options.schema.parse({ ...empty, items: [item] })),
  );
  const hook = await renderHook(useBookingAlerts, { wrapper });
  await waitFor(() => {
    expect(hook.result.current.alerts).toHaveLength(1);
  });
  expect(hook.result.current.alerts[0]).toMatchObject({
    bookingId: 'booking-one',
    notificationId: data.deliveryKey,
  });
  await act(() => {
    push()(notification());
  });
  expect(hook.result.current.alerts).toHaveLength(1);
  await act(() => {
    hook.result.current.dismiss(data.deliveryKey);
  });
  expect(hook.result.current.alerts).toEqual([]);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(20_000);
  });
  await act(() => {
    push()(notification());
  });
  expect(hook.result.current.alerts).toEqual([]);
  expect(mockRequest).toHaveBeenCalledTimes(2);
});

it('drains feed pages so older unread rows do not hide new bookings beyond the first page', async () => {
  mockRequest.mockImplementation((path, options) =>
    Promise.resolve(
      options.schema.parse({
        ...empty,
        nextCursor: path.includes('cursor=') ? null : 'next-page',
        items: [
          path.includes('cursor=')
            ? {
                ...item,
                id: 'row-two',
                data: { ...data, bookingId: 'booking-two', deliveryKey: 'event-two' },
              }
            : item,
        ],
      }),
    ),
  );
  const hook = await renderHook(useBookingAlerts, { wrapper });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
  await waitFor(() => {
    expect(hook.result.current.alerts).toHaveLength(2);
  });
  expect(mockRequest.mock.calls[1]?.[0]).toContain('cursor=next-page');
});

it.each(['locked', 'signed out', 'restoring', 'background', 'offline'] as const)(
  'does not poll private booking alerts while %s',
  async (condition) => {
    if (condition === 'locked') mockLocked = true;
    if (condition === 'signed out') mockStatus = 'idle';
    if (condition === 'restoring') mockStatus = 'restoring';
    if (condition === 'background') mockAppState = 'background';
    if (condition === 'offline') mockNetwork = { isConnected: false, isInternetReachable: false };
    const hook = await renderHook(useBookingAlerts, { wrapper });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(hook.result.current.alerts).toEqual([]);
  },
);

it('resumes polling on foreground and shows a retryable failure without replacing operational screens', async () => {
  mockAppState = 'background';
  mockRequest.mockRejectedValueOnce(new Error('Offline'));
  const hook = await renderHook(useBookingAlerts, { wrapper });
  await act(() => {
    state('active');
  });
  await waitFor(() => {
    expect(hook.result.current.error).toContain('could not be refreshed');
  });
  await act(() => {
    hook.result.current.retry();
  });
  await waitFor(() => {
    expect(hook.result.current.error).toBeNull();
  });
  expect(mockRequest).toHaveBeenCalledTimes(2);
});

it('keeps native banners and sound for other events and while locked, avoiding duplicate sound for an unlocked modal', async () => {
  const hook = await renderHook(useBookingAlerts, { wrapper });
  expect(foregroundNotificationBehavior(data, 'delivery')).toMatchObject({
    shouldPlaySound: false,
    shouldShowBanner: false,
  });
  expect(foregroundNotificationBehavior({ type: 'DISPUTE' }, 'delivery')).toMatchObject({
    shouldPlaySound: true,
    shouldShowBanner: true,
  });
  expect(
    foregroundNotificationBehavior({ type: 'NEW_BOOKING', eventType: 'admin.test_push' }, 'delivery'),
  ).toMatchObject({ shouldPlaySound: true, shouldShowBanner: true });
  mockLocked = true;
  await hook.rerender(undefined);
  expect(foregroundNotificationBehavior(data, 'delivery')).toMatchObject({
    shouldPlaySound: true,
    shouldShowBanner: true,
  });
});

it('waits for sign-in and Face ID before a cold-start tap opens and acknowledges a booking exactly once', async () => {
  mockStatus = 'restoring';
  mockLocked = true;
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response());
  mockRequest.mockImplementation((path, options) =>
    Promise.resolve(options.schema.parse(path.endsWith('/read') ? { ok: true } : empty)),
  );
  const hook = await renderHook(useBookingAlerts, { wrapper });
  expect(router.push).not.toHaveBeenCalled();
  mockStatus = 'signed-in';
  await hook.rerender(undefined);
  expect(router.push).not.toHaveBeenCalled();
  mockLocked = false;
  await hook.rerender(undefined);
  await waitFor(() => {
    expect(router.push).toHaveBeenCalledWith('/(app)/bookings/booking-one');
  });
  await act(() => {
    responseListener()(response());
  });
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(mockRequest.mock.calls.filter(([path]) => path.endsWith('/read'))).toHaveLength(1);
  expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
});

it('does not open a booking for the notification Dismiss action', async () => {
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response('DISMISS'));
  await renderHook(useBookingAlerts, { wrapper });
  expect(router.push).not.toHaveBeenCalled();
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/read'))).toBe(false);
});

it('waits for authentication and unlock before opening the conversation from a cold chat push', async () => {
  mockStatus = 'restoring';
  mockLocked = true;
  const tap = {
    actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: notification({
      type: 'CHAT_MESSAGE', conversationId: 'chat-one', messageId: 'message-one', recipientUserId: 'admin-one',
    }),
  };
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(tap);
  const hook = await renderHook(useBookingAlerts, { wrapper });
  expect(router.push).not.toHaveBeenCalled();
  mockStatus = 'signed-in';
  await hook.rerender(undefined);
  expect(router.push).not.toHaveBeenCalled();
  mockLocked = false;
  await hook.rerender(undefined);
  await waitFor(() => {
    expect(router.push).toHaveBeenCalledWith('/(app)/chat/chat-one');
  });
  await act(() => { responseListener()(tap); });
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/read'))).toBe(false);
});

it('refreshes chat queries for foreground pushes and ignores taps for another account', async () => {
  await renderHook(useBookingAlerts, { wrapper });
  const queryClient = clients.at(-1);
  if (!queryClient) throw new Error('Expected a query client.');
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  const incoming = notification({
    type: 'CHAT_MESSAGE', conversationId: 'chat-one', messageId: 'message-one', recipientUserId: 'admin-one',
  });
  await act(() => { push()(incoming); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'admin-one'] });
  await act(() => {
    responseListener()({
      actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
      notification: notification({ type: 'CHAT_MESSAGE', conversationId: 'chat-private', recipientUserId: 'admin-two' }),
    });
  });
  expect(router.push).not.toHaveBeenCalled();
});

it('shows failed read acknowledgement until it succeeds, despite successful feed refreshes', async () => {
  let readable = false;
  mockRequest.mockImplementation((path, options) =>
    path.endsWith('/read')
      ? readable
        ? Promise.resolve(options.schema.parse({ ok: true }))
        : Promise.reject(new Error('Offline'))
      : Promise.resolve(options.schema.parse(empty)),
  );
  const hook = await renderHook(useBookingAlerts, { wrapper });
  await act(() => {
    hook.result.current.open('booking-one');
  });
  await waitFor(() => {
    expect(hook.result.current.error).toContain('could not be marked as read');
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(20_000);
  });
  expect(hook.result.current.error).toContain('could not be marked as read');
  readable = true;
  await act(() => {
    hook.result.current.retry();
  });
  await waitFor(() => {
    expect(hook.result.current.error).toBeNull();
  });
});

it('discards a late feed page from an old account after a session switch', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const pending = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  mockRequest.mockReturnValueOnce(pending);
  const hook = await renderHook(useBookingAlerts, { wrapper });
  mockApi = { request: mockRequest };
  mockUserId = 'admin-two';
  await hook.rerender(undefined);
  await act(async () => {
    if (!finish) throw new Error('Expected pending feed page.');
    finish({ ...empty, items: [item] });
    await pending;
  });
  expect(hook.result.current.alerts).toEqual([]);
});

it('supports foreground feed fallback in the browser without native push listeners', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  await renderHook(useBookingAlerts, { wrapper });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(Notifications.addNotificationReceivedListener).not.toHaveBeenCalled();
  expect(Notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
});
