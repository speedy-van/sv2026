import 'server-only';

import { prisma, type DbTx } from '@sv/db';
import type { PushSendPayload } from '../integrations/expo-push';

export const CHAT_PUSH_TTL_SECONDS = 3600;

export function chatPushScope(messageId: string): string {
  return `chat.message:${messageId}`;
}

/** Runs in the same transaction as the new customer message, after deduplication. */
export async function queueCustomerChatPush(
  tx: DbTx,
  message: { id: string; conversationId: string },
): Promise<void> {
  const recipients = await tx.user.findMany({
    where: { status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
    select: { id: true },
  });
  if (recipients.length === 0) return;
  await tx.outboxEvent.createMany({
    data: recipients.map(({ id: userId }) => {
      const payload = {
        app: 'ADMIN',
        body: 'A customer has sent a new message. Open chat to reply.',
        category: 'CHAT_MESSAGE',
        data: {
          eventType: 'chat.message_received',
          type: 'CHAT_MESSAGE',
          conversationId: message.conversationId,
          messageId: message.id,
          recipientUserId: userId,
          url: `speedyvan-admin://chat/${encodeURIComponent(message.conversationId)}`,
          invalidate: ['chat-unread', 'chat-inbox', 'chat-thread'],
        },
        sound: 'chat-message.wav',
        title: 'New customer message',
        ttl: CHAT_PUSH_TTL_SECONDS,
        userId,
      } satisfies PushSendPayload;
      return {
        dedupeKey: `${chatPushScope(message.id)}:push:${userId}`,
        payload,
        type: 'push.send',
      };
    }),
  });
}

/** Re-check the canonical message at send time: queued alerts can become obsolete. */
export async function shouldSendChatPush(data: Record<string, unknown> | undefined, now = new Date()): Promise<boolean> {
  const conversationId = data?.conversationId;
  const messageId = data?.messageId;
  if (typeof conversationId !== 'string' || !conversationId || typeof messageId !== 'string' || !messageId) return false;
  const message = await prisma.chatMessage.findFirst({
    where: {
      id: messageId,
      conversationId,
      sender: 'CUSTOMER',
      createdAt: { gt: new Date(now.getTime() - CHAT_PUSH_TTL_SECONDS * 1000) },
      conversation: { expiresAt: { gt: now } },
    },
    select: { sequence: true, conversation: { select: { adminReadSequence: true } } },
  });
  return Boolean(message && message.sequence > message.conversation.adminReadSequence);
}
