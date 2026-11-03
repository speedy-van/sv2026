import { act, fireEvent, render } from '@testing-library/react-native';
import type { NotificationItem, NotificationsResponse } from '@sv/contracts';
import { router } from 'expo-router';
import NotificationsScreen, { notificationDestination } from '../app/(app)/notifications';
import { notificationCopy } from '../src/content/notifications';
import type { NotificationReadInput } from '../src/data/notifications';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../src/data/notifications', () => ({
  useNotificationInbox: () => mockInbox,
  useMarkNotificationsRead: () => mockRead,
}));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({ api: mockApi, user: mockAccountId ? { id: mockAccountId } : null }),
}));

const mockApi = {};
let mockAccountId: string | null = 'admin-one';
const mockRefetch = jest.fn(() => Promise.resolve());
const mockNextPage = jest.fn(() => Promise.resolve());
const mockMutate = jest.fn<undefined, [NotificationReadInput, { onSuccess: () => void }?]>();
const notices: [NotificationItem, NotificationItem, NotificationItem] = [
  { id: 'contact-one', type: 'contact.received', title: 'Contact received', body: 'First website contact received.', data: { url: 'https://untrusted.example' }, readAt: null, createdAt: '2031-10-15T12:00:00.000Z' },
  { id: 'contact-two', type: 'contact.received', title: 'Another contact received', body: 'Second website contact received.', data: null, readAt: null, createdAt: '2031-10-14T12:00:00.000Z' },
  { id: 'booking-one', type: 'booking.confirmed', title: 'Booking confirmed', body: 'A new booking is ready.', data: { bookingId: 'booking-one' }, readAt: null, createdAt: '2031-10-13T12:00:00.000Z' },
];
let mockInbox: {
  enabled: boolean;
  privateReady: boolean;
  offline: boolean;
  query: {
    data: { pages: NotificationsResponse[] } | undefined;
    isPending: boolean;
    isError: boolean;
    isRefetching: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    refetch: typeof mockRefetch;
    fetchNextPage: typeof mockNextPage;
  };
};
let mockRead: {
  mutate: typeof mockMutate;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  variables: NotificationReadInput | undefined;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAccountId = 'admin-one';
  mockInbox = {
    enabled: true, privateReady: true, offline: false,
    query: {
      data: { pages: [{ items: notices, unreadCount: 3, badgeCount: 3, nextCursor: null }] },
      isPending: false, isError: false, isRefetching: false, hasNextPage: false, isFetchingNextPage: false,
      refetch: mockRefetch, fetchNextPage: mockNextPage,
    },
  };
  mockRead = { mutate: mockMutate, isPending: false, isError: false, isSuccess: false, variables: undefined };
});

it('makes contact notifications visible and changes 3 to 2 to 0 only after explicit read actions', async () => {
  const view = await render(<NotificationsScreen />);
  expect(view.getByText('3 unread notifications')).toBeTruthy();
  expect(view.getByText(notices[0].body)).toBeTruthy();
  expect(view.getByText(notices[1].body)).toBeTruthy();
  expect(mockMutate).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'Mark read: Contact received' }));
  expect(mockMutate).toHaveBeenLastCalledWith({ ids: ['contact-one'] });
  expect(view.getByText('3 unread notifications')).toBeTruthy();
  mockInbox.query.data = { pages: [{ items: notices.map((item, index) => index === 0 ? { ...item, readAt: '2031-10-15T12:10:00.000Z' } : item), unreadCount: 2, badgeCount: 2, nextCursor: null }] };
  await view.rerender(<NotificationsScreen />);
  expect(view.getByText('2 unread notifications')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: notificationCopy.readAll }));
  expect(mockMutate).toHaveBeenLastCalledWith({ all: true });
  mockInbox.query.data = { pages: [{ items: notices.map((item) => ({ ...item, readAt: '2031-10-15T12:10:00.000Z' })), unreadCount: 0, badgeCount: 0, nextCursor: null }] };
  await view.rerender(<NotificationsScreen />);
  expect(view.getByText('0 unread notifications')).toBeTruthy();
  expect(view.getByText(notices[0].body)).toBeTruthy();
  expect(view.getByRole('button', { name: notificationCopy.readAll })).toBeDisabled();
});

