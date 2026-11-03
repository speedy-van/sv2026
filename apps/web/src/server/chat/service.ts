import 'server-only';

import {
  AdminChatInboxResponseSchema, AppError, ChatMessagesResponseSchema, ChatReadResponseSchema,
  ChatSendResponseSchema, ChatSessionResponseSchema,
  type AdminChatInboxQuery, type AdminChatInboxResponse, type AdminChatSendRequest,
  type ChatMessagesQuery, type ChatMessagesResponse, type ChatReadResponse, type ChatSendRequest,
  type ChatSendResponse, type ChatSessionResponse,
} from '@sv/contracts';
import { prisma, type DbTx } from '@sv/db';
import { z } from 'zod';
import { enforceChatSessionRateLimit } from '../rate-limit';
import { queueCustomerChatPush } from './push';
import {
  adminChatUnreadCounts, conversationDto, conversationSelect, conversationWithUnread, findCustomerConversation, latestCustomerMessages, lockConversation, messageDto,
  messageInConversation, messageSelect, requireConversation, type ChatViewer, type ConversationRecord,
} from './repository';
import { CHAT_SESSION_SECONDS, chatCookie, chatTokenHash, createChatToken, readChatToken } from './session';

const InboxCursorSchema = z.object({ id: z.string().min(1).max(100), at: z.iso.datetime() }).strict();
const emptyMessages: ChatMessagesResponse = { conversation: null, messages: [], cursor: null, olderCursor: null, hasMore: false };

async function customerConversation(request: Request, now: Date): Promise<ConversationRecord | null> {
  const token = readChatToken(request);
  return token ? findCustomerConversation(chatTokenHash(token), now) : null;
}

export async function getChatSession(request: Request, now = new Date()): Promise<ChatSessionResponse> {
  const conversation = await customerConversation(request, now);
  return ChatSessionResponseSchema.parse({ conversation: conversation ? await conversationDto(conversation, 'CUSTOMER') : null });
}

/** Establish ownership before the first message, so a lost send response can be safely retried. */
export async function startChatSession(request: Request, now = new Date()): Promise<{ body: ChatSessionResponse; cookie: string | null }> {
  const existing = await customerConversation(request, now);
  if (existing) return { body: ChatSessionResponseSchema.parse({ conversation: await conversationDto(existing, 'CUSTOMER') }), cookie: null };
  const token = createChatToken();
  const conversation = await prisma.chatConversation.create({
    data: {
      customerTokenHash: chatTokenHash(token), expiresAt: new Date(now.getTime() + CHAT_SESSION_SECONDS * 1000),
      createdAt: now, updatedAt: now, lastMessageAt: now,
    }, select: conversationSelect,
  });
  return { body: ChatSessionResponseSchema.parse({ conversation: await conversationDto(conversation, 'CUSTOMER') }), cookie: chatCookie(token) };
}

