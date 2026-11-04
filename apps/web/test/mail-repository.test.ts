import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@sv/contracts';
import type { ImapMessageSummary, ImapPage } from '../src/server/mail/imap';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), lock: vi.fn(), folderFind: vi.fn(), folderUpsert: vi.fn(), folderUpdate: vi.fn(),
  messageFind: vi.fn(), messageFindMany: vi.fn(), messageUpsert: vi.fn(), messageDelete: vi.fn(), messageUpdate: vi.fn(),
  config: vi.fn(), page: vi.fn(), lease: vi.fn(),
}));
vi.mock('@sv/db', () => ({ prisma: {
  $transaction: mocks.transaction,
  mailFolder: { findUnique: mocks.folderFind, upsert: mocks.folderUpsert, update: mocks.folderUpdate },
  mailMessage: { findFirst: mocks.messageFind, findMany: mocks.messageFindMany, upsert: mocks.messageUpsert, deleteMany: mocks.messageDelete, updateMany: mocks.messageUpdate },
} }));
vi.mock('../src/server/mail/config', () => ({ mailConfig: mocks.config }));
vi.mock('../src/server/mail/imap', () => ({ readImapPage: mocks.page }));
vi.mock('../src/server/mail/lease', () => ({ withMailLease: mocks.lease }));

import { decodeMailCursor, mailCursor, persistPage, requireMailMessage, syncMailFolder, threadKey } from '../src/server/mail/repository';

const mailbox = 'support@example.test';
const date = new Date('2026-11-04T00:00:00Z');
interface FolderState {
  id: string; mailbox: string; folder: string; path: string; uidValidity: string;
  lastUid: number | bigint; oldestUid: number | bigint; uidNext: number | bigint;
  unreadCount: number; hasMore: boolean; lastSyncAt: Date | null; lastErrorCode: string | null;
}
interface MessageState {
  id: string; mailbox: string; folder: string; uidValidity: string; uid: number | bigint;
  threadId: string; messageId: string | null; inReplyTo: string | null; references: string[];
  fromAddresses: unknown; toAddresses: unknown; ccAddresses: unknown;
  subject: string; sentAt: Date; seen: boolean; size: number; attachmentCount: number; snippet: string; createdAt: Date;
}
interface UidWhere { gte?: number | bigint; lte?: number | bigint; lt?: number | bigint; notIn?: (number | bigint)[] }
interface RelatedWhere { messageId?: { in: string[] }; inReplyTo?: string; references?: { array_contains: string[] } }
interface MessageWhere {
  mailbox?: string; folder?: string; uidValidity?: string; uid?: UidWhere; id?: string;
  threadId?: string | { in: string[] }; OR?: RelatedWhere[];
}
let folder: FolderState | null;
let messages: MessageState[];

function folderState(values: Partial<FolderState> = {}): FolderState {
  return { id: 'folder-inbox', mailbox, folder: 'inbox', path: 'INBOX', uidValidity: '7', lastUid: 50n, oldestUid: 10n, uidNext: 51n, unreadCount: 0, hasMore: false, lastSyncAt: date, lastErrorCode: null, ...values };
}
function messageState(uid: number, values: Partial<MessageState> = {}): MessageState {
  return { id: `message-${String(uid)}`, mailbox, folder: 'inbox', uidValidity: '7', uid: BigInt(uid),
    threadId: `thread-${String(uid)}`, messageId: `<${String(uid)}@example.test>`, inReplyTo: null, references: [],
    fromAddresses: [], toAddresses: [], ccAddresses: [], subject: 'Message', sentAt: date, seen: false,
    size: 100, attachmentCount: 0, snippet: '', createdAt: date, ...values };
}
function providerMessage(uid: number, values: Partial<ImapMessageSummary> = {}): ImapMessageSummary {
  return { uid, messageId: `<${String(uid)}@example.test>`, inReplyTo: null, references: [], from: [], to: [], cc: [], replyTo: [], subject: 'Message', dateISO: date.toISOString(), seen: false, size: 100, attachmentCount: 0, ...values };
}
function page(uids: number[], values: Partial<ImapPage> = {}): ImapPage {
  return { path: 'INBOX', uidValidity: '7', uidNext: Math.max(50, ...uids) + 1, unread: 0, total: uids.length,
    messages: uids.map((uid) => providerMessage(uid)), hasMore: false, ...values };
}
function matches(message: MessageState, where: MessageWhere): boolean {
  if (where.mailbox !== undefined && where.mailbox !== message.mailbox) return false;
  if (where.folder !== undefined && where.folder !== message.folder) return false;
  if (where.uidValidity !== undefined && where.uidValidity !== message.uidValidity) return false;
  if (where.id !== undefined && where.id !== message.id) return false;
  if (typeof where.threadId === 'string' && where.threadId !== message.threadId) return false;
  if (typeof where.threadId === 'object' && !where.threadId.in.includes(message.threadId)) return false;
  const uid = Number(message.uid);
  if (where.uid?.gte !== undefined && uid < Number(where.uid.gte)) return false;
  if (where.uid?.lte !== undefined && uid > Number(where.uid.lte)) return false;
  if (where.uid?.lt !== undefined && uid >= Number(where.uid.lt)) return false;
  if (where.uid?.notIn?.some((value) => Number(value) === uid)) return false;
  if (where.OR && !where.OR.some((choice) => (choice.messageId && message.messageId !== null && choice.messageId.in.includes(message.messageId))
    || (choice.inReplyTo !== undefined && choice.inReplyTo === message.inReplyTo)
    || (choice.references && choice.references.array_contains.every((id) => message.references.includes(id))))) return false;
  return true;
}
function cachedUids(): number[] { return messages.filter((item) => item.mailbox === mailbox && item.folder === 'inbox').map((item) => Number(item.uid)).sort((a, b) => a - b); }

