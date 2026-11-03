import 'server-only';

import {
  AdminChatInboxQuerySchema, AdminChatSendRequestSchema, AppError, ChatMessagesQuerySchema,
  ChatReadRequestSchema, ChatSendRequestSchema,
  ChatSessionStartRequestSchema,
} from '@sv/contracts';
import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';
import { z, type ZodType } from 'zod';
import { assertBrowserSessionOrigin } from '../auth/browser-session';
import { apiJson, withApi, type ApiContext } from '../request';
import { enforceAdminChatRateLimit } from '../rate-limit';
import { requireConversation } from './repository';
import { assertChatOrigin } from './session';
import { dispatchChatPush } from './push-dispatch';
import {
  getAdminChatInbox, getChatSession, getCustomerMessages, markCustomerMessagesRead,
  markMessagesRead, readMessages, sendAdminMessage, sendCustomerMessage,
  startChatSession,
} from './service';

const maxBodyBytes = 12_288;
type ChatAction = 'session' | 'start' | 'messages' | 'send' | 'read';
type AdminChatAction = 'inbox' | 'messages' | 'send' | 'read';
const ConversationIdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u);

function validated<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Check your message and try again.', { validation: z.treeifyError(parsed.error) });
  return parsed.data;
}

function query<T>(request: Request, schema: ZodType<T>): T {
  const params = new URL(request.url).searchParams;
  for (const name of params.keys()) if (params.getAll(name).length > 1) throw new AppError('VALIDATION_ERROR', 'Choose one value for each query option.');
  return validated(schema, Object.fromEntries(params));
}

async function body<T>(request: Request, schema: ZodType<T>): Promise<T> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError('VALIDATION_ERROR', 'Expected a JSON request body.');
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maxBodyBytes) throw new AppError('VALIDATION_ERROR', 'Your message is too long.');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('VALIDATION_ERROR', 'Expected a JSON request body.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > maxBodyBytes) {
      await reader.cancel();
      throw new AppError('VALIDATION_ERROR', 'Your message is too long.');
    }
    chunks.push(result.value);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('VALIDATION_ERROR', 'Expected a JSON request body.'); }
  return validated(schema, value);
}

async function reportFailure(operation: () => Promise<Response>): Promise<Response> {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof AppError)) Sentry.captureException(error, { tags: { component: 'live-chat' } });
    throw error;
  }
}

export async function handlePublicChat(request: Request, action: ChatAction): Promise<Response> {
  const mutation = action === 'send' || action === 'read' || action === 'start';
  return withApi(request, { auth: false, rateLimit: mutation ? 'chatWrite' : 'chatRead' }, ({ requestId }) => reportFailure(async () => {
    if (mutation) assertChatOrigin(request);
    if (action === 'session') return apiJson(await getChatSession(request), {}, requestId);
    if (action === 'start') {
      await body(request, ChatSessionStartRequestSchema);
      const result = await startChatSession(request);
      return apiJson(result.body, { headers: result.cookie ? { 'set-cookie': result.cookie } : {} }, requestId);
    }
    if (action === 'messages') return apiJson(await getCustomerMessages(request, query(request, ChatMessagesQuerySchema)), {}, requestId);
    if (action === 'send') {
      const result = await sendCustomerMessage(request, await body(request, ChatSendRequestSchema));
      try {
        after(() => dispatchChatPush(result.body.message.id));
      } catch (error) {
        Sentry.captureException(error, { tags: { feature: 'chat-push-scheduling' } });
      }
      return apiJson(result.body, { headers: result.cookie ? { 'set-cookie': result.cookie } : {} }, requestId);
    }
    const input = await body(request, ChatReadRequestSchema);
    return apiJson(await markCustomerMessagesRead(request, input.messageId), {}, requestId);
  }));
}

export async function handleAdminChat(request: Request, action: AdminChatAction, id?: string): Promise<Response> {
  return withApi(request, { auth: { app: 'admin', roles: ['OWNER', 'ADMIN'] } }, (context: ApiContext<undefined>) => reportFailure(async () => {
    const { requestId, staff } = context;
    if (!staff) throw new AppError('UNAUTHORIZED', 'Sign in required.');
    await enforceAdminChatRateLimit(staff.userId);
    // Native clients authenticate with a bearer token. Browser mutations also verify their source.
    if ((action === 'send' || action === 'read') && request.headers.has('origin')) assertBrowserSessionOrigin(request);
    if (action === 'inbox') return apiJson(await getAdminChatInbox(query(request, AdminChatInboxQuerySchema)), {}, requestId);
    const conversationId = validated(ConversationIdSchema, id);
    if (action === 'messages') return apiJson(await readMessages(await requireConversation(conversationId), query(request, ChatMessagesQuerySchema), 'ADMIN'), {}, requestId);
    if (action === 'send') return apiJson(await sendAdminMessage(conversationId, await body(request, AdminChatSendRequestSchema), staff.userId), {}, requestId);
    const input = await body(request, ChatReadRequestSchema);
    return apiJson(await markMessagesRead(conversationId, input.messageId, 'ADMIN'), {}, requestId);
  }));
}
