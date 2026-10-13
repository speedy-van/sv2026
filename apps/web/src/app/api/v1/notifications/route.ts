import { NotificationReadSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { listNotifications, markNotificationsRead } from '@/server/auth/staff';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { auth: {} }, async ({ requestId, staff }) => {
    if (!staff) throw new Error('Missing staff context.');
    return apiJson(await listNotifications(staff), { status: 200 }, requestId);
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: {}, input: NotificationReadSchema }, async ({ input, requestId, staff }) => {
    if (!staff) throw new Error('Missing staff context.');
    await markNotificationsRead(staff, input);
    return apiJson({ ok: true }, { status: 200 }, requestId);
  });
}
