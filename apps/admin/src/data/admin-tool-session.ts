import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { z } from 'zod';
import { useAuth } from '@/state/auth';

const browserRuntime = globalThis as { document?: EventTarget & { hidden: boolean } };

interface RequestOptions {
  body?: unknown;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  signal?: AbortSignal;
}
export interface AdminToolSession {
  actorId: string | undefined;
  enabled: boolean;
  offline: boolean;
  privateReady: boolean;
  owner: boolean;
  revision: number;
  identityRevision: number;
  request<T>(path: string, schema: z.ZodType<T>, options?: RequestOptions): Promise<T>;
  invalidate(): Promise<void>;
  isCurrent(revision: number): boolean;
  isIdentityCurrent(revision: number): boolean;
  waitForReady(identityRevision: number): Promise<boolean>;
  queryOptions: {
    enabled: boolean;
    gcTime: number;
    staleTime: number;
    retry: false;
    networkMode: 'always';
    placeholderData(): undefined;
    refetchOnWindowFocus: 'always';
  };
}

export function useAdminToolSession(): AdminToolSession {
  const auth = useAuth();
  const network = NetInfo.useNetInfo();
  const focused = useIsFocused();
  const queries = useQueryClient();
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const [visible, setVisible] = useState(Platform.OS !== 'web' || !browserRuntime.document?.hidden);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
    });
    setForeground(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
    return () => {
      listener.remove();
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web' || !browserRuntime.document) return;
    const page = browserRuntime.document;
    const update = (): void => {
      setVisible(!page.hidden);
    };
    page.addEventListener('visibilitychange', update);
    update();
    return () => {
      page.removeEventListener('visibilitychange', update);
    };
  }, []);
  const privateReady =
    auth.status === 'signed-in' &&
    !auth.appLocked &&
    Boolean(auth.user?.id) &&
    (auth.user?.role === 'ADMIN' || auth.user?.role === 'OWNER');
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const enabled = privateReady && !offline && focused && foreground && visible;
  const actorId = privateReady ? auth.user?.id : undefined;
  const desiredEnabled = useRef(enabled);
  desiredEnabled.current = enabled;
  const current = useRef({
    auth,
    enabled,
    actorId,
    role: auth.user?.role,
    revision: 0,
    identityRevision: 0,
    mounted: true,
  });
  const identityChanged =
    current.current.actorId !== actorId ||
    current.current.auth.api !== auth.api ||
    current.current.role !== auth.user?.role;
  if (
    current.current.enabled !== enabled ||
    current.current.actorId !== actorId ||
    current.current.auth.api !== auth.api ||
    current.current.role !== auth.user?.role
  ) {
    current.current = {
      auth,
      enabled,
      actorId,
      role: auth.user?.role,
      revision: current.current.revision + 1,
      identityRevision: current.current.identityRevision + (identityChanged ? 1 : 0),
      mounted: current.current.mounted,
    };
  } else current.current.auth = auth;
  useEffect(() => {
    current.current.enabled = desiredEnabled.current;
    current.current.mounted = true;
    return () => {
      current.current.enabled = false;
      current.current.revision += 1;
      current.current.identityRevision += 1;
      current.current.mounted = false;
    };
  }, []);
  function requireSession(): typeof current.current {
    if (!current.current.enabled || !current.current.actorId)
      throw new Error('Open and unlock the admin app while online before continuing.');
    return current.current;
  }
  async function request<T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
    const session = requireSession();
    const revision = session.revision;
    const response = await session.auth.api.request(path, { ...options, schema });
    if (!current.current.enabled || current.current.revision !== revision)
      throw new Error('The active session changed. Reopen this screen to see the latest result.');
    return response;
  }
  async function invalidate(): Promise<void> {
    if (!actorId) return;
    await queries.invalidateQueries({ queryKey: ['admin', actorId] });
  }
  function isIdentityCurrent(revision: number): boolean {
    return (
      current.current.mounted &&
      Boolean(current.current.actorId) &&
      current.current.identityRevision === revision
    );
  }
  function waitForReady(identityRevision: number): Promise<boolean> {
    const deadline = Date.now() + 2000;
    return new Promise((resolve) => {
      function check(): void {
        if (!isIdentityCurrent(identityRevision)) {
          resolve(false);
          return;
        }
        if (current.current.enabled) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(check, 25);
      }
      check();
    });
  }
  return {
    actorId,
    enabled,
    offline,
    privateReady,
    owner: auth.user?.role === 'OWNER',
    request,
    invalidate,
    get revision() {
      return current.current.revision;
    },
    get identityRevision() {
      return current.current.identityRevision;
    },
    isIdentityCurrent,
    waitForReady,
    isCurrent: (revision: number): boolean =>
      current.current.enabled && current.current.revision === revision,
    queryOptions: {
      enabled,
      gcTime: 0,
      staleTime: 0,
      retry: false,
      networkMode: 'always' as const,
      placeholderData: () => undefined,
      refetchOnWindowFocus: 'always' as const,
    },
  };
}
