import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@sv/api-client';
import type { AdminBookingSummary, AdminDashboardResponse } from '@sv/contracts';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { Platform, Text } from 'react-native';
import TodayScreen from '../app/(app)/today';
import { adminToday, shiftAdminDate, useBookings, useDashboard } from '../src/data/operations';
import { RootShell } from '../src/shell/root-shell';

jest.mock('@expo-google-fonts/bricolage-grotesque', () => ({ BricolageGrotesque_700Bold: 1 }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    useNetInfo: () => ({ isConnected: true, isInternetReachable: true }),
    addEventListener: () => () => undefined,
  },
}));
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('@expo-google-fonts/manrope', () => ({ Manrope_500Medium: 1, Manrope_700Bold: 1 }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('@sentry/react-native', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('expo-router', () => ({
  DarkTheme: { colors: {} },
  DefaultTheme: { colors: {} },
  ThemeProvider: (props: PropsWithChildren) => props.children,
  router: { push: jest.fn() },
  useIsFocused: () => mockFocused,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: (props: PropsWithChildren) => props.children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../src/components/offline-banner', () => ({ OfflineBanner: () => null }));
jest.mock('../src/notifications/register-push', () => ({
  registerPushDevice: () => Promise.resolve(() => undefined),
}));
jest.mock('../src/state/auth', () => ({
  AuthProvider: (props: PropsWithChildren) => props.children,
  useAuth: () => ({
    api: mockSessionClient,
    status: mockStatus,
    appLocked: mockLocked,
    user: { id: mockUserId },
  }),
}));

const booking: AdminBookingSummary = {
  id: 'test-booking',
  createdAt: '2031-03-01T12:34:56.789Z',
  reference: 'SV-INTEGRATION',
  customerName: 'Test Customer',
  service: 'man_and_van',
  variant: 'small_load',
  routeLabel: 'Paisley to Edinburgh',
  pickupTown: 'Paisley',
  dropoffTown: 'Edinburgh',
  moveDate: '2031-10-15',
  slot: 'MORNING',
  status: 'CONFIRMED',
  dispatchStatus: 'UNASSIGNED',
  jobStage: 'NOT_STARTED',
  totalPence: 21000,
  paidPence: 21000,
  refundedPence: 0,
  holdExpiresAt: null,
  driver: null,
  capacityUnits: 1,
  blocksSlots: 1,
};
const dashboard: AdminDashboardResponse = {
  date: '2031-10-15',
  generatedAt: '2031-10-15T12:00:00.000Z',
  bookedValuePence: 21000,
  paidPence: 21000,
  counts: { scheduled: 1, needsDriver: 1, inProgress: 0, completed: 0, pendingPayment: 0 },
  jobs: [booking],
};
const mockRequest = jest.fn<Promise<unknown>, [string]>(() => Promise.resolve(dashboard));
let mockSessionClient = { request: mockRequest };
let mockStatus: 'idle' | 'signed-in' | 'submitting' = 'signed-in';
let mockLocked = false;
let mockFocused = true;
let mockUserId = 'test-admin-1';
const clients: QueryClient[] = [];

function queryWrapper(): (props: PropsWithChildren) => React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  clients.push(client);
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function notification(id = 'delivery-1', bookingId = 'test-booking'): Notifications.Notification {
  return {
    date: Date.now(),
    request: {
      identifier: id,
      trigger: { type: 'push' },
      content: {
        title: 'New booking',
        subtitle: null,
        body: null,
        categoryIdentifier: 'NEW_BOOKING',
        sound: null,
        data: { type: 'NEW_BOOKING', bookingId },
      },
    },
  };
}

function notificationListener(): (event: Notifications.Notification) => void {
  const listener = jest.mocked(Notifications.addNotificationReceivedListener).mock.calls.at(-1)?.[0];
  if (!listener) throw new Error('An unlocked session should register its notification listener.');
  return listener;
}

describe('admin session and query integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockSessionClient = { request: mockRequest };
    mockStatus = 'signed-in';
    mockLocked = false;
    mockFocused = true;
    mockUserId = 'test-admin-1';
    mockRequest.mockImplementation((path) =>
      Promise.resolve(
        path.includes('/admin/feed')
          ? { items: [], nextCursor: null, generatedAt: '2031-10-15T12:00:00.000Z' }
          : path.includes('/admin/chats')
            ? { items: [], nextCursor: null, unreadCount: 0, latestCustomerSequence: null }
            : dashboard,
      ),
    );
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.clear();
    onlineManager.setOnline(true);
    jest.restoreAllMocks();
  });

  it('removes booking alerts on lock and does not replay them after unlock', async () => {
    const view = await render(
      <RootShell>
        <Text>App content</Text>
      </RootShell>,
    );
    const receive = notificationListener();
    await act(() => {
      receive(notification());
    });
    expect(view.getByText('New booking')).toBeTruthy();
    mockLocked = true;
    await view.rerender(
      <RootShell>
        <Text>App content</Text>
      </RootShell>,
    );
    expect(view.queryByText('New booking')).toBeNull();
    mockLocked = false;
    await view.rerender(
      <RootShell>
        <Text>App content</Text>
      </RootShell>,
    );
    expect(view.queryByText('New booking')).toBeNull();
    await act(() => {
      receive(notification('late-old-delivery'));
    });
    expect(view.queryByText('New booking')).toBeNull();
  });

  it('does not carry an alert into a new session or accept a removed session listener', async () => {
    const view = await render(
      <RootShell>
        <Text>App content</Text>
      </RootShell>,
    );
    const oldListener = notificationListener();
    await act(() => {
      oldListener(notification());
    });
    mockStatus = 'idle';
    await view.rerender(
      <RootShell>
        <Text>App content</Text>
      </RootShell>,
    );
    expect(view.queryByText('New booking')).toBeNull();
    mockStatus = 'signed-in';
    mockUserId = 'test-admin-2';
    mockSessionClient = { request: mockRequest };
    await view.rerender(
      <RootShell>
        <Text>App content</Text>
      </RootShell>,
    );
    const currentListener = notificationListener();
    await act(() => {
      currentListener(notification('new-delivery', 'new-booking'));
    });
    await act(() => {
      oldListener(notification('late-delivery', 'old-booking'));
    });
    await fireEvent.press(view.getByRole('button', { name: 'View booking' }));
    expect(router.push).toHaveBeenLastCalledWith('/(app)/bookings/new-booking');
    expect(view.queryByText('New booking')).toBeNull();
  });

  it('never starts native alert or permission listeners for signed-out or locked sessions', async () => {
    mockStatus = 'idle';
    const view = await render(
      <RootShell>
        <Text>Sign in</Text>
      </RootShell>,
    );
    expect(Notifications.addNotificationReceivedListener).not.toHaveBeenCalled();
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    mockStatus = 'signed-in';
    mockLocked = true;
    await view.rerender(
      <RootShell>
        <Text>Unlock</Text>
      </RootShell>,
    );
    expect(Notifications.addNotificationReceivedListener).not.toHaveBeenCalled();
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['idle', false],
    ['submitting', false],
    ['signed-in', true],
  ] as const)('does not fetch operational data for %s with lock=%s', async (status, locked) => {
    mockStatus = status;
    mockLocked = locked;
    await renderHook(() => useDashboard('2031-10-15'), { wrapper: queryWrapper() });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('flattens real paginated results and forwards the cursor with encoded server filters', async () => {
    mockRequest.mockImplementation((path) =>
      Promise.resolve({
        items: [{ ...booking, id: path.includes('cursor=next-page') ? 'second-booking' : 'first-booking' }],
        nextCursor: path.includes('cursor=next-page') ? null : 'next-page',
      }),
    );
    const view = await renderHook(
      () => useBookings({ q: 'name+phone@example.test & SV', status: 'CONFIRMED' }),
      { wrapper: queryWrapper() },
    );
    await waitFor(() => {
      expect(view.result.current.isSuccess).toBe(true);
    });
    expect(view.result.current.hasNextPage).toBe(true);
    await act(async () => {
      await view.result.current.fetchNextPage();
    });
    await waitFor(() => {
      expect(view.result.current.data?.items.map((item) => item.id)).toEqual([
        'first-booking',
        'second-booking',
      ]);
    });
    expect(view.result.current.hasNextPage).toBe(false);
    const lastPath = mockRequest.mock.calls.at(-1)?.[0];
    const parameters = new URL(`https://api.example.test${lastPath ?? ''}`).searchParams;
    expect(parameters.get('q')).toBe('name+phone@example.test & SV');
    expect(parameters.get('status')).toBe('CONFIRMED');
    expect(parameters.get('cursor')).toBe('next-page');
    expect(parameters.get('limit')).toBe('30');
  });

  it('does not expose a previous account’s cached dashboard during an account switch', async () => {
    const view = await renderHook(() => useDashboard('2031-10-15'), { wrapper: queryWrapper() });
    await waitFor(() => {
      expect(view.result.current.isSuccess).toBe(true);
    });
    let finish: ((value: unknown) => void) | undefined;
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    mockRequest.mockReturnValueOnce(pending);
    mockUserId = 'test-admin-2';
    await view.rerender(undefined);
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.isPending).toBe(true);
    await act(async () => {
      if (!finish) throw new Error('The new account query should be pending.');
      finish({ ...dashboard, bookedValuePence: 0, jobs: [] });
      await pending;
    });
    await waitFor(() => {
      expect(view.result.current.data?.bookedValuePence).toBe(0);
    });
  });

  it('does not retry forbidden operational reads', async () => {
    mockRequest.mockRejectedValue(new ApiClientError(403, 'Permission denied.'));
    const view = await renderHook(() => useDashboard('2031-10-15'), { wrapper: queryWrapper() });
    await waitFor(() => {
      expect(view.result.current.isError).toBe(true);
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('settles an offline first read with a bounded retry instead of pausing on a skeleton', async () => {
    onlineManager.setOnline(false);
    mockRequest.mockRejectedValue(new Error('Network unavailable'));
    const view = await renderHook(() => useDashboard('2031-10-15'), { wrapper: queryWrapper() });
    await waitFor(
      () => {
        expect(view.result.current.isError).toBe(true);
      },
      { timeout: 3000 },
    );
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(view.result.current.fetchStatus).toBe('idle');
  });

  it('renders Today from actual response values and opens real booking details', async () => {
    const view = await render(<TodayScreen />, { wrapper: queryWrapper() });
    await waitFor(() => {
      expect(view.getByText('1 move scheduled')).toBeTruthy();
    });
    expect(view.getAllByText('£210.00')).toHaveLength(2);
    await fireEvent.press(view.getByRole('button', { name: /SV-INTEGRATION/ }));
    expect(router.push).toHaveBeenCalledWith('/(app)/bookings/test-booking');
    await fireEvent.press(view.getByRole('button', { name: 'View bookings' }));
    expect(router.push).toHaveBeenCalledWith('/(app)/bookings');
  });

  it('preserves the selected overview day when opening its empty schedule', async () => {
    mockRequest.mockImplementation((path) =>
      Promise.resolve({
        ...dashboard,
        date: new URL(`https://api.example.test${path}`).searchParams.get('date'),
        bookedValuePence: 0,
        paidPence: 0,
        jobs: [],
        counts: { scheduled: 0, needsDriver: 0, inProgress: 0, completed: 0, pendingPayment: 0 },
      }),
    );
    const view = await render(<TodayScreen />, { wrapper: queryWrapper() });
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Open schedule' })).toBeTruthy();
    });
    await fireEvent.press(view.getByRole('button', { name: 'Next day' }));
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Open schedule' })).toBeTruthy();
    });
    await fireEvent.press(view.getByRole('button', { name: 'Open schedule' }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/(app)/schedule',
      params: { date: shiftAdminDate(adminToday(), 1) },
    });
  });
});
