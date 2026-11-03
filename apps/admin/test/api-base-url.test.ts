import { resolveApiBaseUrl } from '../src/lib/api-base-url.cjs';

describe('admin release API configuration', () => {
  it('preserves local development without requiring release configuration', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe('http://127.0.0.1:3000');
    expect(resolveApiBaseUrl('http://localhost:3000', false)).toBe('http://localhost:3000');
  });
  it('uses the real HTTPS production origin', () => {
    expect(resolveApiBaseUrl('https://www.speedyvan.uk/', true)).toBe('https://www.speedyvan.uk');
  });
  it.each([
    undefined, '', 'not-a-url', 'http://www.speedyvan.uk', 'https://localhost:3000',
    'https://localhost.:3000', 'https://child.localhost', 'https://127.0.0.1:3000',
    'https://127.2.3.4', 'https://2130706433', 'https://[::1]:3000', 'https://0.0.0.0', 'https://[::]',
    'https://user:password@www.speedyvan.uk', 'https://www.speedyvan.uk/api',
    'https://www.speedyvan.uk?key=unit', 'https://www.speedyvan.uk#fragment',
  ])('fails closed for an invalid or device-local release API: %s', (value) => {
    expect(() => resolveApiBaseUrl(value, true)).toThrow();
  });
});
