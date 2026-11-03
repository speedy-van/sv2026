import { describe, expect, it } from 'vitest';
import {
  AdminChatInboxResponseSchema, AdminChatSendRequestSchema, ChatMessagesQuerySchema, ChatSendRequestSchema,
  ChatSendResponseSchema, CHAT_MESSAGE_MAX_LENGTH,
} from '../src/live-chat';

const clientMessageId = '4debd948-fcff-4c21-a522-680f4d533f6c';
describe('live chat contracts', () => {
  it('trims plain-text messages while preserving useful line breaks', () => {
    expect(ChatSendRequestSchema.parse({ clientMessageId, body: '  Hello\nCan you help?  ', customerName: ' Alex ' }))
      .toEqual({ clientMessageId, body: 'Hello\nCan you help?', customerName: 'Alex' });
  });

  it.each(['', ' '.repeat(3), 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1), 'hidden\u0000value'])('rejects invalid message text %#', (body) => {
    expect(ChatSendRequestSchema.safeParse({ clientMessageId, body }).success).toBe(false);
  });

  it('rejects forged sender, invalid idempotency keys and customer-name edits from staff', () => {
    expect(ChatSendRequestSchema.safeParse({ clientMessageId, body: 'Hello', sender: 'ADMIN' }).success).toBe(false);
    expect(ChatSendRequestSchema.safeParse({ clientMessageId: 'chosen', body: 'Hello' }).success).toBe(false);
    expect(AdminChatSendRequestSchema.safeParse({ clientMessageId, body: 'Hello', customerName: 'Forged' }).success).toBe(false);
  });

  it('bounds every page and accepts only one cursor direction', () => {
    expect(ChatMessagesQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(ChatMessagesQuerySchema.parse({ limit: '100', after: 'message_123' })).toEqual({ limit: 100, after: 'message_123' });
    expect(ChatMessagesQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(ChatMessagesQuerySchema.safeParse({ after: 'a', before: 'b' }).success).toBe(false);
    expect(ChatMessagesQuerySchema.safeParse({ conversationId: 'other' }).success).toBe(false);
  });

  it('rejects credentials and internal staff identifiers in outgoing payloads', () => {
    const conversation = { id: 'thread_1', customerName: null, createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '2026-10-15T12:00:00.000Z', lastMessageAt: '2026-10-15T12:00:00.000Z', unreadCount: 0 };
    const message = { id: 'message_1', clientMessageId, sender: 'CUSTOMER', body: 'Hello', createdAt: '2026-10-15T12:00:00.000Z' };
    expect(ChatSendResponseSchema.safeParse({ conversation, message }).success).toBe(true);
    expect(ChatSendResponseSchema.safeParse({ conversation: { ...conversation, customerTokenHash: 'private' }, message }).success).toBe(false);
    expect(ChatSendResponseSchema.safeParse({ conversation, message: { ...message, senderUserId: 'staff' } }).success).toBe(false);
  });

  it('accepts additive staff-only incoming watermarks without changing older inbox responses', () => {
    const response = { items: [], nextCursor: null, unreadCount: 0 };
    expect(AdminChatInboxResponseSchema.safeParse(response).success).toBe(true);
    expect(AdminChatInboxResponseSchema.safeParse({ ...response, latestCustomerSequence: '9223372036854775807' }).success).toBe(true);
    expect(AdminChatInboxResponseSchema.safeParse({ ...response, latestCustomerSequence: null }).success).toBe(true);
    for (const invalid of ['-1', '0', '01', '1.5', 'not-a-sequence', '9'.repeat(20), 123])
      expect(AdminChatInboxResponseSchema.safeParse({ ...response, latestCustomerSequence: invalid }).success).toBe(false);
  });
});
