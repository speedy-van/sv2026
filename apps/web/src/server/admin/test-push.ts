import 'server-only';

import { AppError } from '@sv/contracts';
import { prisma } from '@sv/db';
import { processOutboxEventNow } from '../outbox/processor';

export async function sendAdminTestPush(staff: { userId: string }): Promise<{ id: string; ok: true; queued: boolean }> {
  const devices = await prisma.pushDevice.count({
    where: {
      app: 'ADMIN', enabled: true, userId: staff.userId,
      user: { status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
    },
  });
  if (devices === 0) {
    throw new AppError('CONFLICT', 'No phone is registered for notifications. Enable notifications in the admin app and try again.');
  }
  const event = await prisma.outboxEvent.create({
    data: {
      dedupeKey: `admin.test_push:${staff.userId}:${new Date().toISOString()}`,
      payload: {
        app: 'ADMIN',
        body: 'If this arrived, this phone can receive urgent booking alerts.',
        category: 'NEW_BOOKING',
        data: { eventType: 'admin.test_push', type: 'NEW_BOOKING' },
        sound: 'new-job.wav',
        timeSensitive: true,
        title: 'Speedy Van test push',
        userId: staff.userId,
      },
      type: 'push.send',
    },
    select: { id: true },
  });
  const result = await processOutboxEventNow(event.id);
  if (result.failed > 0 || result.done !== 1) {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'The test notification could not be sent. Check notification service settings and try again.', { eventId: event.id });
  }
  const accepted = await prisma.pushTicket.count({ where: { outboxEventId: event.id, status: 'ok' } });
  if (accepted === 0) {
    throw new AppError('CONFLICT', 'No phone accepted the test notification. Open the admin app, enable notifications and try again.');
  }
  // An accepted Expo ticket is not a delivery receipt. Keep the existing queued
  // response contract: only seeing/hearing it on the phone confirms reception.
  return { id: event.id, ok: true, queued: true };
}
