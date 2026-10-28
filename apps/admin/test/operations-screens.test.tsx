import { act, fireEvent, render } from '@testing-library/react-native';
import type { AdminBookingSummary, AdminDriverSummary, AdminScheduleResponse } from '@sv/contracts';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';
import BookingsScreen from '../app/(app)/bookings';
import DriversScreen from '../app/(app)/drivers';
import MoreScreen from '../app/(app)/more';
import ScheduleScreen from '../app/(app)/schedule';
import { JobCard } from '../src/components/job-card';
import type * as Operations from '../src/data/operations';
import { useBookings, useDrivers, useSchedule } from '../src/data/operations';

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    setParams: jest.fn((params: MockRouteParams) => {
      mockRouteParams = { ...mockRouteParams, ...params };
    }),
  },
  useIsFocused: () => true,
  useLocalSearchParams: () => mockRouteParams,
}));
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: true, isInternetReachable: true }),
  fetch: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
}));
jest.mock('lucide-react-native', () => {
  const Icon = (): null => null;
  return {
    AlertCircle: Icon,
    CalendarDays: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
    Inbox: Icon,
    LayoutDashboard: Icon,
    LogOut: Icon,
    MessageCircle: Icon,
    RefreshCw: Icon,
    Settings: Icon,
    Truck: Icon,
    Users: Icon,
  };
});
jest.mock('../src/data/operations', () => {
  const actual = jest.requireActual<typeof Operations>('../src/data/operations');
  return {
    ...actual,
    useBookings: jest.fn(() => mockBookings),
    useDrivers: jest.fn(() => mockDrivers),
    useSchedule: jest.fn(() => mockSchedule),
    useSlotClosure: jest.fn(() => ({ mutateAsync: jest.fn(), reset: jest.fn(), isPending: false })),
  };
});
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({
    signOut: mockSignOut,
    status: 'signed-in',
    user: {
      id: 'test-admin',
      email: 'admin@example.test',
      name: 'Test Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  }),
}));

