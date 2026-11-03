import { z } from 'zod';
import { IsoDateSchema } from './time';
import { SlotSchema } from './settings';
import { PenceSchema } from './money';
import { UserStatusSchema } from './api';

const BookingIdSchema = z.string().trim().min(1);
const VersionSchema = z.number().int().nonnegative();
const CapabilityReasonSchema = z.string().min(1).nullable();

export const AdminBookingCalendarResponseSchema = z.object({
  bookingId: BookingIdSchema,
  version: VersionSchema,
  currentDate: IsoDateSchema,
  currentSlot: SlotSchema,
  currentTotalPence: PenceSchema,
  days: z.array(z.object({
    date: IsoDateSchema,
    slots: z.array(z.object({
      slot: SlotSchema,
      windowLabel: z.string().min(1),
      pricePence: PenceSchema,
      available: z.boolean(),
      reason: CapabilityReasonSchema,
      current: z.boolean(),
    }).strict()),
  }).strict()),
}).strict();

export const AdminBookingReschedulePreviewSchema = z.object({
  id: BookingIdSchema,
  expectedVersion: VersionSchema,
  date: IsoDateSchema,
  slot: SlotSchema,
  currentTotalPence: PenceSchema,
  newTotalPence: PenceSchema,
  differencePence: z.number().int(),
  willUnassignDriver: z.boolean(),
  settle: z.enum(['EXTRA_CHARGE', 'REFUND', 'NONE']),
  settlementAmountPence: PenceSchema,
}).strict().refine((value) => value.differencePence === value.newTotalPence - value.currentTotalPence, { message: 'Price difference must match the totals.', path: ['differencePence'] }).refine((value) => (value.settle === 'NONE') === (value.settlementAmountPence === 0), { message: 'Settlement amount must match its action.', path: ['settlementAmountPence'] });

export const AdminBookingAssignmentOptionsSchema = z.object({
  bookingId: BookingIdSchema,
  version: VersionSchema,
  editable: z.boolean(),
  reason: CapabilityReasonSchema,
  drivers: z.array(z.object({
    id: BookingIdSchema,
    name: z.string().min(1),
    status: UserStatusSchema,
    defaultVanId: BookingIdSchema.nullable(),
    available: z.boolean(),
    reason: CapabilityReasonSchema,
  }).strict()),
  vans: z.array(z.object({
    id: BookingIdSchema,
    label: z.string().min(1),
    registration: z.string().min(1),
    available: z.boolean(),
    reason: CapabilityReasonSchema,
  }).strict()),
}).strict();

export type AdminBookingCalendarResponse = z.infer<typeof AdminBookingCalendarResponseSchema>;
export type AdminBookingReschedulePreview = z.infer<typeof AdminBookingReschedulePreviewSchema>;
export type AdminBookingAssignmentOptions = z.infer<typeof AdminBookingAssignmentOptionsSchema>;
