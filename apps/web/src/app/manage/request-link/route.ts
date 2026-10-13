import { ManageRequestLinkSchema } from '@sv/contracts';
import { after } from 'next/server';
import { apiJson, withApi } from '@/server/request';
import { processOutboxBatch } from '@/server/outbox/processor';
import { requestManageLink } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: ManageRequestLinkSchema, rateLimit: 'manageLink' }, async ({ input, requestId }) => {
    await requestManageLink(input);
    if (process.env.NODE_ENV !== 'test') {
      try {
        after(() => {
          void processOutboxBatch(10);
        });
      } catch {
        void processOutboxBatch(10);
      }
    }
    return apiJson(
      { message: "If those details match a booking, we've emailed you a link. It can take a minute to arrive." },
      {},
      requestId,
    );
  });
}
