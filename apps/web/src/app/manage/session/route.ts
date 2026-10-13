import { AppError } from '@sv/contracts';
import { prisma } from '@sv/db';
import { NextResponse } from 'next/server';
import { MANAGE_COOKIE } from '@/server/auth/manage-cookie';
import { shortManageCookieToken, verifyBookingLink } from '@/server/auth/customer-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return NextResponse.redirect(new URL('/manage?expired=1', request.url), 303);
  try {
    const { bookingId } = await verifyBookingLink(token, 'manage');
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { contactEmail: true, id: true },
    });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
    const cookieToken = await shortManageCookieToken(booking);
    const manageUrl = new URL('/manage', request.url);
    const response = new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${manageUrl.pathname}"><title>Opening booking</title></head><body><p>Opening your booking...</p><script>location.replace(${JSON.stringify(manageUrl.pathname)});</script></body></html>`,
      {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/html; charset=utf-8',
        },
        status: 200,
      },
    );
    const secure = process.env.NODE_ENV === 'production' && process.env.E2E !== '1';
    response.headers.set(
      'Set-Cookie',
      `${MANAGE_COOKIE}=${cookieToken}; Path=/; Max-Age=${String(7 * 24 * 60 * 60)}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    );
    return response;
  } catch {
    return NextResponse.redirect(new URL('/manage?expired=1', request.url), 303);
  }
}
