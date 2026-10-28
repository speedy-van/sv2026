import NetInfo from '@react-native-community/netinfo';
import {
  AdminChatInboxResponseSchema,
  CHAT_POLL_INTERVAL_MS,
  CHAT_UNREAD_POLL_INTERVAL_MS,
  ChatMessagesResponseSchema,
  ChatReadResponseSchema,
  AdminChatSendRequestSchema,
  ChatSendResponseSchema,
  type ChatConversation,
  type ChatMessage,
  type AdminChatInboxResponse,
  type AdminChatSendRequest,
  type ChatReadResponse,
  type ChatSendResponse,
} from '@sv/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from '@/state/auth';
import { publishIncomingChatMessages } from '@/notifications/chat-sound-events';

const browserRuntime = globalThis as { document?: EventTarget & { hidden: boolean } };

export interface AdminChatThread {
  conversation: ChatConversation;
  messages: ChatMessage[];
  olderCursor: string | null;
  hasOlder: boolean;
  cursor: string | null;
}

export interface AdminChatThreadResult {
  query: UseQueryResult<AdminChatThread>;
  send: UseMutationResult<ChatSendResponse, Error, AdminChatSendRequest>;
  read: UseMutationResult<ChatReadResponse, Error, string>;
  older: UseMutationResult<void, Error, void>;
  offline: boolean;
  enabled: boolean;
}

export function mergeChatMessages(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()];
}

export function useChatRuntime(): { auth: ReturnType<typeof useAuth>; offline: boolean; enabled: boolean } {
  const auth = useAuth();
  const network = NetInfo.useNetInfo();
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const [visible, setVisible] = useState(Platform.OS !== 'web' || !browserRuntime.document?.hidden);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
    });
    // Native startup can become active between the render and listener registration.
    setForeground(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
    return () => {
      listener.remove();
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const page = browserRuntime.document;
    if (!page) return;
    const update = (): void => {
      setVisible(!page.hidden);
    };
    page.addEventListener('visibilitychange', update);
    update();
    return () => {
      page.removeEventListener('visibilitychange', update);
    };
  }, []);
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const authorized = auth.status === 'signed-in' && !auth.appLocked && Boolean(auth.user?.id);
  return { auth, offline, enabled: authorized && foreground && visible && !offline };
}

export function useChatUnread(): UseQueryResult<AdminChatInboxResponse> {
  const { auth, enabled } = useChatRuntime();
  const query = useQuery({
    queryKey: ['admin', auth.user?.id, 'chat-unread'],
    // The global sound runtime keeps this observed; discard private summaries as soon as it leaves.
    gcTime: 0,
    queryFn: () => {
      if (!enabled) throw new Error('Open and unlock the app while online to refresh live chat.');
      return auth.api.request('/api/v1/admin/chats?limit=100', { schema: AdminChatInboxResponseSchema });
    },
    enabled,
    networkMode: 'always',
    refetchInterval: enabled ? CHAT_UNREAD_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
    staleTime: 10_000,
    placeholderData: () => undefined,
    retry: false,
  });
  const { refetch } = query;
  const previouslyEnabled = useRef(false);
  useEffect(() => {
    // Even a fresh cache needs a new baseline immediately after foreground/unlock.
    const resumedWithCache = enabled && !previouslyEnabled.current && query.dataUpdatedAt > 0;
    previouslyEnabled.current = enabled;
    if (resumedWithCache) void refetch({ cancelRefetch: false });
  }, [enabled, query.dataUpdatedAt, refetch]);
  return query;
}

