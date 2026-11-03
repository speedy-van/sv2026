import { ApiClientError } from '@sv/api-client';
import NetInfo from '@react-native-community/netinfo';
import {
  AdminBookingAssignmentOptionsSchema,
  AdminBookingCalendarResponseSchema,
  AdminBookingDetailResponseSchema,
  AdminBookingEditContextSchema,
  AdminBookingMutationResponseSchema,
  AdminBookingPatchSchema,
  AdminBookingRepricePreviewSchema,
  AdminBookingReschedulePreviewSchema,
  AdminReschedulePreviewRequestSchema,
  AdminRescheduleSchema,
  AdminUnassignBookingSchema,
  AssignBookingSchema,
  CatalogueResponseSchema,
  PostcodeLookupResponseSchema,
  RepriceApplySchema,
  RepricePreviewSchema,
  UkPostcodeSchema,
  type AdminBookingAssignmentOptions,
  type AdminBookingCalendarResponse,
  type AdminBookingDetailResponse,
  type AdminBookingEditContext,
  type AdminBookingMutationResponse,
  type AdminBookingRepricePreview,
  type AdminBookingReschedulePreview,
} from '@sv/contracts';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { z } from 'zod';
import { useAuth } from '@/state/auth';

const browserRuntime = globalThis as { document?: EventTarget & { hidden: boolean } };

export type BookingEditSection = 'details' | 'move' | 'schedule' | 'driver';
export type BookingEditMutation =
  | { operation: 'details'; input: z.input<typeof AdminBookingPatchSchema> }
  | { operation: 'move'; input: z.input<typeof RepriceApplySchema> }
  | { operation: 'schedule'; input: z.input<typeof AdminRescheduleSchema> }
  | { operation: 'assign'; input: z.input<typeof AssignBookingSchema> }
  | { operation: 'unassign'; input: z.input<typeof AdminUnassignBookingSchema> };
type Catalogue = z.infer<typeof CatalogueResponseSchema>;
type Postcode = z.infer<typeof PostcodeLookupResponseSchema>;
type MovePreviewInput = z.input<typeof RepricePreviewSchema>;
type SchedulePreviewInput = z.input<typeof AdminReschedulePreviewRequestSchema>;

export interface BookingEditorData {
  sessionIdentity: object;
  actorId: string | undefined;
  owner: boolean;
  privateReady: boolean;
  enabled: boolean;
  offline: boolean;
  context: UseQueryResult<AdminBookingEditContext>;
  booking: UseQueryResult<AdminBookingDetailResponse>;
  catalogue: UseQueryResult<Catalogue>;
  calendar: UseQueryResult<AdminBookingCalendarResponse>;
  assignment: UseQueryResult<AdminBookingAssignmentOptions>;
  save: UseMutationResult<AdminBookingMutationResponse, Error, BookingEditMutation>;
  previewMove: UseMutationResult<AdminBookingRepricePreview, Error, MovePreviewInput>;
  previewSchedule: UseMutationResult<AdminBookingReschedulePreview, Error, SchedulePreviewInput>;
  lookupPostcode: (postcode: string) => Promise<Postcode>;
}

