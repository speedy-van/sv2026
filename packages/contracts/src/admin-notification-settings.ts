import { z } from 'zod';
import { IsoTimestampSchema } from './api';

export const AdminNotificationSettingsResponseSchema = z.object({
  generatedAt: IsoTimestampSchema,
  devices: z.array(z.object({
    id: z.string().min(1), platform: z.enum(['IOS', 'ANDROID', 'WEB']), enabled: z.boolean(),
    currentSession: z.boolean(), deviceName: z.string().nullable(), pendingBookingAlerts: z.boolean(),
    lastRegisteredAt: IsoTimestampSchema, lastError: z.string().nullable(),
    latestTicket: z.object({ status: z.string().nullable(), createdAt: IsoTimestampSchema, checkedAt: IsoTimestampSchema.nullable(), error: z.string().nullable() }).strict().nullable(),
  }).strict()),
}).strict();
export const AdminNotificationSettingsUpdateSchema = z.object({ deviceId: z.string().min(1), pendingBookingAlerts: z.boolean() }).strict();
export const AdminNotificationSettingsUpdateResponseSchema = z.object({ ok: z.literal(true) }).strict();
export const AdminTestPushRequestSchema = z.object({ deviceId: z.string().min(1).optional() }).strict();
export const AdminTestPushResponseSchema = z.object({ id: z.string().min(1), ok: z.literal(true), queued: z.literal(true) }).strict();
export type AdminNotificationSettingsResponse = z.infer<typeof AdminNotificationSettingsResponseSchema>;
