import 'server-only';

import { Redis } from '@upstash/redis';
import { serverEnv } from './env';

let redis: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const env = serverEnv();
  redis = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ token: env.UPSTASH_REDIS_REST_TOKEN, url: env.UPSTASH_REDIS_REST_URL })
    : null;
  return redis;
}

