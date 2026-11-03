import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@sv/api-client';
import { router } from 'expo-router';
import type * as IconMocks from './lucide-react-native.mock';
import SignInScreen from '../app/(auth)/sign-in';
import CodeScreen from '../app/(auth)/code';
import { AppLockGate } from '../src/components/app-lock-gate';

const mockAuth = {
  requestCode: jest.fn<Promise<void>, [string]>(),
  signInWithCode: jest.fn<Promise<void>, [string, string]>(),
  signInWithPassword: jest.fn<Promise<void>, [string, string]>(),
  signOutWarning: null as string | null,
  status: 'idle' as 'idle' | 'signed-in' | 'submitting',
  unlock: jest.fn<Promise<boolean>, []>(),
};

jest.mock('../src/state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ email: 'staff@example.test' }),
}));
jest.mock('lucide-react-native', () => {
  const icons = jest.requireActual<typeof IconMocks>('./lucide-react-native.mock');
  return { ...icons, LockKeyhole: icons.AlertCircle, Mail: icons.AlertCircle };
});

beforeEach(() => {
  jest.resetAllMocks();
  mockAuth.status = 'idle';
  mockAuth.signOutWarning = null;
  mockAuth.requestCode.mockResolvedValue(undefined);
  mockAuth.signInWithCode.mockResolvedValue(undefined);
  mockAuth.signInWithPassword.mockResolvedValue(undefined);
  mockAuth.unlock.mockResolvedValue(true);
});

describe('admin authentication screens without external requests', () => {
  it('shows the sign-out warning and keeps incomplete sign-in disabled', async () => {
    mockAuth.signOutWarning = 'Signed out on this device. The server could not confirm session revocation.';
    const view = await render(<SignInScreen />);
    expect(view.getByRole('alert')).toHaveTextContent(
      'Signed out on this device. The server could not confirm session revocation.',
    );
    expect(view.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(view.getByLabelText('Email')).toBeTruthy();
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('preserves exact password input and navigates only after password sign-in succeeds', async () => {
    const view = await render(<SignInScreen />);
    await fireEvent.changeText(view.getByLabelText('Email'), 'staff@example.test');
    await fireEvent.changeText(view.getByLabelText('Password'), '  Test-owned password  ');
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/(app)/today');
    });
    expect(mockAuth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith('staff@example.test', '  Test-owned password  ');
    expect(view.getByLabelText('Password')).toHaveDisplayValue('');
    expect(mockAuth.requestCode).not.toHaveBeenCalled();
  });

  it('announces a rejected password and leaves the form usable for correction', async () => {
    mockAuth.signInWithPassword.mockRejectedValueOnce(new ApiClientError(401, 'Invalid email or password.'));
    const view = await render(<SignInScreen />);
    await fireEvent.changeText(view.getByLabelText('Email'), 'staff@example.test');
    await fireEvent.changeText(view.getByLabelText('Password'), 'Test-owned password');
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(view.getByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    });
    expect(view.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(view.getByLabelText('Password')).toHaveDisplayValue('Test-owned password');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('clears the password when changing methods and enters code verification only after a successful code request', async () => {
    const view = await render(<SignInScreen />);
    await fireEvent.changeText(view.getByLabelText('Email'), 'staff@example.test');
    await fireEvent.changeText(view.getByLabelText('Password'), 'Test-owned password');
    await fireEvent.press(view.getByRole('button', { name: 'Show password' }));
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', false);
    await fireEvent.press(view.getByRole('tab', { name: 'Email code' }));
    expect(view.queryByLabelText('Password')).toBeNull();
    await fireEvent.press(view.getByRole('tab', { name: 'Use password' }));
    expect(view.getByLabelText('Password')).toHaveDisplayValue('');
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    await fireEvent.press(view.getByRole('tab', { name: 'Email code' }));
    await fireEvent.press(view.getByRole('button', { name: 'Send code' }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/(auth)/code',
        params: { email: 'staff@example.test' },
      });
    });
    expect(mockAuth.requestCode).toHaveBeenCalledTimes(1);
    expect(mockAuth.requestCode).toHaveBeenCalledWith('staff@example.test');
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('keeps all sign-in fields and method controls disabled while submitting', async () => {
    mockAuth.status = 'submitting';
    const view = await render(<SignInScreen />);
    expect(view.getByLabelText('Email')).toHaveProp('editable', false);
    expect(view.getByLabelText('Password')).toHaveProp('editable', false);
    expect(view.getByRole('tab', { name: 'Email code' })).toBeDisabled();
    expect(view.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(mockAuth.requestCode).not.toHaveBeenCalled();
  });

  it('requires six code characters and preserves server errors with a working retry', async () => {
    mockAuth.signInWithCode.mockRejectedValueOnce(new ApiClientError(401, 'Invalid or expired code.'));
    const view = await render(<CodeScreen />);
    expect(view.getByRole('button', { name: 'Verify code' })).toBeDisabled();
    await fireEvent.changeText(view.getByLabelText('Code'), '12345');
    expect(view.getByRole('button', { name: 'Verify code' })).toBeDisabled();
    await fireEvent.changeText(view.getByLabelText('Code'), '123456');
    await fireEvent.press(view.getByRole('button', { name: 'Verify code' }));
    await waitFor(() => {
      expect(view.getByRole('alert')).toHaveTextContent(
        'This code is invalid or has expired. Request a new code.',
      );
    });
    expect(router.replace).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: 'Verify code' }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/(app)/today');
    });
    expect(mockAuth.signInWithCode).toHaveBeenLastCalledWith('staff@example.test', '123456');
  });

  it('can return from code entry without sending another code', async () => {
    const view = await render(<CodeScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Back to sign in' }));
    expect(router.replace).toHaveBeenCalledWith('/(auth)/sign-in');
    expect(mockAuth.requestCode).not.toHaveBeenCalled();
    expect(mockAuth.signInWithCode).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'rejected'])('keeps native lock failures recoverable (%s)', async (outcome) => {
    if (outcome === 'cancelled') mockAuth.unlock.mockResolvedValueOnce(false);
    else mockAuth.unlock.mockRejectedValueOnce(new Error('Test-only biometric failure.'));
    const view = await render(<AppLockGate />);
    await fireEvent.press(view.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => {
      expect(view.getByRole('alert')).toHaveTextContent('Unlock was not completed. Please try again.');
    });
    expect(view.getByRole('button', { name: 'Unlock' })).toBeEnabled();
    await fireEvent.press(view.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => {
      expect(mockAuth.unlock).toHaveBeenCalledTimes(2);
    });
    expect(view.queryByRole('alert')).toBeNull();
  });
});
