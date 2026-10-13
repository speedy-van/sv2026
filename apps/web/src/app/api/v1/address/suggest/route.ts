import { AddressSuggestRequestSchema, AddressSuggestResponseSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { suggestAddresses } from '@/server/mapbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: AddressSuggestRequestSchema, rateLimit: 'addressSuggest' }, async ({ input, requestId }) => {
    const suggestions = await suggestAddresses(input.q, input.sessionToken, input.proximity);
    return apiJson(AddressSuggestResponseSchema.parse({ suggestions }), {}, requestId);
  });
}
