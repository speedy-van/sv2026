import 'server-only';

import { AppError } from '@sv/contracts';
import * as Sentry from '@sentry/nextjs';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { createHash } from 'node:crypto';
import { serverEnv } from './env';

export type PublicRateLimitKind =
  | 'addressSuggest'
  | 'addressRetrieve'
  | 'authOtpRequest'
  | 'authOtpVerify'
  | 'authRefresh'
  | 'catalogue'
  | 'contact'
  | 'mapStatic'
  | 'manageLink'
  | 'quote'
  | 'manualQuote'
  | 'booking';

interface LimitRule {
  limit: number;
  windowSeconds: number;
}

const rules = {
  addressSuggest: [
    { limit: 60, windowSeconds: 60 },
    { limit: 600, windowSeconds: 3600 },
  ],
  addressRetrieve: [{ limit: 30, windowSeconds: 60 }],
  authOtpRequest: [{ limit: 10, windowSeconds: 3600 }],
  authOtpVerify: [{ limit: 10, windowSeconds: 3600 }],
  authRefresh: [{ limit: 60, windowSeconds: 3600 }],
  catalogue: [{ limit: 120, windowSeconds: 60 }],
  contact: [
    { limit: 5, windowSeconds: 3600 },
    { limit: 20, windowSeconds: 86400 },
  ],
  mapStatic: [{ limit: 60, windowSeconds: 60 }],
  manageLink: [{ limit: 5, windowSeconds: 3600 }],
  quote: [
    { limit: 10, windowSeconds: 60 },
    { limit: 60, windowSeconds: 3600 },
  ],
  manualQuote: [{ limit: 5, windowSeconds: 3600 }],
  booking: [{ limit: 10, windowSeconds: 3600 }],
} as const satisfies Record<PublicRateLimitKind, readonly LimitRule[]>;

const memoryHits = new Map<string, number[]>();
const ratelimitCache = new Map<string, Ratelimit>();

function ipFrom(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || '127.0.0.1';
}

function hashKey(value: string): string {
  const env = serverEnv();
  const salt = env.IP_HASH_SALT ?? 'development-ip-hash-salt';
  return createHash('sha256').update(`${value}:${salt}`).digest('hex');
}

function redisClient(): Redis | null {
  const env = serverEnv();
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    token: env.UPSTASH_REDIS_REST_TOKEN,
    url: env.UPSTASH_REDIS_REST_URL,
  });
}

function upstashLimiter(kind: PublicRateLimitKind, rule: LimitRule): Ratelimit | null {
  const redis = redisClient();
  if (!redis) return null;
  const key = `${kind}:${String(rule.limit)}:${String(rule.windowSeconds)}`;
  const existing = ratelimitCache.get(key);
  if (existing) return existing;
  const limiter = new Ratelimit({
    analytics: false,
    limiter: Ratelimit.slidingWindow(rule.limit, `${String(rule.windowSeconds)} s` as Parameters<typeof Ratelimit.slidingWindow>[1]),
    prefix: `sv:${kind}`,
    redis,
  });
  ratelimitCache.set(key, limiter);
  return limiter;
}

function enforceMemoryLimit(identifier: string, kind: PublicRateLimitKind, rule: LimitRule): void {
  const now = Date.now();
  const key = `${kind}:${identifier}:${String(rule.limit)}:${String(rule.windowSeconds)}`;
  const cutoff = now - rule.windowSeconds * 1000;
  const hits = (memoryHits.get(key) ?? []).filter((hit) => hit > cutoff);
  if (hits.length >= rule.limit) {
    throw new AppError('RATE_LIMITED', 'Too many requests. Try again shortly.', { retryAfter: rule.windowSeconds });
  }
  hits.push(now);
  memoryHits.set(key, hits);
}

export async function enforceRateLimit(request: Request, kind: PublicRateLimitKind): Promise<void> {
  const identifier = hashKey(ipFrom(request));
  for (const rule of rules[kind]) {
    const limiter = upstashLimiter(kind, rule);
    if (limiter) {
      try {
        const result = await limiter.limit(identifier);
        if (!result.success) {
          const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
          throw new AppError('RATE_LIMITED', 'Too many requests. Try again shortly.', { retryAfter });
        }
        continue;
      } catch (error) {
        if (error instanceof AppError) throw error;
        Sentry.captureException(error, {
          tags: { component: 'rate-limit', rateLimitKind: kind },
        });
      }
    }
    enforceMemoryLimit(identifier, kind, rule);
  }
}
