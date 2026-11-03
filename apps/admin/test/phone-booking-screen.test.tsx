import { AdminPhoneBookingCreateSchema, AdminQuoteResponseSchema } from '@sv/contracts';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { z } from 'zod';
import NewPhoneBookingScreen from '../app/(app)/new-booking';
import type { AdminToolSession } from '../src/data/admin-tool-session';
import { editCatalogue, editContext } from './booking-editor-fixtures';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../src/data/admin-tool-session', () => ({ useAdminToolSession: () => mockSession }));
const mockHttp = jest.fn<Promise<unknown>, [string, { method?: string; body?: unknown } | undefined]>();
let mockSession: AdminToolSession;
let manual = false;
let rejectFirstCreate = false;
const clients: QueryClient[] = [];
const quote = AdminQuoteResponseSchema.parse({
  quote: {
    publicId: 'quote-public-one',
    expiresAt: '2099-10-15T12:00:00.000Z',
    service: 'man-and-van',
    variant: 'standard',
    distanceMiles: 47,
    durationMinutes: 70,
    pickup: {
      line1: '1 Test Road',
      town: 'Glasgow',
      postcode: 'G2 1DU',
      lat: 55.86,
      lng: -4.25,
      label: '1 Test Road, Glasgow',
    },
    dropoff: {
      line1: '2 Test Road',
      town: 'Edinburgh',
      postcode: 'EH1 1BB',
      lat: 55.95,
      lng: -3.19,
      label: '2 Test Road, Edinburgh',
    },
    breakdownLines: [],
    staticSubtotalPence: 21000,
    calendar: [
      {
        date: '2099-10-15',
        weekday: 4,
        slots: [
          { slot: 'MORNING', windowLabel: '08:00–12:00', pricePence: 21000, available: true, lastOne: false },
          {
            slot: 'AFTERNOON',
            windowLabel: '12:00–16:00',
            pricePence: 22000,
            available: false,
            lastOne: false,
            reason: 'FULL',
          },
          { slot: 'EVENING', windowLabel: '16:00–20:00', pricePence: 23000, available: true, lastOne: false },
        ],
      },
    ],
    cheapest: { date: '2099-10-15', slot: 'MORNING', pricePence: 21000 },
    staticMapPath: '/api/v1/maps/static/quote-one',
  },
});
function response(path: string, options?: { method?: string; body?: unknown }): unknown {
  if (path.endsWith('/create-context')) return { services: editContext.services, ready: true, reason: null };
  if (path.endsWith('/catalogue')) return editCatalogue;
  if (path.includes('/address/postcode/')) {
    const postcode = decodeURIComponent(path.split('/').at(-1) ?? '');
    return { postcode, town: postcode === 'G2 1DU' ? 'Glasgow' : 'Edinburgh', lat: 55.86, lng: -4.25 };
  }
  if (path.endsWith('/admin/quotes'))
    return manual
      ? { manualQuote: { quotePublicId: 'manual-public-one', reasons: ['VARIANT_REQUIRES_SURVEY'] } }
      : quote;
  if (path.endsWith('/manual-request')) return { reference: 'MQ-ONE' };
  if (path.endsWith('/admin/bookings') && options?.method === 'POST') {
    if (rejectFirstCreate) {
      rejectFirstCreate = false;
      throw new Error('Connection interrupted. Retry the same request.');
    }
    return {
      ok: true,
      id: 'booking-created',
      version: 0,
      reference: 'SV-PHONE-ONE',
      status: 'PENDING_PAYMENT',
      totalPence: 21000,
      paymentUrl: 'https://example.test/payment',
    };
  }
  throw new Error(`Unexpected mock request ${path}`);
}
beforeEach(() => {
  jest.clearAllMocks();
  manual = false;
  rejectFirstCreate = false;
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
    invalidate: () => Promise.resolve(),
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
});
async function start(): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const view = await render(
    <QueryClientProvider client={client}>
      <NewPhoneBookingScreen />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(view.getByRole('button', { name: 'Continue to move details' })).toBeTruthy();
  });
  await fireEvent.press(view.getByRole('button', { name: 'Continue to move details' }));
  for (const [side, line, town, postcode] of [
    ['Pickup', '1 Test Road', 'Glasgow', 'G2 1DU'],
    ['Delivery', '2 Test Road', 'Edinburgh', 'EH1 1BB'],
  ] as const) {
    await fireEvent.changeText(view.getByLabelText(`${side} address line 1`), line);
    await fireEvent.changeText(view.getByLabelText(`${side} town`), town);
    await fireEvent.changeText(view.getByLabelText(`${side} postcode`), postcode);
    await fireEvent.press(view.getByRole('button', { name: `Verify ${side.toLowerCase()} address` }));
    await waitFor(() => {
      expect(view.getByRole('button', { name: `Verify ${side.toLowerCase()} address` })).not.toBeDisabled();
    });
  }
  await waitFor(() => {
    expect(view.getByRole('button', { name: 'Continue to items' })).not.toBeDisabled();
  });
  await fireEvent.press(view.getByRole('button', { name: 'Continue to items' }));
  await fireEvent.changeText(view.getByLabelText('Find an item to add'), 'sofa');
  await fireEvent.press(view.getByRole('button', { name: 'Add Test sofa' }));
  await fireEvent.press(view.getByRole('button', { name: 'Get quote and available dates' }));
  await waitFor(() => {
    expect(view.getByRole('button', { name: 'Continue to customer details' })).toBeTruthy();
  });
  await fireEvent.press(view.getByRole('button', { name: 'Continue to customer details' }));
  await fireEvent.changeText(view.getByLabelText('Customer name'), 'Phone customer');
  await fireEvent.changeText(view.getByLabelText('Customer email'), 'phone@example.test');
  await fireEvent.changeText(view.getByLabelText('Customer phone'), '+447700900111');
  return view;
}

