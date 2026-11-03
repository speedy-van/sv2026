import 'server-only';

import { prisma, type DbTx } from '@sv/db';

/** Deletes only expired chat sessions and their own messages through the chat foreign key. */
export async function pruneExpiredChatConversations(now = new Date(), db: Pick<DbTx, 'chatConversation'> = prisma): Promise<number> {
  const expired = await db.chatConversation.findMany({
    where: { expiresAt: { lte: now } }, orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }], take: 100, select: { id: true },
  });
  if (expired.length === 0) return 0;
  const result = await db.chatConversation.deleteMany({ where: { id: { in: expired.map((conversation) => conversation.id) }, expiresAt: { lte: now } } });
  return result.count;
}
