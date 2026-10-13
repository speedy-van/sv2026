import { getCatalogue } from '@/server/services/catalogue';
import { apiJson, withApi } from '@/server/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { rateLimit: 'catalogue' }, async ({ requestId }) => {
    return apiJson(await getCatalogue(), {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    }, requestId);
  });
}
