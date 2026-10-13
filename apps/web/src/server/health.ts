import 'server-only';

import { AppError, HealthResponseSchema } from '@sv/contracts';
import { prisma } from '@sv/db';
import type { z } from 'zod';

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

const outboxBacklogLimitSeconds = 5 * 60;

function currentVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.npm_package_version ?? 'local';
}

export async function readHealth(now = new Date()): Promise<{ body: HealthResponse; status: number }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Database is unreachable.');
  }

  const [outboxBacklog, oldestPending, lastWebhook] = await Promise.all([
    prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
    prisma.outboxEvent.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
      where: { status: 'PENDING' },
    }),
    prisma.stripeEvent.findFirst({
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    }),
  ]);

  const oldestPendingSeconds = oldestPending ? Math.max(0, Math.floor((now.getTime() - oldestPending.createdAt.getTime()) / 1000)) : null;
  const body = HealthResponseSchema.parse({
    db: 'ok',
    lastWebhookAt: lastWebhook?.receivedAt.toISOString() ?? null,
    oldestPendingSeconds,
    outboxBacklog,
    version: currentVersion(),
  });

  return {
    body,
    status: oldestPendingSeconds !== null && oldestPendingSeconds > outboxBacklogLimitSeconds ? 503 : 200,
  };
}
