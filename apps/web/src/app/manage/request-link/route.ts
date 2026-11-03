import { ManageRequestLinkSchema } from '@sv/contracts';
import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';
import { apiJson, withApi } from '@/server/request';
import { processOutboxBatch } from '@/server/outbox/processor';
import { requestManageLink } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: ManageRequestLinkSchema, rateLimit: 'manageLink' }, async ({ input, requestId }) => {
    const eventId = await requestManageLink(input);
    if (eventId && process.env.NODE_ENV !== 'test') {
      try {
        after(async () => {
          try {
            await processOutboxBatch(1, ['email.send'], { rootEventId: eventId });
          } catch (error) {
            Sentry.captureException(error, { tags: { feature: 'manage-link-email-delivery' } });
          }
        });
      } catch (error) {
        // The requested email remains durable; never drain unrelated pending work.
        Sentry.captureException(error, { tags: { feature: 'manage-link-email-scheduling' } });
      }
    }
    return apiJson(
      { message: "If those details match a booking, we've emailed you a link. It can take a minute to arrive." },
      {},
      requestId,
    );
  });
}
