import 'server-only';
import { AppError } from '@sv/contracts';
import { ImapFlow, type FetchMessageObject, type MailboxObject, type MessageStructureObject } from 'imapflow';
import { mailConfig } from './config';
import { MailTransientError } from './errors';
import { MAX_HEADER_BYTES, MAX_MESSAGE_BYTES, mailDateISO, normalizeMessageId, parseMailAttachment, parseMailHeaders, parseMailMessage, type MailHeaders, type MailAttachmentDownload, type ParsedMailContent } from './mime';
export type { MailAddress, MailHeaders, MailAttachmentDescriptor, MailAttachmentDownload, ParsedMailContent } from './mime';

export type ImapFolder = 'inbox' | 'sent';
export interface ImapMessageSummary extends MailHeaders {
  uid: number;
  seen: boolean;
  size: number;
  attachmentCount: number;
}
export interface ImapPageOptions { beforeUid?: number; afterUid?: number; limit?: number }
export interface ImapPage {
  path: string; uidValidity: string; uidNext: number; unread: number; total: number;
  messages: ImapMessageSummary[]; hasMore: boolean;
}
export interface ImapMessage extends ParsedMailContent {
  uid: number; uidValidity: string; seen: boolean; size: number;
}

const MAX_UID = 4_294_967_295;
const SUMMARY_HEADERS = ['message-id', 'references', 'in-reply-to', 'from', 'to', 'cc', 'reply-to', 'subject', 'date'];

function validUid(uid: number, allowZero = false): void {
  if (!Number.isSafeInteger(uid) || uid < (allowZero ? 0 : 1) || uid > MAX_UID) throw new AppError('VALIDATION_ERROR', 'Invalid message identifier.');
}

function requireValidity(client: ImapFlow, expected: string): void {
  if (!/^\d+$/.test(expected) || !client.mailbox || client.mailbox.uidValidity.toString() !== expected) {
    throw new AppError('CONFLICT', 'This mailbox changed. Refresh the mailbox before opening this message.');
  }
}

