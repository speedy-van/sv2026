import { OtpRequestSchema } from '@sv/contracts';
import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';
import { apiJson, withApi } from '@/server/request';
import { requestStaffOtp } from '@/server/auth/staff';
import { processOutboxBatch } from '@/server/outbox/processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: OtpRequestSchema, rateLimit: 'authOtpRequest' }, async ({ input, requestId }) => {
    const eventId = await requestStaffOtp(input);
    if (eventId && process.env.NODE_ENV !== 'test') {
      try {
        after(async () => {
          try {
            const result = await processOutboxBatch(1, ['email.send'], { rootEventId: eventId });
            if (result.failed > 0) {
              Sentry.captureMessage('Staff sign-in email delivery failed.', {
                level: 'error',
                tags: { feature: 'staff-otp-email-delivery' },
              });
            }
          } catch (error) {
            Sentry.captureException(error, { tags: { feature: 'staff-otp-email-delivery' } });
          }
        });
      } catch (error) {
        // Keep the generic response and durable job; never drain other requests.
        Sentry.captureException(error, { tags: { feature: 'staff-otp-email-scheduling' } });
      }
    }
    return apiJson({ ok: true }, { status: 202 }, requestId);
  });
}
