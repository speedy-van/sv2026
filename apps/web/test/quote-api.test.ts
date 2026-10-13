import { QuoteStreamEventSchema } from '@sv/contracts';
import { prisma } from '@sv/db';
import type { Prisma } from '@sv/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { POST as postQuote } from '../src/app/api/v1/quotes/route';
import { createQuote, type QuoteRequest } from '../src/server/services/quote';

type QuoteStreamEvent = z.infer<typeof QuoteStreamEventSchema>;

const createdQuoteIds: string[] = [];
const createdBookingRefs: string[] = [];
const createdCustomerEmails: string[] = [];
const overrideDates = ['2031-02-03'];

const pickupAccess: QuoteRequest['pickupAccess'] = {
  carryMetres: 10,
  floorChoice: 'GROUND',
  hasLift: false,
  narrowAccess: false,
  permitZone: false,
};

const glasgow: QuoteRequest['pickup'] = {
  label: '1 George Square, Glasgow G2 1DU',
  lat: 55.861,
  line1: '1 George Square',
  lng: -4.25,
  mapboxId: 'mock:glasgow',
  postcode: 'G2 1DU',
  source: 'MAPBOX',
  town: 'Glasgow',
};

const edinburgh: QuoteRequest['pickup'] = {
  label: '1 Princes Street, Edinburgh EH1 1BB',
  lat: 55.953,
  line1: '1 Princes Street',
  lng: -3.189,
  mapboxId: 'mock:edinburgh',
  postcode: 'EH1 1BB',
  source: 'MAPBOX',
  town: 'Edinburgh',
};

const bute: QuoteRequest['pickup'] = {
  label: '1 Ferry Road, Rothesay PA20 0AA',
  lat: 55.837,
  line1: '1 Ferry Road',
  lng: -5.055,
  mapboxId: 'mock:bute',
  postcode: 'PA20 0AA',
  source: 'MAPBOX',
  town: 'Rothesay',
};

const london: QuoteRequest['pickup'] = {
  label: '10 Downing Street, London SW1A 2AA',
  lat: 51.503,
  line1: '10 Downing Street',
  lng: -0.127,
  mapboxId: 'mock:london',
  postcode: 'SW1A 2AA',
  source: 'MAPBOX',
  town: 'London',
};

function quoteRequest(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return {
    addons: { assembly: false, helpers: 0, packing: false },
    dropoff: edinburgh,
    dropoffAccess: pickupAccess,
    items: [{ itemSlug: 'sofa-2-seater', kind: 'catalogue', quantity: 1 }],
    pickup: glasgow,
    pickupAccess,
    service: 'man-and-van',
    variant: 'standard',
    ...overrides,
  };
}

function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function activePricingVersionId(): Promise<string> {
  const version = await prisma.pricingConfigVersion.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { version: 'desc' },
    select: { id: true },
  });
  if (!version) throw new Error('Missing active pricing version');
  return version.id;
}

async function seedFullMorningSlot(): Promise<void> {
  const email = 'phase6-full-slot@example.test';
  const reference = 'SV-TSTF01';
  createdCustomerEmails.push(email);
  createdBookingRefs.push(reference);
  await prisma.capacityOverride.upsert({
    create: { capacity: 1, date: dateOnly('2031-02-03'), reason: 'Phase 6 full-slot test', slot: 'MORNING' },
    update: { capacity: 1, reason: 'Phase 6 full-slot test' },
    where: { date_slot: { date: dateOnly('2031-02-03'), slot: 'MORNING' } },
  });
  const customer = await prisma.customer.upsert({
    create: { email, name: 'Phase 6 Test', phone: '+447700900000' },
    update: { name: 'Phase 6 Test', phone: '+447700900000' },
    where: { email },
  });
  await prisma.booking.upsert({
    create: {
      accessDetail: json({ dropoff: pickupAccess, pickup: pickupAccess }),
      blocksSlots: 1,
      capacityUnits: 1,
      contactEmail: email,
      contactName: 'Phase 6 Test',
      contactPhone: '+447700900000',
      customerId: customer.id,
      distanceMiles: 47.3,
      dropoff: json(edinburgh),
      dropoffPostcode: edinburgh.postcode,
      durationMinutes: 69,
      moveDate: dateOnly('2031-02-03'),
      pickup: json(glasgow),
      pickupPostcode: glasgow.postcode,
      priceBreakdown: json({}),
      pricingInput: json({}),
      pricingVersionId: await activePricingVersionId(),
      reference,
      service: 'man-and-van',
      slot: 'MORNING',
      status: 'CONFIRMED',
      totalPence: 1000,
      variant: 'standard',
    },
    update: { status: 'CONFIRMED' },
    where: { reference },
  });
}

beforeAll(async () => {
  process.env.MAPBOX_MODE = 'mock';
  await seedFullMorningSlot();
});

afterAll(async () => {
  await prisma.manualQuote.deleteMany({ where: { quote: { publicId: { in: createdQuoteIds } } } });
  await prisma.booking.deleteMany({ where: { reference: { in: createdBookingRefs } } });
  await prisma.quote.deleteMany({ where: { publicId: { in: createdQuoteIds } } });
  for (const date of overrideDates) {
    await prisma.capacityOverride.deleteMany({ where: { date: dateOnly(date), reason: 'Phase 6 full-slot test' } });
  }
  await prisma.customer.deleteMany({ where: { email: { in: createdCustomerEmails } } });
  await prisma.$disconnect();
});

describe('Phase 6 quote API', () => {
  it('routes ferry moves to a manual quote reason', async () => {
    const result = await createQuote(quoteRequest({ dropoff: glasgow, pickup: bute }));
    createdQuoteIds.push(result.quote.publicId);
    expect(result.manualReasons).toContain('FERRY_ROUTE');
  });

  it('rejects routes outside Scotland', async () => {
    await expect(createQuote(quoteRequest({ dropoff: london, pickup: london }))).rejects.toMatchObject({
      code: 'OUTSIDE_SERVICE_AREA',
    });
  });

  it('marks a full slot unavailable', async () => {
    const result = await createQuote(quoteRequest(), { now: new Date('2031-02-03T00:00:00.000Z') });
    createdQuoteIds.push(result.quote.publicId);
    const morning = result.quote.calendar[0]?.slots.find((slot) => slot.slot === 'MORNING');
    expect(morning).toMatchObject({ available: false, reason: 'FULL' });
  });

  it('streams quote events in documented order', async () => {
    const response = await postQuote(new Request('http://localhost/api/v1/quotes', {
      body: JSON.stringify(quoteRequest()),
      headers: {
        accept: 'application/x-ndjson',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.42',
      },
      method: 'POST',
    }));
    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line): QuoteStreamEvent => QuoteStreamEventSchema.parse(JSON.parse(line)));
    expect(events.map((event) => event.type)).toEqual(['accepted', 'route', 'availability', 'prices', 'done']);
    const done = events.find((event) => event.type === 'done');
    if (done?.type === 'done') createdQuoteIds.push(done.quote.publicId);
  });
});