function upstreamError(error: unknown): MailTransientError {
  if (error instanceof MailTransientError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const authFailed = error && typeof error === 'object' && 'authenticationFailed' in error && error.authenticationFailed === true;
  return new MailTransientError(authFailed || /auth/i.test(code) ? 'MAIL_AUTH_FAILED' : /timeout/i.test(code) ? 'MAIL_TIMEOUT' : 'MAIL_UNAVAILABLE');
}

async function withImap<T>(run: (client: ImapFlow) => Promise<T>, withMessageSource = false): Promise<T> {
  const config = mailConfig();
  if (!config.enabled || !config.mailbox || !config.password) throw new MailTransientError('MAIL_NOT_CONFIGURED');
  const client = new ImapFlow({
    host: 'imap.larksuite.com', port: 993, secure: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: { user: config.mailbox, pass: config.password },
    logger: false, logRaw: false, emitLogs: false, disableAutoIdle: true, disableCompression: true,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    maxLineLength: 256 * 1024, maxLiteralSize: withMessageSource ? MAX_MESSAGE_BYTES + 1 : MAX_HEADER_BYTES,
    maxResponseSize: withMessageSource ? MAX_MESSAGE_BYTES + 512 * 1024 : 512 * 1024, maxResponseTokens: 10_000,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    client.on('error', (error: Error) => { reject(upstreamError(error)); client.close(); });
    timer = setTimeout(() => { reject(new MailTransientError('MAIL_TIMEOUT')); client.close(); }, 25_000);
  });
  try {
    return await Promise.race([stopped, (async () => { await client.connect(); return run(client); })()]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw upstreamError(error);
  } finally {
    clearTimeout(timer);
    // Close is synchronous and ends the socket even on protocol failures. No idle connections survive requests.
    client.close();
  }
}

async function openFolder(client: ImapFlow, folder: ImapFolder, readOnly = true): Promise<MailboxObject> {
  if (!['inbox', 'sent'].includes(folder)) throw new AppError('VALIDATION_ERROR', 'Invalid mailbox folder.');
  let path = 'INBOX';
  if (folder === 'sent') {
    const configured = mailConfig().sentFolder;
    if (configured) {
      if (configured.length > 512 || /\p{Cc}/u.test(configured)) throw new MailTransientError('MAIL_SENT_FOLDER_INVALID');
      path = configured;
    } else {
      const sent = (await client.list()).filter((entry) => entry.specialUse === '\\Sent' && !entry.flags.has('\\Noselect'));
      if (sent.length !== 1 || !sent[0]) throw new MailTransientError('MAIL_SENT_FOLDER_NOT_FOUND');
      path = sent[0].path;
    }
  }
  return client.mailboxOpen(path, { readOnly });
}

function attachmentCount(structure: MessageStructureObject | undefined): number {
  const nodes = structure ? [structure] : [];
  let count = 0;
  let visited = 0;
  while (nodes.length) {
    if (++visited > 100) throw new AppError('VALIDATION_ERROR', 'This message has too many MIME parts.');
    const node = nodes.pop();
    if (!node) break;
    const named = node.dispositionParameters?.filename ?? node.parameters?.name;
    if (node.disposition === 'attachment' || named || node.type.toLowerCase() === 'message/rfc822' || (!node.childNodes?.length && !['text/plain', 'text/html'].includes(node.type.toLowerCase()))) count++;
    else if (node.childNodes) nodes.push(...node.childNodes);
  }
  return count;
}

async function summary(message: FetchMessageObject): Promise<ImapMessageSummary> {
  const parsed = await parseMailHeaders(message.headers ?? Buffer.alloc(0));
  return {
    ...parsed, dateISO: parsed.dateISO ?? mailDateISO(message.internalDate),
    uid: message.uid, seen: message.flags?.has('\\Seen') ?? false,
    size: message.size ?? 0, attachmentCount: attachmentCount(message.bodyStructure),
  };
}

async function firstSequenceAtUid(client: ImapFlow, total: number, target: number, validity: string): Promise<number> {
  // Sequence binary search bounds response size even for a mailbox with millions of sparse UIDs.
  let low = 1;
  let high = total + 1;
  while (low < high) {
    requireValidity(client, validity);
    const mid = low + Math.floor((high - low) / 2);
    const item = await client.fetchOne(mid, { uid: true });
    if (!item) throw new AppError('CONFLICT', 'This mailbox changed. Refresh it and try again.');
    if (item.uid < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

export async function readImapPage(folder: ImapFolder, options: ImapPageOptions = {}): Promise<ImapPage> {
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (options.beforeUid !== undefined && options.afterUid !== undefined)) throw new AppError('VALIDATION_ERROR', 'Invalid mailbox page.');
  if (options.beforeUid !== undefined) validUid(options.beforeUid);
  if (options.afterUid !== undefined) validUid(options.afterUid, true);
  return withImap(async (client) => {
    const box = await openFolder(client, folder);
    const validity = box.uidValidity.toString();
    let changedDuringPage = false;
    const noteMailboxChange = (): void => { changedDuringPage = true; };
    client.on('exists', noteMailboxChange);
    client.on('expunge', noteMailboxChange);
    const status = await client.status(box.path, { unseen: true });
    if (!status || status.unseen === undefined) throw new MailTransientError('MAIL_STATUS_UNAVAILABLE');
    const page: ImapPage = { path: box.path, uidValidity: validity, uidNext: box.uidNext, unread: status.unseen, total: box.exists, messages: [], hasMore: false };
    const finishPage = (): ImapPage => {
      requireValidity(client, validity);
      if (changedDuringPage || !client.mailbox || client.mailbox.exists !== page.total) throw new AppError('CONFLICT', 'This mailbox changed. Refresh it and try again.');
      return page;
    };
    if (!box.exists) return finishPage();
    const ascending = options.afterUid !== undefined;
    let start = 1;
    let end = box.exists;
    if (options.afterUid !== undefined && options.afterUid > 0) start = await firstSequenceAtUid(client, box.exists, options.afterUid + 1, validity);
    if (options.beforeUid !== undefined) end = (await firstSequenceAtUid(client, box.exists, options.beforeUid, validity)) - 1;
    if (start > end) return finishPage();
    if (ascending) end = Math.min(end, start + limit);
    else start = Math.max(start, end - limit);
    requireValidity(client, validity);
    const candidates = await client.fetchAll(`${String(start)}:${String(end)}`, { uid: true });
    const uids = candidates.map((entry) => entry.uid)
      .filter((uid) => (options.afterUid === undefined || uid > options.afterUid) && (options.beforeUid === undefined || uid < options.beforeUid))
      .sort((a, b) => ascending ? a - b : b - a);
    page.hasMore = uids.length > limit;
    const selected = uids.slice(0, limit);
    if (selected.length) {
      requireValidity(client, validity);
      for await (const message of client.fetch(selected, { uid: true, flags: true, internalDate: true, size: true, headers: SUMMARY_HEADERS, bodyStructure: true }, { uid: true })) {
        if (selected.includes(message.uid)) page.messages.push(await summary(message));
      }
      page.messages.sort((a, b) => ascending ? a.uid - b.uid : b.uid - a.uid);
    }
    return finishPage();
  });
}

async function readSource(client: ImapFlow, uid: number, expectedValidity: string): Promise<FetchMessageObject & { source: Buffer }> {
  validUid(uid);
  requireValidity(client, expectedValidity);
  const meta = await client.fetchOne(uid, { uid: true, size: true, flags: true, internalDate: true }, { uid: true });
  if (!meta || meta.uid !== uid) throw new AppError('NOT_FOUND', 'Message not found.');
  if (meta.size === undefined || meta.size > MAX_MESSAGE_BYTES) throw new AppError('VALIDATION_ERROR', 'This message exceeds the 8 MiB viewing limit.');
  requireValidity(client, expectedValidity);
  const body = await client.fetchOne(uid, { uid: true, source: { maxLength: MAX_MESSAGE_BYTES + 1 } }, { uid: true });
  requireValidity(client, expectedValidity);
  if (!body || body.uid !== uid || !body.source) throw new AppError('NOT_FOUND', 'Message not found.');
  if (body.source.length > MAX_MESSAGE_BYTES || body.source.length !== meta.size) throw new AppError('VALIDATION_ERROR', 'This message could not be downloaded completely within the size limit.');
  return { ...meta, source: body.source };
}

export async function fetchImapMessage(folder: ImapFolder, uid: number, expectedUidValidity: string): Promise<ImapMessage> {
  return withImap(async (client) => {
    await openFolder(client, folder);
    const message = await readSource(client, uid, expectedUidValidity);
    const parsed = await parseMailMessage(message.source);
    return { ...parsed, dateISO: parsed.dateISO ?? mailDateISO(message.internalDate), uid, uidValidity: expectedUidValidity, seen: message.flags?.has('\\Seen') ?? false, size: message.size ?? message.source.length };
  }, true);
}

export async function downloadImapAttachment(folder: ImapFolder, uid: number, expectedValidity: string, attachmentId: string): Promise<MailAttachmentDownload> {
  return withImap(async (client) => {
    await openFolder(client, folder);
    const message = await readSource(client, uid, expectedValidity);
    return parseMailAttachment(message.source, attachmentId);
  }, true);
}

export async function setImapSeen(folder: ImapFolder, uid: number, validity: string, read: boolean): Promise<void> {
  validUid(uid);
  return withImap(async (client) => {
    await openFolder(client, folder, false);
    requireValidity(client, validity);
    const message = await client.fetchOne(uid, { uid: true }, { uid: true });
    if (!message || message.uid !== uid) throw new AppError('NOT_FOUND', 'Message not found.');
    requireValidity(client, validity);
    const changed = read ? await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }) : await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
    if (!changed) throw new MailTransientError('MAIL_FLAG_UPDATE_FAILED');
    requireValidity(client, validity);
  });
}

async function hasMessageId(client: ImapFlow, messageId: string, validity: string): Promise<boolean> {
  requireValidity(client, validity);
  const matches = await client.search({ header: { 'message-id': messageId } }, { uid: true });
  if (!matches) throw new MailTransientError('MAIL_SEARCH_FAILED');
  if (matches.length > 100) throw new MailTransientError('MAIL_MESSAGE_ID_AMBIGUOUS');
  // IMAP SEARCH HEADER is a substring search. Confirm full Message-ID before deduplicating.
  for (const uid of matches) {
    requireValidity(client, validity);
    const message = await client.fetchOne(uid, { headers: ['message-id'] }, { uid: true });
    if (message && message.uid === uid && (await parseMailHeaders(message.headers ?? Buffer.alloc(0))).messageId === messageId) return true;
  }
  return false;
}

export async function findSentMessage(messageId: string): Promise<boolean> {
  const normalized = normalizeMessageId(messageId);
  if (!normalized) throw new AppError('VALIDATION_ERROR', 'Invalid email Message-ID.');
  return withImap(async (client) => {
    const box = await openFolder(client, 'sent');
    return hasMessageId(client, normalized, box.uidValidity.toString());
  });
}

export async function appendSentMessage(raw: Buffer): Promise<void> {
  if (raw.length > MAX_MESSAGE_BYTES) throw new AppError('VALIDATION_ERROR', 'This message exceeds the 8 MiB size limit.');
  const boundary = raw.indexOf('\r\n\r\n');
  const fallback = raw.indexOf('\n\n');
  const end = boundary >= 0 ? boundary + 4 : fallback >= 0 ? fallback + 2 : raw.length;
  if (end > MAX_HEADER_BYTES) throw new AppError('VALIDATION_ERROR', 'This message has oversized headers.');
  const messageId = (await parseMailHeaders(raw.subarray(0, end))).messageId;
  if (!messageId) throw new AppError('VALIDATION_ERROR', 'A valid Message-ID is required to save sent email.');
  return withImap(async (client) => {
    const box = await openFolder(client, 'sent', false);
    if (await hasMessageId(client, messageId, box.uidValidity.toString())) return;
    const saved = await client.append(box.path, raw, ['\\Seen']);
    if (!saved) throw new MailTransientError('MAIL_SENT_COPY_FAILED');
  });
}
