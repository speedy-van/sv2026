import NetInfo from '@react-native-community/netinfo';
import { AdminVisitorPresenceResponseSchema, type AdminVisitorPresenceResponse } from '@sv/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/state/auth';

export interface VisitorPresenceResult {
  query: UseQueryResult<AdminVisitorPresenceResponse>;
  actorId: string | undefined;
  authorized: boolean;
  foreground: boolean;
  offline: boolean;
  outdated: boolean;
}

function isForeground(state: typeof AppState.currentState | null): boolean {
  return state === null || state === 'unknown' || state === 'active';
}

export function useVisitorPresence(): VisitorPresenceResult {
  const auth = useAuth();
  const network = NetInfo.useNetInfo();
  const [foreground, setForeground] = useState(() => isForeground(AppState.currentState));
  const [now, setNow] = useState(Date.now);
  const actorId = auth.user?.id;
  const authorized = auth.status === 'signed-in' && !auth.appLocked && Boolean(actorId);
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const enabled = authorized && foreground && !offline;
  const previouslyEnabled = useRef(enabled);

  useEffect(() => {
    const synchronize = (state: typeof AppState.currentState | null): void => {
      setForeground(isForeground(state));
      setNow(Date.now());
    };
    const subscription = AppState.addEventListener('change', synchronize);
    // Native iOS can determine its initial state between render and subscription.
    synchronize(AppState.currentState);
    return () => { subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!authorized || !foreground) return;
    const timer = setInterval(() => { setNow(Date.now()); }, 15_000);
    return () => { clearInterval(timer); };
  }, [authorized, foreground]);

  const query = useQuery({
    queryKey: ['admin', actorId, 'visitors', 'presence'],
    queryFn: () => {
      if (!enabled) throw new Error('Open and unlock the app while online to refresh visitor activity.');
      return auth.api.request('/api/v1/admin/visitors/presence', {
        method: 'GET', schema: AdminVisitorPresenceResponseSchema,
      });
    },
    enabled,
    networkMode: 'online',
    refetchInterval: enabled ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    placeholderData: () => undefined,
    staleTime: 15_000,
    retry: false,
  });
  const { refetch } = query;
  useEffect(() => {
    const resumed = enabled && !previouslyEnabled.current;
    previouslyEnabled.current = enabled;
    // A short background visit can leave a "fresh" cached zero. Check now,
    // sharing any automatic in-flight refetch instead of waiting 15 seconds.
    if (resumed) void refetch({ cancelRefetch: false });
  }, [enabled, refetch]);
  return {
    query, actorId, authorized, foreground, offline,
    outdated: Boolean(query.data) && (!enabled || query.isError || now - query.dataUpdatedAt >= 30_000),
  };
}
