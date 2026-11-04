import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { Platform } from 'react-native';
import { ApiClientError } from '@sv/api-client';
import { addDays, londonToday } from '@sv/contracts';
import type { z } from 'zod';
import BookingActionsScreen from '../app/(app)/booking-actions';
import LeadsScreen from '../app/(app)/leads';
import ManualQuoteScreen from '../app/(app)/manual-quote';
import NotificationSettingsScreen from '../app/(app)/notification-settings';
import ReportsScreen from '../app/(app)/reports';
import type { AdminToolSession } from '../src/data/admin-tool-session';
import { registerPushDevice } from '../src/notifications/register-push';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockRouteParams,
}));
jest.mock('../src/data/admin-tool-session', () => ({ useAdminToolSession: () => mockSession }));
jest.mock('../src/state/auth', () => ({ useAuth: () => ({ api: {} }) }));
jest.mock('../src/notifications/register-push', () => ({
  registerPushDevice: jest.fn(() => Promise.resolve(jest.fn())),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
}));
const now = '2031-10-01T12:00:00.000Z';
const mockHttp = jest.fn<Promise<unknown>, [string, { method?: string; body?: unknown } | undefined]>();
const mockInvalidate = jest.fn(() => Promise.resolve());
let mockSession: AdminToolSession;
let mockRouteParams: { id: string; action?: string } = { id: 'record-one' };
const clients: QueryClient[] = [];
const bookingContext = {
  id: 'record-one',
  version: 7,
  status: 'CONFIRMED',
  totalPence: 21000,
  paidPence: 15000,
  refundedPence: 0,
  balancePence: 6000,
  cancellation: { allowed: true, reason: null },
  refund: { allowed: true, reason: null },
  offlinePayment: { allowed: true, reason: null },
  extraCharge: { allowed: true, reason: null },
  payments: [
    {
      id: 'payment-one',
      method: 'STRIPE',
      status: 'SUCCEEDED',
      amountPence: 15000,
      refundablePence: 15000,
      createdAt: now,
    },
  ],
};
const manualQuote = {
  id: 'record-one',
  updatedAt: now,
  createdAt: now,
  status: 'REQUESTED',
  contact: { name: 'Test customer', email: 'customer@example.test', phone: '+447700900111' },
  service: 'man-and-van',
  variant: 'standard',
  pickupLabel: 'Glasgow',
  dropoffLabel: 'Edinburgh',
  preferredDate: '2031-10-15',
  preferredSlot: 'MORNING',
  details: 'Upright piano',
  reasons: ['Heavy item'],
  pricePence: null,
  adminMessage: null,
  validUntil: null,
  bookingId: null,
  pricingInput: null,
  accessDetail: null,
  distanceMiles: 47,
  durationMinutes: 70,
};
function response(path: string, options?: { method?: string; body?: unknown }): unknown {
  if (options?.method === 'PATCH') return { ok: true };
  if (path.endsWith('/test-push')) return { id: 'push-one', ok: true, queued: true };
  if (path.endsWith('/cancel-preview'))
    return {
      id: 'record-one',
      expectedVersion: 7,
      refundPence: 12000,
      paidNetPence: 15000,
      policySummary: 'Configured policy refund',
      willUnassignDriver: true,
    };
  if (options?.method === 'POST')
    return path.includes('/manual-quotes/')
      ? { ok: true, id: 'record-one', updatedAt: '2031-10-01T12:01:00.000Z' }
      : { ok: true, id: 'record-one', version: 8 };
  if (path.endsWith('/actions-context')) return bookingContext;
  if (path.endsWith('/manual-quotes/record-one')) return manualQuote;
  if (path.endsWith('/notification-settings'))
    return {
      generatedAt: now,
      devices: [
        {
          id: 'device-one',
          platform: 'IOS',
          enabled: true,
          currentSession: true,
          deviceName: 'Test iPhone',
          pendingBookingAlerts: false,
          lastRegisteredAt: now,
          lastError: null,
          latestTicket: null,
        },
      ],
    };
  if (path.includes('/leads/activity'))
    return {
      generatedAt: now,
      activeWindowSeconds: 90,
      retentionHours: 24,
      measurement: 'consenting-browsers',
      counts: { active: 1, SERVICE: 0, MOVE: 0, ITEMS: 1, DATE: 0, PAYMENT: 0 },
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          stage: 'ITEMS',
          service: 'man-and-van',
          startedAt: now,
          lastSeenAt: now,
          active: true,
          quoteId: null,
          booking: null,
        },
      ],
      nextCursor: null,
    };
  if (path.includes('/checkouts/abandoned'))
    return {
      generatedAt: now,
      windowDays: 30,
      items: [
        {
          id: 'expired-one',
          reference: 'SV-EXPIRED',
          customerName: 'Expired customer',
          contactEmail: 'expired@example.test',
          contactPhone: '+447700900112',
          service: 'man-and-van',
          routeLabel: 'Glasgow to Edinburgh',
          moveDate: '2031-10-15',
          slot: 'MORNING',
          totalPence: 21000,
          createdAt: now,
          expiredAt: null,
        },
      ],
      nextCursor: null,
    };
  if (path.includes('/admin/reports?'))
    return {
      from: '2031-10-01',
      to: '2031-10-31',
      dateBasis: 'BOOKING_CREATED_AT',
      bookings: 2,
      confirmed: 1,
      pending: 1,
      cancelled: 0,
      completed: 0,
      totalPence: 42000,
      paidPence: 21000,
      refundedPence: 0,
      netPaidPence: 21000,
      quotes: 5,
      manualQuotes: 1,
      byService: [],
      bySource: [],
      topTowns: [],
    };
  throw new Error(`Unexpected mock path ${path}`);
}
async function screen(element: ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(client);
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { id: 'record-one' };
  jest.replaceProperty(Platform, 'OS', 'ios');
  mockHttp.mockImplementation((path, options) => Promise.resolve().then(() => response(path, options)));
  mockSession = {
    actorId: 'admin-one',
    enabled: true,
    privateReady: true,
    offline: false,
    owner: false,
    revision: 1,
    identityRevision: 1,
    isIdentityCurrent: (revision) => mockSession.privateReady && mockSession.identityRevision === revision,
    waitForReady: () => Promise.resolve(mockSession.enabled),
    isCurrent: (revision) => mockSession.enabled && mockSession.revision === revision,
    invalidate: mockInvalidate,
    request: async <T,>(
      path: string,
      schema: z.ZodType<T>,
      options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: unknown; signal?: AbortSignal },
    ): Promise<T> => schema.parse(await mockHttp(path, options)),
    queryOptions: {
      enabled: true,
      gcTime: 0,
      staleTime: 0,
      retry: false,
      networkMode: 'always',
      placeholderData: () => undefined,
      refetchOnWindowFocus: 'always',
    },
  };
});
afterEach(() => {
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  jest.restoreAllMocks();
});

