import { NextResponse, type NextRequest } from 'next/server';
import { developmentApiCorsHeaders } from './server/dev-cors';

export function proxy(request: NextRequest): NextResponse {
  const headers = developmentApiCorsHeaders(request);
  if (!headers) return NextResponse.next();
  if (request.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers });
  return NextResponse.next({ headers });
}

export const config = {
  matcher: '/api/v1/:path*',
};
