import { ContactRequestSchema, ContactResponseSchema } from '@sv/contracts';
import { prisma } from '@sv/db';
import { apiJson, withApi } from '@/server/request';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { input: ContactRequestSchema, rateLimit: 'contact' }, async ({ input, requestId }) => {
    if (input.company && input.company.length > 0) {
      return apiJson(ContactResponseSchema.parse({ ok: true }), { status: 202 }, requestId);
    }
    await prisma.contactMessage.create({
      data: {
        email: input.email,
        message: input.message,
        name: input.name,
        phone: input.phone && input.phone.length > 0 ? input.phone : null,
      },
    });
    return apiJson(ContactResponseSchema.parse({ ok: true }), { status: 202 }, requestId);
  });
}
