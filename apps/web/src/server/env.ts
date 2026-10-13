import 'server-only';

import { z } from 'zod';

const EnvSchema = z
  .object({
    IP_HASH_SALT: z.string().optional(),
    MAPBOX_MODE: z.enum(['live', 'mock']).default('live'),
    MAPBOX_SECRET_TOKEN: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  })
  .strict();

export type ServerEnv = z.infer<typeof EnvSchema>;

export function serverEnv(): ServerEnv {
  return EnvSchema.parse({
    IP_HASH_SALT: process.env.IP_HASH_SALT || undefined,
    MAPBOX_MODE: process.env.MAPBOX_MODE || undefined,
    MAPBOX_SECRET_TOKEN: process.env.MAPBOX_SECRET_TOKEN || undefined,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || undefined,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || undefined,
  });
}
