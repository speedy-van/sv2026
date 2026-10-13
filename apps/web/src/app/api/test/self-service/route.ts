import { AppError, addDays, fromDbDate, londonToday, toDbDate } from '@sv/contracts';
import { prisma, type Prisma } from '@sv/db';
import { computeQuote, priceForSlot, type PricingConfig, type PricingInput, type SlotKey } from '@sv/pricing';
import { randomInt } from 'node:crypto';
import { apiJson, withApi } from '@/server/request';
import { bookingPurposeLink, manageLinkForBooking, signCustomerLink } from '@/server/auth/customer-links';
import { getActivePricingConfig } from '@/server/services/catalogue';
import { payLinkForExtraCharge } from '@/server/services/customer-self-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function dateOnly(date: string): Date {
  return new Date(`${toDbDate(date)}T00:00:00.000Z`);
}

async function uniqueReference(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = '';
    for (let index = 0; index < 6; index += 1) code += CROCKFORD.charAt(randomInt(CROCKFORD.length));
    const reference = `SV-${code}`;
    const existing = await prisma.booking.findUnique({ where: { reference }, select: { id: true } });
    if (!existing) return reference;
  }
  throw new AppError('INTERNAL', 'Could not allocate a booking reference.');
}

const pickup = {
  label: '1 Buchanan Street, Glasgow, G1 3HL',
  lat: 55.861,
  line1: '1 Buchanan Street',
  lng: -4.253,
  postcode: 'G1 3HL',
  source: 'MANUAL',
  town: 'Glasgow',
} as const;

const dropoff = {
  label: '1 Princes Street, Edinburgh, EH2 2ER',
  lat: 55.952,
  line1: '1 Princes Street',
  lng: -3.189,
  postcode: 'EH2 2ER',
  source: 'MANUAL',
  town: 'Edinburgh',
} as const;

const pricingInput: PricingInput = {
  access: { carryMetres: 10, narrowAccess: false, permitZone: false },
  addons: { assembly: false, helpers: 0, packing: false },
  distanceMiles: 47.2,
  dropoff: { floor: 0, hasLift: false },
  inventory: [{ itemId: 'sofa', name: 'Sofa', quantity: 1, unitVolumeM3: 1.2 }],
  pickup: { floor: 0, hasLift: false },
  service: 'man-and-van',
  variant: 'standard',
};

async function seedSettingsAndCapacity(dates: string[]): Promise<void> {
  await prisma.setting.upsert({
    create: {
      key: 'cancellation',
      value: json({
        freeCancellationHours: 240,
        lateCancellationRefundPercent: 50,
        noRefundHours: 48,
        selfServiceRescheduleHours: 48,
      }),
    },
    update: {
      value: json({
        freeCancellationHours: 240,
        lateCancellationRefundPercent: 50,
        noRefundHours: 48,
        selfServiceRescheduleHours: 48,
      }),
    },
    where: { key: 'cancellation' },
  });
  for (const date of dates) {
    for (const slot of ['MORNING', 'AFTERNOON', 'EVENING'] as const) {
      await prisma.capacityOverride.upsert({
        create: { capacity: 20, date: dateOnly(date), reason: 'E2E self-service fixture', slot },
        update: { capacity: 20 },
        where: { date_slot: { date: dateOnly(date), slot } },
      });
    }
  }
}

async function seedDriver(): Promise<{ driverId: string; vanId: string }> {
  const user = await prisma.user.upsert({
    create: { email: 'self-service-driver@example.com', name: 'Sam Driver', role: 'DRIVER', status: 'ACTIVE' },
    update: { name: 'Sam Driver', role: 'DRIVER', status: 'ACTIVE' },
    where: { email: 'self-service-driver@example.com' },
  });
  const van = await prisma.van.upsert({
    create: { active: true, label: 'E2E Luton', registration: 'SV11E2E', sizeClass: 'LUTON' },
    update: { active: true, label: 'E2E Luton' },
    where: { registration: 'SV11E2E' },
  });
  await prisma.driverProfile.upsert({
    create: { defaultVanId: van.id, userId: user.id },
    update: { defaultVanId: van.id },
    where: { userId: user.id },
  });
  return { driverId: user.id, vanId: van.id };
}

