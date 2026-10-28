import { AppError, ChatSendResponseSchema } from '@sv/contracts';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), limit: vi.fn(), sessionLimit: vi.fn(), adminLimit: vi.fn(), capture: vi.fn(),
  conversationFind: vi.fn(), conversationCreate: vi.fn(), conversationUpdate: vi.fn(), conversationList: vi.fn(),
  messageFind: vi.fn(), messageUnique: vi.fn(), messageCreate: vi.fn(), messageList: vi.fn(), messageCount: vi.fn(),
  transaction: vi.fn(), raw: vi.fn(), recipients: vi.fn(), queuePush: vi.fn(),
  after: vi.fn<(callback: () => Promise<void>) => void>(), dispatchPush: vi.fn(),
}));
vi.mock('@sv/db', () => ({ prisma: {
  chatConversation: { findUnique: mocks.conversationFind, create: mocks.conversationCreate, update: mocks.conversationUpdate, findMany: mocks.conversationList },
  chatMessage: { findUnique: mocks.messageUnique, findFirst: mocks.messageFind, create: mocks.messageCreate, findMany: mocks.messageList, count: mocks.messageCount },
  $transaction: mocks.transaction, $queryRaw: mocks.raw,
} }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: mocks.limit, enforceChatSessionRateLimit: mocks.sessionLimit, enforceAdminChatRateLimit: mocks.adminLimit }));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('../src/server/chat/push-dispatch', () => ({ dispatchChatPush: mocks.dispatchPush }));

import { GET as sessionGET, POST as sessionPOST } from '../src/app/api/v1/chat/session/route';
import { GET as messagesGET, POST as messagesPOST } from '../src/app/api/v1/chat/messages/route';
import { POST as readPOST } from '../src/app/api/v1/chat/read/route';
import { GET as inboxGET } from '../src/app/api/v1/admin/chats/route';
import { GET as adminMessagesGET, POST as adminMessagesPOST } from '../src/app/api/v1/admin/chats/[id]/messages/route';
import { POST as adminReadPOST } from '../src/app/api/v1/admin/chats/[id]/read/route';
import { getAdminChatInbox, getCustomerMessages, markMessagesRead, sendCustomerMessage, startChatSession } from '../src/server/chat/service';
import { readChatToken, chatTokenHash } from '../src/server/chat/session';

const now = new Date('2026-10-15T12:00:00.000Z');
const token = 'X'.repeat(43);
const clientMessageId = '4debd948-fcff-4c21-a522-680f4d533f6c';
const conversation = {
  id: 'thread_test', customerTokenHash: createHash('sha256').update(token).digest('hex'), customerName: 'Alex',
  createdAt: now, updatedAt: now, lastMessageAt: now, expiresAt: new Date('2031-01-01T00:00:00.000Z'),
  customerReadSequence: 0n, adminReadSequence: 0n,
};
const message = { id: 'message_1', sequence: 1n, conversationId: conversation.id, clientMessageId, sender: 'CUSTOMER', body: 'Hello', createdAt: now };
const database = {
  chatConversation: { findUnique: mocks.conversationFind, create: mocks.conversationCreate, update: mocks.conversationUpdate, findMany: mocks.conversationList },
  chatMessage: { findUnique: mocks.messageUnique, findFirst: mocks.messageFind, create: mocks.messageCreate, findMany: mocks.messageList, count: mocks.messageCount },
  $queryRaw: mocks.raw,
  user: { findMany: mocks.recipients },
  outboxEvent: { createMany: mocks.queuePush },
};

