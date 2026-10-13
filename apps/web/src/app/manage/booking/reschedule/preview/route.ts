import { ReschedulePreviewRequestSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { manageTokenFromCookie } from '@/server/auth/manage-cookie';
import { previewReschedule } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withApi(request, { input: ReschedulePreviewRequestSchema }, async ({ input, requestId }) => {
    const preview = await previewReschedule(await manageTokenFromCookie(), input);
    return apiJson({ allowed: true, ...preview }, {}, requestId);
  });
}
