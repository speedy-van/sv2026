import 'server-only';
import { AppError, MailAddressSchema } from '@sv/contracts';
import { simpleParser, type AddressObject, type Attachment, type EmailAddress, type ParsedMail } from 'mailparser';
import sanitizeHtml from 'sanitize-html';
import { inspectAttachment } from './attachment-policy';

export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
export const MAX_HEADER_BYTES = 64 * 1024;
export const MAX_BODY_CHARACTERS = 200_000;

export interface MailAddress { name: string; address: string }
export interface MailHeaders {
  messageId: string | null;
  references: string[];
  inReplyTo: string | null;
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  replyTo: MailAddress[];
  subject: string;
  dateISO: string | null;
}
export interface MailAttachmentDescriptor {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  allowed: boolean;
  blockedReason: string | null;
}
export interface ParsedMailContent extends MailHeaders {
  bodyText: string;
  sanitizedHtml: string;
  bodyTruncated: boolean;
  attachments: MailAttachmentDescriptor[];
}
export interface MailAttachmentDownload { filename: string; contentType: string; base64: string; size: number }

const PARSE_OPTIONS = {
  skipHtmlToText: true, skipTextToHtml: true, skipTextLinks: true,
  skipImageLinks: true, keepCidLinks: true, ignoreEmbedded: true,
  maxHeadSize: MAX_HEADER_BYTES, maxChildNodes: 100,
  maxHtmlLengthToParse: MAX_BODY_CHARACTERS,
} as const;

function cleanHeader(value: string | undefined, limit = 998): string {
  return (value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, limit);
}

export function normalizeMessageId(value: string | undefined): string | null {
  if (!value || value.length > 998 || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const match = /^<[^<>\s]+@[^<>\s]+>$/.exec(value.trim());
  return match?.[0] ?? null;
}

function addresses(value: AddressObject | AddressObject[] | undefined): MailAddress[] {
  const result: MailAddress[] = [];
  const pending: EmailAddress[] = (Array.isArray(value) ? value : value ? [value] : []).flatMap((entry) => entry.value);
  // Both headers and output are bounded, including nested address groups.
  let visited = 0;
  while (pending.length && visited++ < 500 && result.length < 100) {
    const entry = pending.shift();
    if (!entry) break;
    if (entry.group) pending.push(...entry.group.slice(0, 100));
    if ((entry.address?.length ?? 0) > 254) continue;
    const address = cleanHeader(entry.address, 320);
    const candidate = { name: cleanHeader(entry.name, 200), address };
    if (MailAddressSchema.safeParse(candidate).success) result.push(candidate);
  }
  return result;
}

export function mailDateISO(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 0 && date.getUTCFullYear() <= 9999 ? date.toISOString() : null;
}

function headers(parsed: ParsedMail): MailHeaders {
  const refs = typeof parsed.references === 'string' ? [parsed.references] : parsed.references ?? [];
  return {
    messageId: normalizeMessageId(parsed.messageId),
    references: refs.slice(0, 100).map(normalizeMessageId).filter((id): id is string => id !== null),
    inReplyTo: normalizeMessageId(parsed.inReplyTo),
    from: addresses(parsed.from), to: addresses(parsed.to), cc: addresses(parsed.cc), replyTo: addresses(parsed.replyTo),
    // mailparser substitutes the current time for some invalid Date headers. Never persist that invented date.
    subject: cleanHeader(parsed.subject), dateISO: mailDateISO(parsed.headerLines.find((line) => line.key === 'date')?.line.replace(/^date:\s*/i, '').replace(/\r?\n[ \t]+/g, ' ')),
  };
}

export function sanitizeMailHtml(html: string): string {
  const safeHtml = sanitizeHtml(html.slice(0, MAX_BODY_CHARACTERS), {
    allowedTags: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
    allowedAttributes: {}, allowedSchemes: [], allowProtocolRelative: false,
    disallowedTagsMode: 'discard', parseStyleAttributes: false, nestingLimit: 30,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'form', 'button', 'select', 'template', 'svg', 'math'],
  });
  // Entity escaping can expand the output. If it exceeds the display budget, keep only escaped text.
  return safeHtml.length <= MAX_BODY_CHARACTERS ? safeHtml
    : sanitizeHtml(safeHtml, { allowedTags: [], allowedAttributes: {} }).slice(0, MAX_BODY_CHARACTERS);
}

async function parseRaw(source: Buffer): Promise<ParsedMail> {
  if (source.length > MAX_MESSAGE_BYTES) throw new AppError('VALIDATION_ERROR', 'This message exceeds the 8 MiB viewing limit.');
  try {
    return await simpleParser(source, PARSE_OPTIONS);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'This message could not be safely decoded.');
  }
}

export async function parseMailHeaders(source: Buffer): Promise<MailHeaders> {
  if (source.length > MAX_HEADER_BYTES) throw new AppError('VALIDATION_ERROR', 'This message has oversized headers.');
  return headers(await parseRaw(source));
}

function attachmentPolicy(attachment: Attachment): ReturnType<typeof inspectAttachment> {
  const declared = attachment.headers.get('content-type');
  // mailparser guesses an octet-stream attachment's MIME from its extension. Require the declared type instead.
  const contentType = declared && !Array.isArray(declared) && typeof declared === 'object' && 'value' in declared && typeof declared.value === 'string'
    ? declared.value : 'application/octet-stream';
  return inspectAttachment({ filename: attachment.filename, contentType, content: attachment.content });
}

export async function parseMailMessage(source: Buffer): Promise<ParsedMailContent> {
  const parsed = await parseRaw(source);
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  const safeHtml = sanitizeMailHtml(html);
  const plainText = parsed.text ?? sanitizeHtml(safeHtml, { allowedTags: [], allowedAttributes: {} });
  return {
    ...headers(parsed), bodyText: plainText.slice(0, MAX_BODY_CHARACTERS), sanitizedHtml: safeHtml,
    bodyTruncated: plainText.length > MAX_BODY_CHARACTERS || html.length > MAX_BODY_CHARACTERS || safeHtml.length === MAX_BODY_CHARACTERS,
    attachments: parsed.attachments.map((attachment, index) => ({
      id: `attachment-${String(index + 1)}`,
      ...attachmentPolicy(attachment),
    })),
  };
}

export async function parseMailAttachment(source: Buffer, attachmentId: string): Promise<MailAttachmentDownload> {
  if (!/^attachment-[1-9]\d{0,2}$/.test(attachmentId)) throw new AppError('NOT_FOUND', 'Attachment not found.');
  const parsed = await parseRaw(source);
  const attachment = parsed.attachments[Number(attachmentId.slice('attachment-'.length)) - 1];
  if (!attachment) throw new AppError('NOT_FOUND', 'Attachment not found.');
  const policy = attachmentPolicy(attachment);
  if (!policy.allowed) throw new AppError('FORBIDDEN', policy.blockedReason ?? 'This attachment cannot be downloaded.');
  return { filename: policy.filename, contentType: policy.contentType, size: policy.size, base64: attachment.content.toString('base64') };
}
