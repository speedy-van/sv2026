import { z } from 'zod';
import { IsoTimestampSchema } from './api';

export const CHAT_MESSAGE_MAX_LENGTH = 2000;
export const CHAT_POLL_INTERVAL_MS = 3000;
export const CHAT_UNREAD_POLL_INTERVAL_MS = 15_000;
export const CHAT_RETENTION_DAYS = 30;
export const CHAT_NOTIFICATION_SOUND_FILENAME = 'chat-message.wav';
const ChatIdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u);
const AdminChatSequenceSchema = z.string().regex(/^[1-9]\d{0,18}$/u).nullable().optional();
function validChatText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return false;
  }
  return true;
}
const ChatBodySchema = z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH)
  .refine(validChatText, 'Use plain text without control characters.');

export const ChatMessageSchema = z.object({
  id: ChatIdSchema,
  clientMessageId: z.uuid(),
  sender: z.enum(['CUSTOMER', 'ADMIN']),
  body: ChatBodySchema,
  createdAt: IsoTimestampSchema,
}).strict();

export const ChatConversationSchema = z.object({
  id: ChatIdSchema,
  customerName: z.string().max(80).nullable(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  lastMessageAt: IsoTimestampSchema,
  unreadCount: z.number().int().nonnegative(),
}).strict();

export const ChatSendRequestSchema = z.object({
  clientMessageId: z.uuid(),
  body: ChatBodySchema,
  customerName: z.string().trim().min(1).max(80).optional(),
}).strict();
export const AdminChatSendRequestSchema = ChatSendRequestSchema.omit({ customerName: true });
export const ChatReadRequestSchema = z.object({ messageId: ChatIdSchema }).strict();
export const ChatMessagesQuerySchema = z.object({
  after: ChatIdSchema.optional(),
  before: ChatIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().refine((query) => !(query.after && query.before), 'Choose one pagination direction.');
export const AdminChatInboxQuerySchema = z.object({
  cursor: z.string().min(1).max(300).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const ChatSessionResponseSchema = z.object({ conversation: ChatConversationSchema.nullable() }).strict();
export const ChatSessionStartRequestSchema = z.object({}).strict();
export const ChatMessagesResponseSchema = z.object({
  conversation: ChatConversationSchema.nullable(),
  messages: z.array(ChatMessageSchema).max(100),
  cursor: ChatIdSchema.nullable(),
  olderCursor: ChatIdSchema.nullable(),
  hasMore: z.boolean(),
}).strict();
export const ChatSendResponseSchema = z.object({ conversation: ChatConversationSchema, message: ChatMessageSchema }).strict();
export const ChatReadResponseSchema = z.object({ conversation: ChatConversationSchema }).strict();
export const AdminChatInboxResponseSchema = z.object({
  items: z.array(ChatConversationSchema.extend({
    lastMessage: ChatMessageSchema.nullable(),
    lastCustomerMessage: ChatMessageSchema.nullable().optional(),
    lastCustomerMessageSequence: AdminChatSequenceSchema,
  })).max(100),
  nextCursor: z.string().max(300).nullable(),
  unreadCount: z.number().int().nonnegative(),
  latestCustomerSequence: AdminChatSequenceSchema,
}).strict();

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatConversation = z.infer<typeof ChatConversationSchema>;
export type ChatSendRequest = z.infer<typeof ChatSendRequestSchema>;
export type AdminChatSendRequest = z.infer<typeof AdminChatSendRequestSchema>;
export type ChatReadRequest = z.infer<typeof ChatReadRequestSchema>;
export type ChatMessagesQuery = z.infer<typeof ChatMessagesQuerySchema>;
export type AdminChatInboxQuery = z.infer<typeof AdminChatInboxQuerySchema>;
export type ChatSessionResponse = z.infer<typeof ChatSessionResponseSchema>;
export type ChatMessagesResponse = z.infer<typeof ChatMessagesResponseSchema>;
export type ChatSendResponse = z.infer<typeof ChatSendResponseSchema>;
export type ChatReadResponse = z.infer<typeof ChatReadResponseSchema>;
export type AdminChatInboxResponse = z.infer<typeof AdminChatInboxResponseSchema>;
