import * as Sentry from '@sentry/react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { notificationQueryKey, useNotificationRuntime, useNotificationsSummary } from '@/data/notifications';

/** Synchronize the icon from confirmed server counts, never from the displayed page length. */
export function useNotificationBadge(): { error: string | null; retry: () => void } {
  const runtime = useNotificationRuntime();
  const { auth, enabled, privateReady } = runtime;
  const { query } = useNotificationsSummary();
  const queries = useQueryClient();
  const [writeError, setWriteError] = useState<string | null>(null);
  const mounted = useRef(true);
  const pendingWrite = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const previous = useRef({ api: auth.api, userId: auth.user?.id, enabled: false, baseline: 0 });
  const changedAccount = previous.current.userId !== undefined && previous.current.userId !== auth.user?.id;
  if (previous.current.api !== auth.api || previous.current.userId !== auth.user?.id || previous.current.enabled !== enabled) {
    generation.current += 1;
    previous.current = { api: auth.api, userId: auth.user?.id, enabled, baseline: query.dataUpdatedAt };
  }
  const current = useRef({ enabled });
  current.current = { enabled };

  const writeBadge = useCallback((count: number, version: number, reset = false): void => {
    if (Platform.OS === 'web') return;
    // Serialize native writes: a slow old write must finish before logout/new counts.
    pendingWrite.current = pendingWrite.current.then(async () => {
      const isCurrent = (): boolean => mounted.current && version === generation.current;
      // A queued account clear must survive a quick sign-in, lock, or network change.
      if (!mounted.current || (!reset && (!isCurrent() || !current.current.enabled))) return;
      try {
        const applied = await Notifications.setBadgeCountAsync(count);
        if (!applied) throw new Error('The device did not accept the notification badge count.');
        if (isCurrent()) setWriteError(null);
      } catch (cause) {
        Sentry.captureException(cause, { tags: { feature: 'admin-notification-badge' } });
        if (isCurrent()) {
          setWriteError('The app icon count could not be updated. Check notification settings and retry.');
        }
      }
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (auth.status === 'idle' || changedAccount) {
      writeBadge(0, generation.current, true);
    }
    // On launch/foreground/unlock, wait for the new response rather than replaying
    // a cached count over a newer badge delivered while the app was closed.
    if (!enabled || !query.isSuccess || query.isFetching || query.dataUpdatedAt === previous.current.baseline) return;
    writeBadge(query.data.badgeCount, generation.current);
  }, [auth.api, auth.status, auth.user?.id, changedAccount, enabled, query.data?.badgeCount, query.dataUpdatedAt, query.isFetching, query.isSuccess, writeBadge]);

  useEffect(() => {
    if (Platform.OS === 'web' || !enabled) return;
    const listener = Notifications.addNotificationReceivedListener(() => {
      if (!current.current.enabled) return;
      void queries.invalidateQueries({ queryKey: notificationQueryKey(auth.user?.id) });
      void queries.invalidateQueries({ queryKey: ['admin', auth.user?.id, 'notification-inbox'] });
    });
    return () => { listener.remove(); };
  }, [auth.user?.id, enabled, queries]);

  return {
    error: privateReady && enabled
      ? writeError ?? (query.isError ? 'The notification count could not be refreshed. Your existing alerts have been kept.' : null)
      : null,
    retry: () => {
      if (enabled) void query.refetch();
    },
  };
}
