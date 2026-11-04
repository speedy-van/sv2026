import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchQueryObject, FetchOptions, ImapFlowOptions } from 'imapflow';

const mocks = vi.hoisted(() => ({
  config: vi.fn(), connect: vi.fn(), close: vi.fn(), list: vi.fn(), open: vi.fn(), status: vi.fn(), emitEvent: vi.fn(),
  fetchOne: vi.fn(), fetchAll: vi.fn(), fetch: vi.fn(), search: vi.fn(), append: vi.fn(), add: vi.fn(), remove: vi.fn(), options: vi.fn(),
  box: { path: 'INBOX', delimiter: '/', flags: new Set<string>(), uidValidity: 7n, uidNext: 51, exists: 5 },
}));
vi.mock('../src/server/mail/config', () => ({ mailConfig: mocks.config }));
vi.mock('imapflow', async () => {
  const { EventEmitter } = await import('node:events');
  return { ImapFlow: class extends EventEmitter {
    mailbox = mocks.box;
    constructor(options: ImapFlowOptions) { super(); mocks.options(options); mocks.emitEvent.mockImplementation((event: string) => this.emit(event, {})); }
    connect = mocks.connect; close = mocks.close; list = mocks.list; mailboxOpen = mocks.open;
    status = mocks.status; fetchOne = mocks.fetchOne; fetchAll = mocks.fetchAll; fetch = mocks.fetch;
    search = mocks.search; append = mocks.append; messageFlagsAdd = mocks.add; messageFlagsRemove = mocks.remove;
  } };
});

import { appendSentMessage, downloadImapAttachment, fetchImapMessage, findSentMessage, readImapPage, setImapSeen } from '../src/server/mail/imap';
import { MAX_MESSAGE_BYTES } from '../src/server/mail/mime';