it('uses verified addresses and quote prices, retains the idempotency key across an uncertain retry, then opens the actual booking', async () => {
  const view = await start();
  expect(view.queryByRole('tab', { name: 'Already paid offline' })).toBeNull();
  rejectFirstCreate = true;
  await fireEvent.press(view.getByRole('button', { name: 'Create booking and send payment link' }));
  await waitFor(() => {
    expect(view.getByText('Connection interrupted. Retry the same request.')).toBeTruthy();
  });
  await fireEvent.press(view.getByRole('button', { name: 'Create booking and send payment link' }));
  await waitFor(() => {
    expect(view.getByText('Booking SV-PHONE-ONE created')).toBeTruthy();
  });
  const requests = mockHttp.mock.calls.filter(
    ([path, options]) => path.endsWith('/admin/bookings') && options?.method === 'POST',
  );
  expect(requests).toHaveLength(2);
  const first = AdminPhoneBookingCreateSchema.parse(requests[0]?.[1]?.body);
  const second = AdminPhoneBookingCreateSchema.parse(requests[1]?.[1]?.body);
  expect(first.idempotencyKey).toBe(second.idempotencyKey);
  expect(second.expectedTotalPence).toBe(21000);
  expect(second.payment).toEqual({ mode: 'LINK' });
  expect(second.contact.email).toBe('phone@example.test');
  await fireEvent.press(view.getByRole('button', { name: 'Open created booking' }));
  expect(router.replace).toHaveBeenCalledWith('/(app)/bookings/booking-created');
});

it('saves a manual quote request without claiming that a booking was confirmed', async () => {
  manual = true;
  const view = await start();
  await fireEvent.press(view.getByRole('button', { name: 'Save quote request' }));
  await waitFor(() => {
    expect(view.getByText('Quote request MQ-ONE created')).toBeTruthy();
  });
  expect(mockHttp.mock.calls.some(([path]) => path.endsWith('/admin/bookings'))).toBe(false);
  expect(view.getByText(/This move needs a manual price/)).toBeTruthy();
});

it('ignores a manual request response when the session changes during submission', async () => {
  manual = true;
  const view = await start();
  let finish: ((value: unknown) => void) | undefined;
  mockHttp.mockImplementation((path, options) =>
    path.endsWith('/manual-request')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(response(path, options)),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Save quote request' }));
  mockSession.revision = 2;
  await act(async () => {
    finish?.({ reference: 'OLD-ACCOUNT' });
    await Promise.resolve();
  });
  expect(view.queryByText(/OLD-ACCOUNT/)).toBeNull();
  expect(router.replace).not.toHaveBeenCalled();
});
