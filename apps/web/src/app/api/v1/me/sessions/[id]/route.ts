import { apiJson, withApi } from '@/server/request';
import { revokeOwnSession } from '@/server/auth/staff';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: Request, context: RouteParams): Promise<Response> {
  const { id } = await context.params;
  return withApi(request, { auth: {} }, async ({ requestId, staff }) => {
    if (!staff) throw new Error('Missing staff context.');
    await revokeOwnSession(staff, id);
    return apiJson({ ok: true }, { status: 200 }, requestId);
  });
}
