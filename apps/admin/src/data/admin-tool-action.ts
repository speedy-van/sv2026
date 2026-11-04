import { ApiClientError } from '@sv/api-client';
import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ZodError } from 'zod';
import type { AdminToolSession } from './admin-tool-session';

// Plain-language prompts for form fields, so the owner never sees raw validation wording.
const fieldPrompts: Record<string, string> = {
  reason: 'Please write a reason.',
  description: 'Please say what the charge is for.',
  reference: 'Please say how they paid.',
  paymentId: 'Please choose which payment to refund.',
  amountPence: 'Please enter an amount.',
  paidAt: 'Please choose when it was paid.',
};

export function adminActionError(cause: unknown): string {
  if (cause instanceof ZodError) {
    const field = cause.issues[0]?.path[0];
    return (typeof field === 'string' ? fieldPrompts[field] : undefined) ??
      'Some details are missing or not quite right. Please check the form and try again.';
  }
  if (
    cause instanceof ApiClientError &&
    (cause.envelope?.error.code === 'CONFLICT' || cause.envelope?.error.code === 'PRICE_CHANGED')
  )
    return `${cause.message} Tap Refresh to load the latest details, then try again.`;
  return cause instanceof Error
    ? cause.message
    : 'That didn’t go through. Check your internet connection and try again.';
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
