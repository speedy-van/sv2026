import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let loaded = false;

export function loadDbEnv(): void {
  if (loaded) return;
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = resolve(packageRoot, '../..');
  config({ path: resolve(repoRoot, '.env.local'), quiet: true });
  config({ path: resolve(repoRoot, '.env'), quiet: true });
  loaded = true;
}

export function readEnv(name: string): string | undefined {
  loadDbEnv();
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function deriveUnpooledDatabaseUrl(pooledUrl: string | undefined): string | undefined {
  if (!pooledUrl) return undefined;
  try {
    const url = new URL(pooledUrl);
    if (!url.hostname.includes('-pooler.')) return undefined;
    url.hostname = url.hostname.replace('-pooler.', '.');
    return url.toString();
  } catch {
    return undefined;
  }
}

export function directDatabaseUrl(): string {
  return readEnv('DATABASE_URL_UNPOOLED') ?? deriveUnpooledDatabaseUrl(readEnv('DATABASE_URL')) ?? requireEnv('DATABASE_URL_UNPOOLED');
}

export function runtimeDatabaseUrl(): string {
  if (process.env.NODE_ENV === 'test') {
    const testUrl = readEnv('DATABASE_URL_TEST');
    if (!testUrl) throw new Error('DATABASE_URL_TEST is required for database integration tests; refusing the shared application database.');
    const primary = readEnv('DATABASE_URL');
    const identity = (value: string): string => {
      const parsed = new URL(value);
      return `${parsed.hostname.replace('-pooler.', '.')}:${parsed.port}${parsed.pathname}`;
    };
    if (primary && identity(testUrl) === identity(primary)) {
      throw new Error('DATABASE_URL_TEST must identify a separate test database.');
    }
    return testUrl;
  }
  return readEnv('DATABASE_URL_TEST') ?? requireEnv('DATABASE_URL');
}
