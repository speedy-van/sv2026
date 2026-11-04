import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  origin: vi.fn(),
  limit: vi.fn(),
  status: vi.fn(),
  messages: vi.fn(),
  sync: vi.fn(),
  thread: vi.fn(),
  read: vi.fn(),
  reply: vi.fn(),
  attachment: vi.fn(),
  deliveries: vi.fn(),
  retry: vi.fn(),
  after: vi.fn<(task: () => Promise<void>) => void>(),
  process: vi.fn(),
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/auth/browser-session', () => ({ assertBrowserSessionOrigin: mocks.origin }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxBatch: mocks.process }));
vi.mock('../src/server/mail/repository', () => ({ syncMailFolder: mocks.sync }));
vi.mock('../src/server/mail/service', () => ({
  enforceMailRateLimit: mocks.limit,
  mailStatus: mocks.status,
  listMail: mocks.messages,
  readMailThread: mocks.thread,
  markMailRead: mocks.read,
  queueMailReply: mocks.reply,
  mailAttachment: mocks.attachment,
  listMailDeliveries: mocks.deliveries,
  retryDelivery: mocks.retry,
}));
import { handleAdminMail, type MailAction } from '../src/server/mail/routes';

const at = '2031-10-15T12:00:00.000Z';
const status = {
  configured: true,
  mailbox: 'business@example.test',
  folders: [{ id: 'inbox', unreadCount: 0 }],
  lastSyncAt: at,
  syncError: null,
  quota: {
    messagesUsed: 0,
    messagesLimit: 100,
    externalRecipientsUsed: 0,
    externalRecipientsLimit: 100,
    resetsAt: at,
  },
  failedCount: 0,
  uncertainCount: 0,
};
const reply = { clientMessageId: '6a0d772b-0b3c-4ee2-b3c9-f829ff4539be', mode: 'reply', text: 'Confirmed' };
const saved = { deliveryId: 'delivery-one', status: 'QUEUED', outboxEventId: 'event-one' };
const cases: { action: MailAction; body?: unknown; id?: string; attachmentId?: string }[] = [
  { action: 'status' },
  { action: 'messages' },
  { action: 'deliveries' },
  { action: 'sync', body: { folder: 'inbox' } },
  { action: 'thread', id: 'thread-one' },
  { action: 'read', id: 'message-one', body: { read: true } },
  { action: 'reply', id: 'message-one', body: reply },
  { action: 'attachment', id: 'message-one', attachmentId: 'attachment-one' },
  { action: 'retry', id: 'delivery-one', body: { acknowledgeDuplicateRisk: false } },
];
function request(body?: unknown, query = '', headers: Record<string, string> = {}): Request {
  return new Request(`https://example.test/api/v1/admin/mail${query}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'request-one', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({
    app: 'admin',
    role: 'ADMIN',
    userId: 'admin-one',
    sessionId: 'session-one',
  });
  mocks.status.mockResolvedValue(status);
  mocks.messages.mockResolvedValue({
    items: [],
    nextCursor: null,
    sync: { at, error: null, hasMore: false },
  });
  mocks.thread.mockResolvedValue({ id: 'thread-one', subject: 'Subject', messages: [], nextCursor: null });
  mocks.read.mockResolvedValue({ ok: true });
  mocks.reply.mockResolvedValue(saved);
  mocks.retry.mockResolvedValue(saved);
  mocks.attachment.mockResolvedValue({
    filename: 'file.txt',
    contentType: 'text/plain',
    size: 2,
    base64: 'SGk=',
  });
  mocks.deliveries.mockResolvedValue({ items: [], nextCursor: null });
});

describe('mail routes authenticate and validate each action', () => {
  it.each(cases)(
    'handles the $action happy path through staff auth and a no-store response',
    async ({ action, body, id, attachmentId }) => {
      const req = request(body);
      const response = await handleAdminMail(req, action, id, attachmentId);
      expect(response.status).toBe(action === 'reply' || action === 'retry' ? 202 : 200);
      expect(mocks.authenticate).toHaveBeenCalledExactlyOnceWith(req, {
        app: 'admin',
        roles: ['OWNER', 'ADMIN'],
      });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-request-id')).toBe('request-one');
    },
  );

  it.each(cases)(
    'rejects anonymous access to $action before touching mail',
    async ({ action, body, id, attachmentId }) => {
      mocks.authenticate.mockRejectedValue(new AppError('UNAUTHORIZED', 'Sign in.'));
      expect((await handleAdminMail(request(body), action, id, attachmentId)).status).toBe(401);
      expect(mocks.limit).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    },
  );

  it.each(cases)(
    'propagates staff role rejection for $action',
    async ({ action, body, id, attachmentId }) => {
      mocks.authenticate.mockRejectedValue(new AppError('FORBIDDEN', 'Admin role required.'));
      expect((await handleAdminMail(request(body), action, id, attachmentId)).status).toBe(403);
      expect(mocks.limit).not.toHaveBeenCalled();
    },
  );

  it.each(['sync', 'read', 'reply', 'retry'] as const)(
    'checks browser origin before %s mutates',
    async (action) => {
      mocks.origin.mockImplementation(() => {
        throw new AppError('FORBIDDEN', 'Invalid origin.');
      });
      expect(
        (
          await handleAdminMail(
            request({}, '', { origin: 'https://outside.example.test' }),
            action,
            'message-one',
          )
        ).status,
      ).toBe(403);
      expect(mocks.limit).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    },
  );

  it('rejects a body over the streaming byte cap even without Content-Length', async () => {
    expect(
      (await handleAdminMail(request({ ...reply, text: 'x'.repeat(128 * 1024) }), 'reply', 'message-one'))
        .status,
    ).toBe(400);
    expect(mocks.reply).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('rejects oversized declared length, non-JSON content, invalid reply identifiers and unknown fields', async () => {
    expect(
      (
        await handleAdminMail(
          request(reply, '', { 'content-length': String(128 * 1024 + 1) }),
          'reply',
          'message-one',
        )
      ).status,
    ).toBe(400);
    expect(
      (await handleAdminMail(request(reply, '', { 'content-type': 'text/plain' }), 'reply', 'message-one'))
        .status,
    ).toBe(400);
    expect(
      (await handleAdminMail(request({ ...reply, clientMessageId: 'invalid' }), 'reply', 'message-one'))
        .status,
    ).toBe(400);
    expect(
      (await handleAdminMail(request({ ...reply, to: 'other@example.test' }), 'reply', 'message-one')).status,
    ).toBe(400);
    expect(mocks.reply).not.toHaveBeenCalled();
  });

  it('rejects duplicate query keys, invalid identifiers and attachment traversal before services run', async () => {
    expect((await handleAdminMail(request(undefined, '?folder=inbox&folder=sent'), 'messages')).status).toBe(
      400,
    );
    expect((await handleAdminMail(request(), 'thread', '../message')).status).toBe(400);
    expect((await handleAdminMail(request(), 'attachment', 'message-one', '../file')).status).toBe(400);
    expect(mocks.messages).not.toHaveBeenCalled();
    expect(mocks.thread).not.toHaveBeenCalled();
    expect(mocks.attachment).not.toHaveBeenCalled();
  });

  it('schedules only a committed outbox row and never exposes its internal ID in the JSON response', async () => {
    let complete: ((value: typeof saved) => void) | undefined;
    mocks.reply.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const responsePromise = handleAdminMail(request(reply), 'reply', 'message-one');
    await vi.waitFor(() => {
      expect(mocks.reply).toHaveBeenCalled();
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
    complete?.(saved);
    const response = await responsePromise;
    expect(await response.json()).toEqual({ deliveryId: 'delivery-one', status: 'QUEUED' });
    const task = mocks.after.mock.calls[0]?.[0];
    if (!task) throw new Error('Expected after-commit dispatch');
    await task();
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith(1, ['booking.confirmed', 'email.send', 'email.reply'], {
      rootEventId: 'event-one',
    });
    expect(mocks.reply).toHaveBeenCalledExactlyOnceWith('message-one', reply, 'admin-one');
  });

  it('does not schedule a failed persistence and hides provider/database diagnostics', async () => {
    mocks.reply.mockRejectedValue(new Error('secret-password and private MIME body'));
    const response = await handleAdminMail(request(reply), 'reply', 'message-one');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret-password');
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('preserves the successful queue response if the optional after dispatcher is unavailable', async () => {
    mocks.after.mockImplementation(() => {
      throw new Error('No request scope');
    });
    expect((await handleAdminMail(request(reply), 'reply', 'message-one')).status).toBe(202);
    expect(mocks.reply).toHaveBeenCalledOnce();
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
