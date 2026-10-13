import { londonToday } from '@sv/contracts';
import { prisma, type Prisma } from '@sv/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleDriverRoute, type DriverMethod } from '../src/server/driver/routes';
import { requestStaffOtp, verifyStaffOtp, type StaffApp } from '../src/server/auth/staff';

const emailPrefix = 'phase14-';
const driverEmail = `${emailPrefix}driver@example.test`;
const otherDriverEmail = `${emailPrefix}other-driver@example.test`;
const ownerEmail = `${emailPrefix}owner@example.test`;
const customerEmail = `${emailPrefix}customer@example.test`;
const referencePrefix = 'SV-P14';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function sampleAddress(label: string): Prisma.InputJsonValue {
  return json({
    label,
    lat: 55.861,
    line1: label,
    lng: -4.25,
    postcode: 'G2 1DU',
    source: 'MANUAL',
    town: 'Glasgow',
  });
}

async function activePricingVersionId(): Promise<string> {
  const version = await prisma.pricingConfigVersion.findFirst({
    orderBy: { version: 'desc' },
    select: { id: true },
    where: { status: 'ACTIVE' },
  });
  if (!version) throw new Error('Missing active pricing version');
  return version.id;
}

function device(deviceId: string) {
  return {
    appVersion: '1.0.0',
    deviceId,
    deviceName: 'Vitest',
    platform: 'ios' as const,
  };
}

async function latestOtpCode(email: string, app: StaffApp): Promise<string> {
  const event = await prisma.outboxEvent.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
    where: { dedupeKey: { startsWith: `staff-login-code:${email}:${app}:` } },
  });
  const payload = event?.payload;
  if (!payload || typeof payload !== 'object' || !('data' in payload)) throw new Error('Missing OTP payload.');
  const data = payload.data;
  if (!data || typeof data !== 'object' || !('signInCode' in data) || typeof data.signInCode !== 'string') {
    throw new Error('Missing OTP code.');
  }
  return data.signInCode;
}

async function tokenFor(email: string, app: StaffApp, deviceId: string): Promise<string> {
  await requestStaffOtp({ app, email });
  const code = await latestOtpCode(email, app);
  const response = await verifyStaffOtp({ app, code, device: device(deviceId), email });
  return response.accessToken;
}

