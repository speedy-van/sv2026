import { ApiClientError } from '@sv/api-client';
import type { AdminBookingDetailResponse } from '@sv/contracts';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking } from 'react-native';
import BookingDetailScreen from '../app/(app)/bookings/[id]';
import { useBookingDetail } from '../src/data/operations';

jest.mock('../src/components/booking-cleanup-actions', () => ({ BookingCleanupActions: () => null }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({ id: 'booking-test' }),
}));
jest.mock('lucide-react-native', () => {
  const Icon = (): null => null;
  return {
    AlertCircle: Icon,
    ChevronLeft: Icon,
    CreditCard: Icon,
    Inbox: Icon,
    MapPin: Icon,
    RefreshCw: Icon,
  };
});
jest.mock('../src/data/operations', () => ({
  useBookingDetail: jest.fn(() => mockQuery),
  slotLabel: () => 'Morning',
  displayAdminDate: (date: string) => date,
  bookingStatusLabel: (status: string) => (status === 'CONFIRMED' ? 'Confirmed' : status),
  jobStageLabel: (stage: string) => (stage === 'NOT_STARTED' ? 'Not started' : stage),
  serviceLabel: (value: string) => value,
}));

const booking: AdminBookingDetailResponse = {
  deletedAt: null,
  deletion: { allowed: true, reason: null },
  id: 'booking-test',
  createdAt: '2031-03-01T12:34:56.789Z',
  reference: 'SV-DETAIL-TEST',
  customerName: 'Unit test customer',
  service: 'man-and-van',
  variant: 'standard',
  routeLabel: 'Glasgow to Edinburgh',
  pickupTown: 'Glasgow',
  dropoffTown: 'Edinburgh',
  moveDate: '2031-03-04',
  slot: 'MORNING',
  status: 'CONFIRMED',
  dispatchStatus: 'UNASSIGNED',
  jobStage: 'NOT_STARTED',
  totalPence: 23456,
  paidPence: 17345,
  refundedPence: 345,
  holdExpiresAt: null,
  driver: null,
  capacityUnits: 1,
  blocksSlots: 1,
  contactEmail: 'customer@example.test',
  contactPhone: '+447700900111',
  pickup: {
    label: 'Unit test pickup',
    line1: 'Unit test pickup street',
    line2: 'Unit test area',
    flat: 'Flat 3',
    town: 'Glasgow',
    postcode: 'G2 1DU',
    lat: 55.86,
    lng: -4.25,
    source: 'MANUAL',
  },
  dropoff: {
    label: 'Unit test delivery',
    line1: 'Unit test delivery street',
    town: 'Edinburgh',
    postcode: 'EH1 1BB',
    lat: 55.95,
    lng: -3.19,
    source: 'MANUAL',
  },
  customerNotes: 'Unit test customer instructions',
  adminNotes: 'Unit test internal note',
  distanceMiles: 47,
  durationMinutes: 70,
  version: 2,
  van: { id: 'van-test', label: 'Unit test van', registration: 'TEST VAN' },
  payments: [
    {
      id: 'received',
      kind: 'BOOKING',
      method: 'STRIPE',
      status: 'SUCCEEDED',
      amountPence: 19000,
      currency: 'gbp',
      createdAt: '2031-03-01T12:00:00.000Z',
    },
    {
      id: 'failed',
      kind: 'BOOKING',
      method: 'STRIPE',
      status: 'FAILED',
      amountPence: 1234,
      currency: 'gbp',
      createdAt: '2031-03-01T11:00:00.000Z',
    },
    {
      id: 'processing',
      kind: 'EXTRA_CHARGE',
      method: 'STRIPE',
      status: 'PROCESSING',
      amountPence: 5678,
      currency: 'gbp',
      createdAt: '2031-03-01T13:00:00.000Z',
    },
    {
      id: 'canceled',
      kind: 'EXTRA_CHARGE',
      method: 'STRIPE',
      status: 'CANCELED',
      amountPence: 910,
      currency: 'gbp',
      createdAt: '2031-03-01T14:00:00.000Z',
    },
    {
      id: 'unpaid',
      kind: 'EXTRA_CHARGE',
      method: 'STRIPE',
      status: 'REQUIRES_PAYMENT',
      amountPence: 111,
      currency: 'gbp',
      createdAt: '2031-03-01T15:00:00.000Z',
    },
    {
      id: 'offline',
      kind: 'BOOKING',
      method: 'OFFLINE',
      status: 'SUCCEEDED',
      amountPence: 4321,
      currency: 'gbp',
      createdAt: '2031-03-01T16:00:00.000Z',
    },
  ],
};

