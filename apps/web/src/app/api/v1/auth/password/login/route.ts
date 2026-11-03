import { AuthTokenResponseSchema, PasswordLoginRequestSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { loginStaffPassword } from '@/server/auth/staff';
import { assertBrowserSessionOrigin, browserLoginResult } from '@/server/auth/browser-session';
import { enforcePasswordAccountRateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: PasswordLoginRequestSchema, rateLimit: 'authPasswordLogin' }, async ({ input, requestId }) => {
    const browser = input.app === 'admin' && input.device.platform === 'web';
    if (browser) assertBrowserSessionOrigin(request);
    await enforcePasswordAccountRateLimit(input.email);
    const response = await loginStaffPassword(input);
    if (browser) {
      const result = browserLoginResult(response, input.device.deviceId);
      return apiJson(result.body, { headers: { 'set-cookie': result.cookie } }, requestId);
    }
    return apiJson(AuthTokenResponseSchema.parse(response), { status: 200 }, requestId);
  });
}
