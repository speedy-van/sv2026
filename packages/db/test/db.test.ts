import { AppError } from '@sv/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertSlotCapacity, prisma } from '../src';
import { directDatabaseUrl } from '../src/env';

const moveDate = new Date('2031-02-03T00:00:00.000Z');
const slot = 'MORNING';
const referencePrefix = 'TEST-CAP-';
const customerEmail = 'capacity-test@example.invalid';
let schemaReady = false;

async function cleanup(): Promise<void> {
  if (!schemaReady) return;
  await prisma.booking.deleteMany({ where: { reference: { startsWith: referencePrefix } } });
  await prisma.customer.deleteMany({ where: { email: customerEmail } });
  await prisma.capacityOverride.deleteMany({ where: { date: moveDate, slot } });
}

async function pricingVersionId(): Promise<string> {
  const existing = await prisma.pricingConfigVersion.findFirst({ orderBy: { version: 'asc' }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.pricingConfigVersion.create({
    data: {
      version: 999_001,
      status: 'DRAFT',
      config: { test: true },
      approvedByOwner: false,
      notes: 'Integration test fallback pricing version',
    },
    select: { id: true },
  });
  return created.id;
}

async function createCustomer(): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      email: customerEmail,
      name: 'Capacity Test',
      phone: '+447700900000',
    },
    select: { id: true },
  });
  return customer.id;
}

async function tryCreateBooking(index: number, customerId: string, versionId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await assertSlotCapacity(tx, { moveDate, slot, now: new Date('2031-01-01T10:00:00.000Z') });
    const booking = await tx.booking.create({
      data: {
        reference: `${referencePrefix}${String(index).padStart(2, '0')}`,
        status: 'CONFIRMED',
        customerId,
        contactName: 'Capacity Test',
        contactEmail: customerEmail,
        contactPhone: '+447700900000',
        service: 'man-and-van',
        variant: 'standard',
        pickup: { postcode: 'G1 1AA' },
        pickupPostcode: 'G1 1AA',
        distanceMiles: 0,
        durationMinutes: 0,
        pricingInput: { test: true },
        accessDetail: { test: true },
        priceBreakdown: { test: true },
        pricingVersionId: versionId,
        moveDate,
        slot,
        totalPence: 1000,
        paidPence: 1000,
        capacityUnits: 1,
        blocksSlots: 1,
      },
      select: { id: true },
    });
    return booking.id;
  });
}

describe('@sv/db integration', () => {
  beforeAll(async () => {
    try {
      directDatabaseUrl();
    } catch {
      throw new Error('DATABASE_URL_UNPOOLED is required before @sv/db integration tests; run npm run db:migrate first.');
    }
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Booking'
      ) AS "exists"
    `;
    if (rows[0]?.exists !== true) {
      throw new Error('Database schema is missing; run npm run db:migrate before @sv/db integration tests.');
    }
    schemaReady = true;
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('supports interactive transactions', async () => {
    const rows = await prisma.$transaction(async (tx) => tx.$queryRaw<Array<{ ok: number }>>`SELECT 1::int AS ok`);
    expect(rows).toEqual([{ ok: 1 }]);
  });

  it('serialises concurrent slot booking with advisory locks', async () => {
    await prisma.capacityOverride.create({ data: { date: moveDate, slot, capacity: 1, reason: 'Integration test capacity' } });
    const customerId = await createCustomer();
    const versionId = await pricingVersionId();

    const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => tryCreateBooking(index, customerId, versionId)));
    const successes = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const failures = attempts.filter((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(9);
    expect(
      failures.every((failure) => {
        return failure.reason instanceof AppError && failure.reason.code === 'SLOT_UNAVAILABLE';
      }),
    ).toBe(true);
    await expect(prisma.booking.count({ where: { reference: { startsWith: referencePrefix } } })).resolves.toBe(1);
  }, 30_000);
});
