import { apiJson, withApi } from '@/server/request';
import { logoutStaffSession } from '@/server/auth/staff';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: {} }, async ({ requestId, staff }) => {
    if (staff) await logoutStaffSession(staff);
    return apiJson({ ok: true }, { status: 200 }, requestId);
  });
}