export async function readMessages(conversation: ConversationRecord, query: ChatMessagesQuery, viewer: ChatViewer): Promise<ChatMessagesResponse> {
  const cursorId = query.after ?? query.before;
  const cursor = cursorId ? await messageInConversation(conversation.id, cursorId) : null;
  const ascending = query.after !== undefined;
  const rows = await prisma.chatMessage.findMany({
    where: {
      conversationId: conversation.id,
      ...(cursor ? { sequence: ascending ? { gt: cursor.sequence } : { lt: cursor.sequence } } : {}),
    },
    select: messageSelect, orderBy: { sequence: ascending ? 'asc' : 'desc' }, take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  if (!ascending) page.reverse();
  return ChatMessagesResponseSchema.parse({
    conversation: await conversationDto(conversation, viewer), messages: page.map(messageDto),
    cursor: page.at(-1)?.id ?? null, olderCursor: page[0]?.id ?? null, hasMore,
  });
}

export async function getCustomerMessages(request: Request, query: ChatMessagesQuery, now = new Date()): Promise<ChatMessagesResponse> {
  const conversation = await customerConversation(request, now);
  return conversation ? readMessages(conversation, query, 'CUSTOMER') : emptyMessages;
}

async function appendMessage(tx: DbTx, conversation: ConversationRecord, input: AdminChatSendRequest, viewer: ChatViewer, now: Date, staffUserId?: string): Promise<ChatSendResponse> {
  await lockConversation(conversation.id, tx);
  const current = await requireConversation(conversation.id, tx, now);
  const existing = await tx.chatMessage.findUnique({
    where: { conversationId_clientMessageId: { conversationId: conversation.id, clientMessageId: input.clientMessageId } }, select: messageSelect,
  });
  if (existing) {
    if (existing.body !== input.body || existing.sender !== viewer) throw new AppError('CONFLICT', 'This message identifier has already been used.');
    return ChatSendResponseSchema.parse({ conversation: await conversationDto(current, viewer, tx), message: messageDto(existing) });
  }
  // A database-backed per-thread ceiling remains effective across serverless instances and Redis outages.
  const recent = await tx.chatMessage.count({ where: { conversationId: conversation.id, sender: viewer, createdAt: { gt: new Date(now.getTime() - 60_000) } } });
  if (recent >= 20) throw new AppError('RATE_LIMITED', 'Please wait a moment before sending another message.', { retryAfter: 60 });
  const message = await tx.chatMessage.create({
    data: { conversationId: conversation.id, clientMessageId: input.clientMessageId, sender: viewer, senderUserId: staffUserId ?? null, body: input.body, createdAt: now }, select: messageSelect,
  });
  const lastMessageAt = new Date(Math.max(now.getTime(), current.lastMessageAt.getTime()));
  const updated = await tx.chatConversation.update({ where: { id: conversation.id }, data: { lastMessageAt, updatedAt: lastMessageAt }, select: conversationSelect });
  if (viewer === 'CUSTOMER') await queueCustomerChatPush(tx, message);
  return ChatSendResponseSchema.parse({ conversation: await conversationDto(updated, viewer, tx), message: messageDto(message) });
}

export async function sendCustomerMessage(request: Request, input: ChatSendRequest, now = new Date()): Promise<{ body: ChatSendResponse; cookie: string | null }> {
  const existing = await customerConversation(request, now);
  if (!existing) throw new AppError('UNAUTHORIZED', 'Start this chat again before sending your message.');
  await enforceChatSessionRateLimit(existing.id);
  const body = await prisma.$transaction(async (tx) => {
    await lockConversation(existing.id, tx);
    let conversation = await requireConversation(existing.id, tx, now);
    if (input.customerName && conversation.customerName === null && await tx.chatMessage.count({ where: { conversationId: existing.id } }) === 0) {
      conversation = await tx.chatConversation.update({ where: { id: existing.id }, data: { customerName: input.customerName }, select: conversationSelect });
    }
    return appendMessage(tx, conversation, input, 'CUSTOMER', now);
  });
  return { body, cookie: null };
}

export async function sendAdminMessage(id: string, input: AdminChatSendRequest, staffUserId: string, now = new Date()): Promise<ChatSendResponse> {
  return prisma.$transaction(async (tx) => appendMessage(tx, await requireConversation(id, tx, now), input, 'ADMIN', now, staffUserId));
}

export async function markMessagesRead(id: string, messageId: string, viewer: ChatViewer): Promise<ChatReadResponse> {
  return prisma.$transaction(async (tx) => {
    await lockConversation(id, tx);
    const conversation = await requireConversation(id, tx);
    const message = await messageInConversation(id, messageId, tx);
    const watermark = viewer === 'ADMIN' ? conversation.adminReadSequence : conversation.customerReadSequence;
    if (message.sequence > watermark) {
      const updated = await tx.chatConversation.update({
        where: { id }, data: viewer === 'ADMIN' ? { adminReadSequence: message.sequence } : { customerReadSequence: message.sequence }, select: conversationSelect,
      });
      return ChatReadResponseSchema.parse({ conversation: await conversationDto(updated, viewer, tx) });
    }
    return ChatReadResponseSchema.parse({ conversation: await conversationDto(conversation, viewer, tx) });
  });
}

export async function markCustomerMessagesRead(request: Request, messageId: string, now = new Date()): Promise<ChatReadResponse> {
  const conversation = await customerConversation(request, now);
  if (!conversation) throw new AppError('UNAUTHORIZED', 'Start a chat to continue.');
  return markMessagesRead(conversation.id, messageId, 'CUSTOMER');
}

function decodeInboxCursor(value: string): z.infer<typeof InboxCursorSchema> {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const parsed = InboxCursorSchema.safeParse(decoded);
    if (parsed.success) return parsed.data;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  throw new AppError('VALIDATION_ERROR', 'Choose a valid conversation cursor.');
}

export async function getAdminChatInbox(query: AdminChatInboxQuery, now = new Date()): Promise<AdminChatInboxResponse> {
  const cursor = query.cursor ? decodeInboxCursor(query.cursor) : null;
  const rows = await prisma.chatConversation.findMany({
    where: {
      messages: { some: {} },
      expiresAt: { gt: now },
      ...(cursor ? { OR: [{ lastMessageAt: { lt: new Date(cursor.at) } }, { lastMessageAt: new Date(cursor.at), id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
    select: { ...conversationSelect, messages: { orderBy: { sequence: 'desc' }, take: 1, select: messageSelect } },
  });
  const page = rows.slice(0, query.limit);
  const ids = page.map((conversation) => conversation.id);
  const [lastIncoming, unreadCounts] = await Promise.all([latestCustomerMessages(ids), adminChatUnreadCounts(ids)]);
  const items = page.map((conversation) => {
    const lastCustomer = lastIncoming.get(conversation.id);
    return {
      ...conversationWithUnread(conversation, unreadCounts.get(conversation.id) ?? 0), lastMessage: conversation.messages[0] ? messageDto(conversation.messages[0]) : null,
      lastCustomerMessage: lastCustomer ? messageDto(lastCustomer) : null,
      lastCustomerMessageSequence: lastCustomer?.sequence.toString() ?? null,
    };
  });
  const unreadRows = await prisma.$queryRaw<{ count: bigint; latestCustomerSequence: string | null }[]>`
    SELECT COUNT(*) FILTER (WHERE m."sequence" > c."adminReadSequence")::bigint AS "count",
      MAX(m."sequence")::text AS "latestCustomerSequence" FROM "ChatMessage" AS m
    JOIN "ChatConversation" AS c ON c."id" = m."conversationId"
    WHERE m."sender" = 'CUSTOMER' AND c."expiresAt" > ${now}`;
  const last = page.at(-1);
  return AdminChatInboxResponseSchema.parse({
    items,
    nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ id: last.id, at: last.lastMessageAt.toISOString() })).toString('base64url') : null,
    unreadCount: Number(unreadRows[0]?.count ?? 0n),
    latestCustomerSequence: unreadRows[0]?.latestCustomerSequence ?? null,
  });
}
