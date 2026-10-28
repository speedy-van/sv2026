import NetInfo from '@react-native-community/netinfo';
import { DriverCreateResponseSchema, DriverCreateSchema } from '@sv/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { useAuth } from '@/state/auth';

type DriverCreateInput = z.input<typeof DriverCreateSchema>;
type DriverCreateResponse = z.infer<typeof DriverCreateResponseSchema>;

export function useAddDriver(): {
  addDriver(input: DriverCreateInput): Promise<DriverCreateResponse>;
  isPending: boolean;
  offline: boolean;
  authorized: boolean;
} {
  const auth = useAuth();
  const network = NetInfo.useNetInfo();
  const queries = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const submitting = useRef(false);
  const activeAuth = useRef(auth);
  const mounted = useRef(true);
  activeAuth.current = auth;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const authorized =
    auth.status === 'signed-in' &&
    !auth.appLocked &&
    Boolean(auth.user?.id) &&
    (auth.user?.role === 'OWNER' || auth.user?.role === 'ADMIN');

  async function addDriver(input: DriverCreateInput): Promise<DriverCreateResponse> {
    if (submitting.current) throw new Error('A driver is already being added.');
    const actor = activeAuth.current;
    if (
      actor.status !== 'signed-in' ||
      actor.appLocked ||
      !actor.user?.id ||
      (actor.user.role !== 'OWNER' && actor.user.role !== 'ADMIN')
    )
      throw new Error('Sign in and unlock the admin app to continue.');
    if (offline) throw new Error('Reconnect to add a driver.');
    const body = DriverCreateSchema.parse(input);
    const actorId = actor.user.id;
    submitting.current = true;
    setIsPending(true);
    try {
      // Keep credentials out of React Query's mutation cache and persistent storage.
      const response = await actor.api.request('/api/v1/admin/drivers', {
        method: 'POST',
        body,
        schema: DriverCreateResponseSchema,
      });
      await queries.invalidateQueries({ queryKey: ['admin', actorId, 'drivers'] });
      return response;
    } finally {
      submitting.current = false;
      if (mounted.current) setIsPending(false);
    }
  }
  return { addDriver, isPending, offline, authorized };
}
