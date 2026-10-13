import { AuthTokenResponseSchema, OtpVerifySchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { verifyStaffOtp } from '@/server/auth/staff';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { input: OtpVerifySchema, rateLimit: 'authOtpVerify' }, async ({ input, requestId }) => {
    const response = await verifyStaffOtp(input);
    return apiJson(AuthTokenResponseSchema.parse(response), { status: 200 }, requestId);
  });
}
