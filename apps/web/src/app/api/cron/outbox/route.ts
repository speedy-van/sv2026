import { CronAuthResponseSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { assertCronRequest } from '@/server/cron';
import { processOutboxBatch } from '@/server/outbox/processor';
import { maintainPushReceipts } from '@/server/notifications/receipt-maintenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { auth: false }, async ({ request, requestId }) => {
    assertCronRequest(request);
    const deadline = Date.now() + 40_000;
    // Reuse this authenticated daily invocation without adding a paid cron schedule.
    const receiptMaintenance = maintainPushReceipts();
    let done = 0;
    let failed = 0;
    try {
      for (let claim = 0; claim < 100 && Date.now() < deadline; claim += 1) {
        const result = await processOutboxBatch(1);
        done += result.done;
        failed += result.failed;
        if (result.done + result.failed === 0) break;
      }
    } finally {
      await receiptMaintenance;
    }
    return apiJson({ ...CronAuthResponseSchema.parse({ ok: true, requestId }), done, failed }, {}, requestId);
  });
}