export function useBookingEditor(id: string, section: BookingEditSection): BookingEditorData {
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
  const privateReady =
    auth.status === 'signed-in' &&
    !auth.appLocked &&
    Boolean(auth.user?.id) &&
    (auth.user?.role === 'ADMIN' || auth.user?.role === 'OWNER');
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const enabled = privateReady && !offline && foreground && visible && focused && Boolean(id);
  const actorId = privateReady ? auth.user?.id : undefined;
  const runtime = useRef({ auth, enabled });
  runtime.current = { auth, enabled };
  const path = `/api/v1/admin/bookings/${encodeURIComponent(id)}`;
  function requireSession(): ReturnType<typeof useAuth> {
    if (!runtime.current.enabled || !runtime.current.auth.user?.id)
      throw new Error('Open and unlock the admin app while online before changing this booking.');
    return runtime.current.auth;
  }
  function read<T>(suffix: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    return requireSession().api.request(`${path}${suffix}`, { schema, ...(signal ? { signal } : {}) });
  }
  const options = {
    enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    networkMode: 'always' as const,
    placeholderData: () => undefined,
    refetchOnWindowFocus: 'always' as const,
  };
  const context = useQuery({
    ...options,
    queryKey: ['admin', actorId, 'booking-edit', id],
    queryFn: ({ signal }) => read('/edit-context', AdminBookingEditContextSchema, signal),
    refetchInterval: enabled ? 15_000 : false,
  });
  const booking = useQuery({
    ...options,
    queryKey: ['admin', actorId, 'booking-edit-detail', id],
    queryFn: ({ signal }) => read('', AdminBookingDetailResponseSchema, signal),
  });
  const catalogue = useQuery({
    ...options,
    enabled: enabled && section === 'move',
    queryKey: ['admin', actorId, 'booking-edit-catalogue'],
    queryFn: ({ signal }) =>
      requireSession().api.request('/api/v1/catalogue', { schema: CatalogueResponseSchema, signal }),
  });
  const calendar = useQuery({
    ...options,
    enabled: enabled && section === 'schedule',
    queryKey: ['admin', actorId, 'booking-calendar', id],
    queryFn: ({ signal }) => read('/calendar', AdminBookingCalendarResponseSchema, signal),
  });
  const assignment = useQuery({
    ...options,
    enabled: enabled && (section === 'driver' || section === 'details'),
    queryKey: ['admin', actorId, 'booking-assignment-options', id],
    queryFn: ({ signal }) => read('/assignment-options', AdminBookingAssignmentOptionsSchema, signal),
  });
  async function invalidate(userId: string | undefined): Promise<void> {
    await queries.invalidateQueries({ queryKey: ['admin', userId] });
  }
  const save = useMutation<AdminBookingMutationResponse, Error, BookingEditMutation>({
    networkMode: 'always',
    retry: false,
    mutationFn: async (variables) => {
      const session = requireSession();
      const userId = session.user?.id;
      const request =
        variables.operation === 'details'
          ? { suffix: '', method: 'PATCH' as const, body: AdminBookingPatchSchema.parse(variables.input) }
          : variables.operation === 'move'
            ? {
                suffix: '/reprice-apply',
                method: 'POST' as const,
                body: RepriceApplySchema.parse(variables.input),
              }
            : variables.operation === 'schedule'
              ? {
                  suffix: '/reschedule',
                  method: 'POST' as const,
                  body: AdminRescheduleSchema.parse(variables.input),
                }
              : variables.operation === 'assign'
                ? {
                    suffix: '/assign',
                    method: 'POST' as const,
                    body: AssignBookingSchema.parse(variables.input),
                  }
                : {
                    suffix: '/unassign',
                    method: 'POST' as const,
                    body: AdminUnassignBookingSchema.parse(variables.input),
                  };
      try {
        const response = await session.api.request(`${path}${request.suffix}`, {
          method: request.method,
          body: request.body,
          schema: AdminBookingMutationResponseSchema,
        });
        if (response.id !== id || response.version <= variables.input.expectedVersion)
          throw new Error('The server did not confirm an updated booking. Reload before continuing.');
        await invalidate(userId);
        return response;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 409) await invalidate(userId);
        throw error;
      }
    },
  });
  const previewMove = useMutation<AdminBookingRepricePreview, Error, MovePreviewInput>({
    networkMode: 'always',
    retry: false,
    mutationFn: async (input) => {
      const session = requireSession();
      try {
        const result = await session.api.request(`${path}/reprice-preview`, {
          method: 'POST',
          body: RepricePreviewSchema.parse(input),
          schema: AdminBookingRepricePreviewSchema,
        });
        if (result.id !== id || result.expectedVersion !== input.expectedVersion)
          throw new Error('This preview is for an older booking. Reload the booking and preview again.');
        return result;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 409) await invalidate(session.user?.id);
        throw error;
      }
    },
  });
  const previewSchedule = useMutation<AdminBookingReschedulePreview, Error, SchedulePreviewInput>({
    networkMode: 'always',
    retry: false,
    mutationFn: async (input) => {
      const session = requireSession();
      try {
        const result = await session.api.request(`${path}/reschedule-preview`, {
          method: 'POST',
          body: AdminReschedulePreviewRequestSchema.parse(input),
          schema: AdminBookingReschedulePreviewSchema,
        });
        if (
          result.id !== id ||
          result.expectedVersion !== input.expectedVersion ||
          result.date !== input.date ||
          result.slot !== input.slot
        )
          throw new Error('This preview no longer matches the selected date. Preview the change again.');
        return result;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 409) await invalidate(session.user?.id);
        throw error;
      }
    },
  });
  async function lookupPostcode(value: string): Promise<Postcode> {
    const session = requireSession();
    const postcode = UkPostcodeSchema.parse(value);
    const result = await session.api.request(`/api/v1/address/postcode/${encodeURIComponent(postcode)}`, {
      schema: PostcodeLookupResponseSchema,
    });
    if (runtime.current.auth.api !== session.api || !runtime.current.enabled)
      throw new Error('The editing session changed. Verify the address again.');
    if (result.postcode !== postcode) throw new Error('The returned postcode did not match the address.');
    return result;
  }
  return {
    sessionIdentity: auth.api,
    actorId,
    owner: auth.user?.role === 'OWNER',
    privateReady,
    enabled,
    offline,
    context,
    booking,
    catalogue,
    calendar,
    assignment,
    save,
    previewMove,
    previewSchedule,
    lookupPostcode,
  };
}
