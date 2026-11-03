import { AppError, EmptyBrowserSessionSchema } from '@sv/contracts';
import { apiError, apiJson, withApi } from '@/server/request';
import { clearBrowserSessionCookie, restoreBrowserSession } from '@/server/auth/browser-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: EmptyBrowserSessionSchema, rateLimit: 'authRefresh' }, async ({ requestId }) => {
    try {
      const result = await restoreBrowserSession(request);
      return apiJson(result.body, { headers: { 'set-cookie': result.cookie } }, requestId);
    } catch (error) {
      if (error instanceof AppError && error.code === 'UNAUTHORIZED') {
        return apiError(error, requestId, { 'set-cookie': clearBrowserSessionCookie() });
      }
      throw error;
    }
  });
}
