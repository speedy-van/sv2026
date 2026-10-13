import { AppError } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { bookingStatusFromToken } from '@/server/services/booking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { auth: false }, async ({ requestId }) => {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) throw new AppError('VALIDATION_ERROR', 'Missing status token.');
    const status = await bookingStatusFromToken(token);
    return apiJson(status, {}, requestId);
  });
}
