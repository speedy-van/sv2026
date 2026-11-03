import { BookingActivityHeartbeatRequestSchema, BookingActivityWithdrawRequestSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { heartbeatBookingActivity, withdrawBookingActivity } from '@/server/booking-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: BookingActivityHeartbeatRequestSchema, rateLimit: 'visitorPresence' }, async ({ input, requestId }) => {
    const result = await heartbeatBookingActivity(request, input);
    return apiJson(result.body, { headers: result.cookie ? { 'set-cookie': result.cookie } : {} }, requestId);
  });
}
export async function DELETE(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: BookingActivityWithdrawRequestSchema, rateLimit: 'visitorPresence' }, async ({ requestId }) => {
    const result = await withdrawBookingActivity(request);
    return apiJson(result.body, { headers: result.cookie ? { 'set-cookie': result.cookie } : {} }, requestId);
  });
}
