import * as Sentry from '@sentry/react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';
import chatSound from '../../assets/sounds/chat-message.wav';
import type { ChatSoundPlayer } from './chat-sound-player-types';
import { claimNotificationSound } from './notification-sound-focus';

/** Expo owns and releases this native player; every one-shot starts at the beginning. */
export function useChatSoundPlayer(): ChatSoundPlayer {
  const player = useAudioPlayer(chatSound);
  const audio = useAudioPlayerStatus(player);
  const generation = useRef(0);
  const releaseFocus = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    generation.current += 1;
    releaseFocus.current?.();
    releaseFocus.current = null;
    try {
      player.pause();
    } catch (error) {
      Sentry.captureException(error, { tags: { feature: 'admin-chat-sound-stop' } });
    }
  }, [player]);
  useEffect(() => stop, [stop]);
  const play = useCallback(async (): Promise<void> => {
    if (!audio.isLoaded || audio.error) {
      if (audio.error) player.replace(chatSound);
      throw new Error('The chat sound is not ready. Try again.');
    }
    releaseFocus.current = claimNotificationSound(stop);
    const attempt = ++generation.current;
    await setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: false,
      shouldPlayInBackground: false,
    });
    if (attempt !== generation.current) return;
    player.pause();
    await player.seekTo(0);
    if (attempt !== generation.current) return;
    player.loop = false;
    player.play();
  }, [audio.error, audio.isLoaded, player, stop]);
  return { play, stop, failed: Boolean(audio.error) };
}
