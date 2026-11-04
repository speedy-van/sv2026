import { OperationsCronResponseSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { assertCronRequest } from '@/server/cron';
import { runOperationsCron } from '@/server/cron-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { auth: false }, async ({ request, requestId }) => {
    assertCronRequest(request);
    const result = await runOperationsCron();
    return apiJson(OperationsCronResponseSchema.parse({ ok: true, requestId, ...result }), {}, requestId);
  });
}
