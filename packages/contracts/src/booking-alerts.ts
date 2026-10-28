import { z } from 'zod';
import { IsoTimestampSchema } from './api';
import { PenceSchema } from './money';
import { SlotSchema } from './settings';
import { IsoDateSchema } from './time';

export const AdminBookingAlertsQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const AdminBookingAlertDataSchema = z
  .object({
    bookingId: z.string().min(1),
    deliveryKey: z.string().min(1),
    eventType: z.literal('booking.confirmed'),
    type: z.literal('NEW_BOOKING'),
    reference: z.string().min(1),
    pricePence: PenceSchema,
    route: z.string().min(1),
    service: z.string().min(1),
    slot: SlotSchema,
    moveDate: IsoDateSchema,
  })
  .strict();

export const AdminBookingAlertSchema = z
  .object({
    id: z.string().min(1),
    createdAt: IsoTimestampSchema,
    title: z.string(),
    body: z.string(),
    data: AdminBookingAlertDataSchema,
  })
  .strict();

export const AdminBookingAlertsResponseSchema = z
  .object({
    items: z.array(AdminBookingAlertSchema),
    nextCursor: z.string().nullable(),
    generatedAt: IsoTimestampSchema,
  })
  .strict();

export const BookingAlertReadRequestSchema = z
  .object({ bookingId: z.string().trim().min(1).max(200) })
  .strict();
export const BookingAlertReadResponseSchema = z.object({ ok: z.literal(true) }).strict();

export type AdminBookingAlert = z.infer<typeof AdminBookingAlertSchema>;
export type AdminBookingAlertsResponse = z.infer<typeof AdminBookingAlertsResponseSchema>;
