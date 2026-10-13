import type { SpeedyVanApiClient } from '@sv/api-client';
import { DriverAvailabilitySchema, DriverExtraRequestSchema, DriverSignatureSchema, DriverSyncRequestSchema, type JobStage } from '@sv/contracts';
import { z } from 'zod';

export const JobCardSchema = z.object({
  assignmentId: z.string().optional(),
  bookingId: z.string(),
  dispatchStatus: z.string(),
  earningPence: z.number().int(),
  expiresAt: z.string().nullable().optional(),
  jobStage: z.string(),
  moveDate: z.string(),
  reference: z.string(),
  route: z.string(),
  service: z.string(),
  slot: z.string()
}).loose();

export const JobListSchema = z.object({
  items: z.array(JobCardSchema),
  nextCursor: z.string().nullable()
});

export const JobDetailSchema = z.object({
  accessDetail: z.unknown(),
  contact: z.object({ name: z.string(), phone: z.string() }),
  customerNotes: z.string().nullable(),
  dispatchStatus: z.string(),
  earningPence: z.number().int(),
  extraCharges: z.array(z.object({ amountPence: z.number().int(), description: z.string(), id: z.string(), status: z.string() }).loose()),
  id: z.string(),
  items: z.unknown(),
  jobStage: z.string(),
  moveDate: z.string(),
  pickup: z.unknown(),
  dropoff: z.unknown().nullable(),
  reference: z.string(),
  route: z.string(),
  service: z.string(),
  signature: z.unknown().nullable(),
  slot: z.string(),
  status: z.string()
}).loose();

export const OkSchema = z.object({ ok: z.boolean() }).loose();
export const PhotoResponseSchema = z.object({ id: z.string(), ok: z.boolean() });
export const ExtraResponseSchema = z.object({ id: z.string(), ok: z.boolean() });
export const LocationResponseSchema = z.object({ stored: z.number().int() });
export const EarningsSchema = z.object({
  items: z.array(z.object({
    amountPence: z.number().int(),
    bookingReference: z.string(),
    id: z.string(),
    moveDate: z.string(),
    paid: z.boolean(),
    service: z.string()
  }).loose()),
  totals: z.object({ earnedPence: z.number().int(), paidPence: z.number().int(), unpaidPence: z.number().int() })
});
export const AvailabilityResponseSchema = z.object({
  unavailable: z.array(z.object({ date: z.string(), reason: z.string().nullable(), slot: z.string() }).loose())
});
export const ProfileSchema = z.object({
  email: z.string(),
  homePostcode: z.string().nullable(),
  licenceExpiry: z.string().nullable(),
  name: z.string(),
  payoutPercent: z.number().int(),
  phone: z.string().nullable()
});

export type JobCard = z.infer<typeof JobCardSchema>;
export type JobDetail = z.infer<typeof JobDetailSchema>;
export type Earnings = z.infer<typeof EarningsSchema>;

export function listJobs(api: SpeedyVanApiClient, scope: 'history' | 'offers' | 'today' | 'upcoming' = 'today'): Promise<z.infer<typeof JobListSchema>> {
  return api.request(`/api/v1/driver/jobs?scope=${scope}`, { schema: JobListSchema });
}

export function getJob(api: SpeedyVanApiClient, bookingId: string): Promise<JobDetail> {
  return api.request(`/api/v1/driver/jobs/${bookingId}`, { schema: JobDetailSchema });
}

export function acceptOffer(api: SpeedyVanApiClient, bookingId: string): Promise<z.infer<typeof OkSchema>> {
  return api.request(`/api/v1/driver/jobs/${bookingId}/accept`, { body: {}, schema: OkSchema });
}

export function declineOffer(api: SpeedyVanApiClient, bookingId: string, reason?: string): Promise<z.infer<typeof OkSchema>> {
  return api.request(`/api/v1/driver/jobs/${bookingId}/decline`, { body: reason ? { reason } : {}, schema: OkSchema });
}

export function syncEvents(api: SpeedyVanApiClient, body: z.infer<typeof DriverSyncRequestSchema>) {
  return api.request('/api/v1/driver/sync', { body: DriverSyncRequestSchema.parse(body), schema: z.object({
    events: z.array(z.discriminatedUnion('result', [
      z.object({ clientEventId: z.string(), result: z.enum(['APPLIED', 'DUPLICATE']) }),
      z.object({ clientEventId: z.string(), error: z.string(), result: z.literal('REJECTED') })
    ]))
  }) });
}

export function uploadSignature(api: SpeedyVanApiClient, bookingId: string, body: z.infer<typeof DriverSignatureSchema>): Promise<z.infer<typeof OkSchema>> {
  return api.request(`/api/v1/driver/jobs/${bookingId}/signature`, { body: DriverSignatureSchema.parse(body), schema: OkSchema });
}

export function requestExtra(api: SpeedyVanApiClient, bookingId: string, body: z.infer<typeof DriverExtraRequestSchema>): Promise<z.infer<typeof ExtraResponseSchema>> {
  return api.request(`/api/v1/driver/jobs/${bookingId}/extra-requests`, { body: DriverExtraRequestSchema.parse(body), schema: ExtraResponseSchema });
}

export function sendLocation(api: SpeedyVanApiClient, body: unknown): Promise<z.infer<typeof LocationResponseSchema>> {
  return api.request('/api/v1/driver/location', { body, schema: LocationResponseSchema });
}

export function listEarnings(api: SpeedyVanApiClient): Promise<Earnings> {
  return api.request('/api/v1/driver/earnings', { schema: EarningsSchema });
}

export function getAvailability(api: SpeedyVanApiClient): Promise<z.infer<typeof AvailabilityResponseSchema>> {
  return api.request('/api/v1/driver/availability', { schema: AvailabilityResponseSchema });
}

export function putAvailability(api: SpeedyVanApiClient, body: z.infer<typeof DriverAvailabilitySchema>): Promise<z.infer<typeof OkSchema>> {
  return api.request('/api/v1/driver/availability', { body: DriverAvailabilitySchema.parse(body), method: 'PUT', schema: OkSchema });
}

export function getProfile(api: SpeedyVanApiClient): Promise<z.infer<typeof ProfileSchema>> {
  return api.request('/api/v1/driver/profile', { schema: ProfileSchema });
}

export function isJobStage(value: string): value is JobStage {
  return ['NOT_STARTED', 'EN_ROUTE_TO_PICKUP', 'AT_PICKUP', 'LOADING', 'EN_ROUTE_TO_DROPOFF', 'AT_DROPOFF', 'UNLOADING', 'COMPLETED'].includes(value);
}
