import { ApiClientError } from '@sv/api-client';
import type { AdminDriverDetailResponse } from '@sv/contracts';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking } from 'react-native';
import DriverDetailScreen from '../app/(app)/drivers/[id]';
import { useDriverDetail } from '../src/data/operations';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('lucide-react-native', () => {
  const Icon = (): null => null;
  return { AlertCircle: Icon, ChevronRight: Icon, Inbox: Icon, Truck: Icon };
});
jest.mock('../src/data/operations', () => ({
  useDriverDetail: jest.fn(() => mockQuery),
  slotLabel: (slot: string) =>
    slot === 'MORNING' ? 'Morning' : slot === 'AFTERNOON' ? 'Afternoon' : 'Evening',
  displayAdminDate: (date: string) => date,
  bookingStatusLabel: (status: string) => status,
  jobStageLabel: (stage: string) => stage,
  serviceLabel: (service: string) => service,
}));

const driver: AdminDriverDetailResponse = {
  id: 'driver-test',
  name: 'Unit test driver',
  email: 'driver@example.test',
  phone: '+447700900111',
  status: 'ACTIVE',
  homePostcode: 'G2 1DU',
  licenceExpiry: '2032-11-14',
  rightToWorkAt: '2030-03-01T10:00:00.000Z',
  defaultVan: { id: 'van-test', label: 'Unit test van', registration: 'TEST VAN' },
  jobsOnDate: 2,
  unavailableSlots: ['EVENING'],
  payoutPercent: 40,
  notes: 'Unit test recorded note',
  unpaidEarningsPence: 8400,
  hasMoreUpcomingBookings: false,
  upcomingBookings: [
    {
      createdAt: '2031-03-01T12:34:56.789Z',
      id: 'booking-test',
      reference: 'SV-DRIVER-TEST',
      customerName: 'Unit test customer',
      service: 'man-and-van',
      variant: 'standard',
      routeLabel: 'Glasgow to Edinburgh',
      pickupTown: 'Glasgow',
      dropoffTown: 'Edinburgh',
      moveDate: '2031-03-04',
      slot: 'MORNING',
      status: 'CONFIRMED',
      dispatchStatus: 'ACCEPTED',
      jobStage: 'NOT_STARTED',
      totalPence: 10000,
      paidPence: 10000,
      refundedPence: 0,
      holdExpiresAt: null,
      driver: { id: 'driver-test', name: 'Unit test driver' },
      capacityUnits: 1,
      blocksSlots: 1,
    },
  ],
};

