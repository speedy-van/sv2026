import {
  AdminBookingDetailResponseSchema,
  AdminBookingCleanupRequestSchema,
  AdminBookingCleanupResponseSchema,
  AdminBookingsResponseSchema,
  AdminDashboardResponseSchema,
  AdminDriverDetailResponseSchema,
  AdminDriversResponseSchema,
  AdminScheduleResponseSchema,
  AdminSlotClosureRequestSchema,
  AdminSlotClosureResponseSchema,
  addDays,
  londonToday,
  type BookingStatus,
  type DispatchStatus,
  type AdminBookingSummary,
  type AdminDriverSummary,
  type AdminDashboardResponse,
  type AdminScheduleResponse,
  type AdminBookingDetailResponse,
  type AdminDriverDetailResponse,
  type AdminBookingsResponse,
  type AdminDriversResponse,
  type AdminBookingCleanupResponse,
  type AdminSlotClosureRequest,
  type AdminSlotClosureResponse,
} from '@sv/contracts';
import { ApiClientError } from '@sv/api-client';
import {
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
  infiniteQueryOptions,
  queryOptions,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useAuth } from '@/state/auth';

export function adminToday(): string {
  return londonToday();
}
export function shiftAdminDate(date: string, days: number): string {
  return addDays(date, days);
}
export function displayAdminDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  }).format(new Date(`${date}T12:00:00Z`));
}
export function slotLabel(slot: AdminBookingSummary['slot']): string {
  return { MORNING: 'Morning', AFTERNOON: 'Afternoon', EVENING: 'Evening' }[slot];
}
export function serviceLabel(service: string): string {
  const labels: Record<string, string> = {
    house_removals: 'Home move',
    home: 'Home move',
    home_removals: 'Home move',
    man_and_van: 'Man and van',
    furniture: 'Furniture move',
    furniture_removals: 'Furniture move',
  };
  return labels[service] ?? service.replace(/[_-]/gu, ' ').replace(/^./u, (letter) => letter.toUpperCase());
}
export function bookingStatusLabel(status: BookingStatus): string {
  return {
    PENDING_PAYMENT: 'Awaiting payment',
    CONFIRMED: 'Confirmed',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
  }[status];
}
export function jobStageLabel(stage: AdminBookingSummary['jobStage']): string {
  return {
    NOT_STARTED: 'Not started',
    EN_ROUTE_TO_PICKUP: 'On the way to pickup',
    AT_PICKUP: 'At pickup',
    LOADING: 'Loading',
    EN_ROUTE_TO_DROPOFF: 'On the way to delivery',
    AT_DROPOFF: 'At delivery',
    UNLOADING: 'Unloading',
    COMPLETED: 'Completed',
  }[stage];
}

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') params.set(key, String(value));
  const result = params.toString();
  return result ? `?${result}` : '';
}
function retryRead(attempt: number, error: Error): boolean {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) return false;
  return attempt < 1;
}

type AdminApi = ReturnType<typeof useAuth>['api'];
type AdminReadOptions<T> = ReturnType<typeof queryOptions<T>>;
type AdminListOptions<T> = ReturnType<typeof infiniteQueryOptions<T, Error, T, readonly unknown[], string | undefined>>;

export function dashboardQueryOptions(api: AdminApi, actorId: string | undefined, date: string): AdminReadOptions<AdminDashboardResponse> {
  return queryOptions<AdminDashboardResponse>({
    queryKey: ['admin', actorId, 'dashboard', date],
    networkMode: 'always',
    queryFn: ({ signal }) =>
      api.request(`/api/v1/admin/dashboard${queryString({ date })}`, {
        schema: AdminDashboardResponseSchema,
        signal,
      }),
    staleTime: 10_000,
    retry: retryRead,
  });
}

