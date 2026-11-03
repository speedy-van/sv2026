import { act, renderHook } from '@testing-library/react-native';
import { setAudioModeAsync } from 'expo-audio';
import { useChatSoundPlayer } from '../src/notifications/use-chat-sound-player';
import { claimNotificationSound } from '../src/notifications/notification-sound-focus';

const mockPlayer = {
  pause: jest.fn(),
  play: jest.fn(),
  replace: jest.fn(),
  seekTo: jest.fn<Promise<void>, [number]>(() => Promise.resolve()),
  loop: false,
};
let mockLoaded = true;
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  useAudioPlayer: () => mockPlayer,
  useAudioPlayerStatus: () => ({ isLoaded: mockLoaded, error: null }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockLoaded = true;
  jest.mocked(setAudioModeAsync).mockResolvedValue();
});

it('replays each new chat one-shot from zero through Expo audio without looping or silent-mode bypass', async () => {
  const hook = await renderHook(useChatSoundPlayer);
  await act(async () => {
    await hook.result.current.play();
    await hook.result.current.play();
  });
  expect(mockPlayer.seekTo).toHaveBeenNthCalledWith(1, 0);
  expect(mockPlayer.seekTo).toHaveBeenNthCalledWith(2, 0);
  expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  expect(mockPlayer.loop).toBe(false);
  expect(setAudioModeAsync).toHaveBeenCalledWith({
    allowsRecording: false,
    interruptionMode: 'mixWithOthers',
    playsInSilentMode: false,
    shouldPlayInBackground: false,
  });
});

it('cancels delayed playback on lock/unmount rather than starting an old sound later', async () => {
  let resolve: (() => void) | undefined;
  jest.mocked(setAudioModeAsync).mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const hook = await renderHook(useChatSoundPlayer);
  const pending = hook.result.current.play();
  await hook.unmount();
  await act(async () => {
    resolve?.();
    await pending;
  });
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('returns a visible-to-the-provider failure if the sound has not decoded yet', async () => {
  mockLoaded = false;
  const hook = await renderHook(useChatSoundPlayer);
  await expect(hook.result.current.play()).rejects.toThrow('not ready');
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it('relinquishes audio to a booking alert and cancels a still-pending chat start', async () => {
  let finish: (() => void) | undefined;
  jest.mocked(setAudioModeAsync).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const hook = await renderHook(useChatSoundPlayer);
  const pending = hook.result.current.play();
  const bookingStop = jest.fn();
  const releaseBooking = claimNotificationSound(bookingStop);
  expect(mockPlayer.pause).toHaveBeenCalled();
  await act(async () => { finish?.(); await pending; });
  expect(mockPlayer.play).not.toHaveBeenCalled();
  await hook.unmount();
  // Disposing the old chat player cannot release the newer booking owner's sound.
  const releaseNext = claimNotificationSound(jest.fn());
  expect(bookingStop).toHaveBeenCalledTimes(1);
  releaseBooking();
  releaseNext();
});
