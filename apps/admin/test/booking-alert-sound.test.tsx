import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';
import { BookingAlertSound } from '../src/notifications/booking-alert-sound';
import { claimNotificationSound } from '../src/notifications/notification-sound-focus';

const mockPlayer = {
  pause: jest.fn(),
  play: jest.fn(),
  replace: jest.fn(),
  seekTo: jest.fn<Promise<void>, [number]>(() => Promise.resolve()),
};
let mockAudioLoaded = true;
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  useAudioPlayer: () => mockPlayer,
  useAudioPlayerStatus: () => ({ isLoaded: mockAudioLoaded, error: null }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.mocked(setAudioModeAsync).mockResolvedValue();
  mockPlayer.seekTo.mockResolvedValue();
  mockAudioLoaded = true;
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('plays once for each displayed booking and stops when the popup closes, respecting silent mode', async () => {
  const view = await render(<BookingAlertSound alertId="first-delivery" />);
  await waitFor(() => {
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });
  expect(setAudioModeAsync).toHaveBeenCalledWith({
    allowsRecording: false,
    interruptionMode: 'mixWithOthers',
    playsInSilentMode: false,
    shouldPlayInBackground: false,
  });
  expect(mockPlayer.seekTo).toHaveBeenCalledWith(0);
  await view.rerender(<BookingAlertSound alertId="first-delivery" />);
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  await view.rerender(<BookingAlertSound alertId="second-delivery" />);
  await waitFor(() => {
    expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  });
  await view.unmount();
  expect(mockPlayer.pause).toHaveBeenCalledTimes(2);
});

it('shows a playback failure and lets the admin retry without losing the booking', async () => {
  mockPlayer.seekTo.mockRejectedValueOnce(new Error('Audio unavailable'));
  const view = await render(<BookingAlertSound alertId="delivery" />);
  await waitFor(() => {
    expect(view.getByRole('button', { name: 'Try alert sound again' })).toBeTruthy();
  });
  expect(view.getByRole('alert')).toHaveTextContent(
    'The booking alert sound could not play. You can still open this booking.',
  );
  await fireEvent.press(view.getByRole('button', { name: 'Try alert sound again' }));
  await waitFor(() => {
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });
  expect(view.queryByRole('alert')).toBeNull();
});

it('does not start delayed audio after the popup has been dismissed or the app locked', async () => {
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  jest.mocked(setAudioModeAsync).mockReturnValueOnce(pending);
  const view = await render(<BookingAlertSound alertId="delivery" />);
  await view.unmount();
  await act(async () => {
    if (!finish) throw new Error('Expected a pending audio mode request.');
    finish();
    await pending;
  });
  expect(mockPlayer.seekTo).not.toHaveBeenCalled();
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('does not claim native notification sound support in the browser preview', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  await render(<BookingAlertSound alertId="delivery" />);
  expect(setAudioModeAsync).not.toHaveBeenCalled();
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('stops the long booking sound when a chat alert takes foreground audio ownership', async () => {
  const view = await render(<BookingAlertSound alertId="booking" />);
  await waitFor(() => { expect(mockPlayer.play).toHaveBeenCalledTimes(1); });
  const releaseChat = claimNotificationSound(jest.fn());
  expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
  await view.unmount();
  releaseChat();
});

it('waits for the bundled audio to decode before seeking and reports a stalled load', async () => {
  jest.useFakeTimers();
  mockAudioLoaded = false;
  const view = await render(<BookingAlertSound alertId="delivery" />);
  expect(mockPlayer.play).not.toHaveBeenCalled();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(15_000);
  });
  expect(view.getByRole('button', { name: 'Try alert sound again' })).toBeTruthy();
  mockAudioLoaded = true;
  await view.rerender(<BookingAlertSound alertId="delivery" />);
  await waitFor(() => {
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });
  await view.unmount();
  jest.useRealTimers();
});
