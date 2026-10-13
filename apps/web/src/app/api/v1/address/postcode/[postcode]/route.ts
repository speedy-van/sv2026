import { AppError, PostcodeLookupResponseSchema, UkPostcodeSchema } from '@sv/contracts';
import { lookupPostcode } from '@/server/mapbox';
import { apiJson, withApi } from '@/server/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ postcode: string }> }): Promise<Response> {
  return withApi(request, { rateLimit: 'addressRetrieve' }, async ({ requestId }) => {
    const params = await context.params;
    const parsed = UkPostcodeSchema.safeParse(decodeURIComponent(params.postcode));
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Expected a valid UK postcode.');
    const result = await lookupPostcode(parsed.data);
    return apiJson(PostcodeLookupResponseSchema.parse(result), {}, requestId);
  });
}
