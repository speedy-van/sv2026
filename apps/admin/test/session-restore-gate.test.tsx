import { act, fireEvent, render } from '@testing-library/react-native';
import { SessionRestoreGate } from '../src/components/session-restore-gate';

const mockRetry = jest.fn<Promise<void>, []>();
const mockSignOut = jest.fn<Promise<void>, []>();
let mockError: string | null = null;
jest.mock('../src/state/auth', () => ({
  useAuth: () => ({ restoreError: mockError, retryRestore: mockRetry, signOut: mockSignOut }),
}));

beforeEach(() => {
  mockError = null;
  mockRetry.mockReset().mockResolvedValue(undefined);
  mockSignOut.mockReset().mockResolvedValue(undefined);
});

it('shows a neutral saved-session gate while checking, without sign-in fields or private data', async () => {
  const view = await render(<SessionRestoreGate />);
  expect(view.getByRole('header', { name: 'Restoring your session' })).toBeTruthy();
  expect(view.queryByLabelText('Password')).toBeNull();
  expect(view.queryByText('Booking total')).toBeNull();
  expect(view.queryByRole('button', { name: 'Try again' })).toBeNull();
});

it('offers a real retry after connectivity failure instead of discarding the saved session', async () => {
  mockError = 'Reconnect to check your saved session.';
  const view = await render(<SessionRestoreGate />);
  expect(view.getByText(mockError)).toBeTruthy();
  await act(async () => {
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  });
  expect(mockRetry).toHaveBeenCalledTimes(1);
  expect(mockSignOut).not.toHaveBeenCalled();
});

it('lets the administrator explicitly sign out from the restore gate', async () => {
  mockError = 'Reconnect to check your saved session.';
  const view = await render(<SessionRestoreGate />);
  await act(async () => {
    await fireEvent.press(view.getByRole('button', { name: 'Sign out on this device' }));
  });
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});