const tx = {
  $executeRaw: mocks.lock,
  mailFolder: { findUnique: mocks.folderFind, upsert: mocks.folderUpsert, update: mocks.folderUpdate },
  mailMessage: { findFirst: mocks.messageFind, findMany: mocks.messageFindMany, upsert: mocks.messageUpsert, deleteMany: mocks.messageDelete, updateMany: mocks.messageUpdate },
};

beforeEach(() => {
  vi.resetAllMocks(); folder = folderState(); messages = [];
  mocks.config.mockReturnValue({ enabled: true, mailbox, password: 'test-only' });
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
  mocks.lease.mockImplementation((_key: string, operation: () => Promise<unknown>) => operation());
  mocks.lock.mockResolvedValue(1);
  mocks.folderFind.mockImplementation(() => Promise.resolve(folder ? { ...folder } : null));
  mocks.folderUpsert.mockImplementation((input: { create: Omit<FolderState, 'id'>; update: Partial<FolderState> }) => {
    folder = folder ? { ...folder, ...input.update } : { id: 'folder-inbox', ...input.create };
    return Promise.resolve(folder);
  });
  mocks.folderUpdate.mockImplementation((input: { data: Partial<FolderState> }) => {
    if (folder) folder = { ...folder, ...input.data };
    return Promise.resolve(folder);
  });
  mocks.messageFind.mockImplementation((input: { where: MessageWhere }) => Promise.resolve(messages.find((item) => matches(item, input.where)) ?? null));
  mocks.messageFindMany.mockImplementation((input: { where: MessageWhere }) => Promise.resolve(messages.filter((item) => matches(item, input.where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((item) => ({ ...item }))));
  mocks.messageDelete.mockImplementation((input: { where: MessageWhere }) => {
    const previousCount = messages.length; messages = messages.filter((item) => !matches(item, input.where));
    return Promise.resolve({ count: previousCount - messages.length });
  });
  mocks.messageUpdate.mockImplementation((input: { where: MessageWhere; data: Partial<MessageState> }) => {
    let count = 0;
    messages = messages.map((item) => { if (!matches(item, input.where)) return item; count++; return { ...item, ...input.data }; });
    return Promise.resolve({ count });
  });
  mocks.messageUpsert.mockImplementation((input: { create: Omit<MessageState, 'id' | 'snippet'>; update: Partial<MessageState> }) => {
    const existing = messages.find((item) => item.mailbox === input.create.mailbox && item.folder === input.create.folder && item.uidValidity === input.create.uidValidity && Number(item.uid) === Number(input.create.uid));
    const saved = existing ? { ...existing, ...input.update } : { id: `message-${String(input.create.uid)}-${input.create.uidValidity}`, snippet: '', ...input.create };
    messages = [...messages.filter((item) => item.id !== saved.id), saved];
    return Promise.resolve({ ...saved });
  });
});

describe('mail cache synchronization', () => {
  it.each([{ uidValidity: '8', path: 'INBOX' }, { uidValidity: '7', path: 'ChangedInbox' }])('discards a stale cursor and resets cached messages after mailbox identity changes: %j', async (identity) => {
    messages = [messageState(10), messageState(20, { folder: 'sent' }), messageState(30, { mailbox: 'other@example.test' })];
    mocks.page.mockResolvedValueOnce(page([], identity)).mockResolvedValueOnce(page([1, 2], identity));
    await syncMailFolder('inbox');
    expect(mocks.page).toHaveBeenNthCalledWith(1, 'inbox', { afterUid: 50, limit: 50 });
    expect(mocks.page).toHaveBeenNthCalledWith(2, 'inbox', { limit: 50 });
    expect(cachedUids()).toEqual([1, 2]);
    expect(messages).toHaveLength(4);
    expect(folder).toMatchObject({ ...identity, lastUid: 2, oldestUid: 1 });
  });

  it('does not advance the incremental high-water mark when a user opens the newest page', async () => {
    folder = folderState({ lastUid: 50n, oldestUid: 10n, hasMore: true });
    await persistPage(mailbox, 'inbox', page([199, 200], { total: 200, hasMore: true }), 'latest');
    expect(Number(folder.lastUid)).toBe(50);
    mocks.page.mockResolvedValue(page([51, 52], { total: 200, hasMore: true }));
    await syncMailFolder('inbox');
    expect(mocks.page).toHaveBeenCalledWith('inbox', { afterUid: 50, limit: 50 });
    expect(Number(folder.lastUid)).toBe(52);
    expect(cachedUids()).toEqual([51, 52, 199, 200]);
  });

  it('resumes from the persisted cursor on a later sync call, including unsigned 32-bit UIDs', async () => {
    folder = folderState({ lastUid: 4_000_000_000n, oldestUid: 4_000_000_000n });
    mocks.page.mockResolvedValueOnce(page([4_000_000_001, 4_000_000_002], { total: 3, hasMore: true }))
      .mockResolvedValueOnce(page([4_000_000_003], { total: 3 }));
    await syncMailFolder('inbox');
    await syncMailFolder('inbox');
    expect(mocks.page).toHaveBeenNthCalledWith(1, 'inbox', { afterUid: 4_000_000_000, limit: 50 });
    expect(mocks.page).toHaveBeenNthCalledWith(2, 'inbox', { afterUid: 4_000_000_002, limit: 50 });
    expect(Number(folder.lastUid)).toBe(4_000_000_003);
    expect(cachedUids()).toEqual([4_000_000_001, 4_000_000_002, 4_000_000_003]);
  });

  it('initializes newest messages once and preserves the older-page cursor separately', async () => {
    folder = null;
    await persistPage(mailbox, 'inbox', page([99, 100], { total: 100, hasMore: true }), 'latest');
    await persistPage(mailbox, 'inbox', page([97, 98], { total: 100, hasMore: true }), 'older');
    expect(folder).toMatchObject({ lastUid: 100, oldestUid: 97, hasMore: true });
  });

  it('clears stale empty-folder cursors and cached rows without touching another mailbox', async () => {
    folder = folderState({ hasMore: true });
    messages = [messageState(10), messageState(20, { mailbox: 'other@example.test' })];
    await persistPage(mailbox, 'inbox', page([], { total: 0 }), 'incremental');
    expect(cachedUids()).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(folder).toMatchObject({ lastUid: 0, oldestUid: 0, hasMore: false });
  });

  it('removes expunged messages at the top edge without deleting unsynced older history', async () => {
    messages = [70, 80, 85, 90, 100].map((uid) => messageState(uid));
    await persistPage(mailbox, 'inbox', page([80, 90], { total: 3, hasMore: true }), 'latest');
    expect(cachedUids()).toEqual([70, 80, 90]);
  });

  it('reconciles the entire folder when the newest page reaches its beginning', async () => {
    folder = folderState({ oldestUid: 70n, hasMore: true });
    messages = [70, 80, 90, 100].map((uid) => messageState(uid));
    await persistPage(mailbox, 'inbox', page([80, 90]), 'latest');
    expect(cachedUids()).toEqual([80, 90]);
    expect(folder).toMatchObject({ oldestUid: 80, hasMore: false });
  });

  it('reconciles only covered older and incremental ranges', async () => {
    messages = [1, 10, 15, 20, 40, 100].map((uid) => messageState(uid));
    await persistPage(mailbox, 'inbox', page([10, 20], { total: 4 }), 'older');
    expect(cachedUids()).toEqual([10, 20, 40, 100]);
    await persistPage(mailbox, 'inbox', page([25, 50], { total: 5 }), 'incremental');
    expect(cachedUids()).toEqual([10, 20, 25, 50, 100]);
  });

  it('removes stale older rows when an older request returns no messages', async () => {
    folder = folderState({ oldestUid: 10n, hasMore: true });
    messages = [1, 5, 10, 50].map((uid) => messageState(uid));
    await persistPage(mailbox, 'inbox', page([], { total: 2 }), 'older');
    expect(cachedUids()).toEqual([10, 50]);
    expect(folder.hasMore).toBe(false);
  });

  it('joins every cached child thread when their missing parent arrives', async () => {
    messages = [
      messageState(10, { inReplyTo: '<parent@example.test>', threadId: 'child-a' }),
      messageState(20, { inReplyTo: '<parent@example.test>', threadId: 'child-b' }),
      messageState(30, { references: ['<parent@example.test>'], threadId: 'child-c' }),
      messageState(40, { mailbox: 'other@example.test', inReplyTo: '<parent@example.test>', threadId: 'other-mailbox' }),
    ];
    await persistPage(mailbox, 'inbox', page([5], { total: 4, messages: [providerMessage(5, { messageId: '<parent@example.test>' })] }), 'incremental');
    const expected = threadKey(mailbox, '<parent@example.test>');
    expect(messages.filter((item) => item.mailbox === mailbox).map((item) => item.threadId)).toEqual([expected, expected, expected, expected]);
    expect(messages.find((item) => item.mailbox !== mailbox)?.threadId).toBe('other-mailbox');
  });

  it('joins competing ancestor roots and returns consistent thread IDs within one page', async () => {
    messages = [messageState(1, { messageId: '<root@example.test>', threadId: 'root-thread', createdAt: new Date('2026-01-01') })];
    const result = await persistPage(mailbox, 'inbox', page([4, 3], { total: 3, messages: [
      providerMessage(4, { messageId: '<child@example.test>', inReplyTo: '<parent@example.test>' }),
      providerMessage(3, { messageId: '<parent@example.test>', references: ['<root@example.test>'] }),
    ] }), 'incremental');
    expect(result.rows.map((row) => row.threadId)).toEqual(['root-thread', 'root-thread']);
    expect(messages.map((item) => item.threadId)).toEqual(['root-thread', 'root-thread', 'root-thread']);
  });

  it('uses the cache creation time when no provider date exists and preserves it on refresh', async () => {
    const startedAt = Date.now();
    const result = await persistPage(mailbox, 'inbox', page([10], { messages: [providerMessage(10, { dateISO: null })] }), 'incremental');
    expect(result.rows[0]?.sentAt).toEqual(result.rows[0]?.createdAt);
    expect(result.rows[0]?.sentAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    const original = messages[0]?.sentAt;
    await persistPage(mailbox, 'inbox', page([10], { messages: [providerMessage(10, { dateISO: null })] }), 'incremental');
    expect(messages[0]?.sentAt).toEqual(original);
  });

  it('keeps cursors unchanged on provider failure and persists only a sanitized error', async () => {
    mocks.page.mockRejectedValue(new AppError('CONFLICT', 'private provider details'));
    await expect(syncMailFolder('inbox')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(Number(folder?.lastUid)).toBe(50);
    expect(folder?.lastErrorCode).toBe('MAILBOX_CHANGED');
    expect(mocks.folderUpsert).not.toHaveBeenCalled();
  });
});

describe('mail cursor and cached-message identity', () => {
  it('round trips a folder-bound cursor and rejects malformed or cross-folder input', () => {
    const cursor = mailCursor('inbox', '7', 4_000_000_000);
    expect(decodeMailCursor(cursor, 'inbox')).toEqual({ folder: 'inbox', validity: '7', uid: 4_000_000_000 });
    expect(() => decodeMailCursor(cursor, 'sent')).toThrow(AppError);
    expect(() => decodeMailCursor('malformed', 'inbox')).toThrow(AppError);
    expect(decodeMailCursor(undefined, 'inbox')).toBeNull();
  });

  it('does not return stale or another mailbox cached message', async () => {
    messages = [messageState(10, { uidValidity: '6' }), messageState(20, { mailbox: 'other@example.test' })];
    await expect(requireMailMessage('message-10')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(requireMailMessage('message-20')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(requireMailMessage('absent')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
