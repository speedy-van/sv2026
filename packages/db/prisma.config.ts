import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const packageRoot = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(packageRoot, '../../.env.local'), quiet: true });
config({ path: resolve(packageRoot, '../../.env'), quiet: true });

function deriveUnpooledDatabaseUrl(pooledUrl: string | undefined): string | undefined {
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

const datasourceUrl = process.env.DATABASE_URL_UNPOOLED ?? deriveUnpooledDatabaseUrl(process.env.DATABASE_URL);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed.ts',
  },
  ...(datasourceUrl ? { datasource: { url: datasourceUrl } } : {}),
});
