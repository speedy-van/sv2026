import { apiJson, withApi } from '@/server/request';
import { manageTokenFromCookie } from '@/server/auth/manage-cookie';
import { manageView } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { auth: false }, async ({ requestId }) => {
    const view = await manageView(await manageTokenFromCookie());
    return apiJson(view, {}, requestId);
  });
}
