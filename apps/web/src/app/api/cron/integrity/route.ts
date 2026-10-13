import { CronAuthResponseSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { assertCronRequest } from '@/server/cron';
import { runIntegrityChecks } from '@/server/cron-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { auth: false }, async ({ request, requestId }) => {
    assertCronRequest(request);
    const result = await runIntegrityChecks();
    return apiJson({ ...CronAuthResponseSchema.parse({ ok: true, requestId }), ...result }, {}, requestId);
  });
}
