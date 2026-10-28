'use client';

import {
  ChatMessagesResponseSchema, ChatReadResponseSchema, ChatSendResponseSchema,
  ChatSessionResponseSchema, type ChatSendRequest,
} from '@sv/contracts';
import type { z } from 'zod';

export class ChatRequestError extends Error {
  constructor(public readonly status: number) {
    super('Chat request failed.');
    this.name = 'ChatRequestError';
  }
}

async function chatRequest<T>(path: string, schema: z.ZodType<T>, body?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => { controller.abort(); }, 12_000);
  const abort = (): void => { controller.abort(); };
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
  const response = await fetch(`/api/v1/chat/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store',
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: controller.signal,
  });
  if (!response.ok) throw new ChatRequestError(response.status);
  const result: unknown = await response.json();
  return schema.parse(result);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function getChatSession(signal?: AbortSignal) {
  return chatRequest('session', ChatSessionResponseSchema, undefined, signal);
}

export function startChatSession() {
  return chatRequest('session', ChatSessionResponseSchema, {});
}

export function getChatMessages(direction?: { after?: string; before?: string }, signal?: AbortSignal) {
  const query = new URLSearchParams(direction);
  const search = query.toString();
  return chatRequest(`messages${search ? `?${search}` : ''}`, ChatMessagesResponseSchema, undefined, signal);
}

export function sendChatMessage(input: ChatSendRequest) {
  return chatRequest('messages', ChatSendResponseSchema, input);
}

export function markChatRead(messageId: string) {
  return chatRequest('read', ChatReadResponseSchema, { messageId });
}
