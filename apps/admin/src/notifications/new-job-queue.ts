import { IsoDateSchema, PenceSchema } from '@sv/contracts';
import { z } from 'zod';

export interface NewJobAlert {
  bookingId: string;
  // A delivery deduplication key; this is not necessarily a database row ID.
  notificationId: string;
  pricePence?: number;
  reference?: string;
  route?: string;
  service?: string;
  slot?: string;
  moveDate?: string;
}

const AlertIdentitySchema = z.object({
  bookingId: z.string().trim().min(1),
  deliveryKey: z.string().trim().min(1).optional(),
  notificationId: z.string().trim().min(1).optional(),
  type: z.literal('NEW_BOOKING'),
});
const AlertTextSchema = z.string().trim().min(1).max(300);

export function newJobAlertFromNotification(data: unknown, deliveryId: string): NewJobAlert | null {
  const identity = AlertIdentitySchema.safeParse(data);
  const details = z.record(z.string(), z.unknown()).safeParse(data);
  if (!identity.success || !details.success) return null;
  const notificationId = identity.data.deliveryKey ?? identity.data.notificationId ?? deliveryId.trim();
  if (!notificationId) return null;
  const amount = PenceSchema.safeParse(details.data.pricePence);
  const reference = AlertTextSchema.safeParse(details.data.reference);
  const route = AlertTextSchema.safeParse(details.data.route);
  const service = AlertTextSchema.safeParse(details.data.service);
  const slot = AlertTextSchema.safeParse(details.data.slot);
  const moveDate = IsoDateSchema.safeParse(details.data.moveDate);
  return {
    bookingId: identity.data.bookingId,
    notificationId,
    ...(amount.success && amount.data > 0 ? { pricePence: amount.data } : {}),
    ...(reference.success ? { reference: reference.data } : {}),
    ...(route.success ? { route: route.data } : {}),
    ...(service.success ? { service: service.data } : {}),
    ...(slot.success ? { slot: slot.data } : {}),
    ...(moveDate.success ? { moveDate: moveDate.data } : {}),
  };
}

export function addAlerts(existing: readonly NewJobAlert[], incoming: readonly NewJobAlert[]): NewJobAlert[] {
  const byId = new Map(existing.map((alert) => [alert.notificationId, alert]));
  for (const alert of incoming) byId.set(alert.notificationId, alert);
  return [...byId.values()];
}

export function dismissAlert(existing: readonly NewJobAlert[], notificationId: string): NewJobAlert[] {
  return existing.filter((alert) => alert.notificationId !== notificationId);
}
