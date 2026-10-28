import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@sv/api-client';
import { router } from 'expo-router';
import type { DriverCreateRequest, DriverCreateResponse } from '@sv/contracts';
import type * as ReactModule from 'react';
import AddDriverScreen from '../app/(app)/drivers/add';

const mockAddDriver = jest.fn<Promise<DriverCreateResponse>, [DriverCreateRequest]>();
let mockPending = false;
let mockOffline = false;
let mockLocked = false;
let mockActorId = 'test-admin';
let mockFocusCleanup: (() => void) | undefined;

jest.mock('../src/data/drivers', () => ({
  useAddDriver: () => ({
    addDriver: mockAddDriver,
    isPending: mockPending,
    offline: mockOffline,
    authorized: !mockLocked,
  }),
}));
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({ status: 'signed-in', appLocked: mockLocked, user: { id: mockActorId } }),
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useFocusEffect: (effect: () => () => void) => {
    const { useEffect } = jest.requireActual<typeof ReactModule>('react');
    useEffect(() => {
      mockFocusCleanup = effect();
      return mockFocusCleanup;
    }, [effect]);
  },
}));

async function fill(view: Awaited<ReturnType<typeof render>>): Promise<void> {
  await fireEvent.changeText(view.getByLabelText('Email'), ' Driver@Example.Test ');
  await fireEvent.changeText(view.getByLabelText('Password'), '  Test-only driver password  ');
  await fireEvent.changeText(view.getByLabelText('Phone number'), '+44 7700 900123');
}

describe('Add driver screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPending = false;
    mockOffline = false;
    mockLocked = false;
    mockActorId = 'test-admin';
    mockFocusCleanup = undefined;
    mockAddDriver.mockResolvedValue({ id: 'test-driver-created', ok: true });
  });

  it('offers exactly the three requested fields with a protected password and an accessible reveal control', async () => {
    const view = await render(<AddDriverScreen />);
    expect(view.getByLabelText('Email')).toBeTruthy();
    expect(view.getByLabelText('Phone number')).toBeTruthy();
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    expect(view.getByRole('button', { name: 'Add driver' })).toBeDisabled();
    expect(view.queryByLabelText('Name')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Show password' }));
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', false);
    await fireEvent.press(view.getByRole('button', { name: 'Hide password' }));
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
  });

  it('announces validation failures before attempting account creation', async () => {
    const view = await render(<AddDriverScreen />);
    await fireEvent.changeText(view.getByLabelText('Email'), 'invalid');
    await fireEvent.changeText(view.getByLabelText('Password'), 'short');
    await fireEvent.changeText(view.getByLabelText('Phone number'), 'abc');
    await fireEvent.press(view.getByRole('button', { name: 'Add driver' }));
    expect(view.getByText('Enter a valid email address.')).toBeTruthy();
    expect(view.getByText('Use a password between 12 and 1,024 characters.')).toBeTruthy();
    expect(view.getByText('Enter a valid phone number.')).toBeTruthy();
    expect(mockAddDriver).not.toHaveBeenCalled();
  });

  it('creates an active account with the exact password, removes all form credentials and opens the acknowledged driver', async () => {
    const view = await render(<AddDriverScreen />);
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Add driver' }));
    await waitFor(() => {
      expect(view.getByText('Driver added')).toBeTruthy();
    });
    expect(mockAddDriver).toHaveBeenCalledWith({
      email: 'driver@example.test',
      password: '  Test-only driver password  ',
      phone: '+447700900123',
    });
    expect(view.queryByLabelText('Password')).toBeNull();
    expect(view.queryByText('  Test-only driver password  ')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Open driver' }));
    expect(router.replace).toHaveBeenCalledWith('/(app)/drivers/test-driver-created');
    await fireEvent.press(view.getByRole('button', { name: 'Add another driver' }));
    expect(view.getByLabelText('Password')).toHaveDisplayValue('');
    expect(view.getByLabelText('Email')).toHaveDisplayValue('');
    expect(view.getByLabelText('Phone number')).toHaveDisplayValue('');
  });

  it('shows duplicate-account errors and preserves editable fields for correction', async () => {
    mockAddDriver.mockRejectedValueOnce(new ApiClientError(409, 'An account exists.'));
    const view = await render(<AddDriverScreen />);
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Add driver' }));
    await waitFor(() => {
      expect(view.getByRole('alert')).toHaveTextContent(/An account already uses this email\./u);
    });
    expect(view.getByLabelText('Password')).toHaveDisplayValue('  Test-only driver password  ');
    expect(view.getByRole('button', { name: 'Add driver' })).toBeEnabled();
    await fireEvent.changeText(view.getByLabelText('Email'), 'other@example.test');
    expect(view.queryByRole('alert')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Add driver' }));
    await waitFor(() => {
      expect(view.getByText('Driver added')).toBeTruthy();
    });
  });

  it('disables submissions while offline and allows retry after reconnecting', async () => {
    mockOffline = true;
    const view = await render(<AddDriverScreen />);
    await fill(view);
    expect(view.getByRole('alert')).toHaveTextContent(/You’re offline\./u);
    expect(view.getByRole('button', { name: 'Add driver' })).toBeDisabled();
    expect(mockAddDriver).not.toHaveBeenCalled();
    mockOffline = false;
    await view.rerender(<AddDriverScreen />);
    expect(view.getByRole('button', { name: 'Add driver' })).toBeEnabled();
  });

  it('locks all inputs and actions during a pending request', async () => {
    mockPending = true;
    const view = await render(<AddDriverScreen />);
    for (const label of ['Email', 'Password', 'Phone number'])
      expect(view.getByLabelText(label)).toHaveProp('editable', false);
    expect(view.getByRole('button', { name: 'Adding driver…' })).toBeDisabled();
    expect(view.getByRole('button', { name: 'Show password' })).toBeDisabled();
    expect(view.getByRole('button', { name: 'Back to drivers' })).toBeDisabled();
  });

  it.each(['blur', 'lock', 'account-change'])('clears credentials after %s', async (change) => {
    const view = await render(<AddDriverScreen />);
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Show password' }));
    if (change === 'blur')
      await act(() => {
        mockFocusCleanup?.();
      });
    else {
      if (change === 'lock') mockLocked = true;
      else mockActorId = 'another-admin';
      await view.rerender(<AddDriverScreen />);
    }
    expect(view.getByLabelText('Password')).toHaveDisplayValue('');
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    expect(view.getByLabelText('Email')).toHaveDisplayValue('');
    expect(view.getByLabelText('Phone number')).toHaveDisplayValue('');
  });

  it('does not surface a late creation result after leaving the form', async () => {
    let resolveRequest: ((value: DriverCreateResponse) => void) | undefined;
    mockAddDriver.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const view = await render(<AddDriverScreen />);
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Add driver' }));
    await act(() => {
      mockFocusCleanup?.();
    });
    await act(async () => {
      if (!resolveRequest) throw new Error('The test request was not created.');
      resolveRequest({ id: 'test-driver-created', ok: true });
      await Promise.resolve();
    });
    expect(view.queryByText('Driver added')).toBeNull();
    expect(view.getByLabelText('Password')).toHaveDisplayValue('');
  });

  it('clears credentials before returning to the driver directory', async () => {
    const view = await render(<AddDriverScreen />);
    await fill(view);
    await fireEvent.press(view.getByRole('button', { name: 'Back to drivers' }));
    expect(router.replace).toHaveBeenCalledWith('/(app)/drivers');
    expect(view.getByLabelText('Password')).toHaveDisplayValue('');
  });
});