async function createBooking(params: {
  completedAt?: Date;
  config: PricingConfig;
  date: string;
  driverId?: string;
  jobStage?: 'NOT_STARTED' | 'EN_ROUTE_TO_PICKUP' | 'COMPLETED';
  paid?: boolean;
  pricingVersionId: string;
  slot: SlotKey;
  status?: 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED';
  totalOverride?: number;
  vanId?: string;
}): Promise<{ contactEmail: string; id: string; moveDate: Date; reference: string }> {
  const reference = await uniqueReference();
  const email = `self-service+${reference.toLowerCase().replace('-', '')}@example.com`;
  const price = priceForSlot(pricingInput, params.config, londonToday(), params.date, params.slot).pricePence;
  const totalPence = params.totalOverride ?? price;
  const customer = await prisma.customer.upsert({
    create: { email, name: 'Self Service Customer', phone: '+447700900111' },
    update: { name: 'Self Service Customer', phone: '+447700900111' },
    where: { email },
  });
  const booking = await prisma.booking.create({
    data: {
      accessDetail: json({ dropoffAccess: null, pickupAccess: null }),
      blocksSlots: 1,
      capacityUnits: 1,
      ...(params.completedAt ? { completedAt: params.completedAt } : {}),
      contactEmail: email,
      contactName: 'Self Service Customer',
      contactPhone: '+447700900111',
      customerId: customer.id,
      dispatchStatus: params.driverId ? 'ACCEPTED' : 'UNASSIGNED',
      distanceMiles: pricingInput.distanceMiles,
      driverId: params.driverId ?? null,
      dropoff: json(dropoff),
      dropoffPostcode: dropoff.postcode,
      durationMinutes: 78,
      jobStage: params.jobStage ?? 'NOT_STARTED',
      moveDate: dateOnly(params.date),
      paidPence: params.paid === false ? 0 : totalPence,
      pickup: json(pickup),
      pickupPostcode: pickup.postcode,
      priceBreakdown: json({ e2e: true, pricePence: totalPence }),
      pricingInput: json(pricingInput),
      pricingVersionId: params.pricingVersionId,
      reference,
      service: pricingInput.service,
      slot: params.slot,
      status: params.status ?? 'CONFIRMED',
      totalPence,
      vanId: params.vanId ?? null,
      variant: pricingInput.variant,
      ...(params.paid === false
        ? {}
        : { payments: {
            create: {
              amountPence: totalPence,
              kind: 'BOOKING',
              status: 'SUCCEEDED',
              stripePaymentIntentId: `pi_mock_seed_${reference.replace('-', '').toLowerCase()}`,
            },
          } }),
    },
    select: { contactEmail: true, id: true, moveDate: true, reference: true },
  });
  return booking;
}

