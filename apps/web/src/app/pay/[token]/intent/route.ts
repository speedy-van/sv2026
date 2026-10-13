import { apiJson, withApi } from '@/server/request';
import { startPayRequest } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  return withApi(request, {}, async ({ requestId }) => {
    const { token } = await params;
    const result = await startPayRequest(decodeURIComponent(token));
    return apiJson({ amountPence: result.amountPence, clientSecret: result.clientSecret }, {}, requestId);
  });
}