export function useChatInbox(): {
  query: UseInfiniteQueryResult<InfiniteData<AdminChatInboxResponse>>;
  offline: boolean;
} {
  const runtime = useChatRuntime();
  const focused = useIsFocused();
  const enabled = runtime.enabled && focused;
  const query = useInfiniteQuery({
    queryKey: ['admin', runtime.auth.user?.id, 'chat-inbox'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      if (!enabled) throw new Error('Open and unlock live chat while online to refresh conversations.');
      return runtime.auth.api.request(
        `/api/v1/admin/chats?limit=25${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { schema: AdminChatInboxResponseSchema },
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    networkMode: 'always',
    refetchInterval: enabled ? CHAT_UNREAD_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
    staleTime: 10_000,
    placeholderData: () => undefined,
    retry: false,
  });
  const { refetch } = query;
  const previouslyEnabled = useRef(false);
  useEffect(() => {
    const resumedWithCache = enabled && !previouslyEnabled.current && query.dataUpdatedAt > 0;
    previouslyEnabled.current = enabled;
    if (resumedWithCache) void refetch({ cancelRefetch: false });
  }, [enabled, query.dataUpdatedAt, refetch]);
  return { query, offline: runtime.offline };
}

export function useChatThread(conversationId: string): AdminChatThreadResult {
  const { auth, enabled: runtimeEnabled, offline } = useChatRuntime();
  const focused = useIsFocused();
  const enabled = runtimeEnabled && focused && conversationId.length > 0;
  const delivery = useRef({
    enabled,
    conversationId,
    api: auth.api,
    version: 0,
    mounted: true,
    ready: false,
  });
  if (
    delivery.current.enabled !== enabled ||
    delivery.current.api !== auth.api ||
    delivery.current.conversationId !== conversationId
  ) {
    delivery.current = {
      ...delivery.current,
      enabled,
      conversationId,
      api: auth.api,
      version: delivery.current.version + 1,
      ready: false,
    };
  }
  useEffect(() => {
    delivery.current.mounted = true;
    return () => {
      delivery.current.mounted = false;
      delivery.current.version += 1;
    };
  }, []);
  const client = useQueryClient();
  const key = ['admin', auth.user?.id, 'chat-thread', conversationId] as const;
  const path = `/api/v1/admin/chats/${encodeURIComponent(conversationId)}`;
  const invalidateInbox = async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['admin', auth.user?.id, 'chat-unread'] }),
      client.invalidateQueries({ queryKey: ['admin', auth.user?.id, 'chat-inbox'] }),
    ]);
  };
  const query = useQuery<AdminChatThread>({
    queryKey: key,
    queryFn: async () => {
      if (!enabled) throw new Error('Open and unlock the conversation while online to refresh messages.');
      const existing = client.getQueryData<AdminChatThread>(key);
      const cursor = existing?.cursor;
      const deliveryVersion = delivery.current.version;
      const response = await auth.api.request(
        `${path}/messages?limit=50${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`,
        { schema: ChatMessagesResponseSchema },
      );
      if (!response.conversation)
        throw new Error('This conversation is no longer available. Return to live chat and refresh.');
      if (
        auth.user?.id &&
        delivery.current.mounted &&
        delivery.current.enabled &&
        delivery.current.version === deliveryVersion
      ) {
        if (cursor && delivery.current.ready) {
          publishIncomingChatMessages({
            actorId: auth.user.id,
            conversationId,
            messages: response.messages,
          });
        }
        // Opening/resuming a cached thread catches up silently through every forward page.
        if (!delivery.current.ready) delivery.current.ready = !cursor || !response.hasMore;
      }
      const current = client.getQueryData<AdminChatThread>(key) ?? existing;
      return {
        conversation: response.conversation,
        messages: mergeChatMessages(current?.messages ?? [], response.messages),
        olderCursor: current ? current.olderCursor : response.olderCursor,
        hasOlder: current ? current.hasOlder : response.hasMore,
        cursor: response.cursor ?? current?.cursor ?? null,
      };
    },
    enabled,
    networkMode: 'always',
    refetchInterval: enabled ? CHAT_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
    staleTime: 1_500,
    placeholderData: () => undefined,
    retry: false,
  });
  const { refetch } = query;
  const previouslyEnabled = useRef(false);
  useEffect(() => {
    const resumedWithCache = enabled && !previouslyEnabled.current && query.dataUpdatedAt > 0;
    previouslyEnabled.current = enabled;
    if (resumedWithCache) void refetch({ cancelRefetch: false });
  }, [enabled, query.dataUpdatedAt, refetch]);
  const older = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      if (!enabled) throw new Error('Open and unlock the conversation while online to load messages.');
      const previous = client.getQueryData<AdminChatThread>(key);
      if (!previous?.olderCursor || !previous.hasOlder) return;
      const response = await auth.api.request(
        `${path}/messages?limit=50&before=${encodeURIComponent(previous.olderCursor)}`,
        { schema: ChatMessagesResponseSchema },
      );
      client.setQueryData<AdminChatThread>(key, (current) =>
        current
          ? {
              ...current,
              messages: mergeChatMessages(response.messages, current.messages),
              olderCursor: response.olderCursor,
              hasOlder: response.hasMore,
            }
          : current,
      );
    },
  });
  const send = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (input: { body: string; clientMessageId: string }) => {
      if (!enabled) throw new Error('Open and unlock the conversation while online to reply.');
      return auth.api.request(`${path}/messages`, {
        method: 'POST',
        schema: ChatSendResponseSchema,
        body: AdminChatSendRequestSchema.parse(input),
      });
    },
    onSuccess: async (response) => {
      client.setQueryData<AdminChatThread>(key, (current) =>
        current
          ? {
              ...current,
              conversation: response.conversation,
            }
          : current,
      );
      await Promise.all([invalidateInbox(), client.invalidateQueries({ queryKey: key })]);
    },
  });
  const read = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (messageId: string) => {
      if (!enabled) throw new Error('Open and unlock the conversation while online to mark messages read.');
      return auth.api.request(`${path}/read`, {
        method: 'POST',
        schema: ChatReadResponseSchema,
        body: { messageId },
      });
    },
    onSuccess: async (response) => {
      client.setQueryData<AdminChatThread>(key, (current) =>
        current
          ? {
              ...current,
              conversation: response.conversation,
            }
          : current,
      );
      await invalidateInbox();
    },
  });
  return { query, send, read, older, offline, enabled };
}
