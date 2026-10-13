import { apiJson, withApi } from '@/server/request';
import { readHealth } from '@/server/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { auth: false }, async ({ requestId }) => {
    const health = await readHealth();
    return apiJson(health.body, { status: health.status }, requestId);
  });
}
