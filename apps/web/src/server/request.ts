import 'server-only';

import { AppError, errorEnvelope } from '@sv/contracts';
import { randomUUID } from 'node:crypto';
import { z, type ZodError, type ZodType } from 'zod';
import { enforceRateLimit, type PublicRateLimitKind } from './rate-limit';

export interface ApiOptions<TInput> {
  input?: ZodType<TInput>;
  rateLimit?: PublicRateLimitKind;
}

export interface ApiContext<TInput> {
  input: TInput;
  request: Request;
  requestId: string;
}

export type ApiHandler<TInput> = (context: ApiContext<TInput>) => Promise<Response>;

const noStoreHeaders = {
  'Cache-Control': 'no-store',
} as const;

function validationError(error: ZodError): AppError {
  return new AppError('VALIDATION_ERROR', 'Check the highlighted fields and try again.', {
    validation: z.treeifyError(error),
  });
}

export function requestIdFrom(request: Request): string {
  return request.headers.get('x-request-id') ?? `req_${randomUUID()}`;
}

export function apiJson(data: unknown, init: ResponseInit = {}, requestId?: string): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', headers.get('Cache-Control') ?? noStoreHeaders['Cache-Control']);
  if (requestId) headers.set('x-request-id', requestId);
  return Response.json(data, { ...init, headers });
}

export function apiError(error: AppError, requestId: string, extraHeaders?: HeadersInit): Response {
  const init: ResponseInit = { status: error.httpStatus };
  if (extraHeaders) init.headers = extraHeaders;
  return apiJson(errorEnvelope(error, requestId), init, requestId);
}

export async function parseJson<TInput>(request: Request, schema: ZodType<TInput>): Promise<TInput> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Expected a JSON request body.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  return parsed.data;
}

export async function withApi<TInput>(
  request: Request,
  options: ApiOptions<TInput>,
  handler: ApiHandler<TInput>,
): Promise<Response> {
  const requestId = requestIdFrom(request);
  try {
    if (options.rateLimit) {
      await enforceRateLimit(request, options.rateLimit);
    }
    const input = options.input ? await parseJson(request, options.input) : (undefined as TInput);
    const response = await handler({ input, request, requestId });
    response.headers.set('x-request-id', requestId);
    response.headers.set('Cache-Control', response.headers.get('Cache-Control') ?? noStoreHeaders['Cache-Control']);
    return response;
  } catch (error) {
    if (error instanceof AppError) {
      const headers = error.code === 'RATE_LIMITED' && typeof error.details?.retryAfter === 'number'
        ? { 'retry-after': String(error.details.retryAfter) }
        : undefined;
      return apiError(error, requestId, headers);
    }

    return apiError(new AppError('INTERNAL', 'Something went wrong. Try again in a moment.'), requestId);
  }
}

export function ndjsonResponse(stream: ReadableStream<Uint8Array>, requestId: string): Response {
  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'x-request-id': requestId,
    },
    status: 200,
  });
}
