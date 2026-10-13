import { ReviewSubmitSchema } from '@sv/contracts';
import { apiJson, withApi } from '@/server/request';
import { submitReview } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  return withApi(request, { input: ReviewSubmitSchema.omit({ token: true }) }, async ({ input, requestId }) => {
    const reviewInput = {
      ...(input.comment === undefined ? {} : { comment: input.comment }),
      displayName: input.displayName,
      rating: input.rating,
      ...(input.town === undefined ? {} : { town: input.town }),
    };
    const result = await submitReview(decodeURIComponent(token), reviewInput);
    return apiJson({ result }, { status: result === 'created' ? 201 : 409 }, requestId);
  });
}
