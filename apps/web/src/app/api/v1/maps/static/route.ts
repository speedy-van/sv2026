import { AppError, PublicIdSchema } from '@sv/contracts';
import { staticRouteImage } from '@/server/mapbox';
import { withApi } from '@/server/request';
import { quoteRouteGeometry } from '@/server/services/quote';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const StaticMapQuerySchema = z
  .object({
    dpr: z.coerce.number().int().min(1).max(2).default(1),
    h: z.coerce.number().int().min(120).max(1200).default(360),
    quote: PublicIdSchema,
    w: z.coerce.number().int().min(180).max(1200).default(640),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  return withApi(request, { rateLimit: 'mapStatic' }, async ({ request }) => {
    const url = new URL(request.url);
    const parsed = StaticMapQuerySchema.safeParse({
      dpr: url.searchParams.get('dpr') ?? undefined,
      h: url.searchParams.get('h') ?? undefined,
      quote: url.searchParams.get('quote') ?? '',
      w: url.searchParams.get('w') ?? undefined,
    });
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Expected a valid static map query.');
    const geometry = await quoteRouteGeometry(parsed.data.quote);
    const image = await staticRouteImage(geometry ?? '', parsed.data.w, parsed.data.h, parsed.data.dpr);
    const body = new ArrayBuffer(image.body.byteLength);
    new Uint8Array(body).set(image.body);
    return new Response(body, {
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'Content-Type': image.contentType,
      },
      status: 200,
    });
  });
}
