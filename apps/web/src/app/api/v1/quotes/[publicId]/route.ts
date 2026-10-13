import { AppError, PublicIdSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { getQuote } from '@/server/services/quote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ publicId: string }> }): Promise<Response> {
  return withApi(request, {}, async ({ requestId }) => {
    const params = await context.params;
    const parsed = PublicIdSchema.safeParse(params.publicId);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Expected a valid quote id.');
    return apiJson(await getQuote(parsed.data), {}, requestId);
  });
}