function requestFor(method: DriverMethod, path: string, token: string, body?: unknown): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    'x-request-id': `req_phase14_${method.toLowerCase()}_${path.replace(/[^a-z0-9]/gi, '_')}`,
    'x-sv-app': 'driver@1.0.0',
    authorization: `Bearer ${token}`,
  });
  const init: RequestInit = { headers, method };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost/api/v1/driver/${path}`, init);
}

async function callDriver(method: DriverMethod, path: string, token: string, body?: unknown): Promise<Response> {
  return handleDriverRoute(requestFor(method, path, token, body), method, path);
}

async function cleanup(): Promise<void> {
  await prisma.driverLocation.deleteMany({
    where: {
      OR: [
        { booking: { reference: { startsWith: referencePrefix } } },
        { driver: { user: { email: { startsWith: emailPrefix } } } },
      ],
    },
  });
  await prisma.jobPhoto.deleteMany({ where: { booking: { reference: { startsWith: referencePrefix } } } });
  await prisma.signature.deleteMany({ where: { booking: { reference: { startsWith: referencePrefix } } } });
  await prisma.extraCharge.deleteMany({ where: { booking: { reference: { startsWith: referencePrefix } } } });
  await prisma.jobEvent.deleteMany({ where: { booking: { reference: { startsWith: referencePrefix } } } });
  await prisma.driverEarning.deleteMany({ where: { booking: { reference: { startsWith: referencePrefix } } } });
  await prisma.assignment.deleteMany({
    where: {
      OR: [
        { booking: { reference: { startsWith: referencePrefix } } },
        { driver: { user: { email: { startsWith: emailPrefix } } } },
      ],
    },
  });
  await prisma.booking.deleteMany({ where: { reference: { startsWith: referencePrefix } } });
  await prisma.customer.deleteMany({ where: { email: { startsWith: emailPrefix } } });
  await prisma.driverUnavailability.deleteMany({ where: { driver: { user: { email: { startsWith: emailPrefix } } } } });
  await prisma.driverProfile.deleteMany({ where: { user: { email: { startsWith: emailPrefix } } } });
  await prisma.pushDevice.deleteMany({ where: { user: { email: { startsWith: emailPrefix } } } });
  await prisma.session.deleteMany({ where: { user: { email: { startsWith: emailPrefix } } } });
  await prisma.authOtp.deleteMany({ where: { email: { startsWith: emailPrefix } } });
  await prisma.outboxEvent.deleteMany({ where: { dedupeKey: { startsWith: `staff-login-code:${emailPrefix}` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } });
}

async function seedUser(email: string, role: 'DRIVER' | 'OWNER'): Promise<string> {
  const user = await prisma.user.create({
    data: { email, name: `Phase 14 ${role}`, role, status: 'ACTIVE' },
    select: { id: true },
  });
  if (role === 'DRIVER') {
    await prisma.driverProfile.create({ data: { payoutPercent: 40, userId: user.id } });
  }
  return user.id;
}

async function seedBooking(reference: string, driverId: string, overrides: Partial<Prisma.BookingCreateInput> = {}) {
  const customer = await prisma.customer.upsert({
    create: { email: customerEmail, name: 'Phase 14 Customer', phone: '+447700900140' },
    update: {},
    where: { email: customerEmail },
  });
  return prisma.booking.create({
    data: {
      accessDetail: json({ pickup: { carryMetres: 0, floorChoice: 'GROUND', hasLift: false, narrowAccess: false, permitZone: false } }),
      blocksSlots: 1,
      capacityUnits: 1,
      contactEmail: customer.email,
      contactName: customer.name,
      contactPhone: customer.phone,
      customer: { connect: { id: customer.id } },
      dispatchStatus: 'ACCEPTED',
      distanceMiles: 12,
      driver: { connect: { userId: driverId } },
      dropoff: sampleAddress('2 Driver Dropoff Street'),
      dropoffPostcode: 'G2 2DU',
      durationMinutes: 45,
      jobStage: 'NOT_STARTED',
      moveDate: dateOnly(londonToday()),
      pickup: sampleAddress('1 Driver Pickup Street'),
      pickupPostcode: 'G2 1DU',
      priceBreakdown: json({ items: [{ label: 'Sofa', quantity: 1 }] }),
      pricingInput: json({}),
      pricingVersion: { connect: { id: await activePricingVersionId() } },
      reference,
      service: 'man-and-van',
      slot: 'MORNING',
      status: 'CONFIRMED',
      totalPence: 10000,
      variant: 'standard',
      ...overrides,
    },
    select: { id: true, reference: true },
  });
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'phase14-test-jwt-access-secret';
  process.env.OTP_PEPPER = 'phase14-test-otp-pepper';
  process.env.MIN_DRIVER_APP_VERSION = '1.0.0';
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Phase 14 driver API', () => {
  it('prevents one driver from reading or syncing another driver job', async () => {
    const driverId = await seedUser(driverEmail, 'DRIVER');
    const otherDriverId = await seedUser(otherDriverEmail, 'DRIVER');
    await seedUser(ownerEmail, 'OWNER');
    const otherBooking = await seedBooking(`${referencePrefix}OTH`, otherDriverId);
    const token = await tokenFor(driverEmail, 'driver', 'phase14-driver-device-1');

    const getResponse = await callDriver('GET', `jobs/${otherBooking.id}`, token);
    expect(getResponse.status).toBe(404);

    const eventId = randomUUID();
    const syncResponse = await callDriver('POST', 'sync', token, {
      events: [
        {
          bookingId: otherBooking.id,
          clientEventId: eventId,
          occurredAt: new Date().toISOString(),
          toStage: 'EN_ROUTE_TO_PICKUP',
          type: 'STAGE',
        },
      ],
    });
    expect(syncResponse.status).toBe(200);
    expect(await syncResponse.json()).toEqual({ events: [{ clientEventId: eventId, error: 'NOT_FOUND', result: 'REJECTED' }] });

    const ownJobs = await callDriver('GET', 'jobs', token);
    expect(ownJobs.status).toBe(200);
    expect(driverId).not.toBe(otherDriverId);
  });

  it('applies a stage sync once and treats repeated client events as duplicates', async () => {
    const driverId = await seedUser(`${emailPrefix}sync-driver@example.test`, 'DRIVER');
    const booking = await seedBooking(`${referencePrefix}SYN`, driverId);
    const token = await tokenFor(`${emailPrefix}sync-driver@example.test`, 'driver', 'phase14-driver-device-2');
    const clientEventId = randomUUID();
    const body = {
      events: [
        {
          bookingId: booking.id,
          clientEventId,
          occurredAt: new Date().toISOString(),
          toStage: 'EN_ROUTE_TO_PICKUP',
          type: 'STAGE',
        },
      ],
    };

    const first = await callDriver('POST', 'sync', token, body);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ events: [{ clientEventId, result: 'APPLIED' }] });

    const second = await callDriver('POST', 'sync', token, body);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ events: [{ clientEventId, result: 'DUPLICATE' }] });

    const [stored, bookingAfter] = await Promise.all([
      prisma.jobEvent.count({ where: { clientEventId } }),
      prisma.booking.findUniqueOrThrow({ select: { jobStage: true, status: true }, where: { id: booking.id } }),
    ]);
    expect(stored).toBe(1);
    expect(bookingAfter).toMatchObject({ jobStage: 'EN_ROUTE_TO_PICKUP', status: 'IN_PROGRESS' });
  });

  it('rejects invalid driver stage jumps with a stable error code', async () => {
    const driverId = await seedUser(`${emailPrefix}jump-driver@example.test`, 'DRIVER');
    const booking = await seedBooking(`${referencePrefix}JMP`, driverId);
    const token = await tokenFor(`${emailPrefix}jump-driver@example.test`, 'driver', 'phase14-driver-device-3');
    const clientEventId = randomUUID();
    const response = await callDriver('POST', 'sync', token, {
      events: [
        {
          bookingId: booking.id,
          clientEventId,
          occurredAt: new Date().toISOString(),
          toStage: 'COMPLETED',
          type: 'STAGE',
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [{ clientEventId, error: 'INVALID_TRANSITION', result: 'REJECTED' }] });
    await expect(prisma.jobEvent.findUnique({ where: { clientEventId } })).resolves.toBeNull();
  });
});
