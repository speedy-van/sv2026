import { ApiClientError } from '@sv/api-client';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import EditBookingScreen from '../app/(app)/edit-booking';
import { bookingEditCopy } from '../src/content/booking-edit';
import type { BookingEditMutation, BookingEditorData } from '../src/data/booking-editor';
import {
  editAssignment,
  editBooking,
  editCalendar,
  editCatalogue,
  editContext,
  editMovePreview,
  editSchedulePreview,
} from './booking-editor-fixtures';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'booking-one' }),
}));
jest.mock('../src/data/booking-editor', () => ({ useBookingEditor: () => mockEditor }));
const mockSave = jest.fn<Promise<{ ok: true; id: string; version: number }>, [BookingEditMutation]>();
const mockPreviewMove = jest.fn<
  ReturnType<BookingEditorData['previewMove']['mutateAsync']>,
  Parameters<BookingEditorData['previewMove']['mutateAsync']>
>(() => Promise.resolve(editMovePreview));
const mockPreviewDate = jest.fn(() => Promise.resolve(editSchedulePreview));
const mockSessionIdentity = {};
const mockLookup = jest.fn(() =>
  Promise.resolve({ postcode: 'G1 1AB', town: 'Glasgow', lat: 55.86, lng: -4.25 }),
);
function query<T>(data: T | undefined) {
  return {
    data,
    isPending: !data,
    isError: false,
    isRefetching: false,
    isFetching: false,
    refetch: jest.fn(() => Promise.resolve({ data, isError: false })),
  };
}
function editor() {
  return {
    sessionIdentity: mockSessionIdentity,
    actorId: 'admin-one',
    owner: false,
    privateReady: true,
    enabled: true,
    offline: false,
    context: query(editContext),
    booking: query(editBooking),
    catalogue: query(editCatalogue),
    calendar: query(editCalendar),
    assignment: query(editAssignment),
    save: { mutateAsync: mockSave, isPending: false, reset: jest.fn() },
    previewMove: { mutateAsync: mockPreviewMove, isPending: false, reset: jest.fn() },
    previewSchedule: { mutateAsync: mockPreviewDate, isPending: false, reset: jest.fn() },
    lookupPostcode: mockLookup,
  };
}
let mockEditor = editor();
beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockReset().mockResolvedValue({ ok: true, id: 'booking-one', version: 8 });
  mockPreviewMove.mockReset().mockResolvedValue(editMovePreview);
  mockEditor = editor();
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('saves contact changes with the displayed version and warns about changed customer links', async () => {
  const view = await render(<EditBookingScreen />);
  expect(view.getByRole('button', { name: 'Save contact and notes' })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText('Contact email'), 'changed@example.test');
  await fireEvent.changeText(view.getByLabelText('Internal notes'), 'Call before arrival');
  expect(view.getByText(bookingEditCopy.emailWarning)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Save contact and notes' }));
  expect(mockSave).toHaveBeenCalledWith({
    operation: 'details',
    input: {
      expectedVersion: 7,
      contact: { ...editContext.contact, email: 'changed@example.test' },
      notes: 'Call before arrival',
    },
  });
  expect(view.getByText('Booking updated')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'View updated booking' }));
  expect(router.replace).toHaveBeenCalledWith('/(app)/bookings/booking-one');
});

it('keeps the draft on conflict, blocks overwriting, and replaces it only on explicit reload', async () => {
  const view = await render(<EditBookingScreen />);
  await fireEvent.changeText(view.getByLabelText('Contact name'), 'Unsaved new name');
  mockSave.mockRejectedValueOnce(new ApiClientError(409, 'Version changed'));
  await fireEvent.press(view.getByRole('button', { name: 'Save contact and notes' }));
  expect(view.getByLabelText('Contact name').props.value).toBe('Unsaved new name');
  expect(view.getByRole('button', { name: 'Save contact and notes' })).toBeDisabled();
  mockEditor.context.refetch.mockResolvedValue({
    data: { ...editContext, version: 8, contact: { ...editContext.contact, name: 'Server name' } },
    isError: false,
  });
  mockEditor.booking.refetch.mockResolvedValue({ data: { ...editBooking, version: 8 }, isError: false });
  mockEditor.context.data = {
    ...editContext,
    version: 8,
    contact: { ...editContext.contact, name: 'Server name' },
  };
  await view.rerender(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('button', { name: 'Refresh' }));
  expect(view.getByLabelText('Contact name').props.value).toBe('Server name');
});

