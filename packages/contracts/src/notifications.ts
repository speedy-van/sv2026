import { z } from 'zod';
import { CursorSchema, IsoTimestampSchema, PaginationQuerySchema } from './api';

export const NotificationItemSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
  readAt: IsoTimestampSchema.nullable(),
  createdAt: IsoTimestampSchema,
}).strict();

export const NotificationsQuerySchema = PaginationQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const NotificationsResponseSchema = z.object({
  items: z.array(NotificationItemSchema),
  nextCursor: CursorSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
  badgeCount: z.number().int().nonnegative(),
}).strict().refine((value) => value.badgeCount >= value.unreadCount, {
  message: 'The app badge must include all unread notifications.',
  path: ['badgeCount'],
});

export const NotificationReadResponseSchema = z.object({ ok: z.literal(true) }).strict();

export type NotificationItem = z.infer<typeof NotificationItemSchema>;
export type NotificationsResponse = z.infer<typeof NotificationsResponseSchema>;
export type NotificationsQuery = z.infer<typeof NotificationsQuerySchema>;
