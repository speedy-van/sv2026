import { BookingCreateSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { createBookingFromQuote } from '@/server/services/booking';
import { linkBookingActivityBooking } from '@/server/booking-activity';
import { verifyBookingStatusToken } from '@/server/status-token';
import { scheduleOutboxRoots } from '@/server/outbox/schedule-roots';
import * as Sentry from '@sentry/nextjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: BookingCreateSchema, rateLimit: 'booking' }, async ({ input, requestId }) => {
    const response = await createBookingFromQuote(input);
    const { bookingId } = verifyBookingStatusToken(response.statusToken);
    try { await linkBookingActivityBooking(request, bookingId); }
    catch (error) { Sentry.captureException(error, { tags: { feature: 'booking-activity-link' } }); }
    scheduleOutboxRoots({ exact: `booking.pending_payment:${bookingId}` });
    return apiJson(response, { status: 201 }, requestId);
  });
}