function request(path = '/chat/messages', body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', cookie: `sv_chat=${token}`, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function context(): { params: Promise<{ id: string }> } { return { params: Promise.resolve({ id: conversation.id }) }; }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ app: 'admin', role: 'ADMIN', userId: 'staff_1', sessionId: 'staff_session' });
  mocks.conversationFind.mockResolvedValue(conversation);
  mocks.conversationCreate.mockResolvedValue(conversation);
  mocks.conversationUpdate.mockResolvedValue(conversation);
  mocks.conversationList.mockResolvedValue([{ ...conversation, messages: [message] }]);
  mocks.messageFind.mockResolvedValue(message);
  mocks.messageUnique.mockResolvedValue(null);
  mocks.messageCreate.mockResolvedValue(message);
  mocks.messageList.mockResolvedValue([message]);
  mocks.messageCount.mockResolvedValue(0);
  mocks.recipients.mockResolvedValue([{ id: 'owner_1' }, { id: 'admin_2' }]);
  mocks.queuePush.mockResolvedValue({ count: 2 });
  mocks.raw.mockImplementation((query: unknown) => Promise.resolve(
    String(query).includes('JOIN LATERAL') ? [message]
      : String(query).includes('GROUP BY') ? [{ conversationId: conversation.id, unreadCount: 1 }]
        : [{ count: 1n, latestCustomerSequence: message.sequence.toString() }],
  ));
  mocks.transaction.mockImplementation((operation: (tx: typeof database) => Promise<unknown>) => operation(database));
});
afterEach(() => vi.unstubAllEnvs());

