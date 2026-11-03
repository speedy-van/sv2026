import { act, renderHook } from '@testing-library/react-native';
import { useChatSoundPlayer } from '../src/notifications/use-chat-sound-player.web';

const mockAudio = {
  currentTime: 10,
  loop: true,
  preload: '',
  pause: jest.fn(),
  play: jest.fn<Promise<void>, []>(() => Promise.resolve()),
  removeAttribute: jest.fn(),
  load: jest.fn(),
};
const mockConstruct = jest.fn(() => mockAudio);
const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
beforeEach(() => {
  jest.clearAllMocks();
  mockAudio.play.mockReset().mockResolvedValue();
  mockAudio.currentTime = 10;
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: mockConstruct });
});
afterEach(() => {
  if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio);
  else Reflect.deleteProperty(globalThis, 'Audio');
});

it('calls browser play synchronously from the gesture, reuses the element and restarts the real sound', async () => {
  const hook = await renderHook(useChatSoundPlayer);
  const pending = hook.result.current.play();
  expect(mockConstruct).toHaveBeenCalledWith('/sounds/chat-message.wav');
  expect(mockAudio.play).toHaveBeenCalledTimes(1);
  await pending;
  await hook.result.current.play();
  expect(mockConstruct).toHaveBeenCalledTimes(1);
  expect(mockAudio.currentTime).toBe(0);
  expect(mockAudio.loop).toBe(false);
});

it('propagates autoplay denial so the sound control can show Retry, then retries cleanly', async () => {
  mockAudio.play.mockRejectedValueOnce(new Error('NotAllowedError'));
  const hook = await renderHook(useChatSoundPlayer);
  await expect(hook.result.current.play()).rejects.toThrow('NotAllowedError');
  await expect(hook.result.current.play()).resolves.toBeUndefined();
  expect(mockAudio.play).toHaveBeenCalledTimes(2);
});

it('stops a late browser play result after mute/unmount and releases its media source', async () => {
  let resolve: (() => void) | undefined;
  mockAudio.play.mockReturnValueOnce(
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
  expect(mockAudio.pause).toHaveBeenCalledTimes(3);
  expect(mockAudio.removeAttribute).toHaveBeenCalledWith('src');
  expect(mockAudio.load).toHaveBeenCalledTimes(1);
});

it('does not let an earlier delayed play promise stop a newer valid message sound', async () => {
  let resolve: (() => void) | undefined;
  mockAudio.play.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  const hook = await renderHook(useChatSoundPlayer);
  const earlier = hook.result.current.play();
  hook.result.current.stop();
  await hook.result.current.play();
  const pauses = mockAudio.pause.mock.calls.length;
  await act(async () => {
    resolve?.();
    await earlier;
  });
  expect(mockAudio.pause).toHaveBeenCalledTimes(pauses);
});

it('turns a synchronous browser seek failure into a retryable rejected promise', async () => {
  const hook = await renderHook(useChatSoundPlayer);
  Object.defineProperty(mockAudio, 'currentTime', {
    configurable: true,
    get: () => 0,
    set: () => {
      throw new Error('Seek unavailable');
    },
  });
  await expect(hook.result.current.play()).rejects.toThrow('Seek unavailable');
  Object.defineProperty(mockAudio, 'currentTime', { configurable: true, writable: true, value: 0 });
  await expect(hook.result.current.play()).resolves.toBeUndefined();
});
