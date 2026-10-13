import { BookingCreateSchema } from '@sv/contracts';
import { after } from 'next/server';
import { apiJson, withApi } from '@/server/request';
import { createBookingFromQuote } from '@/server/services/booking';
import { processOutboxBatch } from '@/server/outbox/processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: BookingCreateSchema, rateLimit: 'booking' }, async ({ input, requestId }) => {
    const response = await createBookingFromQuote(input);
    if (process.env.NODE_ENV !== 'test') {
      try {
        after(() => {
          void processOutboxBatch(10);
        });
      } catch {
        void processOutboxBatch(10);
      }
    }
    return apiJson(response, { status: 201 }, requestId);
  });
}
