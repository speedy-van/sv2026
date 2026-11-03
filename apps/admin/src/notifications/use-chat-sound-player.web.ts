import { CHAT_NOTIFICATION_SOUND_FILENAME } from '@sv/contracts';
import { useCallback, useEffect, useRef } from 'react';
import type { ChatSoundPlayer } from './chat-sound-player-types';

interface BrowserAudio {
  currentTime: number;
  loop: boolean;
  preload: string;
  pause(): void;
  play(): Promise<void>;
  removeAttribute(name: string): void;
  load(): void;
}
const browserRuntime = globalThis as { Audio?: new (source: string) => BrowserAudio };

/** Await the browser's play promise so autoplay blocks are visible and retryable. */
export function useChatSoundPlayer(): ChatSoundPlayer {
  const player = useRef<BrowserAudio | null>(null);
  const generation = useRef(0);
  const stopped = useRef(true);
  const stop = useCallback(() => {
    generation.current += 1;
    stopped.current = true;
    player.current?.pause();
  }, []);
  useEffect(
    () => () => {
      stop();
      const audio = player.current;
      player.current = null;
      if (audio) {
        audio.removeAttribute('src');
        audio.load();
      }
    },
    [stop],
  );
  const play = useCallback(async (): Promise<void> => {
    const BrowserAudioElement = browserRuntime.Audio;
    if (!BrowserAudioElement) throw new Error('Audio is unavailable.');
    const audio = player.current ?? new BrowserAudioElement(`/sounds/${CHAT_NOTIFICATION_SOUND_FILENAME}`);
    player.current = audio;
    audio.preload = 'auto';
    audio.loop = false;
    audio.pause();
    audio.currentTime = 0;
    const attempt = ++generation.current;
    stopped.current = false;
    // Called directly inside a press handler when enabling/testing, before any await.
    await audio.play();
    const isStopped = (): boolean => stopped.current;
    if (attempt !== generation.current && isStopped()) audio.pause();
  }, []);
  return { play, stop, failed: false };
}
