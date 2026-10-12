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
  return readEnv('DATABASE_URL_TEST') ?? requireEnv('DATABASE_URL');
}
