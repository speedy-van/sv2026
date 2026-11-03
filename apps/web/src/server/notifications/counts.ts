import 'server-only';

import { prisma } from '@sv/db';
import { adminChatUnreadSummary } from '../chat/repository';

export interface NotificationCounts {
  unreadCount: number;
  badgeCount: number;
}

/** The same authoritative total is used by the app inbox and native push payloads. */
export async function readNotificationCounts(
  userId: string,
  includeAdminChat: boolean,
  now = new Date(),
): Promise<NotificationCounts> {
  const [unreadCount, chat] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    includeAdminChat ? adminChatUnreadSummary(now) : Promise.resolve({ unreadCount: 0 }),
  ]);
  return { unreadCount, badgeCount: unreadCount + chat.unreadCount };
}