function query(data: AdminDriverDetailResponse | undefined) {
  return {
    data,
    error: null as Error | null,
    isPending: data === undefined,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(() => Promise.resolve()),
  };
}
let mockQuery = query(driver);
let mockParams: { id?: string | string[] } = { id: driver.id };

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = query(driver);
  mockParams = { id: driver.id };
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('driver detail uses recorded data and useful states', () => {
  it('shows a phone agreement when no driver payout percentage has been set', async () => {
    mockQuery = query({ ...driver, payoutPercent: null });
    const view = await render(<DriverDetailScreen />);
    expect(view.getByText('Agreed by phone')).toBeTruthy();
    expect(view.queryByText('null%')).toBeNull();
    expect(view.queryByText('0%')).toBeNull();
  });
  it('shows the real account, contacts, van, dates, notes and recorded unpaid earnings', async () => {
    const view = await render(<DriverDetailScreen />);
    expect(useDriverDetail).toHaveBeenCalledWith(driver.id);
    expect(view.getByText('Active account')).toBeTruthy();
    expect(view.getByText('driver@example.test')).toBeTruthy();
    expect(view.getByText('£84.00')).toBeTruthy();
    expect(view.getByText('TEST VAN')).toBeTruthy();
    expect(view.getByText('14 November 2032')).toBeTruthy();
    expect(view.getByText('Unit test recorded note')).toBeTruthy();
    expect(view.getByText('Evening')).toBeTruthy();
    expect(view.queryByText('Disable driver')).toBeNull();
    expect(view.queryByText('Performance')).toBeNull();
    expect(view.queryByText('Online')).toBeNull();
  });

  it('opens an assigned booking and returns directly to the driver directory', async () => {
    const view = await render(<DriverDetailScreen />);
    await fireEvent.press(view.getByRole('button', { name: /SV-DRIVER-TEST\. Glasgow to Edinburgh/ }));
    expect(router.push).toHaveBeenCalledWith('/(app)/bookings/booking-test');
    await fireEvent.press(view.getByRole('button', { name: 'Back to drivers' }));
    expect(router.replace).toHaveBeenCalledWith('/(app)/drivers');
  });

  it('keeps back navigation available while loading', async () => {
    mockQuery = query(undefined);
    const view = await render(<DriverDetailScreen />);
    expect(view.getByTestId('screen-skeleton')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Back to drivers' })).toBeTruthy();
    expect(view.queryByText('£84.00')).toBeNull();
  });

  it('shows retry for a failed initial read', async () => {
    mockQuery = {
      ...query(undefined),
      isPending: false,
      isError: true,
      error: new Error('Unit test read failure'),
    };
    const view = await render(<DriverDetailScreen />);
    expect(
      view.getByText('Driver details could not be loaded. Check your connection and try again.'),
    ).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
    expect(mockQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it('handles a missing driver and missing identifier without leaving a spinner', async () => {
    mockQuery = {
      ...query(undefined),
      isPending: false,
      isError: true,
      error: new ApiClientError(404, 'Driver not found.'),
    };
    const view = await render(<DriverDetailScreen />);
    expect(
      view.getByText(
        'This driver could not be found. Return to the driver directory to choose another account.',
      ),
    ).toBeTruthy();
    mockParams = {};
    mockQuery = query(undefined);
    await view.rerender(<DriverDetailScreen />);
    expect(useDriverDetail).toHaveBeenLastCalledWith('');
    expect(view.queryByTestId('screen-skeleton')).toBeNull();
  });

  it('retains cached details with a visible refresh error and retry action', async () => {
    mockQuery = { ...query(driver), isError: true, error: new Error('Unit test refresh failure') };
    const view = await render(<DriverDetailScreen />);
    expect(view.getByText('£84.00')).toBeTruthy();
    expect(
      view.getByText('The driver details could not be updated. Your last loaded information is shown.'),
    ).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    expect(mockQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows honest empty records instead of claiming availability or inventing jobs', async () => {
    mockQuery = query({
      ...driver,
      phone: null,
      defaultVan: null,
      upcomingBookings: [],
      unavailableSlots: [],
      unpaidEarningsPence: 0,
      status: 'DISABLED',
    });
    const view = await render(<DriverDetailScreen />);
    expect(view.getByText('Disabled account')).toBeTruthy();
    expect(view.getByText('£0.00')).toBeTruthy();
    expect(view.getByText('No default van recorded.')).toBeTruthy();
    expect(view.getByText('No unavailable periods recorded for today.')).toBeTruthy();
    expect(
      view.getByText('No current or upcoming confirmed bookings are assigned to this driver.'),
    ).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Call driver' })).toBeNull();
    expect(view.queryByText('Available')).toBeNull();
  });

  it('discloses the upcoming-list limit', async () => {
    mockQuery = query({ ...driver, hasMoreUpcomingBookings: true });
    const view = await render(<DriverDetailScreen />);
    expect(
      view.getByText('Showing the next 25 assigned bookings. More bookings are assigned beyond this list.'),
    ).toBeTruthy();
  });

  it('shows a helpful error when a contact app cannot open', async () => {
    const open = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValue(new Error('Unit test unavailable phone handler'));
    const view = await render(<DriverDetailScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Call driver' }));
    expect(open).toHaveBeenCalledWith('tel:+447700900111');
    await waitFor(() => {
      expect(
        view.getByText('The phone app could not be opened. You can copy the number above.'),
      ).toBeTruthy();
    });
  });
});
