import { AuthTokenResponseSchema, OtpVerifySchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { verifyStaffOtp } from '@/server/auth/staff';
import { assertBrowserSessionOrigin, browserLoginResult } from '@/server/auth/browser-session';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: OtpVerifySchema, rateLimit: 'authOtpVerify' }, async ({ input, requestId }) => {
    const browser = input.app === 'admin' && input.device.platform === 'web';
    if (browser) assertBrowserSessionOrigin(request);
    const response = await verifyStaffOtp(input);
    if (browser) {
      const result = browserLoginResult(response, input.device.deviceId);
      return apiJson(result.body, { headers: { 'set-cookie': result.cookie } }, requestId);
    }
    return apiJson(AuthTokenResponseSchema.parse(response), { status: 200 }, requestId);
  });
}
