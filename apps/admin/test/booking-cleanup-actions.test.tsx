import { ApiClientError } from '@sv/api-client';
import type { AdminBookingDetailResponse, AdminBookingCleanupResponse } from '@sv/contracts';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { BookingCleanupActions } from '../src/components/booking-cleanup-actions';
import type { BookingCleanupVariables } from '../src/data/operations';

let mockNetwork: { isConnected: boolean | null; isInternetReachable: boolean | null };
const mockFetch = jest.fn<Promise<{ isConnected: boolean; isInternetReachable: boolean }>, []>();
const mockMutate = jest.fn<Promise<AdminBookingCleanupResponse>, [BookingCleanupVariables]>();

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { useNetInfo: () => mockNetwork, fetch: () => mockFetch() },
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../src/data/operations', () => ({
  useBookingCleanup: () => ({ mutateAsync: mockMutate, isPending: false }),
}));

const booking: AdminBookingDetailResponse = {
  id: 'cleanup-test',
  createdAt: '2031-03-01T12:34:56.789Z',
  reference: 'SV-CLEANUP-TEST',
  customerName: 'Unit test customer',
  service: 'man-and-van',
  variant: 'standard',
  routeLabel: 'Glasgow to Edinburgh',
  pickupTown: 'Glasgow',
  dropoffTown: 'Edinburgh',
  moveDate: '2031-03-04',
  slot: 'MORNING',
  status: 'PENDING_PAYMENT',
  dispatchStatus: 'UNASSIGNED',
  jobStage: 'NOT_STARTED',
  totalPence: 23456,
  paidPence: 0,
  refundedPence: 0,
  holdExpiresAt: null,
  driver: null,
  capacityUnits: 1,
  blocksSlots: 1,
  contactEmail: 'cleanup@example.test',
  contactPhone: '+447700900111',
  pickup: null,
  dropoff: null,
  customerNotes: null,
  adminNotes: null,
  distanceMiles: 47,
  durationMinutes: 70,
  version: 2,
  van: null,
  payments: [],
  deletedAt: null,
  deletion: { allowed: true, reason: null },
};
const acknowledgement: AdminBookingCleanupResponse = {
  id: booking.id,
  deletedAt: '2031-03-01T12:00:00.000Z',
  version: 3,
  status: 'CANCELLED',
};
const mockAuthenticate = jest.mocked(LocalAuthentication.authenticateAsync);

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) throw new Error('The deferred promise is not ready.');
      resolvePromise(value);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'web');
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockFetch.mockReset().mockResolvedValue({ isConnected: true, isInternetReachable: true });
  mockMutate.mockReset().mockResolvedValue(acknowledgement);
  mockAuthenticate.mockReset().mockResolvedValue({ success: true });
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('booking cleanup confirmation', () => {
  it('opens a named confirmation with the actual job and preserves it when Keep job is chosen', async () => {
    const view = await render(<BookingCleanupActions booking={booking} />);
    expect(view.getByRole('button', { name: 'Delete job' })).toHaveStyle({ height: 48, width: 48 });
    await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
    const dialog = within(view.getByTestId('booking-cleanup-dialog'));
    expect(dialog.getByRole('header', { name: 'Delete this job?' })).toBeTruthy();
    expect(dialog.getByText(booking.reference)).toBeTruthy();
    expect(dialog.getByText(booking.routeLabel)).toBeTruthy();
    expect(dialog.getByText(/record and payment history will stay in Deleted jobs/)).toBeTruthy();
    expect(dialog.getByText(/Restoring brings back the record, not its old checkout/)).toBeTruthy();
    await fireEvent.press(dialog.getByRole('button', { name: 'Keep job' }));
    expect(view.queryByTestId('booking-cleanup-dialog')).toBeNull();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('treats the platform Escape/back dismissal as cancellation', async () => {
    const view = await render(<BookingCleanupActions booking={booking} />);
    await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
    await fireEvent(view.getByLabelText('Delete this job?'), 'requestClose');
    expect(view.queryByTestId('booking-cleanup-dialog')).toBeNull();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('lets an ineligible job explain its server reason without offering a destructive confirmation', async () => {
    const blocked = { ...booking, deletion: { allowed: false, reason: 'A payment is still processing.' } };
    const view = await render(<BookingCleanupActions booking={blocked} />);
    await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
    const dialog = within(view.getByTestId('booking-cleanup-dialog'));
    expect(dialog.getByText('A payment is still processing.')).toBeTruthy();
    expect(dialog.queryByRole('button', { name: 'Delete job' })).toBeNull();
    await fireEvent.press(dialog.getByRole('button', { name: 'Keep job' }));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('submits the exact version once on web and waits for the server acknowledgement before navigation', async () => {
    const pending = deferred<AdminBookingCleanupResponse>();
    mockMutate.mockReturnValueOnce(pending.promise);
    const view = await render(<BookingCleanupActions booking={booking} />);
    await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
    const dialog = within(view.getByTestId('booking-cleanup-dialog'));
    await fireEvent.press(dialog.getByRole('button', { name: 'Delete job' }));
    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
    expect(mockMutate).toHaveBeenCalledWith({ id: booking.id, expectedVersion: 2, operation: 'delete' });
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(dialog.getByRole('button', { name: 'Keep job' })).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Deleting job…' })).toBeDisabled();
    await fireEvent.press(dialog.getByRole('button', { name: 'Deleting job…' }));
    await fireEvent(view.getByLabelText('Delete this job?'), 'requestClose');
    expect(view.getByTestId('booking-cleanup-dialog')).toBeTruthy();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    await act(() => {
      pending.resolve(acknowledgement);
    });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/(app)/bookings',
      params: { view: 'all', notice: 'deleted' },
    });
  });

  it.each([false, null])(
    'disables confirmation when connectivity is explicitly unavailable (%s)',
    async (reachable) => {
      mockNetwork = { isConnected: false, isInternetReachable: reachable };
      const view = await render(<BookingCleanupActions booking={booking} />);
      await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
      const dialog = within(view.getByTestId('booking-cleanup-dialog'));
      expect(dialog.getByRole('alert')).toHaveTextContent(
        "You're offline. Reconnect before changing this job.",
      );
      expect(dialog.getByRole('button', { name: 'Delete job' })).toBeDisabled();
      await fireEvent.press(dialog.getByRole('button', { name: 'Delete job' }));
      expect(mockMutate).not.toHaveBeenCalled();
      expect(mockAuthenticate).not.toHaveBeenCalled();
    },
  );

  it('checks current connectivity after native verification and does not queue an offline deletion', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockFetch.mockResolvedValueOnce({ isConnected: true, isInternetReachable: false });
    const view = await render(<BookingCleanupActions booking={booking} />);
    await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
    const dialog = within(view.getByTestId('booking-cleanup-dialog'));
    await fireEvent.press(dialog.getByRole('button', { name: 'Delete job' }));
    await waitFor(() => {
      expect(dialog.getByRole('alert')).toHaveTextContent(/You're offline\./);
    });
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows canceled native verification, then allows a verified retry without locking the whole app', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockAuthenticate.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    const view = await render(<BookingCleanupActions booking={booking} />);
    await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
    const dialog = within(view.getByTestId('booking-cleanup-dialog'));
    await fireEvent.press(dialog.getByRole('button', { name: 'Delete job' }));
    await waitFor(() => {
      expect(dialog.getByRole('alert')).toHaveTextContent(
        /Verification was not completed\. Nothing changed\./,
      );
    });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockAuthenticate).toHaveBeenCalledWith({
      biometricsSecurityLevel: 'strong',
      cancelLabel: 'Keep job',
      disableDeviceFallback: false,
      promptMessage: `Delete job ${booking.reference}`,
    });
    await fireEvent.press(dialog.getByRole('button', { name: 'Delete job' }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('guards duplicate confirmation before the native prompt resolves', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const pending = deferred<LocalAuthentication.LocalAuthenticationResult>();
    mockAuthenticate.mockReturnValueOnce(pending.promise);
    const view = await render(<BookingCleanupActions booking={booking} />);
    await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
    const dialog = within(view.getByTestId('booking-cleanup-dialog'));
    const confirm = dialog.getByRole('button', { name: 'Delete job' });
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockMutate).not.toHaveBeenCalled();
    await act(() => {
      pending.resolve({ success: true });
    });
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('invalidates an outstanding native prompt when Keep job cancels the dialog', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const pending = deferred<LocalAuthentication.LocalAuthenticationResult>();
    mockAuthenticate.mockReturnValueOnce(pending.promise);
    const view = await render(<BookingCleanupActions booking={booking} />);
    await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
    const dialog = within(view.getByTestId('booking-cleanup-dialog'));
    await fireEvent.press(dialog.getByRole('button', { name: 'Delete job' }));
    expect(dialog.getByRole('button', { name: 'Keep job' })).toBeEnabled();
    await fireEvent.press(dialog.getByRole('button', { name: 'Keep job' }));
    await act(() => {
      pending.resolve({ success: true });
    });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not mutate if the screen unmounts during native verification', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const pending = deferred<LocalAuthentication.LocalAuthenticationResult>();
    mockAuthenticate.mockReturnValueOnce(pending.promise);
    const view = await render(<BookingCleanupActions booking={booking} />);
    await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
    await fireEvent.press(
      within(view.getByTestId('booking-cleanup-dialog')).getByRole('button', { name: 'Delete job' }),
    );
    await view.unmount();
    await act(() => {
      pending.resolve({ success: true });
    });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('preserves a human conflict reason and submits the refreshed version only on an explicit retry', async () => {
    mockMutate.mockRejectedValueOnce(new ApiClientError(409, 'A payment is still processing.'));
    const view = await render(<BookingCleanupActions booking={booking} />);
    await fireEvent.press(view.getByRole('button', { name: 'Delete job' }));
    const dialog = within(view.getByTestId('booking-cleanup-dialog'));
    await fireEvent.press(dialog.getByRole('button', { name: 'Delete job' }));
    await waitFor(() => {
      expect(dialog.getByRole('alert')).toHaveTextContent(
        /A payment is still processing\. The latest details are being checked\./,
      );
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    await view.rerender(<BookingCleanupActions booking={{ ...booking, version: 3 }} />);
    await fireEvent.press(
      within(view.getByTestId('booking-cleanup-dialog')).getByRole('button', { name: 'Delete job' }),
    );
    expect(mockMutate).toHaveBeenLastCalledWith({ id: booking.id, expectedVersion: 3, operation: 'delete' });
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it.each(['delete', 'restore'] as const)(
    'describes an unknown %s outcome without claiming failure or navigating',
    async (operation) => {
      mockMutate.mockRejectedValueOnce(new Error('Mock connection ended after submit.'));
      const record = operation === 'restore' ? { ...booking, deletedAt: acknowledgement.deletedAt } : booking;
      const label = operation === 'restore' ? 'Restore job' : 'Delete job';
      const view = await render(<BookingCleanupActions booking={record} />);
      await fireEvent.press(view.getByRole('button', { name: label }));
      const dialog = within(view.getByTestId('booking-cleanup-dialog'));
      await fireEvent.press(dialog.getByRole('button', { name: label }));
      await waitFor(() => {
        expect(dialog.getByRole('alert')).toHaveTextContent(
          'Could not confirm the result. Close this message and refresh the job before trying again.',
        );
      });
      expect(view.getByTestId('booking-cleanup-dialog')).toBeTruthy();
      expect(router.replace).not.toHaveBeenCalled();
    },
  );

  it('offers restore even when delete eligibility is false and returns to the list only after acknowledgement', async () => {
    const deleted = {
      ...booking,
      deletedAt: acknowledgement.deletedAt,
      deletion: { allowed: false, reason: 'Already deleted.' },
    };
    mockMutate.mockResolvedValueOnce({ ...acknowledgement, deletedAt: null });
    const view = await render(<BookingCleanupActions booking={deleted} />);
    expect(view.queryByRole('button', { name: 'Delete job' })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Restore job' }));
    const dialog = within(view.getByTestId('booking-cleanup-dialog'));
    expect(dialog.getByRole('header', { name: 'Restore this job?' })).toBeTruthy();
    expect(dialog.getByText(/old unpaid checkout will not be reopened/)).toBeTruthy();
    await fireEvent.press(dialog.getByRole('button', { name: 'Restore job' }));
    expect(mockMutate).toHaveBeenCalledWith({ id: booking.id, expectedVersion: 2, operation: 'restore' });
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/(app)/bookings',
      params: { view: 'all', notice: 'restored' },
    });
  });
});
