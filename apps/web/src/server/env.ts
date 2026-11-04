import 'server-only';

import { z } from 'zod';
import { AppError } from '@sv/contracts';

const MapboxTokenSchema = z.string().regex(/^(?:pk|sk)\./u, 'MAPBOX_SECRET_TOKEN must start with pk. or sk.');

const EnvSchema = z
  .object({
    CRON_SECRET: z.string().optional(),
    CUSTOMER_LINK_SECRET: z.string().optional(),
    LARK_MAIL_ENABLED: z.enum(['true', 'false']).default('false'),
    LARK_MAIL_SEND_ENABLED: z.enum(['true', 'false']).default('false'),
    LARK_MAIL_ADDRESS: z.email().optional(),
    LARK_MAIL_APP_PASSWORD: z.string().min(8).optional(),
    LARK_MAIL_SENT_FOLDER: z.string().min(1).max(200).optional(),
    LARK_MAIL_DAILY_MESSAGES: z.coerce.number().int().min(1).max(449).default(300),
    LARK_MAIL_DAILY_EXTERNAL_RECIPIENTS: z.coerce.number().int().min(1).max(199).default(150),
    LARK_MAIL_ORG_DAILY_MESSAGES: z.coerce.number().int().min(1).max(449).default(400),
    LARK_MAIL_ORG_DAILY_EXTERNAL_RECIPIENTS: z.coerce.number().int().min(1).max(499).default(400),
    LARK_MAIL_MIN_SEND_INTERVAL_SECONDS: z.coerce.number().int().min(2).max(60).default(3),
    EXPO_ACCESS_TOKEN: z.string().optional(),
    IP_HASH_SALT: z.string().optional(),
    JWT_ACCESS_SECRET: z.string().optional(),
    MAPBOX_MODE: z.enum(['live', 'mock']).default('live'),
    MAPBOX_SECRET_TOKEN: MapboxTokenSchema.optional(),
    MIN_ADMIN_APP_VERSION: z.string().optional(),
    MIN_DRIVER_APP_VERSION: z.string().optional(),
    OTP_PEPPER: z.string().optional(),
    OUTBOX_PROCESS_FROM: z.iso.datetime({ offset: true }).optional(),
    PUSH_MODE: z.enum(['capture', 'live']).default('live'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_LEGACY_TEST_SECRET_KEY: z.string().regex(/^sk_test_/u).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    UPSTASH_REDIS_REST_URL: z.url().optional(),
  })
  .strict();

export type ServerEnv = z.infer<typeof EnvSchema>;

export function serverEnv(): ServerEnv {
  return EnvSchema.parse({
    CRON_SECRET: process.env.CRON_SECRET || undefined,
    CUSTOMER_LINK_SECRET: process.env.CUSTOMER_LINK_SECRET || undefined,
    LARK_MAIL_ENABLED: process.env.LARK_MAIL_ENABLED || undefined,
    LARK_MAIL_SEND_ENABLED: process.env.LARK_MAIL_SEND_ENABLED || undefined,
    LARK_MAIL_ADDRESS: process.env.LARK_MAIL_ADDRESS || undefined,
    LARK_MAIL_APP_PASSWORD: process.env.LARK_MAIL_APP_PASSWORD || undefined,
    LARK_MAIL_SENT_FOLDER: process.env.LARK_MAIL_SENT_FOLDER || undefined,
    LARK_MAIL_DAILY_MESSAGES: process.env.LARK_MAIL_DAILY_MESSAGES || undefined,
    LARK_MAIL_DAILY_EXTERNAL_RECIPIENTS: process.env.LARK_MAIL_DAILY_EXTERNAL_RECIPIENTS || undefined,
    LARK_MAIL_ORG_DAILY_MESSAGES: process.env.LARK_MAIL_ORG_DAILY_MESSAGES || undefined,
    LARK_MAIL_ORG_DAILY_EXTERNAL_RECIPIENTS: process.env.LARK_MAIL_ORG_DAILY_EXTERNAL_RECIPIENTS || undefined,
    LARK_MAIL_MIN_SEND_INTERVAL_SECONDS: process.env.LARK_MAIL_MIN_SEND_INTERVAL_SECONDS || undefined,
    EXPO_ACCESS_TOKEN: process.env.EXPO_ACCESS_TOKEN || undefined,
    IP_HASH_SALT: process.env.IP_HASH_SALT || undefined,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || undefined,
    MAPBOX_MODE: process.env.MAPBOX_MODE || undefined,
    MAPBOX_SECRET_TOKEN: process.env.MAPBOX_SECRET_TOKEN || undefined,
    MIN_ADMIN_APP_VERSION: process.env.MIN_ADMIN_APP_VERSION || undefined,
    MIN_DRIVER_APP_VERSION: process.env.MIN_DRIVER_APP_VERSION || undefined,
    OTP_PEPPER: process.env.OTP_PEPPER || undefined,
    OUTBOX_PROCESS_FROM: process.env.OUTBOX_PROCESS_FROM || undefined,
    PUSH_MODE: process.env.PUSH_MODE || undefined,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || undefined,
    STRIPE_LEGACY_TEST_SECRET_KEY: process.env.STRIPE_LEGACY_TEST_SECRET_KEY || undefined,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || undefined,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || undefined,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || undefined,
  });
}

export function outboxProcessFrom(): Date | undefined {
  const value = serverEnv().OUTBOX_PROCESS_FROM;
  if (!value && process.env.NODE_ENV === 'production') {
    throw new AppError('INTERNAL', 'OUTBOX_PROCESS_FROM is required for production outbox processing.');
  }
  return value ? new Date(value) : undefined;
}
