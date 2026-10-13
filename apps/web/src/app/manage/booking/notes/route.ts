import { NotesPatchSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { manageTokenFromCookie } from '@/server/auth/manage-cookie';
import { updateCustomerNotes } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request): Promise<Response> {
  return withApi(request, { auth: false, input: NotesPatchSchema }, async ({ input, requestId }) => {
    await updateCustomerNotes(await manageTokenFromCookie(), input.customerNotes);
    return apiJson({ ok: true }, {}, requestId);
  });
}