export async function GET(request: Request): Promise<Response> {
  return withApi(request, {}, async ({ requestId }) => {
    if (process.env.NODE_ENV === 'production' && process.env.E2E !== '1') {
      throw new AppError('FORBIDDEN', 'Self-service test fixture is disabled.');
    }
    const active = await getActivePricingConfig();
    const today = londonToday();
    const dates = {
      cancelFull: addDays(today, 14),
      cancelLate: addDays(today, 7),
      cancelNone: addDays(today, 1),
      current: addDays(today, 9),
      dearerNew: addDays(today, 11),
      cheaperNew: addDays(today, 12),
      completed: today,
      tracking: today,
    };
    await seedSettingsAndCapacity(Object.values(dates));
    const driver = await seedDriver();
    const currentPrice = priceForSlot(pricingInput, active.config, today, dates.current, 'MORNING').pricePence;
    const cheaper = await createBooking({
      config: active.config,
      date: dates.current,
      pricingVersionId: active.id,
      slot: 'MORNING',
      totalOverride: currentPrice + 4000,
    });
    const dearer = await createBooking({
      config: active.config,
      date: dates.current,
      pricingVersionId: active.id,
      slot: 'AFTERNOON',
      totalOverride: Math.max(1000, currentPrice - 4000),
    });
    const manage = await createBooking({ config: active.config, date: dates.current, pricingVersionId: active.id, slot: 'EVENING' });
    const cancelFull = await createBooking({ config: active.config, date: dates.cancelFull, pricingVersionId: active.id, slot: 'MORNING' });
    const cancelLate = await createBooking({ config: active.config, date: dates.cancelLate, pricingVersionId: active.id, slot: 'MORNING' });
    const cancelNone = await createBooking({ config: active.config, date: dates.cancelNone, pricingVersionId: active.id, slot: 'EVENING' });
    const tracking = await createBooking({
      config: active.config,
      date: dates.tracking,
      driverId: driver.driverId,
      jobStage: 'EN_ROUTE_TO_PICKUP',
      pricingVersionId: active.id,
      slot: 'AFTERNOON',
      status: 'IN_PROGRESS',
      vanId: driver.vanId,
    });
    const invalidated = await createBooking({ config: active.config, date: dates.current, pricingVersionId: active.id, slot: 'MORNING' });
    await prisma.driverLocation.create({
      data: {
        bookingId: tracking.id,
        driverId: driver.driverId,
        lat: 55.862,
        lng: -4.25,
        recordedAt: new Date(),
      },
    });
    const completed = await createBooking({
      completedAt: new Date(),
      config: active.config,
      date: dates.completed,
      driverId: driver.driverId,
      jobStage: 'COMPLETED',
      pricingVersionId: active.id,
      slot: 'MORNING',
      status: 'COMPLETED',
      vanId: driver.vanId,
    });
    const extra = await prisma.extraCharge.create({
      data: {
        amountPence: 1250,
        bookingId: manage.id,
        description: '2 extra wardrobes',
        requestedById: driver.driverId,
        status: 'AWAITING_PAYMENT',
      },
      include: { booking: { select: { contactEmail: true } } },
    });
    const paidExtra = await prisma.extraCharge.create({
      data: {
        amountPence: 500,
        bookingId: completed.id,
        description: 'Paid extra item',
        requestedById: driver.driverId,
        status: 'PAID',
      },
      include: { booking: { select: { contactEmail: true } } },
    });
    const [manageToken, futureTrackToken, invalidatedToken, cheaperToken, dearerToken, cancelFullToken, cancelLateToken, cancelNoneToken, trackToken, reviewToken, extraPayToken, paidPayToken] = await Promise.all([
      manageLinkForBooking(manage),
      bookingPurposeLink(manage, 'track', dateOnly(addDays(fromDbDate(manage.moveDate), 2))),
      manageLinkForBooking(invalidated),
      manageLinkForBooking(cheaper),
      manageLinkForBooking(dearer),
      manageLinkForBooking(cancelFull),
      manageLinkForBooking(cancelLate),
      manageLinkForBooking(cancelNone),
      bookingPurposeLink(tracking, 'track', dateOnly(addDays(fromDbDate(tracking.moveDate), 2))),
      bookingPurposeLink(completed, 'review', new Date(Date.now() + 60 * 86_400_000)),
      payLinkForExtraCharge(extra),
      payLinkForExtraCharge(paidExtra),
    ]);
    await prisma.booking.update({
      data: { contactEmail: `changed-${invalidated.contactEmail}` },
      where: { id: invalidated.id },
    });
    const expiredPayToken = await signCustomerLink({
      email: manage.contactEmail,
      expiresAt: new Date(Date.now() - 60_000),
      purpose: 'pay',
      subject: manage.id,
    });
    const quote = computeQuote(pricingInput, active.config, today);
    return apiJson({
      cancel: {
        fullUrl: `/manage/session?token=${encodeURIComponent(cancelFullToken)}`,
        lateUrl: `/manage/session?token=${encodeURIComponent(cancelLateToken)}`,
        noneUrl: `/manage/session?token=${encodeURIComponent(cancelNoneToken)}`,
      },
      find: { email: manage.contactEmail, reference: manage.reference },
      manageUrl: `/manage/session?token=${encodeURIComponent(manageToken)}`,
      invalidatedManageUrl: `/manage/session?token=${encodeURIComponent(invalidatedToken)}`,
      pay: {
        activeExtraUrl: `/pay/${encodeURIComponent(extraPayToken)}`,
        expiredUrl: `/pay/${encodeURIComponent(expiredPayToken)}`,
        paidUrl: `/pay/${encodeURIComponent(paidPayToken)}`,
      },
      reschedule: {
        cheaperDate: dates.cheaperNew,
        cheaperSlot: 'MORNING',
        cheaperUrl: `/manage/session?token=${encodeURIComponent(cheaperToken)}`,
        dearerDate: dates.dearerNew,
        dearerSlot: 'EVENING',
        dearerUrl: `/manage/session?token=${encodeURIComponent(dearerToken)}`,
      },
      reviewUrl: `/review/${encodeURIComponent(reviewToken)}`,
      futureTrackingUrl: `/track/${encodeURIComponent(futureTrackToken)}`,
      trackingUrl: `/track/${encodeURIComponent(trackToken)}`,
      quoteDays: quote.calendar.length,
    }, {}, requestId);
  });
}
