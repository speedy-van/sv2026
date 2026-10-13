import { apiJson, withApi } from '@/server/request';
import { manageTokenFromCookie } from '@/server/auth/manage-cookie';
import { previewCancel } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, {}, async ({ requestId }) => {
    return apiJson(await previewCancel(await manageTokenFromCookie()), {}, requestId);
  });
}
