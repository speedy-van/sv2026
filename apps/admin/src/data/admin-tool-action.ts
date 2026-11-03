import { ApiClientError } from '@sv/api-client';
import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ZodError } from 'zod';
import type { AdminToolSession } from './admin-tool-session';

export function adminActionError(cause: unknown): string {
  if (cause instanceof ZodError)
    return `Check the form: ${cause.issues[0]?.message ?? 'Complete all required fields.'}`;
  if (
    cause instanceof ApiClientError &&
    (cause.envelope?.error.code === 'CONFLICT' || cause.envelope?.error.code === 'PRICE_CHANGED')
  )
    return `${cause.message} Reload the current record before trying again.`;
  return cause instanceof Error
    ? cause.message
    : 'The action could not be completed. Check your connection and try again.';
}

interface AdminAction {
  busy: boolean;
  error: string | null;
  message: string | null;
  needsReload: boolean;
  clear(): void;
  run<T>(
    action: () => Promise<T>,
    options?: { success?: string; authenticate?: string },
  ): Promise<T | undefined>;
}
export function useAdminToolAction(session: AdminToolSession): AdminAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const current = useRef(session);
  current.current = session;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return {
    busy,
    error,
    message,
    needsReload,
    clear: () => {
      setError(null);
      setMessage(null);
      setNeedsReload(false);
    },
    run: async <T>(
      action: () => Promise<T>,
      options: { success?: string; authenticate?: string } = {},
    ): Promise<T | undefined> => {
      if (pending.current || !current.current.enabled) return undefined;
      pending.current = true;
      setBusy(true);
      setError(null);
      setMessage(null);
      let revision = current.current.revision;
      const identityRevision = current.current.identityRevision;
      const hasIdentity = (): boolean => mounted.current && current.current.isIdentityCurrent(identityRevision);
      const valid = (): boolean => mounted.current && current.current.isCurrent(revision);
      try {
        if (options.authenticate) {
          if (Platform.OS === 'web')
            throw new Error(
              'Confirm this financial action in the installed admin app using Face ID or your device passcode.',
            );
          const confirmation = await LocalAuthentication.authenticateAsync({
            promptMessage: options.authenticate,
            cancelLabel: 'Cancel',
          });
          if (!hasIdentity()) return undefined;
          if (!confirmation.success)
            throw new Error('Device confirmation was cancelled. No changes were sent.');
          const ready = await current.current.waitForReady(identityRevision);
          if (!hasIdentity()) return undefined;
          if (!ready)
            throw new Error(
              'Return to the unlocked admin app while online, then try again. No changes were sent.',
            );
          revision = current.current.revision;
        }
        if (!valid()) return undefined;
        const result = await action();
        if (!valid()) return undefined;
        if (options.success) setMessage(options.success);
        return result;
      } catch (cause) {
        if (
          valid() ||
          (options.authenticate && mounted.current && current.current.isIdentityCurrent(identityRevision))
        ) {
          setError(adminActionError(cause));
          if (cause instanceof ApiClientError && cause.status === 409) setNeedsReload(true);
        }
        return undefined;
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
  };
}
