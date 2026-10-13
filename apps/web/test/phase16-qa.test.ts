import { HealthResponseSchema } from '@sv/contracts';
import { prisma, type Prisma } from '@sv/db';
import { afterAll, describe, expect, it } from 'vitest';
import { GET as getHealth } from '../src/app/api/v1/health/route';
import { GET as getHourlyCron } from '../src/app/api/cron/hourly/route';
import { runBusinessAlarms } from '../src/server/cron-jobs';

const prefix = 'phase16-';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function cleanup(): Promise<void> {
  await prisma.outboxEvent.deleteMany({
    where: {
      OR: [
        { dedupeKey: { startsWith: prefix } },
        { dedupeKey: { startsWith: 'system.alert:business:push-failure-rate:2032-01-01T00' } },
      ],
    },
  });
  await prisma.pushTicket.deleteMany({ where: { ticketId: { startsWith: prefix } } });
  await prisma.pushDevice.deleteMany({ where: { expoPushToken: { startsWith: `ExponentPushToken[${prefix}` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
}

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Phase 16 health and security gates', () => {
  it('reports health and returns 503 when pending outbox is older than five minutes', async () => {
    await cleanup();
    const ok = await getHealth(new Request('http://localhost/api/v1/health'));
    expect(ok.status).toBeLessThan(504);
    HealthResponseSchema.parse(await ok.json());

    await prisma.outboxEvent.create({
      data: {
        createdAt: new Date(Date.now() - 6 * 60_000),
        dedupeKey: `${prefix}old-outbox`,
        payload: json({ issue: 'Phase 16 health test' }),
        type: 'system.alert',
      },
    });
    const unhealthy = await getHealth(new Request('http://localhost/api/v1/health'));
    expect(unhealthy.status).toBe(503);
    const body = HealthResponseSchema.parse(await unhealthy.json());
    expect(body.outboxBacklog).toBeGreaterThan(0);
    expect(body.oldestPendingSeconds).toBeGreaterThanOrEqual(300);
  });

  it('rejects cron calls without CRON_SECRET', async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = `${prefix}cron-secret`;
    try {
      const response = await getHourlyCron(new Request('http://localhost/api/cron/hourly'));
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previous;
    }
  });

  it('queues a business alarm when push failures exceed ten percent', async () => {
    await cleanup();
    const user = await prisma.user.create({
      data: { email: `${prefix}owner@example.test`, name: 'Phase 16 Owner', role: 'OWNER', status: 'ACTIVE' },
      select: { id: true },
    });
    const device = await prisma.pushDevice.create({
      data: {
        app: 'ADMIN',
        expoPushToken: `ExponentPushToken[${prefix}device]`,
        platform: 'IOS',
        userId: user.id,
      },
      select: { id: true },
    });
    await prisma.pushTicket.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        createdAt: new Date('2032-01-01T00:00:00.000Z'),
        error: index < 2 ? 'DeviceNotRegistered' : null,
        pushDeviceId: device.id,
        status: index < 2 ? 'error' : 'ok',
        ticketId: `${prefix}ticket-${String(index)}`,
      })),
    });

    const result = await runBusinessAlarms(new Date('2032-01-01T00:30:00.000Z'));
    expect(result.pushFailureRate).toBe(0.2);
    expect(result.alertsQueued).toBe(1);
    const alert = await prisma.outboxEvent.findUnique({
      where: { dedupeKey: 'system.alert:business:push-failure-rate:2032-01-01T00' },
    });
    expect(alert?.type).toBe('system.alert');
  });
});
