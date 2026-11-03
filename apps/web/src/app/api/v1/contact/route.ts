import { ContactRequestSchema, ContactResponseSchema } from '@sv/contracts';
import { enqueueOutbox, prisma, type Prisma } from '@sv/db';
import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';
import { apiJson, withApi } from '@/server/request';
import { processOutboxBatch } from '@/server/outbox/processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: ContactRequestSchema, rateLimit: 'contact' }, async ({ input, requestId }) => {
    if (input.company && input.company.length > 0) {
      return apiJson(ContactResponseSchema.parse({ ok: true }), { status: 202 }, requestId);
    }
    const eventId = await prisma.$transaction(async (tx) => {
      const message = await tx.contactMessage.create({
        data: {
          email: input.email,
          message: input.message,
          name: input.name,
          phone: input.phone && input.phone.length > 0 ? input.phone : null,
        },
        select: { id: true },
      });
      const event = await enqueueOutbox(tx, 'contact.received', json({ contactMessageId: message.id }), `contact.received:${message.id}`);
      return event.id;
    });
    if (process.env.NODE_ENV !== 'test') {
      try {
        after(async () => {
          const deadline = Date.now() + 40_000;
          try {
            for (let batch = 0; batch < 8 && Date.now() < deadline; batch += 1) {
              // The new contact event and its descendants are the entire scope.
              const result = await processOutboxBatch(1, undefined, { rootEventId: eventId });
              if (result.failed > 0) {
                Sentry.captureMessage('Contact message delivery failed.', {
                  level: 'error',
                  tags: { feature: 'contact-message-delivery' },
                });
              }
              if (result.done + result.failed === 0) return;
            }
          } catch (error) {
            Sentry.captureException(error, { tags: { feature: 'contact-message-delivery' } });
          }
        });
      } catch (error) {
        Sentry.captureException(error, { tags: { feature: 'contact-message-scheduling' } });
      }
    }
    return apiJson(ContactResponseSchema.parse({ ok: true }), { status: 202 }, requestId);
  });
}