it('keeps a draft when background refresh reports a newer version and confirms before changing sections', async () => {
  const view = await render(<EditBookingScreen />);
  await fireEvent.changeText(view.getByLabelText('Internal notes'), 'Keep this draft');
  mockEditor.context.data = { ...editContext, version: 8 };
  await view.rerender(<EditBookingScreen />);
  expect(view.getByLabelText('Internal notes').props.value).toBe('Keep this draft');
  expect(view.getByRole('button', { name: 'Save contact and notes' })).toBeDisabled();
  await fireEvent.press(view.getByRole('tab', { name: 'Driver' }));
  expect(view.getByText('Discard unsaved changes?')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Keep editing' }));
  expect(view.getByLabelText('Internal notes').props.value).toBe('Keep this draft');
});

it('requires price preview, uses the server settlement amount, and invalidates it after changing extras', async () => {
  const view = await render(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Move & price' }));
  expect(view.queryByRole('button', { name: 'Save and send payment link' })).toBeNull();
  await fireEvent.changeText(view.getByLabelText('Reason for move changes'), 'Extra packing requested');
  await fireEvent.press(view.getByRole('button', { name: 'Check the new price' }));
  expect(view.getByText('Send a payment link for £80.00.')).toBeTruthy();
  await fireEvent(view.getByLabelText('Packing'), 'valueChange', true);
  expect(view.queryByRole('button', { name: 'Save and send payment link' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Check the new price' }));
  await fireEvent.press(view.getByRole('button', { name: 'Save and send payment link' }));
  const saved = mockSave.mock.calls[0]?.[0];
  expect(saved?.operation).toBe('move');
  if (saved?.operation !== 'move') throw new Error('Expected a move update');
  expect(saved.input).toMatchObject({
    expectedVersion: 7,
    expectedTotalPence: 23000,
    expectedSettlementPence: 8000,
    settle: 'EXTRA_CHARGE',
  });
  expect(saved.input.changes.addons).toEqual({ helpers: 0, packing: true, assembly: false });
});

it('verifies a changed postcode before allowing a route preview', async () => {
  const view = await render(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Move & price' }));
  await fireEvent.changeText(view.getByLabelText('Pickup postcode'), 'G1 1AB');
  expect(view.getByRole('button', { name: 'Check the new price' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Verify pickup address' }));
  expect(mockLookup).toHaveBeenCalledWith('G1 1AB');
  expect(view.getByRole('button', { name: 'Check the new price' })).toBeEnabled();
  await fireEvent.press(view.getByRole('button', { name: 'Check the new price' }));
  expect(mockPreviewMove.mock.calls[0]?.[0].changes.pickup).toMatchObject({
    postcode: 'G1 1AB',
    lat: 55.86,
    lng: -4.25,
    source: 'MANUAL',
  });
});

it('previews date changes, exposes availability, and explains driver removal before applying', async () => {
  const view = await render(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Date & time' }));
  await fireEvent.press(view.getByRole('button', { name: 'Thursday 16 October' }));
  expect(view.getByRole('button', { name: 'Afternoon 12pm–4pm' })).toBeDisabled();
  expect(view.queryByLabelText('Override capacity')).toBeNull();
  await fireEvent.changeText(view.getByLabelText('Reason for date change'), 'Customer requested Thursday');
  await fireEvent.press(view.getByRole('button', { name: 'Check the date change' }));
  expect(
    view.getByText(
      'Changing the date will remove the current driver assignment. Assign a driver again after saving.',
    ),
  ).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Save new date and time' }));
  expect(mockSave).toHaveBeenCalledWith({
    operation: 'schedule',
    input: {
      expectedVersion: 7,
      date: '2031-10-16',
      slot: 'MORNING',
      priceMode: 'KEEP_PRICE',
      reason: 'Customer requested Thursday',
      expectedTotalPence: 21000,
      expectedSettlementPence: 0,
      settle: 'NONE',
    },
  });
});

it('assigns a real available driver and van while disabling unavailable drivers', async () => {
  const view = await render(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Driver' }));
  expect(view.getByRole('button', { name: 'Busy driver' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Available driver' }));
  await fireEvent.press(view.getByRole('button', { name: 'Assign driver and van' }));
  expect(mockSave).toHaveBeenCalledWith({
    operation: 'assign',
    input: { expectedVersion: 7, driverId: 'driver-one', vanId: 'van-one', mode: 'DIRECT' },
  });
});

it('disables saving offline, hides private fields on lock, and ignores a late save response', async () => {
  const view = await render(<EditBookingScreen />);
  await fireEvent.changeText(view.getByLabelText('Contact name'), 'New name');
  mockEditor.offline = true;
  mockEditor.enabled = false;
  await view.rerender(<EditBookingScreen />);
  expect(view.getByText(bookingEditCopy.offline)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Save contact and notes' })).toBeDisabled();
  mockEditor.offline = false;
  mockEditor.enabled = true;
  await view.rerender(<EditBookingScreen />);
  let finish: ((result: { ok: true; id: string; version: number }) => void) | undefined;
  mockSave.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Save contact and notes' }));
  mockEditor.privateReady = false;
  mockEditor.enabled = false;
  await view.rerender(<EditBookingScreen />);
  expect(view.queryByLabelText('Contact email')).toBeNull();
  await act(() => {
    finish?.({ ok: true, id: 'booking-one', version: 8 });
  });
  expect(view.queryByText('Booking updated')).toBeNull();
  expect(router.replace).not.toHaveBeenCalled();
});

it('requires device confirmation before applying a refund', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest
    .mocked(LocalAuthentication.authenticateAsync)
    .mockResolvedValueOnce({ success: false, error: 'user_cancel' });
  mockPreviewMove.mockResolvedValue({ ...editMovePreview, settle: 'REFUND', settlementAmountPence: 1000 });
  const view = await render(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Move & price' }));
  await fireEvent.changeText(view.getByLabelText('Reason for move changes'), 'Customer removed items');
  await fireEvent.press(view.getByRole('button', { name: 'Check the new price' }));
  await fireEvent.press(view.getByRole('button', { name: 'Save and refund £10.00' }));
  await waitFor(() => {
    expect(view.getByText('Refund confirmation was cancelled. No changes were sent.')).toBeTruthy();
  });
  expect(mockSave).not.toHaveBeenCalled();
});

it('resumes a confirmed refund after native Face ID temporarily deactivates the editor', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  let confirm: ((value: LocalAuthentication.LocalAuthenticationResult) => void) | undefined;
  jest.mocked(LocalAuthentication.authenticateAsync).mockReturnValueOnce(
    new Promise((resolve) => {
      confirm = resolve;
    }),
  );
  mockPreviewMove.mockResolvedValue({ ...editMovePreview, settle: 'REFUND', settlementAmountPence: 1000 });
  const view = await render(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Move & price' }));
  await fireEvent.changeText(view.getByLabelText('Reason for move changes'), 'Customer removed items');
  await fireEvent.press(view.getByRole('button', { name: 'Check the new price' }));
  await fireEvent.press(view.getByRole('button', { name: 'Save and refund £10.00' }));
  mockEditor.enabled = false;
  await view.rerender(<EditBookingScreen />);
  await act(() => {
    confirm?.({ success: true });
  });
  expect(mockSave).not.toHaveBeenCalled();
  mockEditor.enabled = true;
  await view.rerender(<EditBookingScreen />);
  await waitFor(() => {
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
  expect(view.getByText('Booking updated')).toBeTruthy();
});

it.each(['identity', 'version'] as const)(
  'does not apply a refund if the %s changes during device confirmation',
  async (change) => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    let confirm: ((value: LocalAuthentication.LocalAuthenticationResult) => void) | undefined;
    jest.mocked(LocalAuthentication.authenticateAsync).mockReturnValueOnce(
      new Promise((resolve) => {
        confirm = resolve;
      }),
    );
    mockPreviewMove.mockResolvedValue({ ...editMovePreview, settle: 'REFUND', settlementAmountPence: 1000 });
    const view = await render(<EditBookingScreen />);
    await fireEvent.press(view.getByRole('tab', { name: 'Move & price' }));
    await fireEvent.changeText(view.getByLabelText('Reason for move changes'), 'Customer removed items');
    await fireEvent.press(view.getByRole('button', { name: 'Check the new price' }));
    await fireEvent.press(view.getByRole('button', { name: 'Save and refund £10.00' }));
    if (change === 'identity') mockEditor.sessionIdentity = {};
    else mockEditor.context.data = { ...editContext, version: 8 };
    await view.rerender(<EditBookingScreen />);
    await act(() => {
      confirm?.({ success: true });
    });
    expect(mockSave).not.toHaveBeenCalled();
    expect(view.queryByText('Booking updated')).toBeNull();
  },
);

it('provides loading, error and retry states without displaying private fields', async () => {
  mockEditor.context.data = undefined;
  mockEditor.context.isPending = true;
  mockEditor.booking.data = undefined;
  mockEditor.booking.isPending = true;
  const view = await render(<EditBookingScreen />);
  expect(view.getByTestId('screen-skeleton')).toBeTruthy();
  expect(view.queryByLabelText('Contact email')).toBeNull();
  mockEditor.context.isPending = false;
  mockEditor.context.isError = true;
  mockEditor.booking.isPending = false;
  mockEditor.booking.isError = true;
  await view.rerender(<EditBookingScreen />);
  expect(view.getByText(bookingEditCopy.loadError)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  expect(mockEditor.context.refetch).toHaveBeenCalledTimes(1);
  expect(mockEditor.booking.refetch).toHaveBeenCalledTimes(1);
});

it('requires reload after an uncertain save while preserving the draft', async () => {
  mockSave.mockRejectedValueOnce(new Error('Connection dropped'));
  const view = await render(<EditBookingScreen />);
  await fireEvent.changeText(view.getByLabelText('Contact name'), 'My unsaved name');
  await fireEvent.press(view.getByRole('button', { name: 'Save contact and notes' }));
  expect(view.getByLabelText('Contact name').props.value).toBe('My unsaved name');
  expect(view.getAllByText(bookingEditCopy.uncertain).length).toBeGreaterThan(0);
  expect(view.getByRole('button', { name: 'Save contact and notes' })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Refresh' })).toBeTruthy();
});

it('removes an earlier preview when a fresh price request fails', async () => {
  const view = await render(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Move & price' }));
  await fireEvent.changeText(view.getByLabelText('Reason for move changes'), 'Updated inventory');
  await fireEvent.press(view.getByRole('button', { name: 'Check the new price' }));
  expect(view.getByRole('button', { name: 'Save and send payment link' })).toBeTruthy();
  mockPreviewMove.mockRejectedValueOnce(new ApiClientError(400, 'The selected move cannot be priced.'));
  await fireEvent.press(view.getByRole('button', { name: 'Check the new price' }));
  expect(view.getByText('The selected move cannot be priced.')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Save and send payment link' })).toBeNull();
});

it('sends updated quantities and custom items in the preview instead of a client-computed price', async () => {
  const view = await render(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Move & price' }));
  await fireEvent.changeText(view.getByLabelText('Quantity of Test sofa'), '2');
  await fireEvent.changeText(view.getByLabelText('Custom item name'), 'Large test box');
  await fireEvent.press(view.getByRole('button', { name: 'Add custom item' }));
  await fireEvent.press(view.getByRole('button', { name: 'Check the new price' }));
  expect(mockPreviewMove.mock.calls[0]?.[0].changes.items).toEqual([
    { kind: 'catalogue', itemSlug: 'sofa', quantity: 2 },
    { kind: 'custom', name: 'Large test box', size: 'M', quantity: 1 },
  ]);
});

it('shows empty assignment options and keeps assignment disabled', async () => {
  mockEditor.assignment.data = { ...editAssignment, drivers: [], vans: [] };
  const view = await render(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Driver' }));
  expect(
    view.getByText('No drivers are available. Add or activate a driver before assigning this booking.'),
  ).toBeTruthy();
  expect(view.getByText('No active vans are available for this slot.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Assign driver and van' })).toBeDisabled();
});

it('removes an assignment only after a reason is entered', async () => {
  mockEditor.booking.data = {
    ...editBooking,
    driver: { id: 'driver-one', name: 'Available driver' },
    dispatchStatus: 'ACCEPTED',
  };
  const view = await render(<EditBookingScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Driver' }));
  expect(view.getByRole('button', { name: 'Remove assignment and offers' })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText('Reason for removing assignment'), 'Driver unavailable');
  await fireEvent.press(view.getByRole('button', { name: 'Remove assignment and offers' }));
  expect(mockSave).toHaveBeenCalledWith({
    operation: 'unassign',
    input: { expectedVersion: 7, reason: 'Driver unavailable' },
  });
});
