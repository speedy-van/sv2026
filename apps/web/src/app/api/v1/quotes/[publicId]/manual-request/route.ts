import { AppError, ManualQuoteRequestResponseSchema, ManualQuoteRequestSchema, PublicIdSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { requestManualQuote } from '@/server/services/quote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ publicId: string }> }): Promise<Response> {
  return withApi(request, { input: ManualQuoteRequestSchema, rateLimit: 'manualQuote' }, async ({ input, requestId }) => {
    const params = await context.params;
    const parsed = PublicIdSchema.safeParse(params.publicId);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Expected a valid quote id.');
    const result = await requestManualQuote(parsed.data, input);
    return apiJson(ManualQuoteRequestResponseSchema.parse(result), { status: 202 }, requestId);
  });
}
