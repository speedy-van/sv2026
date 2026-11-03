import { z } from 'zod';
import { BookingStatusSchema, IsoTimestampSchema, ServiceKeySchema } from './api';
import { IsoDateSchema } from './time';
import { PenceSchema } from './money';
import { SlotSchema } from './settings';
import { VISITOR_ACTIVE_WINDOW_SECONDS, VISITOR_HEARTBEAT_INTERVAL_SECONDS } from './visitor-presence';

export const BOOKING_ACTIVITY_COOKIE_NAME = 'sv_booking_activity';
export const BOOKING_ACTIVITY_RETENTION_HOURS = 24;
export const BOOKING_ACTIVITY_HEARTBEAT_INTERVAL_SECONDS = VISITOR_HEARTBEAT_INTERVAL_SECONDS;
export const BOOKING_ACTIVITY_ACTIVE_WINDOW_SECONDS = VISITOR_ACTIVE_WINDOW_SECONDS;
export const ABANDONED_CHECKOUT_WINDOW_DAYS = 30;
export const BookingActivityStageSchema = z.enum(['SERVICE', 'MOVE', 'ITEMS', 'DATE', 'PAYMENT']);
export const BookingActivityHeartbeatRequestSchema = z.object({
  stage: BookingActivityStageSchema,
  service: ServiceKeySchema.nullable(),
}).strict();
export const BookingActivityWithdrawRequestSchema = z.object({}).strict();
export const BookingActivityHeartbeatResponseSchema = z.object({
  tracked: z.boolean(), activeWindowSeconds: z.literal(BOOKING_ACTIVITY_ACTIVE_WINDOW_SECONDS),
  retentionHours: z.literal(BOOKING_ACTIVITY_RETENTION_HOURS),
}).strict();

export const AdminBookingActivityQuerySchema = z.object({
  scope: z.enum(['active', 'recent']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.uuid().optional(),
}).strict();
export const AdminBookingActivityItemSchema = z.object({
  id: z.uuid(), stage: BookingActivityStageSchema, service: ServiceKeySchema.nullable(),
  startedAt: IsoTimestampSchema, lastSeenAt: IsoTimestampSchema, active: z.boolean(), quoteId: z.string().min(1).nullable(),
  booking: z.object({ id: z.string().min(1), reference: z.string().min(1), status: BookingStatusSchema, customerName: z.string().min(1) }).strict().nullable(),
}).strict();
const CountSchema = z.number().int().nonnegative();
export const AdminBookingActivityResponseSchema = z.object({
  generatedAt: IsoTimestampSchema, activeWindowSeconds: z.literal(BOOKING_ACTIVITY_ACTIVE_WINDOW_SECONDS),
  retentionHours: z.literal(BOOKING_ACTIVITY_RETENTION_HOURS), measurement: z.literal('consenting-browsers'),
  counts: z.object({ active: CountSchema, SERVICE: CountSchema, MOVE: CountSchema, ITEMS: CountSchema, DATE: CountSchema, PAYMENT: CountSchema }).strict(),
  items: z.array(AdminBookingActivityItemSchema), nextCursor: z.uuid().nullable(),
}).strict();
export const AdminAbandonedCheckoutsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(120).optional(),
}).strict();
export const AdminAbandonedCheckoutSchema = z.object({
  id: z.string().min(1), reference: z.string().min(1), customerName: z.string().min(1),
  contactEmail: z.email(), contactPhone: z.string().min(1), service: ServiceKeySchema,
  routeLabel: z.string().min(1), moveDate: IsoDateSchema, slot: SlotSchema, totalPence: PenceSchema,
  createdAt: IsoTimestampSchema, expiredAt: IsoTimestampSchema.nullable(),
}).strict();
export const AdminAbandonedCheckoutsResponseSchema = z.object({
  generatedAt: IsoTimestampSchema, windowDays: z.literal(ABANDONED_CHECKOUT_WINDOW_DAYS),
  items: z.array(AdminAbandonedCheckoutSchema), nextCursor: z.string().min(1).nullable(),
}).strict();

export type BookingActivityStage = z.infer<typeof BookingActivityStageSchema>;
export type BookingActivityHeartbeatRequest = z.infer<typeof BookingActivityHeartbeatRequestSchema>;
export type BookingActivityHeartbeatResponse = z.infer<typeof BookingActivityHeartbeatResponseSchema>;
export type AdminBookingActivityResponse = z.infer<typeof AdminBookingActivityResponseSchema>;
export type AdminAbandonedCheckoutsResponse = z.infer<typeof AdminAbandonedCheckoutsResponseSchema>;
