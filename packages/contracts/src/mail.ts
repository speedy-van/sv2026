import { z } from 'zod';

export const MAIL_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const MailFolderSchema = z.enum(['inbox', 'sent']);
export type MailFolder = z.infer<typeof MailFolderSchema>;
export const MailIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
export const MailAddressSchema = z.object({ address: z.email().max(254), name: z.string().max(200).optional() }).strict();
export type MailAddress = z.infer<typeof MailAddressSchema>;
/** The server and composer use the same RFC reply recipient selection. */
export function mailReplyRecipients(headers: { from: MailAddress[]; to: MailAddress[]; cc: MailAddress[]; replyTo: MailAddress[] }, mode: 'reply' | 'reply-all', mailbox: string) {
  const self = mailbox.trim().toLowerCase();
  const senderIsSelf = headers.from.some((item) => item.address.toLowerCase() === self);
  const base = senderIsSelf ? headers.to : headers.replyTo.length ? headers.replyTo : headers.from;
  const to = [...new Set(base.map((item) => item.address.toLowerCase()).filter((item) => item !== self))];
  const cc = mode === 'reply-all' ? [...new Set([...headers.to, ...headers.cc].map((item) => item.address.toLowerCase()).filter((item) => item !== self && !to.includes(item)))] : [];
  return { to, cc };
}
export const MailDeliveryStateSchema = z.enum(['QUEUED', 'SENDING', 'SENT', 'RETRY', 'FAILED', 'UNCERTAIN', 'DEFERRED']);
export const MailListQuerySchema = z.object({
  folder: MailFolderSchema.default('inbox'),
  cursor: z.string().max(256).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export const MailPageQuerySchema = MailListQuerySchema.pick({ cursor: true, limit: true });
export const MailMessageSummarySchema = z.object({
  id: MailIdSchema, threadId: MailIdSchema, folder: MailFolderSchema,
  subject: z.string().max(1000), from: z.array(MailAddressSchema), to: z.array(MailAddressSchema),
  sentAt: z.iso.datetime(), read: z.boolean(), attachmentCount: z.number().int().nonnegative(),
  snippet: z.string().max(300),
}).strict();
export type MailMessageSummary = z.infer<typeof MailMessageSummarySchema>;
export const MailAttachmentSchema = z.object({
  id: z.string().min(1).max(100), filename: z.string().max(200), contentType: z.string().max(150),
  size: z.number().int().nonnegative(), blockedReason: z.string().max(200).nullable(),
}).strict();
export const MailMessageSchema = MailMessageSummarySchema.extend({
  cc: z.array(MailAddressSchema), replyTo: z.array(MailAddressSchema), bodyText: z.string().max(200_000),
  bodyHtml: z.string().max(400_000).nullable(), bodyTruncated: z.boolean(), attachments: z.array(MailAttachmentSchema),
  messageId: z.string().max(1000).nullable(),
});
export type MailMessage = z.infer<typeof MailMessageSchema>;
export const MailSyncSchema = z.object({ at: z.iso.datetime().nullable(), error: z.string().max(300).nullable(), hasMore: z.boolean() }).strict();
export const MailListResponseSchema = z.object({
  items: z.array(MailMessageSummarySchema), nextCursor: z.string().nullable(), sync: MailSyncSchema,
}).strict();
export const MailThreadResponseSchema = z.object({
  id: MailIdSchema, subject: z.string().max(1000), messages: z.array(MailMessageSchema), nextCursor: z.string().nullable(),
}).strict();
export const MailReadRequestSchema = z.object({ read: z.boolean() }).strict();
export const MailOkResponseSchema = z.object({ ok: z.literal(true) }).strict();
export const MailReplyRequestSchema = z.object({
  clientMessageId: z.uuid(), mode: z.enum(['reply', 'reply-all']),
  text: z.string().trim().min(1).max(20_000),
}).strict();
export type MailReplyRequest = z.infer<typeof MailReplyRequestSchema>;
export const MailQueuedResponseSchema = z.object({ deliveryId: MailIdSchema, status: MailDeliveryStateSchema }).strict();
export const MailAttachmentResponseSchema = z.object({
  filename: z.string().max(200), contentType: z.string().max(150), size: z.number().int().max(MAIL_ATTACHMENT_MAX_BYTES),
  base64: z.string().max(Math.ceil(MAIL_ATTACHMENT_MAX_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/u),
}).strict();
export const MailQuotaSchema = z.object({
  messagesUsed: z.number().int().nonnegative(), messagesLimit: z.number().int().positive(),
  externalRecipientsUsed: z.number().int().nonnegative(), externalRecipientsLimit: z.number().int().positive(),
  resetsAt: z.iso.datetime(),
}).strict();
export const MailStatusResponseSchema = z.object({
  configured: z.boolean(), mailbox: z.string().nullable(),
  folders: z.array(z.object({ id: MailFolderSchema, unreadCount: z.number().int().nonnegative() }).strict()),
  lastSyncAt: z.iso.datetime().nullable(), syncError: z.string().max(300).nullable(),
  quota: MailQuotaSchema, failedCount: z.number().int().nonnegative(), uncertainCount: z.number().int().nonnegative(),
}).strict();
export const MailDeliverySchema = z.object({
  id: MailIdSchema, subject: z.string().max(1000), to: z.array(MailAddressSchema),
  status: MailDeliveryStateSchema, attempts: z.number().int().nonnegative(),
  lastErrorCode: z.string().max(100).nullable(), nextAttemptAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(), sentAt: z.iso.datetime().nullable(), canRetry: z.boolean(),
}).strict();
export type MailDelivery = z.infer<typeof MailDeliverySchema>;
export const MailDeliveriesResponseSchema = z.object({ items: z.array(MailDeliverySchema), nextCursor: z.string().nullable() }).strict();
export const MailRetryRequestSchema = z.object({ acknowledgeDuplicateRisk: z.boolean().default(false) }).strict();
export const MailSyncRequestSchema = z.object({ folder: MailFolderSchema }).strict();
