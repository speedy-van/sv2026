import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@sv/api-client';
import { router } from 'expo-router';
import SignInScreen from '../app/(auth)/sign-in';
import CodeScreen from '../app/(auth)/code';

const mockAuth = {
  requestCode: jest.fn<Promise<void>, [string]>(),
  signInWithCode: jest.fn<Promise<void>, [string, string]>(),
  signInWithPassword: jest.fn<Promise<void>, [string, string]>(),
  status: 'idle' as 'idle' | 'signed-in' | 'submitting',
};
jest.mock('../src/state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ email: 'driver@example.test' }),
}));

beforeEach(() => {
  jest.resetAllMocks();
  mockAuth.status = 'idle';
  mockAuth.requestCode.mockResolvedValue(undefined);
  mockAuth.signInWithCode.mockResolvedValue(undefined);
  mockAuth.signInWithPassword.mockResolvedValue(undefined);
});

describe('driver password and code sign-in screens', () => {
  it('defaults to a secure password form with labelled inputs and an incomplete form disabled', async () => {
    const view = await render(<SignInScreen />);
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    expect(view.getByLabelText('Password')).toHaveProp('autoComplete', 'current-password');
    expect(view.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await fireEvent.press(view.getByRole('button', { name: 'Show password' }));
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', false);
    await fireEvent.press(view.getByRole('button', { name: 'Hide password' }));
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
  });

  it('uses the exact supplied password and navigates only after successful authentication', async () => {
    const view = await render(<SignInScreen />);
    await fireEvent.changeText(view.getByLabelText('Email'), 'driver@example.test');
    await fireEvent.changeText(view.getByLabelText('Password'), '  Exact admin password  ');
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => { expect(router.replace).toHaveBeenCalledWith('/(app)/today'); });
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith('driver@example.test', '  Exact admin password  ');
    expect(view.getByLabelText('Password')).toHaveDisplayValue('');
    expect(mockAuth.requestCode).not.toHaveBeenCalled();
  });

  it('shows an accessible incorrect-password error without navigating or clearing retry input', async () => {
    mockAuth.signInWithPassword.mockRejectedValueOnce(new ApiClientError(401, 'Invalid email or password.'));
    const view = await render(<SignInScreen />);
    await fireEvent.changeText(view.getByLabelText('Email'), 'driver@example.test');
    await fireEvent.changeText(view.getByLabelText('Password'), 'Test-only password');
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => { expect(view.getByRole('alert')).toHaveTextContent('Email or password is incorrect.'); });
    expect(router.replace).not.toHaveBeenCalled();
    expect(view.getByLabelText('Password')).toHaveDisplayValue('Test-only password');
    expect(view.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('retains the code alternative and clears the password when switching methods', async () => {
    const view = await render(<SignInScreen />);
    await fireEvent.changeText(view.getByLabelText('Email'), 'driver@example.test');
    await fireEvent.changeText(view.getByLabelText('Password'), 'Test-only password');
    await fireEvent.press(view.getByRole('button', { name: 'Sign in with an email code' }));
    expect(view.queryByLabelText('Password')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Use password instead' }));
    expect(view.getByLabelText('Password')).toHaveDisplayValue('');
    expect(view.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    await fireEvent.press(view.getByRole('button', { name: 'Sign in with an email code' }));
    await fireEvent.press(view.getByRole('button', { name: 'Send code' }));
    await waitFor(() => { expect(router.push).toHaveBeenCalledWith({ pathname: '/(auth)/code', params: { email: 'driver@example.test' } }); });
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('disables all controls while submitting', async () => {
    mockAuth.status = 'submitting';
    const view = await render(<SignInScreen />);
    expect(view.getByLabelText('Email')).toHaveProp('editable', false);
    expect(view.getByLabelText('Password')).toHaveProp('editable', false);
    expect(view.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(view.getByRole('button', { name: 'Show password' })).toBeDisabled();
    expect(view.getByRole('button', { name: 'Sign in with an email code' })).toBeDisabled();
  });

  it('keeps failed code requests on the sign-in form with a human retry error', async () => {
    mockAuth.requestCode.mockRejectedValueOnce(new Error('Test-only offline'));
    const view = await render(<SignInScreen />);
    await fireEvent.changeText(view.getByLabelText('Email'), 'driver@example.test');
    await fireEvent.press(view.getByRole('button', { name: 'Sign in with an email code' }));
    await fireEvent.press(view.getByRole('button', { name: 'Send code' }));
    await waitFor(() => { expect(view.getByRole('alert')).toHaveTextContent('We could not complete sign-in. Check your connection and try again.'); });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('requires six numeric code characters, then exposes rejected verification with retry', async () => {
    mockAuth.signInWithCode.mockRejectedValueOnce(new ApiClientError(401, 'Invalid code.'));
    const view = await render(<CodeScreen />);
    await fireEvent.changeText(view.getByLabelText('Six-digit code'), '12345');
    expect(view.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await fireEvent.changeText(view.getByLabelText('Six-digit code'), '123456');
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => { expect(view.getByRole('alert')).toHaveTextContent('This code is invalid or has expired. Request a new code.'); });
    expect(router.replace).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => { expect(router.replace).toHaveBeenCalledWith('/(app)/today'); });
  });
});
