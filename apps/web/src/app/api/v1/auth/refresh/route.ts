import { AuthTokenResponseSchema, RefreshRequestSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { refreshStaffSession } from '@/server/auth/staff';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { input: RefreshRequestSchema, rateLimit: 'authRefresh' }, async ({ input, requestId }) => {
    const response = await refreshStaffSession(input);
    return apiJson(AuthTokenResponseSchema.parse(response), { status: 200 }, requestId);
  });
}
