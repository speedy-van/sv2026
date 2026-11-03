import { AppError, NotificationReadResponseSchema, NotificationReadSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { listNotifications, markNotificationsRead } from '@/server/auth/staff';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { auth: {} }, async ({ requestId, staff }) => {
    if (!staff) throw new AppError('UNAUTHORIZED', 'Sign in required.');
    return apiJson(await listNotifications(staff, new URL(request.url).searchParams), { status: 200 }, requestId);
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: {}, input: NotificationReadSchema }, async ({ input, requestId, staff }) => {
    if (!staff) throw new AppError('UNAUTHORIZED', 'Sign in required.');
    await markNotificationsRead(staff, input);
    return apiJson(NotificationReadResponseSchema.parse({ ok: true }), { status: 200 }, requestId);
  });
}