describe('chat customer credentials and isolation', () => {
  it('does not create a session on a read, and an absent cookie performs no database lookup', async () => {
    const response = await sessionGET(request('/chat/session', undefined, { cookie: '' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversation: null });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.conversationFind).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('restores the same session on repeat handshakes and reads its watermark through the public route', async () => {
    const response = await sessionPOST(request('/chat/session', {}));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
    const read = await readPOST(request('/chat/read', { messageId: message.id }));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ conversation: { id: conversation.id } });
    expect((await readPOST(request('/chat/read', {}))).status).toBe(400);
    expect((await messagesGET(request('/chat/messages?limit=101'))).status).toBe(400);
  });

  it('uses a hashed server credential and scopes every customer query to its own conversation', async () => {
    const response = await messagesGET(request());
    expect(response.status).toBe(200);
    expect(mocks.conversationFind).toHaveBeenCalledWith(expect.objectContaining({ where: { customerTokenHash: chatTokenHash(token) } }));
    expect(mocks.messageList).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: conversation.id }, take: 51 }));
    const payload: unknown = await response.json();
    expect(JSON.stringify(payload)).not.toContain(token);
    expect(JSON.stringify(payload)).not.toContain('customerTokenHash');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toMatch(/^req_/u);
  });

  it.each([`sv_chat=${token}; sv_chat=${'Y'.repeat(43)}`, 'sv_chat=client-chosen'])('rejects ambiguous or malformed cookies %#', (cookie) => {
    expect(readChatToken(request('/chat/session', undefined, { cookie }))).toBeNull();
  });

  it('does not return expired conversations', async () => {
    mocks.conversationFind.mockResolvedValue({ ...conversation, expiresAt: new Date(now.getTime() - 1) });
    expect(await getCustomerMessages(request(), { limit: 50 }, now)).toEqual({ conversation: null, messages: [], cursor: null, olderCursor: null, hasMore: false });
    expect(mocks.messageList).not.toHaveBeenCalled();
  });

  it('establishes an opaque HttpOnly credential before the first send and stores only its hash', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await startChatSession(request('/chat/session', {}, { cookie: '' }), now);
    expect(result.cookie).toMatch(/^sv_chat=[A-Za-z0-9_-]{43}; Path=\/api\/v1\/chat; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/u);
    const tokenValue = result.cookie?.split(';')[0]?.slice('sv_chat='.length);
    expect(tokenValue).toBeTruthy();
    expect(mocks.conversationCreate.mock.calls[0]?.[0]).toMatchObject({ data: { customerTokenHash: chatTokenHash(tokenValue ?? '') } });
    expect(JSON.stringify(result.body)).not.toContain(tokenValue);
    expect(result.body.conversation?.id).toBe(conversation.id);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });

  it('requires same-origin before sending, even if a valid customer cookie is supplied', async () => {
    const response = await messagesPOST(request('/chat/messages', { body: 'Hello', clientMessageId }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }));
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.conversationFind).not.toHaveBeenCalled();
  });

  it.each(['', 'null'])('rejects missing or opaque origins %#', async (origin) => {
    expect((await messagesPOST(request('/chat/messages', { body: 'Hello', clientMessageId }, { origin }))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a forged public conversation selector and wrong-thread pagination cursor', async () => {
    expect((await messagesGET(request('/chat/messages?conversationId=other'))).status).toBe(400);
    mocks.messageFind.mockResolvedValue(null);
    const response = await messagesGET(request('/chat/messages?after=foreign_message'));
    expect(response.status).toBe(404);
    expect(mocks.messageFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign_message', conversationId: conversation.id } }));
    expect(mocks.messageList).not.toHaveBeenCalled();
  });
});

describe('idempotent, paginated chat mutations', () => {
  it('serializes existing-thread writes and returns the original message on a duplicate UUID', async () => {
    mocks.messageUnique.mockResolvedValue(message);
    const result = await sendCustomerMessage(request(), { body: 'Hello', clientMessageId }, now);
    expect(result.body.message.id).toBe(message.id);
    expect(result.cookie).toBeNull();
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.sessionLimit).toHaveBeenCalledWith(conversation.id);
    expect(mocks.raw.mock.calls[0]?.[1]).toBe(conversation.id);
  });

  it('retries a committed first message without creating a duplicate conversation or message', async () => {
    await sendCustomerMessage(request(), { body: 'Hello', clientMessageId }, now);
    mocks.messageUnique.mockResolvedValue(message);
    const retry = await sendCustomerMessage(request(), { body: 'Hello', clientMessageId }, now);
    expect(ChatSendResponseSchema.safeParse(retry.body).success).toBe(true);
    expect(mocks.messageCreate).toHaveBeenCalledOnce();
    expect(mocks.queuePush).toHaveBeenCalledOnce();
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
  });

  it('refuses message creation until the ownership handshake cookie exists', async () => {
    await expect(sendCustomerMessage(request('/chat/messages', {}, { cookie: '' }), { body: 'Hello', clientMessageId }, now)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });

  it('only records an optional customer name on the first message of an empty thread', async () => {
    mocks.conversationFind.mockResolvedValue({ ...conversation, customerName: null });
    await sendCustomerMessage(request(), { body: 'Hello', clientMessageId, customerName: 'Alex' }, now);
    expect(mocks.conversationUpdate.mock.calls[0]?.[0]).toMatchObject({ data: { customerName: 'Alex' } });
  });

  it('the session handshake is CSRF-protected, rate limited and rejects extra fields', async () => {
    expect((await sessionPOST(request('/chat/session', { customerToken: 'chosen' }))).status).toBe(400);
    expect((await sessionPOST(request('/chat/session', {}, { origin: 'https://evil.example' }))).status).toBe(403);
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
    expect(mocks.limit).toHaveBeenCalledWith(expect.any(Request), 'chatWrite');
  });

  it('refuses to reuse a UUID with changed text or a different sender', async () => {
    mocks.messageUnique.mockResolvedValue(message);
    await expect(sendCustomerMessage(request(), { body: 'Changed', clientMessageId }, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });

  it('applies the IP limiter before creating any anonymous row and preserves retry-after', async () => {
    mocks.limit.mockRejectedValue(new AppError('RATE_LIMITED', 'Wait.', { retryAfter: 60 }));
    const response = await messagesPOST(request('/chat/messages', { body: 'Hello', clientMessageId }, { cookie: '' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
  });

  it('enforces a database-backed burst budget even when process-local limiting allows a send', async () => {
    mocks.messageCount.mockResolvedValue(20);
    await expect(sendCustomerMessage(request(), { body: 'Hello', clientMessageId }, now)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });

  it('returns the latest initial page in chronological order with an older-page indicator', async () => {
    mocks.messageList.mockResolvedValue([
      { ...message, id: 'message_3', sequence: 3n }, { ...message, id: 'message_2', sequence: 2n }, message,
    ]);
    const result = await getCustomerMessages(request(), { limit: 2 }, now);
    expect(result.messages.map((item) => item.id)).toEqual(['message_2', 'message_3']);
    expect(result).toMatchObject({ cursor: 'message_3', olderCursor: 'message_2', hasMore: true });
  });

  it('uses sequence ordering for forward pages and verifies the cursor belongs to this thread', async () => {
    await getCustomerMessages(request(), { after: message.id, limit: 2 }, now);
    expect(mocks.messageList).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: conversation.id, sequence: { gt: 1n } }, orderBy: { sequence: 'asc' }, take: 3 }));
  });

  it('only advances a read watermark to an existing message in the same thread', async () => {
    await markMessagesRead(conversation.id, message.id, 'ADMIN');
    expect(mocks.conversationUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { adminReadSequence: 1n } }));
    mocks.conversationUpdate.mockClear();
    mocks.messageFind.mockResolvedValue(null);
    await expect(markMessagesRead(conversation.id, 'foreign', 'ADMIN')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();
  });

  it('never moves a read watermark backwards or accepts an unknown customer read', async () => {
    mocks.conversationFind.mockResolvedValue({ ...conversation, adminReadSequence: 5n });
    await markMessagesRead(conversation.id, message.id, 'ADMIN');
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();
    expect((await readPOST(request('/chat/read', { messageId: message.id }, { cookie: '' }))).status).toBe(401);
  });

  it.each([{ body: '', clientMessageId }, { body: 'a'.repeat(2001), clientMessageId }, { body: 'Hi', clientMessageId, sender: 'ADMIN' }, { body: 'Hi', clientMessageId: 'not-uuid' }])('rejects invalid message input %# before database calls', async (input) => {
    expect((await messagesPOST(request('/chat/messages', input))).status).toBe(400);
    expect(mocks.conversationFind).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('bounds chunked bodies as well as declared content lengths', async () => {
    const response = await messagesPOST(request('/chat/messages', { body: 'a'.repeat(13_000), clientMessageId }));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe('transactional external chat notifications', () => {
  it('queues privacy-safe pushes for active owners/admins in the message transaction', async () => {
    await sendCustomerMessage(request(), { body: 'Hello', clientMessageId }, now);
    expect(mocks.recipients).toHaveBeenCalledExactlyOnceWith({
      where: { status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } }, select: { id: true },
    });
    expect(mocks.queuePush).toHaveBeenCalledExactlyOnceWith({ data: ['owner_1', 'admin_2'].map((userId) => ({
      dedupeKey: `chat.message:${message.id}:push:${userId}`,
      type: 'push.send',
      payload: {
        app: 'ADMIN', category: 'CHAT_MESSAGE', sound: 'chat-message.wav', ttl: 3600,
        title: 'New customer message', body: 'A customer has sent a new message. Open chat to reply.', userId,
        data: {
          eventType: 'chat.message_received', type: 'CHAT_MESSAGE', conversationId: conversation.id,
          messageId: message.id, recipientUserId: userId, url: `speedyvan-admin://chat/${conversation.id}`,
          invalidate: ['chat-unread', 'chat-inbox', 'chat-thread'],
        },
      },
    })) });
    const serialized = JSON.stringify(mocks.queuePush.mock.calls);
    expect(serialized).not.toContain(message.body);
    expect(serialized).not.toContain(conversation.customerName);
    expect(serialized).not.toContain(conversation.customerTokenHash);
    expect(serialized).not.toContain(clientMessageId);
  });

  it('does not enqueue for a repeated UUID or when no active admin recipient exists', async () => {
    mocks.messageUnique.mockResolvedValue(message);
    await sendCustomerMessage(request(), { body: 'Hello', clientMessageId }, now);
    expect(mocks.queuePush).not.toHaveBeenCalled();
    expect(mocks.recipients).not.toHaveBeenCalled();
    mocks.messageUnique.mockResolvedValue(null);
    mocks.recipients.mockResolvedValue([]);
    await sendCustomerMessage(request(), { body: 'Hello', clientMessageId }, now);
    expect(mocks.queuePush).not.toHaveBeenCalled();
  });

  it('schedules only the committed canonical message after returning the send response', async () => {
    const response = await messagesPOST(request('/chat/messages', { body: 'Hello', clientMessageId }));
    expect(response.status).toBe(200);
    expect(mocks.queuePush).toHaveBeenCalledOnce();
    expect(mocks.dispatchPush).not.toHaveBeenCalled();
    const callback = mocks.after.mock.calls[0]?.[0];
    if (!callback) throw new Error('Expected a scheduled chat push dispatcher.');
    await callback();
    expect(mocks.dispatchPush).toHaveBeenCalledExactlyOnceWith(message.id);
  });

  it('does not report a committed message or dispatch when enqueueing its durable push fails', async () => {
    mocks.queuePush.mockRejectedValue(new Error('Unit outbox unavailable'));
    const response = await messagesPOST(request('/chat/messages', { body: 'Hello', clientMessageId }));
    expect(response.status).toBe(500);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.dispatchPush).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it('keeps the committed send successful and reports unavailable post-response scheduling', async () => {
    const error = new Error('Unit scheduler unavailable');
    mocks.after.mockImplementation(() => { throw error; });
    const response = await messagesPOST(request('/chat/messages', { body: 'Hello', clientMessageId }));
    expect(response.status).toBe(200);
    expect(mocks.queuePush).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(error, { tags: { feature: 'chat-push-scheduling' } });
  });

  it('never creates or schedules customer alerts for admin replies', async () => {
    mocks.messageCreate.mockResolvedValue({ ...message, sender: 'ADMIN' });
    const response = await adminMessagesPOST(request(`/admin/chats/${conversation.id}/messages`, { body: 'Reply', clientMessageId }), context());
    expect(response.status).toBe(200);
    expect(mocks.recipients).not.toHaveBeenCalled();
    expect(mocks.queuePush).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});

describe('admin chat route authorization', () => {
  const routes = [
    () => inboxGET(request('/admin/chats')),
    () => adminMessagesGET(request(`/admin/chats/${conversation.id}/messages`), context()),
    () => adminMessagesPOST(request(`/admin/chats/${conversation.id}/messages`, { body: 'Hello', clientMessageId }), context()),
    () => adminReadPOST(request(`/admin/chats/${conversation.id}/read`, { messageId: message.id }), context()),
  ];
  it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)('rejects every admin route with %s before reading or writing chat', async (code) => {
    mocks.authenticate.mockRejectedValue(new AppError(code, 'Denied.'));
    for (const run of routes) expect((await run()).status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
    expect(mocks.conversationFind).not.toHaveBeenCalled();
    expect(mocks.conversationList).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('uses ADMIN/OWNER authentication and strips credentials from the inbox', async () => {
    const response = await inboxGET(request('/admin/chats'));
    expect(response.status).toBe(200);
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Request), { app: 'admin', roles: ['OWNER', 'ADMIN'] });
    expect(mocks.adminLimit).toHaveBeenCalledWith('staff_1');
    const result: unknown = await response.json();
    expect(result).toMatchObject({ unreadCount: 1, nextCursor: null, items: [{ id: conversation.id, lastMessage: { body: 'Hello' } }] });
    expect(JSON.stringify(result)).not.toContain(conversation.customerTokenHash);
  });

  it('retains the newest customer message and canonical sequence when a later staff reply changes the inbox preview', async () => {
    mocks.conversationList.mockResolvedValue([{ ...conversation, messages: [{ ...message, id: 'staff_reply', sender: 'ADMIN', sequence: message.sequence + 1n }] }]);
    const response = await inboxGET(request('/admin/chats'));
    expect(await response.json()).toMatchObject({
      latestCustomerSequence: message.sequence.toString(),
      items: [{ lastMessage: { id: 'staff_reply', sender: 'ADMIN' }, lastCustomerMessage: { id: message.id, sender: 'CUSTOMER' }, lastCustomerMessageSequence: message.sequence.toString() }],
    });
    const latestCall = mocks.raw.mock.calls.find((call) => String(call[0]).includes('JOIN LATERAL'));
    expect(latestCall?.[1]).toEqual([conversation.id]);
    expect(String(latestCall?.[0])).toContain('ORDER BY "sequence" DESC LIMIT 1');
    const unreadCall = mocks.raw.mock.calls.find((call) => String(call[0]).includes('GROUP BY'));
    expect(unreadCall?.[1]).toEqual([conversation.id]);
    expect(mocks.messageCount).not.toHaveBeenCalled();
  });

  it('excludes expired threads from the inbox and its aggregate unread SQL at the same boundary', async () => {
    await getAdminChatInbox({ limit: 25 }, now);
    expect(mocks.conversationList.mock.calls[0]?.[0]).toMatchObject({ where: { expiresAt: { gt: now }, messages: { some: {} } } });
    const rawCall = mocks.raw.mock.calls.find((call) => String(call[0]).includes('MAX(m."sequence")'));
    expect(rawCall?.[1]).toEqual(now);
    expect(String(rawCall?.[0])).toContain('c."expiresAt" >');
  });

  it.each([0, -1])('rejects admin history, replies and read acknowledgements for expired threads at boundary %+dms', async (offset) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      mocks.conversationFind.mockResolvedValue({ ...conversation, expiresAt: new Date(now.getTime() + offset) });
      expect((await adminMessagesGET(request(`/admin/chats/${conversation.id}/messages`), context())).status).toBe(404);
      expect((await adminMessagesPOST(request(`/admin/chats/${conversation.id}/messages`, { body: 'Hello', clientMessageId }), context())).status).toBe(404);
      expect((await adminReadPOST(request(`/admin/chats/${conversation.id}/read`, { messageId: message.id }), context())).status).toBe(404);
      expect(mocks.messageList).not.toHaveBeenCalled();
      expect(mocks.messageCreate).not.toHaveBeenCalled();
      expect(mocks.conversationUpdate).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('serves authenticated thread history and records read acknowledgements through the admin routes', async () => {
    const history = await adminMessagesGET(request(`/admin/chats/${conversation.id}/messages`), context());
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ conversation: { id: conversation.id }, messages: [{ id: message.id }] });
    const read = await adminReadPOST(request(`/admin/chats/${conversation.id}/read`, { messageId: message.id }), context());
    expect(read.status).toBe(200);
    expect((await adminReadPOST(request(`/admin/chats/${conversation.id}/read`, {}), context())).status).toBe(400);
    expect((await adminMessagesGET(request(`/admin/chats/${conversation.id}/messages?after=a&before=b`), context())).status).toBe(400);
  });

  it('saves staff attribution internally but never accepts a forged sender or exposes its staff ID', async () => {
    mocks.messageCreate.mockResolvedValue({ ...message, sender: 'ADMIN' });
    const response = await adminMessagesPOST(request(`/admin/chats/${conversation.id}/messages`, { body: 'Hello', clientMessageId }), context());
    expect(response.status).toBe(200);
    expect(mocks.messageCreate.mock.calls[0]?.[0]).toMatchObject({ data: { sender: 'ADMIN', senderUserId: 'staff_1' } });
    expect(JSON.stringify(await response.json())).not.toContain('staff_1');
    expect((await adminMessagesPOST(request(`/admin/chats/${conversation.id}/messages`, { body: 'Hello', clientMessageId, sender: 'CUSTOMER' }), context())).status).toBe(400);
  });

  it('rejects malformed inbox cursors and cross-origin browser admin replies', async () => {
    expect((await inboxGET(request('/admin/chats?cursor=bad'))).status).toBe(400);
    expect((await adminMessagesPOST(request(`/admin/chats/${conversation.id}/messages`, { body: 'Hello', clientMessageId }, { origin: 'https://evil.example' }), context())).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('reports unexpected database failures without returning internal errors or customer data', async () => {
    mocks.conversationFind.mockRejectedValue(new Error('Database unavailable'));
    const response = await sessionGET(request('/chat/session'));
    expect(response.status).toBe(500);
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain('Database unavailable');
  });
});
