import { OtpRequestSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { requestStaffOtp } from '@/server/auth/staff';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { input: OtpRequestSchema, rateLimit: 'authOtpRequest' }, async ({ input, requestId }) => {
    await requestStaffOtp(input);
    return apiJson({ ok: true }, { status: 202 }, requestId);
  });
}
