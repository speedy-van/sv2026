import { AppError } from '@sv/contracts';
import { constructStripeEvent } from '@/server/integrations/stripe';
import { apiError, apiJson, requestIdFrom } from '@/server/request';
import { handleStripeEvent } from '@/server/services/stripe-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  try {
    const body = await request.text();
    const event = constructStripeEvent(body, request.headers.get('stripe-signature'));
    const result = await handleStripeEvent(event);
    return apiJson({ ok: true, result }, {}, requestId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'VALIDATION_ERROR') {
      return apiError(error, requestId, { 'Cache-Control': 'no-store' });
    }
    if (error instanceof AppError) return apiError(error, requestId);
    return apiError(new AppError('INTERNAL', 'Webhook processing failed.'), requestId);
  }
}
