import { AppError, QuoteRequestSchema, QuoteStreamEventSchema, errorEnvelope } from '@sv/contracts';
import { apiError, apiJson, ndjsonResponse, parseJson, requestIdFrom } from '@/server/request';
import { enforceRateLimit } from '@/server/rate-limit';
import { createQuote, type QuoteRequest } from '@/server/services/quote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function encodeEvent(event: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(QuoteStreamEventSchema.parse(event))}\n`);
}

function appErrorFrom(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError('INTERNAL', 'Something went wrong. Try again in a moment.');
}

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  let input: QuoteRequest;
  try {
    await enforceRateLimit(request, 'quote');
    input = await parseJson(request, QuoteRequestSchema);
  } catch (error) {
    return apiError(appErrorFrom(error), requestId);
  }

  if (request.headers.get('accept')?.includes('application/json')) {
    try {
      const result = await createQuote(input);
      if (result.manualReasons.length > 0) {
        return apiJson({
          manualQuote: {
            quotePublicId: result.quote.publicId,
            reasons: result.manualReasons,
          },
        }, {}, requestId);
      }
      return apiJson({ quote: result.quote }, {}, requestId);
    } catch (error) {
      return apiError(appErrorFrom(error), requestId);
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encodeEvent({ requestId, type: 'accepted' }));
      try {
        const result = await createQuote(input, {
          onProgress: (event) => {
            controller.enqueue(encodeEvent(event));
          },
        });
        if (result.manualReasons.length > 0) {
          controller.enqueue(encodeEvent({
            quotePublicId: result.quote.publicId,
            reasons: result.manualReasons,
            type: 'manual_quote',
          }));
        } else {
          controller.enqueue(encodeEvent({ quote: result.quote, type: 'done' }));
        }
      } catch (error) {
        controller.enqueue(encodeEvent({ error: errorEnvelope(appErrorFrom(error), requestId).error, type: 'error' }));
      } finally {
        controller.close();
      }
    },
  });

  return ndjsonResponse(stream, requestId);
}