it('keeps the unread rows and offers retry after a read or refresh failure', async () => {
  mockRead.isError = true;
  mockInbox.query.isError = true;
  const view = await render(<NotificationsScreen />);
  expect(view.getByText(notificationCopy.readError)).toBeTruthy();
  expect(view.getByText('3 unread notifications')).toBeTruthy();
  expect(view.getByText(notices[0].body)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Retry notifications' }));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByRole('button', { name: notificationCopy.readAll }));
  expect(mockMutate).toHaveBeenCalledWith({ all: true });
});

it('provides loading, empty, error and retry states', async () => {
  mockInbox.query.data = undefined; mockInbox.query.isPending = true;
  const view = await render(<NotificationsScreen />);
  expect(view.getByTestId('screen-skeleton')).toBeTruthy();
  mockInbox.query.isPending = false; mockInbox.query.isError = true;
  await view.rerender(<NotificationsScreen />);
  expect(view.getByText(notificationCopy.error)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  mockInbox.query.isError = false;
  mockInbox.query.data = { pages: [{ items: [], unreadCount: 0, badgeCount: 0, nextCursor: null }] };
  await view.rerender(<NotificationsScreen />);
  expect(view.getByText(notificationCopy.empty)).toBeTruthy();
});

it('disables reading offline and hides private items when locked', async () => {
  mockInbox.offline = true; mockInbox.enabled = false;
  const view = await render(<NotificationsScreen />);
  expect(view.getByText(notificationCopy.offline)).toBeTruthy();
  expect(view.getByRole('button', { name: notificationCopy.readAll })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Mark read: Contact received' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: notificationCopy.readAll }));
  expect(mockMutate).not.toHaveBeenCalled();
  mockInbox.privateReady = false;
  await view.rerender(<NotificationsScreen />);
  expect(view.queryByText(notices[0].body)).toBeNull();
  expect(view.queryByText('3 unread notifications')).toBeNull();
});

it('loads older notifications and opens a new booking only after its alerts are acknowledged', async () => {
  mockInbox.query.hasNextPage = true;
  const view = await render(<NotificationsScreen />);
  expect(mockMutate).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: notificationCopy.more }));
  expect(mockNextPage).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByRole('button', { name: 'Open booking' }));
  expect(mockMutate).toHaveBeenCalledTimes(1);
  expect(mockMutate.mock.calls[0]?.[0]).toEqual({ bookingId: 'booking-one' });
  expect(typeof mockMutate.mock.calls[0]?.[1]?.onSuccess).toBe('function');
  expect(router.push).not.toHaveBeenCalled();
  mockRead.isPending = true; mockRead.variables = { bookingId: 'booking-one' };
  await view.rerender(<NotificationsScreen />);
  expect(view.getByRole('button', { name: 'Open booking, in progress' })).toBeDisabled();
  expect(view.getByText('3 unread notifications')).toBeTruthy();
  await act(() => { mockMutate.mock.calls[0]?.[1]?.onSuccess(); });
  expect(router.push).toHaveBeenCalledWith('/(app)/bookings/booking-one');
  expect(notificationDestination(notices[0])).toBeNull();
  expect(notificationDestination({ ...notices[0], data: { conversationId: 'chat/one' } })).toEqual({ label: 'Open conversation', path: '/(app)/chat/chat%2Fone' });
  expect(notificationDestination({ ...notices[0], data: { bookingId: '', url: '/admin/settings' } })).toBeNull();
});

it('keeps the booking notification visible after an acknowledgement failure and allows retry', async () => {
  const view = await render(<NotificationsScreen />);
  await fireEvent.press(view.getByRole('button', { name: 'Open booking' }));
  mockRead.isError = true; mockRead.variables = { bookingId: 'booking-one' };
  await view.rerender(<NotificationsScreen />);
  expect(view.getByText(notificationCopy.readError)).toBeTruthy();
  expect(view.getByText('3 unread notifications')).toBeTruthy();
  expect(view.getByText(notices[2].body)).toBeTruthy();
  expect(router.push).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'Open booking' }));
  expect(mockMutate).toHaveBeenCalledTimes(2);
  await act(() => { mockMutate.mock.calls[1]?.[1]?.onSuccess(); });
  expect(router.push).toHaveBeenCalledWith('/(app)/bookings/booking-one');
});

it.each(['locked', 'signed-out', 'changed-account', 'unlocked-again'] as const)('does not navigate on a late booking acknowledgement after the session becomes %s', async (state) => {
  const view = await render(<NotificationsScreen />);
  await fireEvent.press(view.getByRole('button', { name: 'Open booking' }));
  if (state === 'changed-account') {
    mockAccountId = 'admin-two';
  } else {
    mockInbox.enabled = false; mockInbox.privateReady = false;
    if (state === 'signed-out') mockAccountId = null;
  }
  await view.rerender(<NotificationsScreen />);
  if (state === 'unlocked-again') {
    mockInbox.enabled = true; mockInbox.privateReady = true;
    await view.rerender(<NotificationsScreen />);
  }
  await act(() => { mockMutate.mock.calls[0]?.[1]?.onSuccess(); });
  expect(router.push).not.toHaveBeenCalled();
});

it('opens already-read bookings and conversations directly without another acknowledgement', async () => {
  mockInbox.query.data = { pages: [{
    items: [
      { ...notices[2], readAt: '2031-10-15T12:10:00.000Z' },
      { ...notices[0], type: 'chat.message', data: { conversationId: 'chat-one' } },
    ], unreadCount: 1, badgeCount: 1, nextCursor: null,
  }] };
  const view = await render(<NotificationsScreen />);
  await fireEvent.press(view.getByRole('button', { name: 'Open booking' }));
  expect(router.push).toHaveBeenLastCalledWith('/(app)/bookings/booking-one');
  await fireEvent.press(view.getByRole('button', { name: 'Open conversation' }));
  expect(router.push).toHaveBeenLastCalledWith('/(app)/chat/chat-one');
  expect(mockMutate).not.toHaveBeenCalled();
});

it('marks other booking updates read by notification id before opening them', async () => {
  mockInbox.query.data = { pages: [{ items: [{ ...notices[2], type: 'booking.updated' }], unreadCount: 1, badgeCount: 1, nextCursor: null }] };
  const view = await render(<NotificationsScreen />);
  await fireEvent.press(view.getByRole('button', { name: 'Open booking' }));
  expect(mockMutate).toHaveBeenCalledTimes(1);
  expect(mockMutate.mock.calls[0]?.[0]).toEqual({ ids: ['booking-one'] });
  expect(typeof mockMutate.mock.calls[0]?.[1]?.onSuccess).toBe('function');
  expect(router.push).not.toHaveBeenCalled();
  await act(() => { mockMutate.mock.calls[0]?.[1]?.onSuccess(); });
  expect(router.push).toHaveBeenCalledWith('/(app)/bookings/booking-one');
});
