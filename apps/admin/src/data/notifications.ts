import NetInfo from '@react-native-community/netinfo';
import {
  BookingAlertReadRequestSchema,
  BookingAlertReadResponseSchema,
  NotificationReadResponseSchema,
  NotificationReadSchema,
  NotificationsResponseSchema,
  type NotificationsResponse,
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

const pollIntervalMs = 20_000;
const browserRuntime = globalThis as { document?: EventTarget & { hidden: boolean } };
export type NotificationReadInput = { ids: string[] } | { all: true } | { bookingId: string };

export function notificationQueryKey(userId: string | undefined): readonly ['admin', string | undefined, 'notifications'] {
  return ['admin', userId, 'notifications'];
}

export function notificationInboxQueryKey(userId: string | undefined): readonly ['admin', string | undefined, 'notification-inbox'] {
  return ['admin', userId, 'notification-inbox'];
}

export function useNotificationRuntime(): {
  auth: ReturnType<typeof useAuth>;
  privateReady: boolean;
  enabled: boolean;
  offline: boolean;
} {
  const auth = useAuth();
  const network = NetInfo.useNetInfo();
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const [visible, setVisible] = useState(Platform.OS !== 'web' || !browserRuntime.document?.hidden);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { setForeground(state === 'active'); });
    setForeground(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
    return () => { subscription.remove(); };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const page = browserRuntime.document;
    if (!page) return;
    const update = (): void => { setVisible(!page.hidden); };
    page.addEventListener('visibilitychange', update);
    update();
    return () => { page.removeEventListener('visibilitychange', update); };
  }, []);
  const privateReady = auth.status === 'signed-in' && !auth.appLocked && Boolean(auth.user?.id);
  const offline = network.isConnected === false || network.isInternetReachable === false;
  return { auth, privateReady, offline, enabled: privateReady && foreground && visible && !offline };
}

function useResumeRefresh(enabled: boolean, updatedAt: number, refresh: () => Promise<unknown>): void {
  const previouslyEnabled = useRef(false);
  useEffect(() => {
    const resumedWithCache = enabled && !previouslyEnabled.current && updatedAt > 0;
    previouslyEnabled.current = enabled;
    if (resumedWithCache) void refresh();
  }, [enabled, refresh, updatedAt]);
}

export function useNotificationsSummary(): {
  query: UseQueryResult<NotificationsResponse>;
  enabled: boolean;
  privateReady: boolean;
  offline: boolean;
} {
  const { auth, enabled, privateReady, offline } = useNotificationRuntime();
  const query = useQuery({
    queryKey: notificationQueryKey(privateReady ? auth.user?.id : undefined),
    queryFn: () => {
      if (!enabled) throw new Error('Open and unlock the app while online to refresh notifications.');
      return auth.api.request('/api/v1/notifications?limit=50', { schema: NotificationsResponseSchema });
    },
    enabled,
    gcTime: 0,
    networkMode: 'always',
    refetchInterval: enabled ? pollIntervalMs : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
    staleTime: 10_000,
    placeholderData: () => undefined,
    retry: false,
  });
  useResumeRefresh(enabled, query.dataUpdatedAt, query.refetch);
  return { query, enabled, privateReady, offline };
}

export function useNotificationInbox(): {
  query: UseInfiniteQueryResult<InfiniteData<NotificationsResponse>>;
  enabled: boolean;
  privateReady: boolean;
  offline: boolean;
} {
  const runtime = useNotificationRuntime();
  const focused = useIsFocused();
  const enabled = runtime.enabled && focused;
  const query = useInfiniteQuery({
    queryKey: notificationInboxQueryKey(runtime.privateReady ? runtime.auth.user?.id : undefined),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      if (!enabled) throw new Error('Open and unlock notifications while online to refresh the inbox.');
      return runtime.auth.api.request(
        `/api/v1/notifications?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { schema: NotificationsResponseSchema },
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    gcTime: 0,
    networkMode: 'always',
    refetchInterval: enabled ? pollIntervalMs : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
    staleTime: 10_000,
    placeholderData: () => undefined,
    retry: false,
  });
  useResumeRefresh(enabled, query.dataUpdatedAt, query.refetch);
  return { query, enabled, privateReady: runtime.privateReady, offline: runtime.offline };
}

export function useMarkNotificationsRead(): UseMutationResult<{ ok: true }, Error, NotificationReadInput> {
  const runtime = useNotificationRuntime();
  const client = useQueryClient();
  const current = useRef(runtime);
  current.current = runtime;
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (input: NotificationReadInput) => {
      const { auth, enabled } = current.current;
      if (!enabled || !auth.user?.id) throw new Error('Open and unlock the app while online to mark notifications read.');
      const userId = auth.user.id;
      const response = 'bookingId' in input
        ? await auth.api.request('/api/v1/admin/feed/read', {
          method: 'POST',
          body: BookingAlertReadRequestSchema.parse(input),
          schema: BookingAlertReadResponseSchema,
        })
        : await auth.api.request('/api/v1/notifications', {
          method: 'POST',
          body: NotificationReadSchema.parse(input),
          schema: NotificationReadResponseSchema,
        });
      // Only the initiating account is invalidated if a response arrives after account switching.
      await Promise.all([
        client.invalidateQueries({ queryKey: notificationQueryKey(userId) }),
        client.invalidateQueries({ queryKey: notificationInboxQueryKey(userId) }),
      ]);
      return response;
    },
  });
}
