import { BookingCreateSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { createBookingFromQuote } from '@/server/services/booking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: BookingCreateSchema, rateLimit: 'booking' }, async ({ input, requestId }) => {
    const response = await createBookingFromQuote(input);
    return apiJson(response, { status: 201 }, requestId);
  });
}
