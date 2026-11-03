import * as Sentry from '@sentry/react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { AdminChatInboxResponse } from '@sv/contracts';
import { chatCopy } from '@/content/chat';
import { useChatRuntime, useChatUnread } from '@/data/chat';
import { subscribeIncomingChatMessages } from './chat-sound-events';
import { IncomingChatSoundTracker } from './chat-sound-tracker';
import { useChatSoundPlayer } from './use-chat-sound-player';
import { subscribeForegroundChatPush } from './chat-push';

interface ChatSoundContextValue {
  enabled: boolean;
  available: boolean;
  testing: boolean;
  error: string | null;
  toggle: () => void;
  test: () => void;
}

const ChatSoundContext = createContext<ChatSoundContextValue | null>(null);

/** One foreground runtime for the whole account, independent of the selected screen. */
export function ChatSoundProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const runtime = useChatRuntime();
  const actorId = runtime.auth.user?.id ?? null;
  const inbox = useChatUnread();
  const player = useChatSoundPlayer();
  const [enabled, setEnabled] = useState(Platform.OS !== 'web');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState(actorId);
  const tracker = useRef(new IncomingChatSoundTracker());
  const lastSnapshot = useRef<{ data: AdminChatInboxResponse | undefined; updatedAt: number }>({
    data: undefined,
    updatedAt: 0,
  });
  const operation = useRef(0);
  const current = useRef({ active: runtime.enabled, enabled, actorId: runtime.auth.user?.id });
  if (owner !== actorId) {
    // Reset account-private delivery/preferences without remounting the navigation tree.
    setOwner(actorId);
    setEnabled(Platform.OS !== 'web');
    setTesting(false);
    setError(null);
    tracker.current = new IncomingChatSoundTracker();
    lastSnapshot.current = { data: undefined, updatedAt: 0 };
    operation.current += 1;
  }
  current.current = { active: runtime.enabled, enabled, actorId: runtime.auth.user?.id };
  const playRef = useRef(player.play);
  playRef.current = player.play;
  const play = useCallback((manual = false): void => {
    if (!current.current.active || (!manual && !current.current.enabled)) return;
    const attempt = ++operation.current;
    if (manual) setTesting(true);
    setError(null);
    // Do not defer this call: a web press must reach audio.play() within its user gesture.
    void playRef
      .current()
      .then(() => {
        if (attempt !== operation.current || !current.current.active) return;
        if (manual) {
          current.current.enabled = true;
          setEnabled(true);
        }
      })
      .catch((failure: unknown) => {
        if (attempt !== operation.current || !current.current.active) return;
        setError(chatCopy.soundError);
        Sentry.captureException(failure, { tags: { feature: 'admin-chat-sound' } });
      })
      .finally(() => {
        if (attempt === operation.current) setTesting(false);
      });
  }, []);
  useEffect(
    () => () => {
      player.stop();
    },
    [actorId, player.stop],
  );
  useEffect(() => {
    if (runtime.enabled) return;
    tracker.current.rebaseline();
    lastSnapshot.current = { data: inbox.data, updatedAt: inbox.dataUpdatedAt };
    operation.current += 1;
    setTesting(false);
    player.stop();
  }, [inbox.data, inbox.dataUpdatedAt, player.stop, runtime.enabled]);
  useEffect(() => {
    if (
      !runtime.enabled ||
      !inbox.isSuccess ||
      (inbox.data === lastSnapshot.current.data && inbox.dataUpdatedAt === lastSnapshot.current.updatedAt)
    )
      return;
    lastSnapshot.current = { data: inbox.data, updatedAt: inbox.dataUpdatedAt };
    if (tracker.current.observeInbox(inbox.data)) play();
  }, [inbox.data, inbox.dataUpdatedAt, inbox.isSuccess, play, runtime.enabled]);
  useEffect(() => {
    if (player.failed && runtime.enabled) {
      setError(chatCopy.soundError);
      Sentry.captureException(new Error('The bundled chat sound could not be decoded or played.'), {
        tags: { feature: 'admin-chat-sound' },
      });
    }
  }, [player.failed, runtime.enabled]);
  useEffect(
    () =>
      subscribeIncomingChatMessages((event) => {
        if (event.actorId !== current.current.actorId) return;
        if (tracker.current.observeForward(event.messages, current.current.active)) play();
      }),
    [play],
  );
  useEffect(() => {
    if (Platform.OS === 'web') return;
    return subscribeForegroundChatPush((event) => {
      if (!current.current.active) return false;
      // A delayed push for a previous login must not ring in the current account.
      if (event.recipientUserId !== current.current.actorId) return true;
      if (tracker.current.observePush(event.messageId)) play();
      // Muted and already-played messages also suppress duplicate native audio.
      return true;
    });
  }, [play]);
  useEffect(
    () => () => {
      operation.current += 1;
    },
    [],
  );
  const toggle = useCallback((): void => {
    if (current.current.enabled) {
      current.current.enabled = false;
      setEnabled(false);
      setError(null);
      operation.current += 1;
      setTesting(false);
      player.stop();
    } else play(true);
  }, [play, player.stop]);
  useEffect(() => {
    if (!testing) return;
    const timeout = setTimeout(() => {
      operation.current += 1;
      player.stop();
      setTesting(false);
      setError(chatCopy.soundError);
    }, 15_000);
    return () => {
      clearTimeout(timeout);
    };
  }, [player.stop, testing]);
  const value = useMemo<ChatSoundContextValue>(
    () => ({
      enabled,
      available: runtime.enabled,
      testing,
      error,
      toggle,
      test: () => {
        play(true);
      },
    }),
    [enabled, error, play, runtime.enabled, testing, toggle],
  );
  return <ChatSoundContext value={value}>{children}</ChatSoundContext>;
}

export function useChatSound(): ChatSoundContextValue | null {
  return useContext(ChatSoundContext);
}
