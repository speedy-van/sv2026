import { CancelBookingRequestSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { manageTokenFromCookie } from '@/server/auth/manage-cookie';
import { applyCancel } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: CancelBookingRequestSchema }, async ({ input, requestId }) => {
    const cancelInput = input.reason === undefined
      ? { expectedRefundPence: input.expectedRefundPence }
      : { expectedRefundPence: input.expectedRefundPence, reason: input.reason };
    return apiJson(await applyCancel(await manageTokenFromCookie(), cancelInput), {}, requestId);
  });
}