it.each(['menu', 'details'] as const)('checks the cancellation from %s, clears the check on edits, and confirms the exact refund with Face ID', async (entry) => {
  if (entry === 'details') mockRouteParams = { id: 'record-one', action: 'cancel' };
  const view = await screen(<BookingActionsScreen />);
  await waitFor(() => {
    expect(view.getByText('Still to pay')).toBeTruthy();
  });
  if (entry === 'menu') await fireEvent.press(view.getByRole('radio', { name: 'Cancel this booking' }));
  else expect(view.queryByRole('radio', { name: 'Cancel this booking' })).toBeNull();
  expect(mockHttp.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  await fireEvent.changeText(view.getByLabelText('Why is it being cancelled?'), 'Customer requested cancellation');
  expect(view.queryByRole('button', { name: 'Yes, cancel this booking' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  await waitFor(() => {
    expect(view.getByText('• The customer gets £120.00 back.')).toBeTruthy();
  });
  expect(view.getByText('• The driver will be taken off this job.')).toBeTruthy();
  expect(view.getByText('Our policy gives back 80% of what they paid.')).toBeTruthy();
  await fireEvent.changeText(view.getByLabelText('Why is it being cancelled?'), 'Changed reason');
  expect(view.queryByRole('button', { name: 'Yes, cancel this booking' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  await waitFor(() => {
    expect(view.getByRole('button', { name: 'Yes, cancel this booking' })).toBeTruthy();
  });
  await fireEvent.press(view.getByRole('button', { name: 'Yes, cancel this booking' }));
  await waitFor(() => {
    expect(mockHttp).toHaveBeenCalledWith(
      '/api/v1/admin/bookings/record-one/cancel',
      expect.objectContaining({
        method: 'POST',
        body: {
          expectedVersion: 7,
          expectedRefundPence: 12000,
          reason: 'Changed reason',
          notifyCustomer: true,
          refund: { mode: 'POLICY' },
        },
      }),
    );
  });
  expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(view.getByText(/Done\. The booking is cancelled\./)).toBeTruthy();
  });
  expect(view.getAllByRole('button', { name: 'Back to booking' })).toHaveLength(2);
});

it('opens an unpaid cancellation with no refund choices and still requires the check', async () => {
  mockRouteParams = { id: 'record-one', action: 'cancel' };
  mockHttp.mockImplementation((path, options) => Promise.resolve().then(() => {
    if (path.endsWith('/actions-context')) return {
      ...bookingContext, status: 'PENDING_PAYMENT', paidPence: 0, refundedPence: 0,
      balancePence: bookingContext.totalPence, payments: [],
    };
    if (path.endsWith('/cancel-preview')) return {
      id: 'record-one', expectedVersion: 7, refundPence: 0, paidNetPence: 0,
      policySummary: 'Cancel without issuing a refund.', willUnassignDriver: false,
    };
    return response(path, options);
  }));
  const view = await screen(<BookingActionsScreen />);
  await waitFor(() => { expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy(); });
  expect(view.getByText('The customer hasn’t paid anything, so there is nothing to refund.')).toBeTruthy();
  expect(view.getByText('Awaiting payment')).toBeTruthy();
  expect(view.queryByRole('radio', { name: 'No refund' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Yes, cancel this booking' })).toBeNull();
  await fireEvent.changeText(view.getByLabelText('Why is it being cancelled?'), 'Customer no longer needs the move');
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  await waitFor(() => { expect(view.getByText('• No money will be refunded.')).toBeTruthy(); });
  expect(mockHttp).toHaveBeenCalledWith('/api/v1/admin/bookings/record-one/cancel-preview', expect.objectContaining({
    method: 'POST', body: {
      expectedVersion: 7, reason: 'Customer no longer needs the move', notifyCustomer: true, refund: { mode: 'NONE' },
    },
  }));
  expect(mockHttp.mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(false);
});

it('shows the plain-language action menu for unknown action links without sending anything', async () => {
  mockRouteParams = { id: 'record-one', action: 'unknown' };
  const view = await screen(<BookingActionsScreen />);
  await waitFor(() => { expect(view.getByRole('radio', { name: 'Email the customer' })).toBeTruthy(); });
  expect(view.getByText('What would you like to do?')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Continue' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Send email' })).toBeNull();
  expect(mockHttp.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

it('resets cancellation choices when switching actions and re-derives the refund default after Refresh', async () => {
  const view = await screen(<BookingActionsScreen />);
  await waitFor(() => { expect(view.getByRole('radio', { name: 'Cancel this booking' })).toBeTruthy(); });
  const previewBody = (): unknown =>
    mockHttp.mock.calls.filter(([path]) => path.endsWith('/cancel-preview')).at(-1)?.[1]?.body;

  await fireEvent.press(view.getByRole('radio', { name: 'Cancel this booking' }));
  await fireEvent.press(view.getByRole('radio', { name: /Refund everything/ }));
  await fireEvent.press(view.getByRole('radio', { name: 'Email the customer' }));
  await fireEvent.press(view.getByRole('radio', { name: 'Cancel this booking' }));
  await fireEvent.changeText(view.getByLabelText('Why is it being cancelled?'), 'Customer requested cancellation');
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  await waitFor(() => { expect(previewBody()).toEqual(expect.objectContaining({ refund: { mode: 'POLICY' } })); });

  await fireEvent.press(view.getByRole('button', { name: 'Go back' }));
  mockHttp.mockImplementation((path, options) => Promise.resolve().then(() => {
    if (path.endsWith('/cancel-preview')) throw new ApiClientError(409, 'This booking changed.');
    return path.endsWith('/actions-context')
      ? { ...bookingContext, refundedPence: bookingContext.paidPence }
      : response(path, options);
  }));
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  await waitFor(() => { expect(view.getByText('This booking has just changed.')).toBeTruthy(); });
  await fireEvent.press(view.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => { expect(view.getByLabelText('Why is it being cancelled?').props.value).toBe(''); });

  mockHttp.mockImplementation((path, options) => Promise.resolve().then(() => response(path, options)));
  await fireEvent.changeText(view.getByLabelText('Why is it being cancelled?'), 'Customer requested cancellation');
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  await waitFor(() => { expect(previewBody()).toEqual(expect.objectContaining({ refund: { mode: 'NONE' } })); });
  expect(mockHttp.mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(false);
});

it('blocks oversized refunds and non-owner offline payment without sending commands', async () => {
  const view = await screen(<BookingActionsScreen />);
  await waitFor(() => {
    expect(view.getByRole('radio', { name: 'Refund a card payment' })).toBeTruthy();
  });
  await fireEvent.press(view.getByRole('radio', { name: 'Refund a card payment' }));
  await fireEvent.press(view.getByRole('radio', { name: /^Card payment/ }));
  await fireEvent.changeText(view.getByLabelText('Amount to refund (£)'), '151');
  await fireEvent.changeText(view.getByLabelText('Why are you refunding?'), 'Goodwill refund');
  await fireEvent.press(view.getByRole('button', { name: 'Refund £151.00' }));
  await waitFor(() => {
    expect(view.getByText('You can refund up to £150.00 from this payment.')).toBeTruthy();
  });
  expect(mockHttp.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  await fireEvent.press(view.getByRole('radio', { name: 'Record cash or bank transfer' }));
  expect(view.getByText('Only the owner can record a cash or bank payment.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Save payment' })).toBeDisabled();
});

it('lets the owner record a cash payment received yesterday without typing a timestamp', async () => {
  mockSession = { ...mockSession, owner: true };
  const view = await screen(<BookingActionsScreen />);
  await waitFor(() => {
    expect(view.getByRole('radio', { name: 'Record cash or bank transfer' })).toBeTruthy();
  });
  await fireEvent.press(view.getByRole('radio', { name: 'Record cash or bank transfer' }));
  await fireEvent.changeText(view.getByLabelText('How did they pay?'), 'Cash to the driver');
  await fireEvent.press(view.getByRole('radio', { name: 'Yesterday' }));
  await fireEvent.press(view.getByRole('button', { name: 'Save payment' }));
  const yesterday = addDays(londonToday(new Date()), -1);
  await waitFor(() => {
    expect(mockHttp).toHaveBeenCalledWith(
      '/api/v1/admin/bookings/record-one/payments/offline',
      expect.objectContaining({
        method: 'POST',
        body: {
          expectedVersion: 7,
          amountPence: 6000,
          reference: 'Cash to the driver',
          paidAt: `${yesterday}T12:00:00.000Z`,
        },
      }),
    );
  });
});

it('prices a manual quote using the displayed revision and exact pence', async () => {
  const view = await screen(<ManualQuoteScreen />);
  await waitFor(() => {
    expect(view.getByLabelText('Price in pounds')).toBeTruthy();
  });
  await fireEvent.changeText(view.getByLabelText('Price in pounds'), '312.45');
  await fireEvent.changeText(view.getByLabelText('Message to customer'), 'Price includes the piano.');
  await fireEvent.press(view.getByRole('button', { name: 'Save price and email offer' }));
  await waitFor(() => {
    expect(mockHttp).toHaveBeenCalledWith(
      '/api/v1/admin/manual-quotes/record-one/price',
      expect.objectContaining({
        body: {
          expectedUpdatedAt: now,
          pricePence: 31245,
          date: '2031-10-15',
          slot: 'MORNING',
          message: 'Price includes the piano.',
          validForHours: 48,
        },
        method: 'POST',
      }),
    );
  });
});

it('shows anonymous activity and abandoned records without inventing an expiry timestamp', async () => {
  const view = await screen(<LeadsScreen />);
  await waitFor(() => {
    expect(view.getByText('Anonymous visitor')).toBeTruthy();
  });
  expect(view.getByText('Adding items')).toBeTruthy();
  await fireEvent.press(view.getByRole('tab', { name: 'Abandoned' }));
  await waitFor(() => {
    expect(view.getByText(/SV-EXPIRED/)).toBeTruthy();
  });
  expect(view.queryByText(/^Expired:/)).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'View booking and contact details' }));
  expect(router.push).toHaveBeenCalledWith('/(app)/bookings/expired-one');
});

it('stores pending-alert preference and explains that a queued test is not confirmed delivery', async () => {
  const view = await screen(<NotificationSettingsScreen />);
  await waitFor(() => {
    expect(view.getByRole('switch')).toBeTruthy();
  });
  await fireEvent(view.getByRole('switch'), 'valueChange', true);
  await waitFor(() => {
    expect(mockHttp).toHaveBeenCalledWith(
      '/api/v1/admin/notification-settings',
      expect.objectContaining({
        method: 'PATCH',
        body: { deviceId: 'device-one', pendingBookingAlerts: true },
      }),
    );
  });
  await waitFor(() => {
    expect(view.getByRole('button', { name: 'Send test to Test iPhone' })).not.toBeDisabled();
  });
  await fireEvent.press(view.getByRole('button', { name: 'Send test to Test iPhone' }));
  await waitFor(() => {
    expect(view.getByText(/acceptance alone does not confirm delivery/)).toBeTruthy();
  });
  expect(mockHttp).toHaveBeenCalledWith(
    '/api/v1/admin/test-push',
    expect.objectContaining({ body: { deviceId: 'device-one' } }),
  );
});

it('validates report dates before issuing another private query', async () => {
  const view = await screen(<ReportsScreen />);
  await waitFor(() => {
    expect(view.getByText('Booking value')).toBeTruthy();
  });
  const count = mockHttp.mock.calls.length;
  await fireEvent.changeText(view.getByLabelText('From date (YYYY-MM-DD)'), '2031-10-30');
  await fireEvent.changeText(view.getByLabelText('To date (YYYY-MM-DD)'), '2031-10-01');
  await fireEvent.press(view.getByRole('button', { name: 'Apply dates' }));
  expect(view.getByText('Enter valid dates in order, covering no more than 366 days.')).toBeTruthy();
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockHttp).toHaveBeenCalledTimes(count);
});

it('waits for the app to resume after the native notification permission prompt before registration', async () => {
  let resume: ((ready: boolean) => void) | undefined;
  mockSession.waitForReady = jest.fn(
    () =>
      new Promise((resolve) => {
        resume = resolve;
      }),
  );
  const view = await screen(<NotificationSettingsScreen />);
  await waitFor(() => {
    expect(view.getByRole('button', { name: 'Register this phone' })).toBeTruthy();
  });
  await fireEvent.press(view.getByRole('button', { name: 'Register this phone' }));
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(registerPushDevice).not.toHaveBeenCalled();
  mockSession.enabled = false;
  mockSession.revision += 1;
  await act(async () => {
    await Promise.resolve();
  });
  mockSession.enabled = true;
  mockSession.revision += 1;
  await act(async () => {
    resume?.(true);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(registerPushDevice).toHaveBeenCalledTimes(1);
  });
  await waitFor(() => {
    expect(
      view.getByText('This phone is registered. Send a test and check the alert on your phone.'),
    ).toBeTruthy();
  });
});
