import 'server-only';
import { after } from 'next/server';
import { z, type ZodType } from 'zod';
import { AppError, MailAttachmentResponseSchema, MailDeliveriesResponseSchema, MailIdSchema, MailListQuerySchema,
  MailListResponseSchema, MailOkResponseSchema, MailPageQuerySchema, MailQueuedResponseSchema, MailReadRequestSchema,
  MailReplyRequestSchema, MailRetryRequestSchema, MailStatusResponseSchema, MailSyncRequestSchema, MailThreadResponseSchema } from '@sv/contracts';
import { assertBrowserSessionOrigin } from '../auth/browser-session';
import { apiJson, withApi } from '../request';
import { processOutboxBatch } from '../outbox/processor';
import { MailDeferredError, MailPermanentError, MailReviewRequiredError, MailTransientError } from './errors';
import { syncMailFolder } from './repository';
import { enforceMailRateLimit, listMail, listMailDeliveries, mailAttachment, mailStatus, markMailRead, queueMailReply, readMailThread, retryDelivery } from './service';

export type MailAction = 'status' | 'messages' | 'sync' | 'thread' | 'read' | 'reply' | 'attachment' | 'deliveries' | 'retry';
const AttachmentIdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u);
export function validateMail<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError('VALIDATION_ERROR', 'Check the mail request and try again.');
  return result.data;
}
function query<T>(request: Request, schema: ZodType<T>): T {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new AppError('VALIDATION_ERROR', 'Choose one value for each query option.');
  return validateMail(schema, Object.fromEntries(params));
}
export async function mailBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const maxBytes = 128 * 1024; // 20k Unicode characters plus JSON escaping.
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new AppError('VALIDATION_ERROR', 'Expected a bounded JSON mail request.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('VALIDATION_ERROR', 'Expected a JSON request body.');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new AppError('VALIDATION_ERROR', 'Your reply is too long.'); }
    chunks.push(part.value);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('VALIDATION_ERROR', 'Expected a JSON request body.'); }
  return validateMail(schema, value);
}
function dispatch(id: string | null): void {
  if (!id) return;
  // Atomic SKIP LOCKED claiming is shared with cron, never the unconditional
  // administrative processOutboxEventNow helper.
  try { after(async () => {
    const deadline = Date.now() + 40_000;
    try {
      for (let claim = 0; claim < 3 && Date.now() < deadline; claim += 1) {
        const result = await processOutboxBatch(1, ['booking.confirmed', 'email.send', 'email.reply'], { rootEventId: id });
        if (result.done + result.failed === 0) break;
      }
    } catch { /* Durable event remains recoverable by the existing scheduler. */ }
  }); }
  catch { /* Enqueue succeeded; the scheduler remains the delivery authority. */ }
}
export async function handleAdminMail(request: Request, action: MailAction, id?: string, attachmentId?: string): Promise<Response> {
  return withApi(request, { auth: { app: 'admin', roles: ['OWNER', 'ADMIN'] } }, async ({ staff, requestId }) => {
    if (!staff) throw new AppError('UNAUTHORIZED', 'Sign in required.');
    const mutation = ['sync', 'read', 'reply', 'retry'].includes(action);
    if (mutation && request.headers.has('origin')) assertBrowserSessionOrigin(request);
    try {
      await enforceMailRateLimit(staff.userId, mutation);
      if (action === 'status') return apiJson(MailStatusResponseSchema.parse(await mailStatus()), {}, requestId);
      if (action === 'messages') return apiJson(MailListResponseSchema.parse(await listMail(query(request, MailListQuerySchema))), {}, requestId);
      if (action === 'deliveries') return apiJson(MailDeliveriesResponseSchema.parse(await listMailDeliveries(query(request, MailPageQuerySchema))), {}, requestId);
      if (action === 'sync') {
        const input = await mailBody(request, MailSyncRequestSchema); await syncMailFolder(input.folder);
        return apiJson(MailStatusResponseSchema.parse(await mailStatus()), {}, requestId);
      }
      const messageId = validateMail(MailIdSchema, id);
      if (action === 'thread') return apiJson(MailThreadResponseSchema.parse(await readMailThread(messageId, query(request, MailPageQuerySchema))), {}, requestId);
      if (action === 'attachment') return apiJson(MailAttachmentResponseSchema.parse(await mailAttachment(messageId, validateMail(AttachmentIdSchema, attachmentId))),
        { headers: { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } }, requestId);
      if (action === 'read') return apiJson(MailOkResponseSchema.parse(await markMailRead(messageId, (await mailBody(request, MailReadRequestSchema)).read)), {}, requestId);
      const result = action === 'reply'
        ? await queueMailReply(messageId, await mailBody(request, MailReplyRequestSchema), staff.userId)
        : await retryDelivery(messageId, staff.userId, (await mailBody(request, MailRetryRequestSchema)).acknowledgeDuplicateRisk);
      dispatch(result.outboxEventId);
      return apiJson(MailQueuedResponseSchema.parse({ deliveryId: result.deliveryId, status: result.status }), { status: 202 }, requestId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof MailDeferredError) throw new AppError('RATE_LIMITED', 'Mail is busy or its sending allowance is paused. Try again later.', { retryAfter: Math.max(1, Math.ceil((error.retryAt.getTime() - Date.now()) / 1000)) });
      if (error instanceof MailTransientError || error instanceof MailPermanentError || error instanceof MailReviewRequiredError) {
        throw new AppError('UPSTREAM_UNAVAILABLE', 'Lark Mail is unavailable. Check the mailbox setup or retry shortly.', { reason: error.code });
      }
      // Database/provider errors can contain MIME or credentials in their
      // diagnostic context. Do not forward them into generic API/Sentry logging.
      throw new AppError('INTERNAL', 'The mail request could not be completed. Try again shortly.');
    }
  });
}
