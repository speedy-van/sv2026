import { apiJson, withApi } from '@/server/request';
import { trackingView } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  return withApi(request, { auth: false }, async ({ requestId }) => {
    const { token } = await params;
    return apiJson(await trackingView(decodeURIComponent(token)), {}, requestId);
  });
}
