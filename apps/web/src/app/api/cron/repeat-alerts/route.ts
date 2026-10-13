import { CronAuthResponseSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { assertCronRequest } from '@/server/cron';
import { runRepeatAlerts } from '@/server/notifications/repeat-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, {}, async ({ request, requestId }) => {
    assertCronRequest(request);
    const result = await runRepeatAlerts();
    return apiJson({ ...CronAuthResponseSchema.parse({ ok: true, requestId }), ...result }, {}, requestId);
  });
}
