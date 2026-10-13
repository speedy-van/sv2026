import { RescheduleApplyRequestSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { manageTokenFromCookie } from '@/server/auth/manage-cookie';
import { applyReschedule } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: RescheduleApplyRequestSchema }, async ({ input, requestId }) => {
    const result = await applyReschedule(await manageTokenFromCookie(), input);
    const body = result.result === 'PAYMENT_REQUIRED'
      ? { clientSecret: result.clientSecret, result: result.result }
      : { result: result.result };
    return apiJson(body, {}, requestId);
  });
}
