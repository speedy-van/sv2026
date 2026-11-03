import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from '../src/proxy';

const previewOrigin = 'http://localhost:8081';
const passwordPath = '/api/v1/auth/password/login';

function request({
  origin = previewOrigin,
  destination = 'http://localhost:3000',
  path = passwordPath,
  method = 'OPTIONS',
  requestedMethod = 'POST',
  requestedHeaders = 'content-type,x-sv-app',
  host,
}: {
  origin?: string | null;
  destination?: string;
  path?: string;
  method?: string;
  requestedMethod?: string | null;
  requestedHeaders?: string | null;
  host?: string;
} = {}): NextRequest {
  const headers = new Headers();
  if (origin) headers.set('Origin', origin);
  headers.set('Host', host ?? new URL(destination).host);
  if (method === 'OPTIONS') {
    if (requestedMethod) headers.set('Access-Control-Request-Method', requestedMethod);
    if (requestedHeaders) headers.set('Access-Control-Request-Headers', requestedHeaders);
  }
  return new NextRequest(`${destination}${path}`, { method, headers });
}

function expectNoCors(response: Response): void {
  const names = [...response.headers.keys()];
  expect(names.filter((name) => name.startsWith('access-control-'))).toEqual([]);
  expect(response.headers.get('x-middleware-next')).toBe('1');
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('local admin preview CORS', () => {
  it.each([
    ['http://localhost:8081', 'http://localhost:3000'],
    ['http://127.0.0.1:8081', 'http://127.0.0.1:3000'],
  ])(
    'answers a local %s to %s login preflight without invoking its mutation',
    async (origin, destination) => {
      const response = proxy(request({ origin, destination }));
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(response.headers.get('x-middleware-next')).toBeNull();
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'Authorization, Content-Type, X-SV-App',
      );
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, HEAD, POST, PUT, PATCH, DELETE',
      );
      expect(response.headers.get('access-control-allow-credentials')).toBe('true');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('vary')).toBe(
        'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      );
    },
  );

  it('leaves bearer-token requests to the original API and its authentication checks', () => {
    const incoming = request({ path: '/api/v1/admin/bookings', method: 'GET' });
    incoming.headers.set('Authorization', 'Bearer test-only-access-token');
    incoming.headers.set('X-SV-App', 'admin@1.0.0');
    const response = proxy(incoming);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('access-control-allow-origin')).toBe(previewOrigin);
    expect(response.headers.get('access-control-expose-headers')).toBe('X-Request-Id, Retry-After');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('authorization')).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')).toBeNull();
    expect(incoming.headers.get('authorization')).toBe('Bearer test-only-access-token');
  });

  it.each(['localhost:3000', '127.0.0.1:3000'])(
    'uses the actual local Host %s when Next normalizes its internal URL to the bind address',
    (host) => {
      const origin = host === 'localhost:3000' ? previewOrigin : 'http://127.0.0.1:8081';
      const response = proxy(request({ destination: 'http://0.0.0.0:3000', host, origin }));
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    },
  );

  it.each([
    ['http://localhost:8081', 'http://127.0.0.1:3000'],
    ['http://127.0.0.1:8081', 'http://localhost:3000'],
  ])('does not share browser credentials between different loopback hosts %s and %s', (origin, destination) => {
    expectNoCors(proxy(request({ origin, destination })));
  });

  it.each(['example.test:3000', '0.0.0.0:3000', 'localhost:3001', 'localhost:3000.example.test'])(
    'does not trust an external or wrong-port Host %s even if the internal URL is loopback',
    (host) => {
      expectNoCors(proxy(request({ host })));
    },
  );

  it('does not treat an all-interface bind address without an original local Host as a browser destination', () => {
    expectNoCors(proxy(request({ destination: 'http://0.0.0.0:3000' })));
  });

  it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'permits %s preflights with case-insensitive allowed header names',
    (requestedMethod) => {
      const response = proxy(
        request({ requestedMethod, requestedHeaders: 'Authorization, CONTENT-TYPE, X-Sv-App' }),
      );
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(previewOrigin);
    },
  );

  it.each(['production', 'test', undefined])('adds no CORS access in NODE_ENV=%s', (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    expectNoCors(proxy(request()));
    expectNoCors(proxy(request({ method: 'POST' })));
  });

  it.each([
    null,
    'null',
    'http://localhost:8082',
    'http://127.0.0.1:8080',
    'https://localhost:8081',
    'http://localhost:8081.example.test',
    'http://evil.localhost:8081',
    'http://[::1]:8081',
    'https://example.test',
  ])('does not reflect an unapproved origin %s', (origin) => {
    expectNoCors(proxy(request({ origin })));
    expectNoCors(proxy(request({ origin, method: 'GET' })));
  });

  it.each([
    'http://localhost:3001',
    'https://localhost:3000',
    'http://127.0.0.1:8081',
    'http://localhost.example.test:3000',
    'https://www.speedyvan.uk',
  ])('does not expand the development policy to another API destination %s', (destination) => {
    expectNoCors(proxy(request({ destination })));
  });

  it.each([
    { requestedMethod: 'TRACE' },
    { requestedMethod: null },
    { requestedHeaders: 'content-type,x-admin-override' },
    { requestedHeaders: 'cookie' },
  ])('leaves unsupported preflights to the original API: %j', (options) => {
    expectNoCors(proxy(request(options)));
  });

  it('supports a valid preflight without custom headers', () => {
    expect(proxy(request({ requestedMethod: 'GET', requestedHeaders: null })).status).toBe(204);
  });

  it.each([
    '/api/v10/auth/password/login',
    '/api/webhooks/stripe',
    '/api/cron/outbox',
    '/api/test/self-service',
    '/book',
  ])('never intercepts another namespace %s', (path) => {
    expectNoCors(proxy(request({ path })));
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })).toBe(false);
  });

  it.each([
    passwordPath,
    '/api/v1/auth/otp/request',
    '/api/v1/me',
    '/api/v1/admin/bookings',
    '/api/v1/catalogue',
  ])('matches the versioned API endpoint %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
  });
});