export function useDashboard(date: string): UseQueryResult<AdminDashboardResponse> {
  const auth = useAuth();
  const focused = useIsFocused();
  return useQuery({
    ...dashboardQueryOptions(auth.api, auth.user?.id, date),
    enabled: auth.status === 'signed-in' && !auth.appLocked,
    refetchInterval: focused ? 20_000 : false,
  });
}
export interface BookingFilters {
  deleted?: 'exclude' | 'only';
  q?: string;
  status?: BookingStatus;
  dispatch?: DispatchStatus;
  from?: string;
  to?: string;
  driverId?: string;
}
export function bookingsQueryOptions(api: AdminApi, actorId: string | undefined, filters: BookingFilters = {}): AdminListOptions<AdminBookingsResponse> {
  return infiniteQueryOptions<AdminBookingsResponse, Error, AdminBookingsResponse, readonly unknown[], string | undefined>({
    queryKey: ['admin', actorId, 'bookings', filters],
    networkMode: 'always',
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.request(`/api/v1/admin/bookings${queryString({ ...filters, cursor: pageParam, limit: 30 })}`, {
        schema: AdminBookingsResponseSchema,
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    select: (data) => ({
      items: data.pages.flatMap((page): AdminBookingSummary[] => page.items),
      nextCursor: data.pages.at(-1)?.nextCursor ?? null,
    }),
    staleTime: 10_000,
    retry: retryRead,
  });
}

export function useBookings(filters: BookingFilters = {}): UseInfiniteQueryResult<AdminBookingsResponse> {
  const auth = useAuth();
  const focused = useIsFocused();
  return useInfiniteQuery({
    ...bookingsQueryOptions(auth.api, auth.user?.id, filters),
    enabled: auth.status === 'signed-in' && !auth.appLocked,
    refetchInterval: focused ? 20_000 : false,
  });
}
export function scheduleQueryOptions(api: AdminApi, actorId: string | undefined, date: string): AdminReadOptions<AdminScheduleResponse> {
  return queryOptions<AdminScheduleResponse>({
    queryKey: ['admin', actorId, 'schedule', date],
    networkMode: 'always',
    queryFn: ({ signal }) =>
      api.request(`/api/v1/admin/schedule${queryString({ date })}`, {
        schema: AdminScheduleResponseSchema,
        signal,
      }),
    staleTime: 10_000,
    retry: retryRead,
  });
}

export function useSchedule(date: string): UseQueryResult<AdminScheduleResponse> {
  const auth = useAuth();
  const focused = useIsFocused();
  return useQuery({
    ...scheduleQueryOptions(auth.api, auth.user?.id, date),
    enabled: auth.status === 'signed-in' && !auth.appLocked,
    refetchInterval: focused ? 20_000 : false,
  });
}
export interface DriverFilters {
  q?: string;
  date?: string;
  status?: AdminDriverSummary['status'];
}
export function driversQueryOptions(api: AdminApi, actorId: string | undefined, filters: DriverFilters = {}): AdminListOptions<AdminDriversResponse> {
  return infiniteQueryOptions<AdminDriversResponse, Error, AdminDriversResponse, readonly unknown[], string | undefined>({
    queryKey: ['admin', actorId, 'drivers', filters],
    networkMode: 'always',
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.request(`/api/v1/admin/drivers${queryString({ ...filters, cursor: pageParam, limit: 30 })}`, {
        schema: AdminDriversResponseSchema,
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    select: (data) => ({
      items: data.pages.flatMap((page): AdminDriverSummary[] => page.items),
      nextCursor: data.pages.at(-1)?.nextCursor ?? null,
    }),
    staleTime: 10_000,
    retry: retryRead,
  });
}

export function useDrivers(filters: DriverFilters = {}): UseInfiniteQueryResult<AdminDriversResponse> {
  const auth = useAuth();
  const focused = useIsFocused();
  return useInfiniteQuery({
    ...driversQueryOptions(auth.api, auth.user?.id, filters),
    enabled: auth.status === 'signed-in' && !auth.appLocked,
    refetchInterval: focused ? 20_000 : false,
  });
}
export function useBookingDetail(id: string): UseQueryResult<AdminBookingDetailResponse> {
  const auth = useAuth();
  const focused = useIsFocused();
  return useQuery({
    queryKey: ['admin', auth.user?.id, 'booking', id],
    networkMode: 'always',
    queryFn: () =>
      auth.api.request(`/api/v1/admin/bookings/${encodeURIComponent(id)}`, {
        schema: AdminBookingDetailResponseSchema,
      }),
    enabled: Boolean(id) && auth.status === 'signed-in' && !auth.appLocked,
    refetchInterval: focused ? 15_000 : false,
    staleTime: 5_000,
    retry: retryRead,
  });
}
export function useDriverDetail(id: string): UseQueryResult<AdminDriverDetailResponse> {
  const auth = useAuth();
  const focused = useIsFocused();
  return useQuery({
    queryKey: ['admin', auth.user?.id, 'driver', id],
    networkMode: 'always',
    queryFn: () =>
      auth.api.request(`/api/v1/admin/drivers/${encodeURIComponent(id)}`, {
        schema: AdminDriverDetailResponseSchema,
      }),
    enabled: Boolean(id) && auth.status === 'signed-in' && !auth.appLocked,
    refetchInterval: focused ? 20_000 : false,
    staleTime: 10_000,
    retry: retryRead,
  });
}

export interface BookingCleanupVariables {
  id: string;
  expectedVersion: number;
  operation: 'delete' | 'restore';
}

export function useBookingCleanup(): UseMutationResult<
  AdminBookingCleanupResponse,
  Error,
  BookingCleanupVariables
> {
  const auth = useAuth();
  const queries = useQueryClient();
  function refreshAdmin(): void {
    void queries.invalidateQueries({ queryKey: ['admin', auth.user?.id] });
  }
  return useMutation({
    mutationFn: ({ id, expectedVersion, operation }) => {
      if (auth.status !== 'signed-in' || auth.appLocked)
        throw new Error('Sign in and unlock the app to continue.');
      const body = AdminBookingCleanupRequestSchema.parse({ expectedVersion });
      return auth.api.request(
        `/api/v1/admin/bookings/${encodeURIComponent(id)}${operation === 'restore' ? '/restore' : ''}`,
        {
          method: operation === 'restore' ? 'POST' : 'DELETE',
          body,
          schema: AdminBookingCleanupResponseSchema,
        },
      );
    },
    retry: false,
    networkMode: 'always',
    onSuccess: refreshAdmin,
    onError: (error) => {
      if (error instanceof ApiClientError && error.status === 409) refreshAdmin();
    },
  });
}

interface SlotClosureContext {
  actorId: string;
}

export function useSlotClosure(): UseMutationResult<
  AdminSlotClosureResponse,
  Error,
  AdminSlotClosureRequest,
  SlotClosureContext
> {
  const auth = useAuth();
  const queries = useQueryClient();
  function requireActor(): string {
    if (auth.status !== 'signed-in' || auth.appLocked || !auth.user?.id)
      throw new Error('Sign in and unlock the app to continue.');
    return auth.user.id;
  }
  return useMutation({
    onMutate: () => ({ actorId: requireActor() }),
    mutationFn: async (input) => {
      requireActor();
      const body = AdminSlotClosureRequestSchema.parse(input);
      const result = await auth.api.request('/api/v1/admin/capacity/closures', {
        method: 'PUT',
        body,
        schema: AdminSlotClosureResponseSchema,
      });
      if (result.date !== body.date || result.window.slot !== body.slot)
        throw new Error('The server response did not match this date and time window. Refresh the schedule.');
      return result;
    },
    retry: false,
    networkMode: 'always',
    onSuccess: async (result, _input, context) => {
      queries.setQueryData<AdminScheduleResponse>(
        ['admin', context.actorId, 'schedule', result.date],
        (current) => {
          if (
            !current ||
            current.date !== result.date ||
            !current.slots.some((window) => window.slot === result.window.slot)
          )
            return current;
          return {
            ...current,
            generatedAt: result.generatedAt,
            slots: current.slots.map((window) =>
              window.slot === result.window.slot ? result.window : window,
            ),
          };
        },
      );
      await queries.invalidateQueries({ queryKey: ['admin', context.actorId] });
    },
    onError: async (error, _input, context) => {
      if (error instanceof ApiClientError && error.status === 409 && context)
        await queries.invalidateQueries({ queryKey: ['admin', context.actorId] });
    },
  });
}
