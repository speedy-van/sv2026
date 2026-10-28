import { AppError } from '@sv/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ after: vi.fn(), batch: vi.fn(), create: vi.fn() }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('../src/server/services/booking', () => ({ createBookingFromQuote: mocks.create }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxBatch: mocks.batch }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: vi.fn() }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn() }));

import { POST } from '../src/app/api/v1/bookings/route';

const bookingInput = {
  quotePublicId: 'quote_unit',
  date: '2026-10-20',
  slot: 'MORNING',
  expectedTotalPence: 12000,
  idempotencyKey: 'd51d9e06-87c6-4b73-b69c-fc6792dc7370',
  contact: { name: 'Unit Customer', email: 'customer@example.test', phone: '07700900000' },
  marketingOptIn: false,
  termsAccepted: true,
  startWithinCancellationPeriodAck: false,
};

function request(input: unknown = bookingInput): Request {
  return new Request('http://localhost/api/v1/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({ reference: 'SV-UNIT01' });
});
afterEach(() => vi.unstubAllEnvs());

describe('unpaid checkout isolation from historical outbox work', () => {
  it.each(['production', 'development', 'test'])('never starts unrelated delivery in %s', async (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ reference: 'SV-UNIT01' });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(bookingInput);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('does not create a booking or run delivery after an invalid request', async () => {
    expect((await POST(request({}))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('preserves a rejected booking response without running delivery', async () => {
    mocks.create.mockRejectedValue(new AppError('SLOT_UNAVAILABLE', 'Please choose another slot.'));
    expect((await POST(request())).status).toBe(409);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });
});