function query(data: AdminBookingDetailResponse | undefined) {
  return {
    data,
    error: null as Error | null,
    isPending: data === undefined,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(() => Promise.resolve()),
  };
}
let mockQuery = query(booking);

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = query(booking);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('booking detail uses actual records without fixture fallbacks', () => {
  it('labels the recorded creation timestamp separately from the move date and payment attempts', async () => {
    const view = await render(<BookingDetailScreen />);
    expect(view.getByText('Booking created')).toBeTruthy();
    expect(view.getByText('1 March 2031 at 12:34 GMT')).toBeTruthy();
    expect(view.getByText(/2031-03-04/)).toBeTruthy();
    expect(view.getAllByText('Received')).toHaveLength(2);

    mockQuery = query({ ...booking, createdAt: '2026-07-15T01:53:10.000Z' });
    await view.rerender(<BookingDetailScreen />);
    expect(view.getByText('15 July 2026 at 02:53 BST')).toBeTruthy();
    expect(view.queryByText('1 March 2031 at 12:34 GMT')).toBeNull();
    expect(view.getByText(/2031-03-04/)).toBeTruthy();
    expect(view.getAllByText('Received')).toHaveLength(2);
  });

  it('shows creation time for an unpaid booking without claiming payment was received', async () => {
    mockQuery = query({
      ...booking,
      status: 'PENDING_PAYMENT',
      payments: [],
      paidPence: 0,
      refundedPence: 0,
    });
    const view = await render(<BookingDetailScreen />);
    expect(view.getByText('Booking created')).toBeTruthy();
    expect(view.getByText('1 March 2031 at 12:34 GMT')).toBeTruthy();
    expect(view.getByText('No payment records for this booking.')).toBeTruthy();
    expect(view.queryByText('Received')).toBeNull();
  });

  it('displays the requested record, addresses, flat and recorded vehicle', async () => {
    const view = await render(<BookingDetailScreen />);
    expect(useBookingDetail).toHaveBeenCalledWith('booking-test');
    expect(view.getByRole('header', { name: booking.reference })).toBeTruthy();
    expect(view.getByText('Glasgow to Edinburgh')).toBeTruthy();
    expect(view.getByText('Flat 3')).toBeTruthy();
    expect(view.getByText('Unit test pickup street')).toBeTruthy();
    expect(view.getByText('Unit test area')).toBeTruthy();
    expect(view.getByText('Unit test delivery street')).toBeTruthy();
    expect(view.getByText('Unit test van · TEST VAN')).toBeTruthy();
    expect(view.getByText('Needs a driver')).toBeTruthy();
  });

  it('shows a skeleton and keeps the list navigation available while loading', async () => {
    mockQuery = query(undefined);
    const view = await render(<BookingDetailScreen />);
    expect(view.getByTestId('screen-skeleton')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Bookings' })).toBeTruthy();
    expect(view.queryByText(booking.reference)).toBeNull();
    expect(view.queryByText('£234.56')).toBeNull();
  });

  it.each([new Error('Unit test network failure'), new ApiClientError(404, 'Booking not found.')])(
    'shows retry and no unrelated booking when the requested record is unavailable',
    async (error) => {
      mockQuery = { ...query(undefined), isPending: false, isError: true, error };
      const view = await render(<BookingDetailScreen />);
      expect(
        view.getByText(
          'This booking could not be loaded. It may no longer be available, or your connection may be offline.',
        ),
      ).toBeTruthy();
      expect(view.queryByText(booking.reference)).toBeNull();
      expect(view.queryByText('Unit test pickup street')).toBeNull();
      expect(view.queryByText('£234.56')).toBeNull();
      await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
      expect(mockQuery.refetch).toHaveBeenCalledTimes(1);
    },
  );

  it('retains cached data with an explicit stale warning when refresh fails', async () => {
    mockQuery = { ...query(booking), isError: true, error: new Error('Unit test refresh failure') };
    const view = await render(<BookingDetailScreen />);
    expect(view.getByText(booking.reference)).toBeTruthy();
    expect(
      view.getByText('The booking could not be updated. The last loaded details are shown.'),
    ).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    expect(mockQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it('uses recorded paid/refunded totals instead of assuming the booking total or all payment attempts were received', async () => {
    const view = await render(<BookingDetailScreen />);
    expect(view.getByText('£234.56')).toBeTruthy();
    expect(view.getByText('Recorded paid')).toBeTruthy();
    expect(view.getByText('£173.45')).toBeTruthy();
    expect(view.getByText('Recorded refunded')).toBeTruthy();
    expect(view.getByText('£3.45')).toBeTruthy();
    expect(view.getAllByText('Received')).toHaveLength(2);
    expect(view.getByText('Failed')).toBeTruthy();
    expect(view.getByText('Processing')).toBeTruthy();
    expect(view.getByText('Cancelled')).toBeTruthy();
    expect(view.getByText('Awaiting payment')).toBeTruthy();
    expect(view.getByText('Offline payment')).toBeTruthy();
    expect(view.getByText('£12.34')).toBeTruthy();
    expect(view.getByText('£56.78')).toBeTruthy();
    expect(view.queryByText('Total paid')).toBeNull();
  });

  it('does not invent a payment, address, driver or notes when none are recorded', async () => {
    mockQuery = query({
      ...booking,
      pickup: null,
      dropoff: null,
      payments: [],
      paidPence: 0,
      refundedPence: 0,
      customerNotes: null,
      adminNotes: null,
      van: null,
    });
    const view = await render(<BookingDetailScreen />);
    expect(view.getAllByText('Address not recorded.')).toHaveLength(2);
    expect(view.getByText('No payment records for this booking.')).toBeTruthy();
    expect(view.getByText('£0.00')).toBeTruthy();
    expect(view.queryByText('Received')).toBeNull();
    expect(view.queryByText('Notes')).toBeNull();
    expect(view.queryByRole('button', { name: 'View driver' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Assign driver' })).toBeNull();
  });

  it('preserves customer and internal notes separately as literal text', async () => {
    mockQuery = query({
      ...booking,
      customerNotes: '<b>Unit test customer text</b>',
      adminNotes: 'Unit test internal instructions',
    });
    const view = await render(<BookingDetailScreen />);
    expect(view.getByText('Customer notes')).toBeTruthy();
    expect(view.getByText('<b>Unit test customer text</b>')).toBeTruthy();
    expect(view.getByText('Internal notes')).toBeTruthy();
    expect(view.getByText('Unit test internal instructions')).toBeTruthy();
  });

  it('navigates back to bookings, opens the actual driver and supports refresh', async () => {
    mockQuery = query({
      ...booking,
      driver: { id: 'actual-driver-test', name: 'Unit test assigned driver' },
    });
    const view = await render(<BookingDetailScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Bookings' }));
    expect(router.navigate).toHaveBeenCalledWith('/(app)/bookings');
    await fireEvent.press(view.getByRole('button', { name: 'View driver' }));
    expect(router.push).toHaveBeenCalledWith('/(app)/drivers/actual-driver-test');
    await fireEvent.press(view.getByRole('button', { name: 'Refresh booking' }));
    expect(mockQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it('opens only user-requested contact handlers and exposes errors instead of failing silently', async () => {
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValue(new Error('Unit test contact app unavailable'));
    const view = await render(<BookingDetailScreen />);
    expect(open).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: 'Call customer' }));
    expect(open).toHaveBeenCalledWith(`tel:${encodeURIComponent(booking.contactPhone)}`);
    await waitFor(() => {
      expect(
        view.getByText('This contact app could not be opened. You can use the details shown below.'),
      ).toBeTruthy();
    });
    await fireEvent.press(view.getByRole('button', { name: 'Email customer' }));
    expect(open).toHaveBeenCalledWith(`mailto:${encodeURIComponent(booking.contactEmail)}`);
  });

  it('does not label a non-GBP payment as pounds', async () => {
    mockQuery = query({
      ...booking,
      payments: [
        {
          id: 'foreign-test',
          kind: 'EXTRA_CHARGE',
          method: 'STRIPE',
          status: 'FAILED',
          amountPence: 123,
          currency: 'usd',
          createdAt: '2031-03-01T12:00:00.000Z',
        },
      ],
    });
    const view = await render(<BookingDetailScreen />);
    expect(view.getByText('123 minor units (USD)')).toBeTruthy();
    expect(view.queryByText('£1.23')).toBeNull();
  });
});
