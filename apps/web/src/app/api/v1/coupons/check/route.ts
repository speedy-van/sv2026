import { CouponCheckSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { checkCouponForQuote } from '@/server/services/booking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: CouponCheckSchema, rateLimit: 'coupon' }, async ({ input, requestId }) => {
    const response = await checkCouponForQuote(input);
    return apiJson(response, {}, requestId);
  });
}
