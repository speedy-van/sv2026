import { ContactRequestSchema, ContactResponseSchema } from '@sv/contracts';
import { enqueueOutbox, prisma, type Prisma } from '@sv/db';
import { apiJson, withApi } from '@/server/request';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { input: ContactRequestSchema, rateLimit: 'contact' }, async ({ input, requestId }) => {
    if (input.company && input.company.length > 0) {
      return apiJson(ContactResponseSchema.parse({ ok: true }), { status: 202 }, requestId);
    }
    await prisma.$transaction(async (tx) => {
      const message = await tx.contactMessage.create({
        data: {
          email: input.email,
          message: input.message,
          name: input.name,
          phone: input.phone && input.phone.length > 0 ? input.phone : null,
        },
        select: { id: true },
      });
      await enqueueOutbox(tx, 'contact.received', json({ contactMessageId: message.id }), `contact.received:${message.id}`);
    });
    return apiJson(ContactResponseSchema.parse({ ok: true }), { status: 202 }, requestId);
  });
}
