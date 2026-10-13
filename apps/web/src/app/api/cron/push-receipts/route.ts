import { CronAuthResponseSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { assertCronRequest } from '@/server/cron';
import { checkPushReceipts } from '@/server/integrations/expo-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withApi(request, {}, async ({ request, requestId }) => {
    assertCronRequest(request);
    const result = await checkPushReceipts();
    return apiJson({ ...CronAuthResponseSchema.parse({ ok: true, requestId }), ...result }, {}, requestId);
  });
}
