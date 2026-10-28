/**
 * Shared by Expo's Node config loader and the native app without a loader hook.
 * @param {unknown} value
 * @param {boolean} release
 * @returns {string}
 */
function resolveApiBaseUrl(value, release) {
  const configured = typeof value === 'string' ? value.trim() : '';
  if (!release) return configured || 'http://127.0.0.1:3000';
  if (!configured) throw new Error('EXPO_PUBLIC_API_BASE_URL is required for an admin release.');
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('The admin release API must be an HTTPS origin.');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (
    url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    url.pathname !== '/' || hostname === 'localhost' || hostname.endsWith('.localhost') ||
    /^127\./u.test(hostname) || hostname === '0.0.0.0' || hostname === '[::1]' || hostname === '[::]'
  ) {
    throw new Error('The admin release API must be an HTTPS origin outside this device.');
  }
  return url.origin;
}

module.exports = { resolveApiBaseUrl };
