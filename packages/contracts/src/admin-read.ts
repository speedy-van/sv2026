import { z } from 'zod';
import {
  AddressSchema,
  AdminBookingsQuerySchema,
  BookingStatusSchema,
  DispatchStatusSchema,
  IsoTimestampSchema,
  JobStageSchema,
  PageSchema,
  PaginationQuerySchema,
  UserStatusSchema,
} from './api';
import { PenceSchema } from './money';
import { SlotSchema } from './settings';
import { IsoDateSchema } from './time';

export const AdminDayQuerySchema = z.object({ date: IsoDateSchema.optional() }).strict();
export const AdminBookingsReadQuerySchema = AdminBookingsQuerySchema.extend({
  deleted: z.enum(['exclude', 'only']).default('exclude'),
}).refine(({ from, to }) => !from || !to || from <= to, {
  message: 'The end date must be on or after the start date.',
});
export const AdminDriversQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  date: IsoDateSchema.optional(),
  status: UserStatusSchema.optional(),
}).strict();
export const AdminScheduleQuerySchema = z
  .object({
    date: IsoDateSchema.optional(),
    from: IsoDateSchema.optional(),
    to: IsoDateSchema.optional(),
  })
  .strict()
  .refine(
    ({ date, from, to }) =>
      (!date || ((!from || from === date) && (!to || to === date))) && (!from || !to || from === to),
    {
      message: 'Choose a single date for the day schedule.',
    },
  );

const PersonSchema = z.object({ id: z.string(), name: z.string() }).strict();
export const AdminVanSummarySchema = z
  .object({ id: z.string(), label: z.string(), registration: z.string() })
  .strict();
export const AdminBookingSummarySchema = z
  .object({
    id: z.string(),
    reference: z.string(),
    customerName: z.string(),
    service: z.string(),
    variant: z.string(),
    routeLabel: z.string(),
    pickupTown: z.string().nullable(),
    dropoffTown: z.string().nullable(),
    moveDate: IsoDateSchema,
    createdAt: IsoTimestampSchema,
    slot: SlotSchema,
    status: BookingStatusSchema,
    dispatchStatus: DispatchStatusSchema,
    jobStage: JobStageSchema,
    totalPence: PenceSchema,
    paidPence: PenceSchema,
    refundedPence: PenceSchema,
    holdExpiresAt: IsoTimestampSchema.nullable(),
    driver: PersonSchema.nullable(),
    capacityUnits: z.number().int().positive(),
    blocksSlots: z.number().int().positive(),
  })
  .strict();
export const AdminBookingsResponseSchema = PageSchema(AdminBookingSummarySchema);
export const AdminDashboardResponseSchema = z
  .object({
    date: IsoDateSchema,
    generatedAt: IsoTimestampSchema,
    counts: z
      .object({
        scheduled: z.number().int().nonnegative(),
        needsDriver: z.number().int().nonnegative(),
        inProgress: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        pendingPayment: z.number().int().nonnegative(),
      })
      .strict(),
    bookedValuePence: PenceSchema,
    paidPence: PenceSchema,
    jobs: z.array(AdminBookingSummarySchema),
  })
  .strict();
export const AdminManualClosureSchema = z
  .object({
    id: z.string().min(1),
    reason: z.string().min(3).max(200),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export const AdminScheduleSlotSchema = z
  .object({
    slot: SlotSchema,
    capacity: z.number().int().nonnegative(),
    configuredCapacity: z.number().int().nonnegative(),
    confirmedUnits: z.number().int().nonnegative(),
    heldUnits: z.number().int().nonnegative(),
    availableUnits: z.number().int().nonnegative(),
    manualClosure: AdminManualClosureSchema.nullable(),
    closeAllowed: z.boolean(),
    closeBlockedReason: z.string().nullable(),
  })
  .strict();
export const AdminSlotClosureRequestSchema = z
  .object({
    date: IsoDateSchema,
    slot: SlotSchema,
    closed: z.boolean(),
    expectedClosureId: z.string().min(1).nullable(),
    reason: z.string().trim().min(3).max(200),
  })
  .strict();
export const AdminSlotClosureResponseSchema = z
  .object({
    date: IsoDateSchema,
    generatedAt: IsoTimestampSchema,
    window: AdminScheduleSlotSchema,
  })
  .strict();
export const AdminScheduleResponseSchema = z
  .object({
    date: IsoDateSchema,
    generatedAt: IsoTimestampSchema,
    slots: z.array(AdminScheduleSlotSchema).length(3),
    jobs: z.array(AdminBookingSummarySchema),
  })
  .strict();
export const AdminDriverSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    status: UserStatusSchema,
    homePostcode: z.string().nullable(),
    licenceExpiry: IsoDateSchema.nullable(),
    defaultVan: AdminVanSummarySchema.nullable(),
    jobsOnDate: z.number().int().nonnegative(),
    unavailableSlots: z.array(SlotSchema),
  })
  .strict();
