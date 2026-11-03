import 'server-only';

const previewOrigins = new Set(['http://localhost:8081', 'http://127.0.0.1:8081']);
const localApiHosts = new Set(['localhost:3000', '127.0.0.1:3000']);
const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const allowedHeaders = new Set(['authorization', 'content-type', 'x-sv-app']);

/** Only the local Expo preview gains browser access; endpoint auth still runs normally. */
export function developmentApiCorsHeaders(request: Request): Headers | null {
  if (process.env.NODE_ENV !== 'development') return null;
  const url = new URL(request.url);
  // Next constructs its internal URL from the bind address, which can be 0.0.0.0.
  // The original Host retains the actual loopback destination used by the browser.
  const host = request.headers.get('host') ?? url.host;
  if (url.protocol !== 'http:' || !localApiHosts.has(host.toLowerCase())) return null;
  if (url.pathname !== '/api/v1' && !url.pathname.startsWith('/api/v1/')) return null;
  const origin = request.headers.get('origin');
  if (!origin || !previewOrigins.has(origin)) return null;
  if (new URL(origin).hostname !== new URL(`http://${host}`).hostname) return null;

  const preflight = request.method === 'OPTIONS';
  const method = preflight ? request.headers.get('access-control-request-method') : request.method;
  if (!method || !allowedMethods.has(method)) return null;
  if (preflight) {
    const requestedHeaders = request.headers.get('access-control-request-headers');
    if (
      requestedHeaders &&
      requestedHeaders.split(',').some((header) => !allowedHeaders.has(header.trim().toLowerCase()))
    )
      return null;
  }

  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'X-Request-Id, Retry-After',
    Vary: 'Origin',
  });
  if (preflight) {
    headers.set('Access-Control-Allow-Methods', [...allowedMethods].join(', '));
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-SV-App');
    headers.set('Cache-Control', 'no-store');
    headers.append('Vary', 'Access-Control-Request-Method');
    headers.append('Vary', 'Access-Control-Request-Headers');
  }
  return headers;
}
