import { AddressRetrieveRequestSchema, AddressRetrieveResponseSchema } from '@sv/contracts';
import { retrieveAddress } from '@/server/mapbox';
import { apiJson, withApi } from '@/server/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: AddressRetrieveRequestSchema, rateLimit: 'addressRetrieve' }, async ({ input, requestId }) => {
    const result = await retrieveAddress(input.id, input.sessionToken);
    const body = 'needsPostcode' in result ? result : { address: result };
    return apiJson(AddressRetrieveResponseSchema.parse(body), {}, requestId);
  });
}
