import { z } from 'zod';

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PRICE_CHANGED',
  'QUOTE_EXPIRED',
  'SLOT_UNAVAILABLE',
  'OFFER_TAKEN',
  'INVALID_TRANSITION',
  'OUTSIDE_SERVICE_AREA',
  'MANUAL_QUOTE_REQUIRED',
  'PAYMENT_FAILED',
  'APP_UPDATE_REQUIRED',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export const ErrorDetailsSchema = z.record(z.string(), z.unknown());

export const ErrorEnvelopeSchema = z.object({
  error: z
    .object({
      code: ApiErrorCodeSchema,
      message: z.string().min(1),
      details: ErrorDetailsSchema.optional(),
      requestId: z.string().min(1),
    })
    .strict(),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const HTTP_STATUS_BY_ERROR_CODE = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRICE_CHANGED: 409,
  QUOTE_EXPIRED: 409,
  SLOT_UNAVAILABLE: 409,
  OFFER_TAKEN: 409,
  INVALID_TRANSITION: 409,
  OUTSIDE_SERVICE_AREA: 422,
  MANUAL_QUOTE_REQUIRED: 422,
  PAYMENT_FAILED: 402,
  APP_UPDATE_REQUIRED: 426,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const satisfies Record<ApiErrorCode, number>;

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly httpStatus: number;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.httpStatus = HTTP_STATUS_BY_ERROR_CODE[code];
  }
}

export function errorEnvelope(error: AppError, requestId: string): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      requestId,
    },
  };
}
