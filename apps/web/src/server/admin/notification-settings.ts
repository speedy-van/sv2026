import 'server-only';
import { AdminNotificationSettingsResponseSchema, AppError, type AdminNotificationSettingsUpdateSchema, type AdminNotificationSettingsResponse } from '@sv/contracts';
import { prisma } from '@sv/db';
import type { z } from 'zod';
import type { StaffContext } from '../auth/staff';

export async function readAdminNotificationSettings(staff: StaffContext): Promise<AdminNotificationSettingsResponse> {
  const devices = await prisma.pushDevice.findMany({
    where: { app: 'ADMIN', userId: staff.userId }, orderBy: { lastRegisteredAt: 'desc' }, take: 100,
    select: { id: true, platform: true, enabled: true, sessionId: true, pendingBookingAlerts: true, lastRegisteredAt: true, lastError: true,
      session: { select: { deviceName: true } }, tickets: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, createdAt: true, checkedAt: true, error: true } } },
  });
  return AdminNotificationSettingsResponseSchema.parse({ generatedAt: new Date().toISOString(), devices: devices.map(({ sessionId, session, tickets, ...device }) => ({
    ...device, currentSession: sessionId === staff.sessionId, deviceName: session?.deviceName ?? null,
    lastRegisteredAt: device.lastRegisteredAt.toISOString(), latestTicket: tickets[0] ? { ...tickets[0], createdAt: tickets[0].createdAt.toISOString(), checkedAt: tickets[0].checkedAt?.toISOString() ?? null } : null,
  })) });
}

export async function updateAdminNotificationSettings(staff: StaffContext, input: z.infer<typeof AdminNotificationSettingsUpdateSchema>, requestId: string): Promise<{ ok: true }> {
  await prisma.$transaction(async (tx) => {
    const device = await tx.pushDevice.findFirst({ where: { id: input.deviceId, app: 'ADMIN', userId: staff.userId }, select: { pendingBookingAlerts: true } });
    if (!device) throw new AppError('NOT_FOUND', 'Notification device not found.');
    await tx.pushDevice.update({ where: { id: input.deviceId }, data: { pendingBookingAlerts: input.pendingBookingAlerts } });
    await tx.auditLog.create({ data: { action: 'admin.notifications.preferences', actorType: 'USER', actorUserId: staff.userId, requestId,
      entityType: 'pushDevice', entityId: input.deviceId, before: device, after: { pendingBookingAlerts: input.pendingBookingAlerts } } });
  }, { isolationLevel: 'Serializable' });
  return { ok: true };
}