const booking: AdminBookingSummary = {
  id: 'test-booking',
  createdAt: '2031-03-01T12:34:56.789Z',
  reference: 'SV-TEST-REF',
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
const driver: AdminDriverSummary = {
  id: 'test-driver',
  name: 'Test Driver',
  email: 'driver@example.test',
  phone: null,
  status: 'ACTIVE',
  homePostcode: null,
  licenceExpiry: null,
  defaultVan: { id: 'test-van', label: 'Test van', registration: 'TEST VAN' },
  jobsOnDate: 7,
  unavailableSlots: ['EVENING'],
};
const schedule: AdminScheduleResponse = {
  date: '2031-10-15',
  generatedAt: '2031-10-15T12:00:00.000Z',
  jobs: [booking],
  slots: [
    {
      slot: 'MORNING',
      capacity: 7,
      configuredCapacity: 7,
      confirmedUnits: 3,
      heldUnits: 2,
      availableUnits: 2,
      manualClosure: null,
      closeAllowed: false,
      closeBlockedReason: 'This window has live checkout holds.',
    },
    {
      slot: 'AFTERNOON',
      capacity: 0,
      configuredCapacity: 0,
      confirmedUnits: 0,
      heldUnits: 0,
      availableUnits: 0,
      manualClosure: null,
      closeAllowed: false,
      closeBlockedReason: 'This window is already closed by its capacity settings.',
    },
    {
      slot: 'EVENING',
      capacity: 5,
      configuredCapacity: 5,
      confirmedUnits: 0,
      heldUnits: 0,
      availableUnits: 5,
      manualClosure: null,
      closeAllowed: true,
      closeBlockedReason: null,
    },
  ],
};

function listState<T>(items?: T[]) {
  const data: { items: T[]; nextCursor: string | null } | undefined = items
    ? { items, nextCursor: null }
    : undefined;
  return {
    data,
    isPending: items === undefined,
    isError: false,
    isRefetching: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    refetch: jest.fn(() => Promise.resolve()),
    fetchNextPage: jest.fn(() => Promise.resolve()),
  };
}

let mockBookings = listState([booking]);
let mockDrivers = listState([driver]);
let mockSchedule = {
  data: schedule,
  isPending: false,
  isError: false,
  isRefetching: false,
  refetch: jest.fn(() => Promise.resolve()),
};
type MockRouteParams = {
  date?: string | string[] | undefined;
  view?: string | string[] | undefined;
  notice?: string | string[] | undefined;
};
let mockRouteParams: MockRouteParams = {};
const mockSignOut = jest.fn(() => Promise.resolve());

describe('operational screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: new Date('2031-10-15T12:00:00Z') });
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockBookings = listState([booking]);
    mockDrivers = listState([driver]);
    mockSchedule = {
      data: schedule,
      isPending: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(() => Promise.resolve()),
    };
    mockRouteParams = {};
    mockSignOut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    { name: 'Bookings', Screen: BookingsScreen },
    { name: 'Schedule', Screen: ScheduleScreen },
  ])(
    'shows the stored creation time on $name rows with a distinct move date in the accessible name',
    async ({ Screen }) => {
      const view = await render(<Screen />);
      expect(view.getByText('Created 1 March 2031 at 12:34 GMT')).toBeTruthy();
      expect(view.getByRole('button', { name: /Booking created 1 March 2031 at 12:34 GMT\./ })).toBeTruthy();
      expect(view.getByRole('button', { name: /15 October/ })).toBeTruthy();
    },
  );

  it('retains the original creation time for unpaid jobs and keeps it separate from the move date', async () => {
    const view = await render(
      <JobCard job={{ ...booking, status: 'PENDING_PAYMENT', paidPence: 0 }} showDate />,
    );
    expect(view.getByText('Created 1 March 2031 at 12:34 GMT')).toBeTruthy();
    expect(view.getByText(/15 October/)).toBeTruthy();
    expect(view.getByText('Awaiting payment')).toBeTruthy();
    expect(view.queryByText('Received')).toBeNull();
  });

  it('opens a booking from its entire labelled row and displays real values', async () => {
    const view = await render(<BookingsScreen />);
    expect(view.getByText('Test Customer')).toBeTruthy();
    expect(view.getByText('£210.00')).toBeTruthy();
    expect(view.getByText('Needs a driver')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: /SV-TEST-REF\. Paisley to Edinburgh/ }));
    expect(router.push).toHaveBeenCalledWith('/(app)/bookings/test-booking');
  });

  it('debounces booking search and sends filters to the backend rather than filtering loaded rows', async () => {
    const view = await render(<BookingsScreen />);
    await fireEvent.changeText(view.getByLabelText('Find a booking'), '  SV-TEST  ');
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'exclude' });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'exclude', q: 'SV-TEST' });
    await fireEvent.press(view.getByRole('tab', { name: 'Needs driver' }));
    expect(useBookings).toHaveBeenLastCalledWith({
      deleted: 'exclude',
      q: 'SV-TEST',
      status: 'CONFIRMED',
      dispatch: 'UNASSIGNED',
    });
    await fireEvent.press(view.getByRole('button', { name: 'Clear filters' }));
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'exclude' });
    expect(view.getByLabelText('Find a booking').props.value).toBe('');
  });

  it('keeps booking filters usable for empty and failed requests and provides retry', async () => {
    mockBookings.data = { items: [], nextCursor: null };
    const view = await render(<BookingsScreen />);
    expect(view.getByLabelText('Find a booking')).toBeTruthy();
    expect(view.getByText('No bookings yet. New bookings will appear here.')).toBeTruthy();
    mockBookings.isError = true;
    await view.rerender(<BookingsScreen />);
    expect(view.getByLabelText('Find a booking')).toBeTruthy();
    expect(view.getByText('Bookings could not be loaded. Check your connection and try again.')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
    expect(mockBookings.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps search and filters visible while the initial booking request loads', async () => {
    mockBookings = listState<AdminBookingSummary>();
    const view = await render(<BookingsScreen />);
    expect(view.getByTestId('screen-skeleton')).toBeTruthy();
    expect(view.getByLabelText('Find a booking')).toBeTruthy();
    expect(view.getByRole('tab', { name: 'Needs driver' })).toBeTruthy();
    expect(view.queryByText('Test Customer')).toBeNull();
  });

  it('loads the next booking page and disables the control while loading', async () => {
    mockBookings.hasNextPage = true;
    const view = await render(<BookingsScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Load more bookings' }));
    expect(mockBookings.fetchNextPage).toHaveBeenCalledTimes(1);
    mockBookings.isFetchingNextPage = true;
    await view.rerender(<BookingsScreen />);
    expect(view.getByRole('button', { name: 'Load more bookings, in progress' })).toBeDisabled();
  });

  it('opens the Deleted jobs route with a truthful notice and server-only deleted filtering', async () => {
    mockRouteParams = { view: 'deleted', notice: 'deleted' };
    mockBookings = listState([{ ...booking, status: 'CANCELLED' }]);
    mockBookings.hasNextPage = true;
    const view = await render(<BookingsScreen />);
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'only' });
    expect(view.getByRole('tab', { name: 'Deleted jobs', selected: true })).toBeTruthy();
    expect(view.getByText('Job moved to Deleted jobs.')).toBeTruthy();
    expect(
      view.getByText(
        'Deleted jobs are kept for your records. Restoring a job does not reactivate a cancelled checkout.',
      ),
    ).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Load more deleted jobs' }));
    expect(mockBookings.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('synchronizes deleted/all route handoffs without restoring a stale status filter', async () => {
    const view = await render(<BookingsScreen />);
    await fireEvent.press(view.getByRole('tab', { name: 'Confirmed' }));
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'exclude', status: 'CONFIRMED' });
    mockRouteParams = { view: 'deleted', notice: 'deleted' };
    await view.rerender(<BookingsScreen />);
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'only' });
    mockRouteParams = { view: 'all', notice: 'restored' };
    await view.rerender(<BookingsScreen />);
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'exclude' });
    expect(view.getByRole('tab', { name: 'All', selected: true })).toBeTruthy();
    expect(view.getByText('Job restored.')).toBeTruthy();
  });

  it('does not reset a local status filter when only the notice route parameter changes', async () => {
    mockRouteParams = { view: 'all' };
    const view = await render(<BookingsScreen />);
    await fireEvent.press(view.getByRole('tab', { name: 'Confirmed' }));
    mockRouteParams = { view: 'all', notice: 'restored' };
    await view.rerender(<BookingsScreen />);
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'exclude', status: 'CONFIRMED' });
    expect(view.getByRole('tab', { name: 'Confirmed', selected: true })).toBeTruthy();
    expect(view.getByText('Job restored.')).toBeTruthy();
  });

  it('changes Deleted jobs through the filter control and clears its search and URL view', async () => {
    const view = await render(<BookingsScreen />);
    await fireEvent.press(view.getByRole('tab', { name: 'Deleted jobs' }));
    expect(router.setParams).toHaveBeenLastCalledWith({ view: 'deleted' });
    await view.rerender(<BookingsScreen />);
    await fireEvent.changeText(view.getByLabelText('Find a booking'), 'retained reference');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'only', q: 'retained reference' });
    await fireEvent.press(view.getByRole('button', { name: 'Clear filters' }));
    expect(router.setParams).toHaveBeenLastCalledWith({ view: 'all' });
    await view.rerender(<BookingsScreen />);
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'exclude' });
    expect(view.getByLabelText('Find a booking').props.value).toBe('');
  });

  it('dismisses the success notice through the router without changing the current view', async () => {
    mockRouteParams = { view: 'deleted', notice: 'deleted' };
    const view = await render(<BookingsScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Dismiss notice' }));
    expect(router.setParams).toHaveBeenLastCalledWith({ notice: undefined });
    await view.rerender(<BookingsScreen />);
    expect(view.queryByText('Job moved to Deleted jobs.')).toBeNull();
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'only' });
  });

  it.each([
    { view: 'invalid', notice: 'invalid' },
    { view: ['deleted', 'all'], notice: ['deleted', 'restored'] },
  ])('rejects unrecognized or ambiguous view/notice parameters: %s', async (params) => {
    mockRouteParams = params;
    const view = await render(<BookingsScreen />);
    expect(useBookings).toHaveBeenLastCalledWith({ deleted: 'exclude' });
    expect(view.queryByText('Job moved to Deleted jobs.')).toBeNull();
    expect(view.queryByText('Job restored.')).toBeNull();
  });

  it('keeps retained-record guidance visible when the Deleted jobs view is empty', async () => {
    mockRouteParams = { view: 'deleted' };
    mockBookings = listState<AdminBookingSummary>([]);
    const view = await render(<BookingsScreen />);
    expect(view.getByText('No deleted jobs. Jobs moved here will remain available for review.')).toBeTruthy();
    expect(
      view.getByText(
        'Deleted jobs are kept for your records. Restoring a job does not reactivate a cancelled checkout.',
      ),
    ).toBeTruthy();
    expect(view.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('moves the schedule by civil date and returns directly to today', async () => {
    const view = await render(<ScheduleScreen />);
    expect(useSchedule).toHaveBeenLastCalledWith('2031-10-15');
    await fireEvent.press(view.getByRole('button', { name: 'Next day' }));
    expect(router.setParams).toHaveBeenLastCalledWith({ date: '2031-10-16' });
    await view.rerender(<ScheduleScreen />);
    expect(useSchedule).toHaveBeenLastCalledWith('2031-10-16');
    await fireEvent.press(view.getByRole('button', { name: 'Previous day' }));
    await view.rerender(<ScheduleScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Previous day' }));
    await view.rerender(<ScheduleScreen />);
    expect(useSchedule).toHaveBeenLastCalledWith('2031-10-14');
    await fireEvent.press(view.getByRole('button', { name: 'Back to today' }));
    await view.rerender(<ScheduleScreen />);
    expect(useSchedule).toHaveBeenLastCalledWith('2031-10-15');
  });

  it('honors a valid schedule handoff and a later handoff into the already mounted tab', async () => {
    mockRouteParams = { date: '2032-02-29' };
    const view = await render(<ScheduleScreen />);
    expect(useSchedule).toHaveBeenLastCalledWith('2032-02-29');
    mockRouteParams = { date: '2031-11-02' };
    await view.rerender(<ScheduleScreen />);
    expect(useSchedule).toHaveBeenLastCalledWith('2031-11-02');
  });

  it.each(['not-a-date', '2031-02-29', ['2031-10-16', '2031-10-17']])(
    'falls back to today for an invalid or ambiguous schedule date: %s',
    async (date) => {
      mockRouteParams = { date };
      await render(<ScheduleScreen />);
      expect(useSchedule).toHaveBeenLastCalledWith('2031-10-15');
    },
  );

  it('uses recorded schedule capacity and holds without fabricated slot counts', async () => {
    const view = await render(<ScheduleScreen />);
    expect(view.getByText('5 of 7 units used')).toBeTruthy();
    expect(view.getByText('3 confirmed · 2 held')).toBeTruthy();
    expect(view.getByText('2 units free')).toBeTruthy();
    expect(view.getByText('Closed by rules')).toBeTruthy();
    expect(view.queryByText('1/2 used')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: /SV-TEST-REF/ }));
    expect(router.push).toHaveBeenCalledWith('/(app)/bookings/test-booking');
  });

  it('distinguishes manual closure from capacity rules while preserving recorded jobs and configured capacity', async () => {
    mockSchedule.data = {
      ...schedule,
      slots: schedule.slots.map((window) =>
        window.slot === 'EVENING'
          ? {
              ...window,
              capacity: 0,
              confirmedUnits: 1,
              availableUnits: 0,
              manualClosure: {
                id: 'closure-unit',
                reason: 'Staff training',
                createdAt: '2031-10-15T12:00:00.000Z',
              },
            }
          : window,
      ),
    };
    const view = await render(<ScheduleScreen />);
    expect(view.getByText('Manually closed')).toBeTruthy();
    expect(view.getByText('Closed by rules')).toBeTruthy();
    expect(view.getByText('1 of 5 units used')).toBeTruthy();
    expect(view.getByText('Reason: Staff training')).toBeTruthy();
    expect(view.getByText('Test Customer')).toBeTruthy();
  });

  it('shows useful empty schedule feedback while retaining real capacity', async () => {
    mockSchedule.data = { ...schedule, jobs: [] };
    const view = await render(<ScheduleScreen />);
    expect(view.getByText('No jobs to show for this day')).toBeTruthy();
    expect(view.getByText('5 of 7 units used')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Next day' })).toBeTruthy();
  });

  it('keeps the loaded schedule visible when a background refresh fails and offers retry', async () => {
    mockSchedule.isError = true;
    const view = await render(<ScheduleScreen />);
    expect(view.getByText('5 of 7 units used')).toBeTruthy();
    expect(view.getByText('Test Customer')).toBeTruthy();
    expect(view.getByText('The schedule could not be updated. Your last loaded information is shown.')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    expect(mockSchedule.refetch).toHaveBeenCalled();
  });

  it('keeps Add driver available in an empty directory and opens the account form', async () => {
    mockDrivers.data = { items: [], nextCursor: null };
    const view = await render(<DriversScreen />);
    expect(view.queryByRole('button', { name: /Invite/u })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Add driver' }));
    expect(router.push).toHaveBeenCalledWith('/(app)/drivers/add');
  });

  it('searches and filters driver accounts on the backend and opens the whole driver row', async () => {
    const view = await render(<DriversScreen />);
    expect(view.getByText('7 jobs today')).toBeTruthy();
    expect(view.getByText('Active account')).toBeTruthy();
    expect(view.getByText('Unavailable: Evening')).toBeTruthy();
    expect(view.queryByText('Free')).toBeNull();
    await fireEvent.changeText(view.getByLabelText('Find a driver'), ' driver@example.test ');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    await fireEvent.press(view.getByRole('tab', { name: 'Invited' }));
    expect(useDrivers).toHaveBeenLastCalledWith({
      date: '2031-10-15',
      q: 'driver@example.test',
      status: 'INVITED',
    });
    await fireEvent.press(view.getByRole('button', { name: 'Open Test Driver, active account' }));
    expect(router.push).toHaveBeenCalledWith('/(app)/drivers/test-driver');
  });

  it('can load more drivers and clear an empty filtered directory', async () => {
    mockDrivers.hasNextPage = true;
    const view = await render(<DriversScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Load more drivers' }));
    expect(mockDrivers.fetchNextPage).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByRole('tab', { name: 'Disabled' }));
    mockDrivers.data = { items: [], nextCursor: null };
    await view.rerender(<DriversScreen />);
    expect(
      view.getByText('No drivers match these filters. Try another search or clear the filters.'),
    ).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Clear filters' }));
    expect(useDrivers).toHaveBeenLastCalledWith({ date: '2031-10-15' });
  });

  it('limits More to working destinations and filters tools without exposing stub workflows', async () => {
    const view = await render(<MoreScreen />);
    expect(view.getByText('admin@example.test')).toBeTruthy();
    expect(view.queryByText('Pricing')).toBeNull();
    expect(view.queryByText('Save changes')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Open Live chat' }));
    expect(router.push).toHaveBeenCalledWith('/(app)/chat');
    await fireEvent.changeText(view.getByLabelText('Find in your workspace'), 'schedule');
    expect(view.queryByRole('button', { name: 'Open Bookings' })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Open Schedule' }));
    expect(router.push).toHaveBeenCalledWith('/(app)/schedule');
    await fireEvent.changeText(view.getByLabelText('Find in your workspace'), 'not a tool');
    expect(view.getByText('No matching tools')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Clear search' }));
    expect(view.getByRole('button', { name: 'Open Bookings' })).toBeTruthy();
  });

  it('offers native settings only on native and signs out through the auth provider', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const view = await render(<MoreScreen />);
    expect(view.queryByRole('button', { name: 'Open device settings' })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Sign out' }));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('reports settings and sign-out failures without unhandled rejections', async () => {
    jest.spyOn(Linking, 'openSettings').mockRejectedValueOnce(new Error('Unavailable'));
    const view = await render(<MoreScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Open device settings' }));
    expect(
      view.getByText(
        'Device settings could not be opened. Open Settings on your device to manage app permissions.',
      ),
    ).toBeTruthy();
    mockSignOut.mockRejectedValueOnce(new Error('Sign-out could not reach the server.'));
    await fireEvent.press(view.getByRole('button', { name: 'Sign out' }));
    expect(view.getByText('Sign-out could not reach the server.')).toBeTruthy();
  });

  it('does not label completed unassigned jobs as needing a driver or make static cards tappable', async () => {
    const view = await render(<JobCard job={{ ...booking, status: 'COMPLETED', jobStage: 'COMPLETED' }} />);
    expect(view.getByText('Completed')).toBeTruthy();
    expect(view.queryByText('Needs a driver')).toBeNull();
    expect(view.queryByRole('button')).toBeNull();
  });
});
