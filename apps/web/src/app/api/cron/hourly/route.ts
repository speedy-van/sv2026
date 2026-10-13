import { CronAuthResponseSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { assertCronRequest } from '@/server/cron';
import { runHourlyCron } from '@/server/cron-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, {}, async ({ request, requestId }) => {
    assertCronRequest(request);
    const result = await runHourlyCron();
    return apiJson({ ...CronAuthResponseSchema.parse({ ok: true, requestId }), ...result }, {}, requestId);
  });
}