const raw = Buffer.from('Message-ID: <mail@example.test>\r\nFrom: sender@example.test\r\nSubject: Hello\r\nDate: invalid\r\nContent-Type: text/plain\r\n\r\nBody');
const uids = [10, 20, 30, 40, 50];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.box.uidValidity = 7n; mocks.box.exists = 5; mocks.box.path = 'INBOX';
  mocks.config.mockReturnValue({ enabled: true, mailbox: 'support@example.test', password: 'test-only-password' });
  mocks.connect.mockResolvedValue(undefined);
  mocks.open.mockImplementation((path: string) => { mocks.box.path = path; return Promise.resolve(mocks.box); });
  mocks.status.mockResolvedValue({ unseen: 2 });
  mocks.list.mockResolvedValue([{ path: 'Localized/Sent', specialUse: '\\Sent', flags: new Set<string>() }]);
  mocks.fetchOne.mockImplementation((value: number, query: FetchQueryObject, options?: FetchOptions) => {
    const uid = options?.uid ? value : uids[value - 1];
    if (uid === undefined) return Promise.resolve(false);
    return Promise.resolve({ seq: uids.indexOf(uid) + 1, uid, size: raw.length, flags: new Set(['\\Seen']), internalDate: new Date('2026-11-03T12:00:00Z'), headers: raw.subarray(0, raw.indexOf('\r\n\r\n') + 4), ...(query.source ? { source: raw } : {}) });
  });
  mocks.fetchAll.mockImplementation((range: string) => {
    const [start, end] = range.split(':').map(Number);
    return Promise.resolve(uids.slice((start ?? 1) - 1, end).map((uid) => ({ seq: uids.indexOf(uid) + 1, uid })));
  });
  mocks.fetch.mockImplementation(function* (selected: number[]) {
    for (const uid of selected) yield { seq: uids.indexOf(uid) + 1, uid, headers: raw.subarray(0, raw.indexOf('\r\n\r\n') + 4), flags: new Set(['\\Seen']), size: raw.length, internalDate: new Date('2026-11-03T12:00:00Z'), bodyStructure: { type: 'text/plain' } };
  });
  mocks.search.mockResolvedValue([]); mocks.append.mockResolvedValue({ uid: 60 });
  mocks.add.mockResolvedValue(true); mocks.remove.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('bounded Lark IMAP adapter', () => {
  it('uses verified TLS, fixed host and bounded timeouts, then closes after a page', async () => {
    const page = await readImapPage('inbox', { limit: 2 });
    expect(page.messages.map((message) => message.uid)).toEqual([50, 40]);
    expect(page).toMatchObject({ uidValidity: '7', uidNext: 51, unread: 2, total: 5, hasMore: true });
    expect(page.messages[0]?.dateISO).toBe('2026-11-03T12:00:00.000Z');
    expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ host: 'imap.larksuite.com', port: 993, secure: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000, disableAutoIdle: true, logger: false }));
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith([50, 40], expect.objectContaining({ bodyStructure: true }), { uid: true });
  });

  it('paginates sparse UIDs before and after cursors without an unbounded search', async () => {
    const previous = await readImapPage('inbox', { beforeUid: 40, limit: 2 });
    expect(previous.messages.map((message) => message.uid)).toEqual([30, 20]);
    expect(previous.hasMore).toBe(true);
    const newer = await readImapPage('inbox', { afterUid: 20, limit: 2 });
    expect(newer.messages.map((message) => message.uid)).toEqual([30, 40]);
    expect(newer.hasMore).toBe(true);
    expect(mocks.search).not.toHaveBeenCalled();
    expect((await readImapPage('inbox', { afterUid: 50 })).messages).toEqual([]);
    expect((await readImapPage('inbox', { beforeUid: 10 })).messages).toEqual([]);
  });

  it('does not fetch stale UIDs or change flags after UIDVALIDITY changes', async () => {
    await expect(fetchImapMessage('inbox', 10, '6')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(downloadImapAttachment('inbox', 10, '6', 'attachment-1')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(setImapSeen('inbox', 10, '6', true)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.fetchOne).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(3);
  });

  it('reads complete bounded source with UID operations and a real internal-date fallback', async () => {
    const message = await fetchImapMessage('inbox', 10, '7');
    expect(message).toMatchObject({ uid: 10, uidValidity: '7', bodyText: 'Body', seen: true, dateISO: '2026-11-03T12:00:00.000Z' });
    expect(mocks.fetchOne).toHaveBeenLastCalledWith(10, { uid: true, source: { maxLength: MAX_MESSAGE_BYTES + 1 } }, { uid: true });
  });

  it('rejects oversized or incomplete message bodies', async () => {
    mocks.fetchOne.mockResolvedValueOnce({ uid: 10, size: MAX_MESSAGE_BYTES + 1 });
    await expect(fetchImapMessage('inbox', 10, '7')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mocks.fetchOne).toHaveBeenCalledTimes(1);
    mocks.fetchOne.mockResolvedValueOnce({ uid: 10, size: 500 }).mockResolvedValueOnce({ uid: 10, source: raw });
    await expect(fetchImapMessage('inbox', 10, '7')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rechecks UIDVALIDITY between the metadata read and the source fetch', async () => {
    mocks.fetchOne.mockImplementationOnce(() => {
      mocks.box.uidValidity = 8n;
      return Promise.resolve({ uid: 10, size: raw.length });
    });
    await expect(fetchImapMessage('inbox', 10, '7')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.fetchOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a page whose message count changes during the read', async () => {
    mocks.fetch.mockImplementation(function* () {
      mocks.box.exists = 4;
      yield { seq: 1, uid: 10, headers: Buffer.from('Subject: Hello\r\n\r\n') };
    });
    await expect(readImapPage('inbox')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects expunge plus append even when the final message count is unchanged', async () => {
    mocks.fetchAll.mockImplementationOnce(() => {
      mocks.emitEvent('expunge'); mocks.emitEvent('exists');
      return Promise.resolve([{ seq: 3, uid: 40 }, { seq: 4, uid: 50 }, { seq: 5, uid: 60 }]);
    });
    await expect(readImapPage('inbox', { afterUid: 20, limit: 2 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('adds and removes only the Seen flag using UID mode', async () => {
    await setImapSeen('inbox', 10, '7', true); await setImapSeen('inbox', 10, '7', false);
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith(10, ['\\Seen'], { uid: true });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(10, ['\\Seen'], { uid: true });
  });

  it('discovers the special-use Sent folder and does not append duplicates', async () => {
    mocks.search.mockResolvedValue([10]);
    expect(await findSentMessage('<mail@example.test>')).toBe(true);
    await appendSentMessage(raw);
    expect(mocks.open).toHaveBeenCalledWith('Localized/Sent', { readOnly: false });
    expect(mocks.append).not.toHaveBeenCalled();
    mocks.search.mockResolvedValue([]);
    await appendSentMessage(raw);
    expect(mocks.append).toHaveBeenCalledExactlyOnceWith('Localized/Sent', raw, ['\\Seen']);
  });

  it('checks exact RFC Message-ID because IMAP header search is a substring search', async () => {
    mocks.search.mockResolvedValue([10]);
    expect(await findSentMessage('<other@example.test>')).toBe(false);
    await expect(findSentMessage('bad\r\ninput')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('does not append when the deduplication search fails', async () => {
    mocks.search.mockResolvedValue(false);
    await expect(appendSentMessage(raw)).rejects.toMatchObject({ code: 'MAIL_SEARCH_FAILED' });
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it('uses only the configured Sent path and fails closed if discovery is ambiguous', async () => {
    mocks.config.mockReturnValue({ enabled: true, mailbox: 'support@example.test', password: 'test-only-password', sentFolder: 'Configured Sent' });
    await findSentMessage('<mail@example.test>');
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.open).toHaveBeenCalledWith('Configured Sent', { readOnly: true });
    mocks.config.mockReturnValue({ enabled: true, mailbox: 'support@example.test', password: 'test-only-password' });
    mocks.list.mockResolvedValue([]);
    await expect(findSentMessage('<mail@example.test>')).rejects.toMatchObject({ code: 'MAIL_SENT_FOLDER_NOT_FOUND' });
  });

  it('refuses missing credentials and invalid pagination before connecting', async () => {
    await expect(readImapPage('inbox', { limit: 500 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(readImapPage('inbox', { beforeUid: 10, afterUid: 20 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    mocks.config.mockReturnValue({ enabled: false, mailbox: '', password: '' });
    await expect(readImapPage('inbox')).rejects.toMatchObject({ code: 'MAIL_NOT_CONFIGURED' });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('maps authentication failures to a safe code and closes without leaking credentials', async () => {
    mocks.connect.mockRejectedValue({ code: 'AUTHENTICATIONFAILED', message: 'secret upstream details' });
    await expect(readImapPage('inbox')).rejects.toMatchObject({ code: 'MAIL_AUTH_FAILED', message: 'MAIL_AUTH_FAILED' });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('enforces an overall deadline even if connect never settles', async () => {
    vi.useFakeTimers();
    mocks.connect.mockImplementation(() => new Promise<never>(() => undefined));
    const pending = expect(readImapPage('inbox')).rejects.toMatchObject({ code: 'MAIL_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(25000);
    await pending;
    expect(mocks.close).toHaveBeenCalled();
  });
});
