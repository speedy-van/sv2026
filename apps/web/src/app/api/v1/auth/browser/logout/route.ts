import { BrowserSessionLogoutResponseSchema, EmptyBrowserSessionSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { clearBrowserSessionCookie, logoutBrowserSession } from '@/server/auth/browser-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: EmptyBrowserSessionSchema, rateLimit: 'authRefresh' }, async ({ requestId }) => {
    await logoutBrowserSession(request);
    return apiJson(BrowserSessionLogoutResponseSchema.parse({ ok: true }), { headers: { 'set-cookie': clearBrowserSessionCookie() } }, requestId);
  });
}
