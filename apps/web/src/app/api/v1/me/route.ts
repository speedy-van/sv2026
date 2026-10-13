import { MeResponseSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { staffMe } from '@/server/auth/staff';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { auth: {} }, async ({ requestId, staff }) => {
    if (!staff) throw new Error('Missing staff context.');
    return apiJson(MeResponseSchema.parse(await staffMe(staff)), { status: 200 }, requestId);
  });
}
