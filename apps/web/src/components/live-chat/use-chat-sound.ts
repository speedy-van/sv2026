'use client';

import { CHAT_NOTIFICATION_SOUND_FILENAME, type ChatMessage } from '@sv/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatSoundArrivals } from './sound-arrivals';

type SoundPhase = 'unarmed' | 'ready' | 'muted' | 'blocked' | 'loading';

interface ChatSound {
  phase: SoundPhase;
  setConversation: (id: string | null) => void;
  observe: (id: string | null, messages: readonly ChatMessage[], hasMore: boolean, epoch: number) => void;
  requestEpoch: () => number;
  toggle: () => void;
}

export function useChatSound(): ChatSound {
  const [phase, setPhase] = useState<SoundPhase>('unarmed');
  const phaseRef = useRef<SoundPhase>('unarmed');
  const enabled = useRef(true);
  const audio = useRef<HTMLAudioElement | null>(null);
  const arrivals = useRef(new ChatSoundArrivals());
  const epoch = useRef(0);
  const mounted = useRef(true);
  const pending = useRef(false);

  const changePhase = useCallback((next: SoundPhase): void => {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }, []);

  const stop = useCallback((): void => {
    epoch.current += 1;
    pending.current = false;
    const element = audio.current;
    if (element) element.pause();
  }, []);

  const isCurrent = useCallback((playbackEpoch: number): boolean => mounted.current && epoch.current === playbackEpoch && enabled.current, []);

  const play = useCallback(async (preview: boolean): Promise<void> => {
    if (!enabled.current || document.visibilityState !== 'visible' || pending.current) return;
    if (!preview && phaseRef.current === 'blocked') return;
    const currentEpoch = epoch.current;
    pending.current = true;
    try {
      const element = audio.current ?? new Audio(`/sounds/${CHAT_NOTIFICATION_SOUND_FILENAME}`);
      if (!audio.current) {
        element.preload = 'none';
        audio.current = element;
      }
      // A rapid batch has one cue. Do not interrupt a cue already playing.
      if (!element.paused && !element.ended) return;
      if (preview) changePhase('loading');
      element.currentTime = 0;
      await element.play();
      if (isCurrent(currentEpoch)) changePhase('ready');
    } catch {
      if (isCurrent(currentEpoch)) changePhase('blocked');
    } finally {
      if (epoch.current === currentEpoch) pending.current = false;
    }
  }, [changePhase, isCurrent]);

  useEffect(() => {
    mounted.current = true;
    const visibility = (): void => {
      stop();
      arrivals.current.suspend();
      // A cancelled unlock stays available for an explicit retry.
      if (phaseRef.current === 'loading') changePhase('unarmed');
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', visibility);
      stop();
      if (audio.current) {
        audio.current.removeAttribute('src');
        audio.current.load();
        audio.current = null;
      }
    };
  }, [changePhase, stop]);

  const setConversation = useCallback((id: string | null): void => {
    arrivals.current.setConversation(id);
  }, []);
  const requestEpoch = useCallback((): number => epoch.current, []);
  const observe = useCallback((id: string | null, messages: readonly ChatMessage[], hasMore: boolean, request: number): void => {
    const silent = request !== epoch.current || document.visibilityState !== 'visible';
    if (arrivals.current.observe(id, messages, hasMore, silent)) void play(false);
  }, [play]);
  const toggle = useCallback((): void => {
    if (phaseRef.current === 'ready') {
      enabled.current = false;
      stop();
      changePhase('muted');
    } else {
      enabled.current = true;
      void play(true);
    }
  }, [changePhase, play, stop]);

  return { phase, setConversation, requestEpoch, observe, toggle };
}