export const AdminDriversResponseSchema = PageSchema(AdminDriverSummarySchema);
export const AdminBookingDetailResponseSchema = AdminBookingSummarySchema.extend({
  deletedAt: IsoTimestampSchema.nullable(),
  deletion: z.object({ allowed: z.boolean(), reason: z.string().nullable() }).strict(),
  contactEmail: z.string(),
  contactPhone: z.string(),
  pickup: AddressSchema.nullable(),
  dropoff: AddressSchema.nullable(),
  customerNotes: z.string().nullable(),
  adminNotes: z.string().nullable(),
  distanceMiles: z.number().nonnegative(),
  durationMinutes: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  van: AdminVanSummarySchema.nullable(),
  payments: z.array(
    z
      .object({
        id: z.string(),
        kind: z.enum(['BOOKING', 'ADMIN_BOOKING', 'MANUAL_QUOTE', 'EXTRA_CHARGE', 'RESCHEDULE_DIFFERENCE']),
        method: z.enum(['STRIPE', 'OFFLINE']),
        status: z.enum(['REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED']),
        amountPence: PenceSchema,
        currency: z.string(),
        createdAt: IsoTimestampSchema,
      })
      .strict(),
  ),
}).strict();
export const AdminBookingCleanupRequestSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();
export const AdminBookingCleanupResponseSchema = z
  .object({
    id: z.string(),
    deletedAt: IsoTimestampSchema.nullable(),
    version: z.number().int().nonnegative(),
    status: BookingStatusSchema,
  })
  .strict();
export const AdminDriverDetailResponseSchema = AdminDriverSummarySchema.extend({
  payoutPercent: z.number().int().min(0).max(100).nullable(),
  notes: z.string().nullable(),
  rightToWorkAt: IsoTimestampSchema.nullable(),
  upcomingBookings: z.array(AdminBookingSummarySchema),
  unpaidEarningsPence: PenceSchema,
  hasMoreUpcomingBookings: z.boolean(),
}).strict();

export type AdminBookingSummary = z.infer<typeof AdminBookingSummarySchema>;
export type AdminBookingsResponse = z.infer<typeof AdminBookingsResponseSchema>;
export type AdminDashboardResponse = z.infer<typeof AdminDashboardResponseSchema>;
export type AdminScheduleResponse = z.infer<typeof AdminScheduleResponseSchema>;
export type AdminScheduleSlot = z.infer<typeof AdminScheduleSlotSchema>;
export type AdminSlotClosureRequest = z.infer<typeof AdminSlotClosureRequestSchema>;
export type AdminSlotClosureResponse = z.infer<typeof AdminSlotClosureResponseSchema>;
export type AdminDriverSummary = z.infer<typeof AdminDriverSummarySchema>;
export type AdminDriversResponse = z.infer<typeof AdminDriversResponseSchema>;
export type AdminBookingDetailResponse = z.infer<typeof AdminBookingDetailResponseSchema>;
export type AdminBookingCleanupRequest = z.infer<typeof AdminBookingCleanupRequestSchema>;
export type AdminBookingCleanupResponse = z.infer<typeof AdminBookingCleanupResponseSchema>;
export type AdminDriverDetailResponse = z.infer<typeof AdminDriverDetailResponseSchema>;
