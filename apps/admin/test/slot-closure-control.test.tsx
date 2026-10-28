import { ApiClientError } from '@sv/api-client';
import type { AdminScheduleSlot, AdminSlotClosureRequest, AdminSlotClosureResponse } from '@sv/contracts';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { SlotClosureControl } from '../src/components/slot-closure-control';

const date = '2031-03-04';
const window: AdminScheduleSlot = {
  slot: 'MORNING',
  capacity: 5,
  configuredCapacity: 5,
  confirmedUnits: 2,
  heldUnits: 0,
  availableUnits: 3,
  manualClosure: null,
  closeAllowed: true,
  closeBlockedReason: null,
};
const closedWindow: AdminScheduleSlot = {
  ...window,
  capacity: 0,
  availableUnits: 0,
  manualClosure: { id: 'closure-test', reason: 'Vehicle maintenance', createdAt: '2031-03-01T10:00:00.000Z' },
};
const acknowledgement: AdminSlotClosureResponse = {
  date,
  generatedAt: '2031-03-01T10:00:00.000Z',
  window: closedWindow,
};
let mockNetwork: { isConnected: boolean | null; isInternetReachable: boolean | null };
const mockFetch = jest.fn<Promise<{ isConnected: boolean; isInternetReachable: boolean }>, []>();
const mockMutate = jest.fn<Promise<AdminSlotClosureResponse>, [AdminSlotClosureRequest]>();
const mockReset = jest.fn();
let mockAuth: {
  status: 'signed-in' | 'idle';
  appLocked: boolean;
  user: { id: string; role: 'ADMIN' | 'OWNER' | 'DRIVER' };
};

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { useNetInfo: () => mockNetwork, fetch: () => mockFetch() },
}));
jest.mock('../src/data/operations', () => ({
  displayAdminDate: (value: string) => value,
  slotLabel: (value: string) => (value === 'MORNING' ? 'Morning' : 'Afternoon'),
  useSlotClosure: () => ({ mutateAsync: mockMutate, reset: mockReset, isPending: false }),
}));
jest.mock('../src/state/auth', () => ({ useAuth: () => mockAuth }));

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
  mockAuth = { status: 'signed-in', appLocked: false, user: { id: 'admin-test', role: 'ADMIN' } };
  mockFetch.mockReset().mockResolvedValue({ isConnected: true, isInternetReachable: true });
  mockMutate.mockReset().mockResolvedValue(acknowledgement);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('manual time-window closure control', () => {
  it.each([
    { label: 'open', record: window, checked: false },
    {
      label: 'full of real bookings',
      record: { ...window, confirmedUnits: 5, availableUnits: 0 },
      checked: false,
    },
    {
      label: 'closed by capacity rules',
      record: {
        ...window,
        capacity: 0,
        configuredCapacity: 0,
        availableUnits: 0,
        closeAllowed: false,
        closeBlockedReason: 'Capacity rules already close this window.',
      },
      checked: false,
    },
    { label: 'manually closed', record: closedWindow, checked: true },
  ])('uses explicit manual-closure state for a $label window', async ({ record, checked }) => {
    const view = await render(<SlotClosureControl date={date} window={record} />);
    const control = view.getByRole('switch', { name: 'Closed to new bookings', checked });
    expect(control).toHaveStyle({ minHeight: 48 });
    expect(mockMutate).not.toHaveBeenCalled();
    if (record.manualClosure) expect(view.getByText('Reason: Vehicle maintenance')).toBeTruthy();
    if (!record.closeAllowed) {
      expect(control).toBeDisabled();
      expect(view.getByText('Capacity rules already close this window.')).toBeTruthy();
    }
  });

  it.each(['press', 'escape'] as const)(
    'cancels a dated, named close confirmation using %s without changing availability',
    async (method) => {
      const view = await render(<SlotClosureControl date={date} window={window} />);
      await fireEvent.press(view.getByRole('switch'));
      const dialog = within(view.getByTestId('slot-closure-dialog'));
      expect(dialog.getByRole('header', { name: 'Close this time window?' })).toBeTruthy();
      expect(dialog.getByText(date)).toBeTruthy();
      expect(dialog.getByText('Morning')).toBeTruthy();
      expect(dialog.getByText(/Existing jobs stay unchanged/)).toBeTruthy();
      expect(dialog.getByText(/checkout in progress must finish/)).toBeTruthy();
      if (method === 'press') await fireEvent.press(dialog.getByRole('button', { name: 'Keep open' }));
      else await fireEvent(view.getByLabelText('Close this time window?'), 'requestClose');
      expect(view.queryByTestId('slot-closure-dialog')).toBeNull();
      expect(view.getByRole('switch', { checked: false })).toBeTruthy();
      expect(mockMutate).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalledTimes(2);
    },
  );

  it('supports Space without scrolling and waits for explicit confirmation', async () => {
    const view = await render(<SlotClosureControl date={date} window={window} />);
    const event = { key: ' ', repeat: false, preventDefault: jest.fn(), stopPropagation: jest.fn() };
    await fireEvent(view.getByRole('switch'), 'keyDown', event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('slot-closure-dialog')).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('requires a trimmed 3–200-character reason and submits the exact date, slot and expected closure', async () => {
    const view = await render(<SlotClosureControl date={date} window={window} />);
    await fireEvent.press(view.getByRole('switch'));
    const dialog = within(view.getByTestId('slot-closure-dialog'));
    const reason = dialog.getByLabelText('Reason for this change');
    expect(reason).toHaveProp('maxLength', 200);
    expect(dialog.getByRole('button', { name: 'Close window' })).toBeDisabled();
    for (const invalid of ['  ', 'ab', 'a'.repeat(201)]) {
      await fireEvent.changeText(reason, invalid);
      await fireEvent(reason, 'blur');
      expect(dialog.getByRole('button', { name: 'Close window' })).toBeDisabled();
      expect(dialog.getByText('Enter a reason between 3 and 200 characters.')).toBeTruthy();
    }
    await fireEvent.changeText(reason, '  Van maintenance  ');
    await fireEvent.press(dialog.getByRole('button', { name: 'Close window' }));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith({
      date,
      slot: 'MORNING',
      closed: true,
      expectedClosureId: null,
      reason: 'Van maintenance',
    });
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
    expect(view.queryByTestId('slot-closure-dialog')).toBeNull();
    expect(view.getByText('Time window manually closed to new bookings.')).toBeTruthy();
    expect(view.getByRole('switch', { checked: false })).toBeTruthy();
    await view.rerender(<SlotClosureControl date={date} window={closedWindow} />);
    expect(view.getByRole('switch', { checked: true })).toBeTruthy();
  });

  it('leaves the switch unchanged and prevents duplicate writes until the server and refresh acknowledge the change', async () => {
    const pending = deferred<AdminSlotClosureResponse>();
    mockMutate.mockReturnValueOnce(pending.promise);
    const view = await render(<SlotClosureControl date={date} window={window} />);
    await fireEvent.press(view.getByRole('switch'));
    const dialog = within(view.getByTestId('slot-closure-dialog'));
    await fireEvent.changeText(dialog.getByLabelText('Reason for this change'), 'Van maintenance');
    const confirm = dialog.getByRole('button', { name: 'Close window' });
    await fireEvent.press(confirm);
    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
    await fireEvent.press(confirm);
    expect(dialog.getByRole('button', { name: 'Closing window…' })).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Keep open' })).toBeDisabled();
    expect(view.getByRole('switch', { checked: false })).toBeDisabled();
    await fireEvent(view.getByLabelText('Close this time window?'), 'requestClose');
    expect(view.getByTestId('slot-closure-dialog')).toBeTruthy();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    await act(() => {
      pending.resolve(acknowledgement);
    });
    expect(view.queryByTestId('slot-closure-dialog')).toBeNull();
  });

  it('removes the specific manual closure and explains that normal rules and occupancy still apply', async () => {
    const record = { ...closedWindow, closeAllowed: false, closeBlockedReason: 'No new closure is needed.' };
    mockMutate.mockResolvedValueOnce({ ...acknowledgement, window });
    const view = await render(<SlotClosureControl date={date} window={record} />);
    expect(view.getByRole('switch', { checked: true })).toBeEnabled();
    await fireEvent.press(view.getByRole('switch'));
    const dialog = within(view.getByTestId('slot-closure-dialog'));
    expect(dialog.getByRole('header', { name: 'Remove this manual closure?' })).toBeTruthy();
    expect(dialog.getByText(/does not guarantee free space/)).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Keep closed' })).toBeEnabled();
    await fireEvent.changeText(dialog.getByLabelText('Reason for this change'), 'Vehicle ready');
    await fireEvent.press(dialog.getByRole('button', { name: 'Remove closure' }));
    expect(mockMutate).toHaveBeenCalledWith({
      date,
      slot: 'MORNING',
      closed: false,
      expectedClosureId: 'closure-test',
      reason: 'Vehicle ready',
    });
    expect(view.getByRole('switch', { checked: true })).toBeTruthy();
    expect(
      view.getByText(
        'Manual closure removed. Capacity rules and existing jobs and holds determine availability.',
      ),
    ).toBeTruthy();
  });

  it('shows the server blocked reason and never opens an unavailable close action', async () => {
    const view = await render(
      <SlotClosureControl
        date={date}
        window={{ ...window, closeAllowed: false, closeBlockedReason: 'A checkout is in progress.' }}
      />,
    );
    expect(view.getByRole('switch')).toBeDisabled();
    expect(view.getByText('A checkout is in progress.')).toBeTruthy();
    await fireEvent.press(view.getByRole('switch'));
    expect(view.queryByTestId('slot-closure-dialog')).toBeNull();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('disables an offline control and rechecks connectivity immediately before sending', async () => {
    mockNetwork = { isConnected: false, isInternetReachable: false };
    const view = await render(<SlotClosureControl date={date} window={window} />);
    expect(view.getByRole('switch')).toBeDisabled();
    expect(view.getByRole('alert')).toHaveTextContent(
      "You're offline. Reconnect before changing this time window.",
    );
    mockNetwork = { isConnected: true, isInternetReachable: true };
    await view.rerender(<SlotClosureControl date={date} window={window} />);
    await fireEvent.press(view.getByRole('switch'));
    const dialog = within(view.getByTestId('slot-closure-dialog'));
    await fireEvent.changeText(dialog.getByLabelText('Reason for this change'), 'Van maintenance');
    mockFetch.mockResolvedValueOnce({ isConnected: true, isInternetReachable: false });
    await fireEvent.press(dialog.getByRole('button', { name: 'Close window' }));
    expect(dialog.getByRole('alert')).toHaveTextContent(
      "You're offline. Reconnect before changing this time window.",
    );
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'signed out', status: 'idle' as const, appLocked: false, role: 'ADMIN' as const },
    { label: 'locked', status: 'signed-in' as const, appLocked: true, role: 'OWNER' as const },
    { label: 'driver', status: 'signed-in' as const, appLocked: false, role: 'DRIVER' as const },
  ])('disables closure changes while $label', async ({ status, appLocked, role }) => {
    mockAuth = { status, appLocked, user: { id: 'test-actor', role } };
    const view = await render(<SlotClosureControl date={date} window={window} />);
    expect(view.getByRole('switch')).toBeDisabled();
    await fireEvent.press(view.getByRole('switch'));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('allows both admin and owner but rechecks a lock that appears during network preflight', async () => {
    mockAuth.user.role = 'OWNER';
    const connection = deferred<{ isConnected: boolean; isInternetReachable: boolean }>();
    mockFetch.mockReturnValueOnce(connection.promise);
    const view = await render(<SlotClosureControl date={date} window={window} />);
    expect(view.getByRole('switch')).toBeEnabled();
    await fireEvent.press(view.getByRole('switch'));
    const dialog = within(view.getByTestId('slot-closure-dialog'));
    await fireEvent.changeText(dialog.getByLabelText('Reason for this change'), 'Van maintenance');
    await fireEvent.press(dialog.getByRole('button', { name: 'Close window' }));
    mockAuth = { ...mockAuth, appLocked: true };
    await view.rerender(<SlotClosureControl date={date} window={window} />);
    await act(() => {
      connection.resolve({ isConnected: true, isInternetReachable: true });
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('preserves a safe conflict reason and never flips the switch on rejection', async () => {
    mockMutate.mockRejectedValueOnce(new ApiClientError(409, 'A checkout is now in progress.'));
    const view = await render(<SlotClosureControl date={date} window={window} />);
    await fireEvent.press(view.getByRole('switch'));
    const dialog = within(view.getByTestId('slot-closure-dialog'));
    await fireEvent.changeText(dialog.getByLabelText('Reason for this change'), 'Van maintenance');
    await fireEvent.press(dialog.getByRole('button', { name: 'Close window' }));
    expect(dialog.getByRole('alert')).toHaveTextContent(
      /A checkout is now in progress\. The latest availability is being checked\./,
    );
    expect(view.getByRole('switch', { checked: false })).toBeTruthy();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    await view.rerender(
      <SlotClosureControl
        date={date}
        window={{ ...window, closeAllowed: false, closeBlockedReason: 'A checkout is now in progress.' }}
      />,
    );
    expect(
      within(view.getByTestId('slot-closure-dialog')).getByRole('button', { name: 'Close window' }),
    ).toBeDisabled();
  });

  it('treats a lost submission response as unknown and requires leaving the dialog before trying again', async () => {
    mockMutate.mockRejectedValueOnce(new Error('Test response lost.'));
    const view = await render(<SlotClosureControl date={date} window={window} />);
    await fireEvent.press(view.getByRole('switch'));
    const dialog = within(view.getByTestId('slot-closure-dialog'));
    await fireEvent.changeText(dialog.getByLabelText('Reason for this change'), 'Van maintenance');
    await fireEvent.press(dialog.getByRole('button', { name: 'Close window' }));
    expect(dialog.getByRole('alert')).toHaveTextContent(
      'Could not confirm the result. Close this message and refresh the schedule before trying again.',
    );
    expect(dialog.getByRole('button', { name: 'Close window' })).toBeDisabled();
    expect(view.getByRole('switch', { checked: false })).toBeTruthy();
  });

  it.each(['cancel', 'date', 'slot', 'unmount'] as const)(
    'invalidates a pending preflight on %s without sending a mutation',
    async (action) => {
      const connection = deferred<{ isConnected: boolean; isInternetReachable: boolean }>();
      mockFetch.mockReturnValueOnce(connection.promise);
      const view = await render(<SlotClosureControl date={date} window={window} />);
      await fireEvent.press(view.getByRole('switch'));
      const dialog = within(view.getByTestId('slot-closure-dialog'));
      await fireEvent.changeText(dialog.getByLabelText('Reason for this change'), 'Van maintenance');
      await fireEvent.press(dialog.getByRole('button', { name: 'Close window' }));
      if (action === 'cancel') await fireEvent.press(dialog.getByRole('button', { name: 'Keep open' }));
      if (action === 'date') await view.rerender(<SlotClosureControl date="2031-03-05" window={window} />);
      if (action === 'slot')
        await view.rerender(<SlotClosureControl date={date} window={{ ...window, slot: 'AFTERNOON' }} />);
      if (action === 'unmount') await view.unmount();
      await act(() => {
        connection.resolve({ isConnected: true, isInternetReachable: true });
      });
      expect(mockMutate).not.toHaveBeenCalled();
    },
  );

  it('does not send a stale closure ID if server state changes during confirmation', async () => {
    const connection = deferred<{ isConnected: boolean; isInternetReachable: boolean }>();
    mockFetch.mockReturnValueOnce(connection.promise);
    const view = await render(<SlotClosureControl date={date} window={window} />);
    await fireEvent.press(view.getByRole('switch'));
    const dialog = within(view.getByTestId('slot-closure-dialog'));
    await fireEvent.changeText(dialog.getByLabelText('Reason for this change'), 'Van maintenance');
    await fireEvent.press(dialog.getByRole('button', { name: 'Close window' }));
    await view.rerender(<SlotClosureControl date={date} window={closedWindow} />);
    await act(() => {
      connection.resolve({ isConnected: true, isInternetReachable: true });
    });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(
      within(view.getByTestId('slot-closure-dialog')).getByRole('button', { name: 'Close window' }),
    ).toBeDisabled();
  });
});
