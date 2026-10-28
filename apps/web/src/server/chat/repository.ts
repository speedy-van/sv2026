import 'server-only';

import { AppError, type ChatConversation, type ChatMessage } from '@sv/contracts';
import { prisma, type DbTx, type Prisma } from '@sv/db';

export const conversationSelect = {
  id: true, customerTokenHash: true, customerName: true, expiresAt: true,
  customerReadSequence: true, adminReadSequence: true, createdAt: true, updatedAt: true, lastMessageAt: true,
} as const satisfies Prisma.ChatConversationSelect;
export type ConversationRecord = Prisma.ChatConversationGetPayload<{ select: typeof conversationSelect }>;
export const messageSelect = {
  sequence: true, id: true, conversationId: true, clientMessageId: true, sender: true, body: true, createdAt: true,
} as const satisfies Prisma.ChatMessageSelect;
export type MessageRecord = Prisma.ChatMessageGetPayload<{ select: typeof messageSelect }>;
export type ChatDb = Pick<DbTx, 'chatConversation' | 'chatMessage' | '$queryRaw'>;
export type ChatViewer = 'CUSTOMER' | 'ADMIN';

export function messageDto(message: MessageRecord): ChatMessage {
  if (message.sender !== 'CUSTOMER' && message.sender !== 'ADMIN') throw new AppError('INTERNAL', 'Unable to read this chat.');
  return {
    id: message.id, clientMessageId: message.clientMessageId, sender: message.sender,
    body: message.body, createdAt: message.createdAt.toISOString(),
  };
}

export async function conversationDto(conversation: ConversationRecord, viewer: ChatViewer, db: ChatDb = prisma): Promise<ChatConversation> {
  const watermark = viewer === 'ADMIN' ? conversation.adminReadSequence : conversation.customerReadSequence;
  const unreadCount = await db.chatMessage.count({
    where: { conversationId: conversation.id, sender: viewer === 'ADMIN' ? 'CUSTOMER' : 'ADMIN', sequence: { gt: watermark } },
  });
  return conversationWithUnread(conversation, unreadCount);
}

export function conversationWithUnread(conversation: ConversationRecord, unreadCount: number): ChatConversation {
  return {
    id: conversation.id, customerName: conversation.customerName,
    createdAt: conversation.createdAt.toISOString(), updatedAt: conversation.updatedAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt.toISOString(), unreadCount,
  };
}

export async function adminChatUnreadCounts(conversationIds: string[], db: Pick<DbTx, '$queryRaw'> = prisma): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map();
  const counts = await db.$queryRaw<{ conversationId: string; unreadCount: number }[]>`
    SELECT m."conversationId", COUNT(*)::int AS "unreadCount"
    FROM "ChatMessage" AS m JOIN "ChatConversation" AS c ON c."id" = m."conversationId"
    WHERE m."conversationId" = ANY(${conversationIds}::text[])
      AND m."sender" = 'CUSTOMER' AND m."sequence" > c."adminReadSequence"
    GROUP BY m."conversationId"`;
  return new Map(counts.map((row) => [row.conversationId, row.unreadCount]));
}

export async function findCustomerConversation(tokenHash: string, now: Date, db: ChatDb = prisma): Promise<ConversationRecord | null> {
  const conversation = await db.chatConversation.findUnique({ where: { customerTokenHash: tokenHash }, select: conversationSelect });
  return conversation && conversation.expiresAt > now ? conversation : null;
}

export async function requireConversation(id: string, db: ChatDb = prisma, now = new Date()): Promise<ConversationRecord> {
  const conversation = await db.chatConversation.findUnique({ where: { id }, select: conversationSelect });
  if (!conversation || conversation.expiresAt <= now) throw new AppError('NOT_FOUND', 'This conversation is no longer available.');
  return conversation;
}

export async function lockConversation(id: string, db: ChatDb): Promise<void> {
  await db.$queryRaw`SELECT "id" FROM "ChatConversation" WHERE "id" = ${id} FOR UPDATE`;
}

export async function messageInConversation(conversationId: string, id: string, db: ChatDb = prisma): Promise<MessageRecord> {
  const message = await db.chatMessage.findFirst({ where: { id, conversationId }, select: messageSelect });
  if (!message) throw new AppError('NOT_FOUND', 'This chat message could not be found.');
  return message;
}

/** One indexed lookup per bounded inbox row, returned in a single database round trip. */
export async function latestCustomerMessages(conversationIds: string[], db: Pick<DbTx, '$queryRaw'> = prisma): Promise<Map<string, MessageRecord>> {
  if (conversationIds.length === 0) return new Map();
  const messages = await db.$queryRaw<MessageRecord[]>`
    SELECT m."sequence", m."id", m."conversationId", m."clientMessageId", m."sender", m."body", m."createdAt"
    FROM "ChatConversation" AS c
    JOIN LATERAL (
      SELECT "sequence", "id", "conversationId", "clientMessageId", "sender", "body", "createdAt"
      FROM "ChatMessage"
      WHERE "conversationId" = c."id" AND "sender" = 'CUSTOMER'
      ORDER BY "sequence" DESC LIMIT 1
    ) AS m ON TRUE
    WHERE c."id" = ANY(${conversationIds}::text[])`;
  return new Map(messages.map((message) => [message.conversationId, message]));
}
