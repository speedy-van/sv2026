import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import { CancelledError, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/state/auth';
import {
  adminToday,
  bookingsQueryOptions,
  dashboardQueryOptions,
  driversQueryOptions,
  scheduleQueryOptions,
} from './operations';

const idleRuntime = globalThis as {
  requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function afterInteraction(callback: () => void): () => void {
  if (idleRuntime.requestIdleCallback && idleRuntime.cancelIdleCallback) {
    const handle = idleRuntime.requestIdleCallback(callback, { timeout: 1500 });
    return () => { idleRuntime.cancelIdleCallback?.(handle); };
  }
  const handle = setTimeout(callback, 0);
  return () => { clearTimeout(handle); };
}

function isForeground(state: typeof AppState.currentState | null): boolean {
  return state === null || state === 'unknown' || state === 'active';
}

/** Warm one page per main destination, without a second request on first navigation. */
export function AdminNavigationPrefetch(): null {
  const auth = useAuth();
  const queries = useQueryClient();
  const network = NetInfo.useNetInfo();
  const [foreground, setForeground] = useState(() => isForeground(AppState.currentState));
  const actorId = auth.user?.id;
  const enabled = auth.status === 'signed-in' && !auth.appLocked && Boolean(actorId)
    && foreground && network.isConnected !== false && network.isInternetReachable !== false;
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => { setForeground(isForeground(state)); });
    // iOS can finish determining its initial state between render and subscription.
    setForeground(isForeground(AppState.currentState));
    return () => { listener.remove(); };
  }, []);
  useEffect(() => {
    if (!enabled || !actorId) return;
    let stopped = false;
    const active = (): boolean => !stopped;
    let cancelIdle: (() => void) | undefined;
    const today = adminToday();
    const dashboard = dashboardQueryOptions(auth.api, actorId, today);
    const bookings = bookingsQueryOptions(auth.api, actorId, { deleted: 'exclude' });
    const schedule = scheduleQueryOptions(auth.api, actorId, today);
    const drivers = driversQueryOptions(auth.api, actorId, { date: today });
    const destinations = [
      { key: dashboard.queryKey, run: () => queries.query({ ...dashboard, retry: false }) },
      { key: bookings.queryKey, run: () => queries.infiniteQuery({ ...bookings, retry: false, pages: 1 }) },
      { key: schedule.queryKey, run: () => queries.query({ ...schedule, retry: false }) },
      { key: drivers.queryKey, run: () => queries.infiniteQuery({ ...drivers, retry: false, pages: 1 }) },
    ];
    async function warm(index: number): Promise<void> {
      const destination = destinations[index];
      if (!active() || !destination) return;
      try {
        await destination.run();
      } catch (error) {
        if (active() && !(error instanceof CancelledError))
          Sentry.captureException(error, { tags: { feature: 'admin-navigation-prefetch' } });
      }
      if (active() && index + 1 < destinations.length)
        cancelIdle = afterInteraction(() => { void warm(index + 1); });
    }
    void warm(0);
    return () => {
      stopped = true;
      cancelIdle?.();
      for (const destination of destinations)
        void queries.cancelQueries({ queryKey: destination.key, exact: true });
    };
  }, [actorId, auth.api, enabled, queries]);
  return null;
}
