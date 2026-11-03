import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useNotificationBadge } from '../src/notifications/use-notification-badge';

const mockInvalidate = jest.fn(() => Promise.resolve());
const mockRefetch = jest.fn(() => Promise.resolve());
let mockApi = {};
let mockUserId: string | undefined = 'admin-one';
let mockStatus: 'idle' | 'signed-in' | 'restoring' = 'signed-in';
let mockEnabled = true;
let mockPrivateReady = true;
let mockCount = 3;
let mockUpdatedAt = 10;
let mockSuccess = true;
let mockFetching = false;
let mockError = false;

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock('../src/data/notifications', () => ({
  notificationQueryKey: (id?: string) => ['admin', id, 'notifications'],
  useNotificationRuntime: () => ({
    auth: { api: mockApi, user: mockUserId ? { id: mockUserId } : null, status: mockStatus },
    enabled: mockEnabled, privateReady: mockPrivateReady, offline: !mockEnabled,
  }),
  useNotificationsSummary: () => ({
    query: {
      data: { badgeCount: mockCount }, dataUpdatedAt: mockUpdatedAt,
      isSuccess: mockSuccess, isFetching: mockFetching, isError: mockError, refetch: mockRefetch,
    },
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  mockApi = {};
  mockUserId = 'admin-one';
  mockStatus = 'signed-in';
  mockEnabled = true;
  mockPrivateReady = true;
  mockCount = 3;
  mockUpdatedAt = 10;
  mockSuccess = true;
  mockFetching = false;
  mockError = false;
  jest.mocked(Notifications.setBadgeCountAsync).mockReset().mockResolvedValue(true);
});

it('waits for a fresh baseline and then replaces 3 with 2 and clears only a confirmed zero', async () => {
  const hook = await renderHook(useNotificationBadge);
  expect(Notifications.setBadgeCountAsync).not.toHaveBeenCalled();
  mockUpdatedAt = 11;
  await hook.rerender(undefined);
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(3); });
  mockCount = 2;
  mockUpdatedAt = 12;
  await hook.rerender(undefined);
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(2); });
  mockCount = 0;
  mockUpdatedAt = 13;
  await hook.rerender(undefined);
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(0); });
});

it('does not replace the badge with cached counts on foreground, unlock, or reconnect', async () => {
  const hook = await renderHook(useNotificationBadge);
  for (const count of [7, 4, 1]) {
    mockEnabled = false;
    await hook.rerender(undefined);
    mockCount = count;
    mockUpdatedAt += 1;
    mockEnabled = true;
    await hook.rerender(undefined);
    const callsBefore = jest.mocked(Notifications.setBadgeCountAsync).mock.calls.length;
    mockFetching = true;
    await hook.rerender(undefined);
    expect(jest.mocked(Notifications.setBadgeCountAsync).mock.calls).toHaveLength(callsBefore);
    mockFetching = false;
    mockUpdatedAt += 1;
    await hook.rerender(undefined);
    await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(count); });
  }
});

it('keeps the last badge on request failure and exposes retry without marking anything read', async () => {
  const hook = await renderHook(useNotificationBadge);
  mockUpdatedAt = 11;
  await hook.rerender(undefined);
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(3); });
  mockSuccess = false;
  mockError = true;
  mockCount = 0;
  await hook.rerender(undefined);
  expect(hook.result.current.error).toContain('could not be refreshed');
  expect(Notifications.setBadgeCountAsync).toHaveBeenCalledTimes(1);
  await act(() => { hook.result.current.retry(); });
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});

it('does not apply a pending former-account count after logout', async () => {
  const hook = await renderHook(useNotificationBadge);
  mockUpdatedAt = 11;
  await hook.rerender(undefined);
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(3); });
  mockStatus = 'idle';
  mockUserId = undefined;
  mockPrivateReady = false;
  mockEnabled = false;
  await hook.rerender(undefined);
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(0); });
  mockCount = 9;
  mockUpdatedAt = 12;
  await hook.rerender(undefined);
  expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(0);
});

it('serializes an in-flight old native write before the logout clear', async () => {
  let finish: ((value: boolean) => void) | undefined;
  jest.mocked(Notifications.setBadgeCountAsync).mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const hook = await renderHook(useNotificationBadge);
  mockUpdatedAt = 11;
  await hook.rerender(undefined);
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(3); });
  mockStatus = 'idle';
  mockUserId = undefined;
  mockPrivateReady = false;
  mockEnabled = false;
  await hook.rerender(undefined);
  expect(Notifications.setBadgeCountAsync).toHaveBeenCalledTimes(1);
  await act(async () => { finish?.(true); await Promise.resolve(); });
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(0); });
});

it('refreshes the authoritative count on push receipt and clears a signed-out badge', async () => {
  const hook = await renderHook(useNotificationBadge);
  const listener = jest.mocked(Notifications.addNotificationReceivedListener).mock.calls.at(-1)?.[0];
  if (!listener) throw new Error('Expected notification listener.');
  const push = { request: { content: { data: {} } } };
  // The badge listener does not consume the notification payload.
  await act(() => { listener(push as Notifications.Notification); });
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'admin-one', 'notifications'] });
  mockStatus = 'idle';
  mockUserId = undefined;
  mockEnabled = false;
  mockPrivateReady = false;
  await hook.rerender(undefined);
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(0); });
});

it('keeps the account clear queued through a fast sign-in while the next account is locked or offline', async () => {
  let finish: ((value: boolean) => void) | undefined;
  jest.mocked(Notifications.setBadgeCountAsync).mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const hook = await renderHook(useNotificationBadge);
  mockUpdatedAt = 11;
  await hook.rerender(undefined);
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(3); });
  mockStatus = 'idle';
  mockUserId = undefined;
  mockPrivateReady = false;
  mockEnabled = false;
  await hook.rerender(undefined);
  mockApi = {};
  mockStatus = 'signed-in';
  mockUserId = 'admin-two';
  await hook.rerender(undefined);
  await act(async () => { finish?.(true); await Promise.resolve(); });
  await waitFor(() => { expect(Notifications.setBadgeCountAsync).toHaveBeenLastCalledWith(0); });
  expect(jest.mocked(Notifications.setBadgeCountAsync).mock.calls.map(([count]) => count)).toEqual([3, 0]);
});

it('reports a refused native badge write and retries after a fresh response', async () => {
  jest.mocked(Notifications.setBadgeCountAsync).mockResolvedValueOnce(false);
  const hook = await renderHook(useNotificationBadge);
  mockUpdatedAt = 11;
  await hook.rerender(undefined);
  await waitFor(() => { expect(hook.result.current.error).toContain('could not be updated'); });
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  mockUpdatedAt = 12;
  await hook.rerender(undefined);
  await waitFor(() => { expect(hook.result.current.error).toBeNull(); });
});

it('does not call native badge APIs on web or clear an account during session restore', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const hook = await renderHook(useNotificationBadge);
  mockUpdatedAt = 11;
  await hook.rerender(undefined);
  expect(Notifications.setBadgeCountAsync).not.toHaveBeenCalled();
  jest.replaceProperty(Platform, 'OS', 'ios');
  mockStatus = 'restoring';
  mockEnabled = false;
  mockPrivateReady = false;
  await hook.rerender(undefined);
  expect(Notifications.setBadgeCountAsync).not.toHaveBeenCalled();
});
