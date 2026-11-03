import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Pricing from '@sv/pricing';
import { legalCopy } from '../src/content/legal';

const mocks = vi.hoisted(() => ({
  findBooking: vi.fn(),
  getSetting: vi.fn(),
  getActivePricingConfig: vi.fn(),
  priceForSlot: vi.fn(),
  transaction: vi.fn(),
  createIntent: vi.fn(),
  enqueue: vi.fn(),
  refund: vi.fn(),
  verifyLink: vi.fn(),
}));

vi.mock('@sv/db', () => ({
  assertSlotCapacity: vi.fn(),
  enqueueOutbox: mocks.enqueue,
  Prisma: {},
  prisma: { booking: { findUniqueOrThrow: mocks.findBooking }, extraCharge: { findFirst: vi.fn() }, refund: { findFirst: vi.fn() }, $transaction: mocks.transaction },
}));
vi.mock('@sv/pricing', async (importOriginal) => ({
  ...await importOriginal<typeof Pricing>(),
  priceForSlot: mocks.priceForSlot,
}));
vi.mock('../src/server/integrations/stripe', () => ({ createOrRetrievePaymentIntent: mocks.createIntent }));
vi.mock('../src/server/settings', () => ({ getOperationsSettings: vi.fn(), getSetting: mocks.getSetting }));
vi.mock('../src/server/services/catalogue', () => ({ getActivePricingConfig: mocks.getActivePricingConfig }));
vi.mock('../src/server/services/payments', () => ({ requestRefund: mocks.refund }));
vi.mock('../src/server/auth/customer-links', () => ({
  bookingPurposeLink: vi.fn(),
  contactEmailHash: vi.fn(),
  manageLinkForBooking: vi.fn(),
  signCustomerLink: vi.fn(),
  verifyBookingLink: mocks.verifyLink,
  verifyCustomerLink: vi.fn(),
}));

import { applyReschedule, previewReschedule } from '../src/server/services/customer-self-service';

const booking = {
  jobStage: 'NOT_STARTED',
  moveDate: new Date('2031-01-03T00:00:00.000Z'),
  pricingInput: {},
  slot: 'MORNING',
  status: 'CONFIRMED',
  totalPence: 10000,
};
const input = { date: '2031-01-04', slot: 'MORNING' as const };
const moveStart = Date.parse('2031-01-03T08:00:00.000Z');

function assertNoMutationOrProviderCall(): void {
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.createIntent).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.refund).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findBooking.mockResolvedValue(booking);
  mocks.verifyLink.mockResolvedValue({ bookingId: 'booking-test' });
  mocks.getSetting.mockResolvedValue({ selfServiceRescheduleHours: null });
  mocks.getActivePricingConfig.mockResolvedValue({ config: {} });
  mocks.priceForSlot.mockReturnValue({ pricePence: 10000 });
});

describe('customer rescheduling uses only the configured deadline', () => {
  it.each(['preview', 'apply'] as const)(
    'blocks %s with an unconfigured deadline before pricing, writes, or payments',
    async (operation) => {
      const now = new Date('2031-01-01T00:00:00.000Z');
      const result = operation === 'preview'
        ? previewReschedule('signed-test-token', input, now)
        : applyReschedule('signed-test-token', {
            ...input,
            expectedDifferencePence: 0,
            idempotencyKey: 'reschedule-test',
          }, now);
      await expect(result).rejects.toMatchObject({ code: 'CONFLICT', message: legalCopy.reschedulePending });
      expect(mocks.getActivePricingConfig).not.toHaveBeenCalled();
      expect(mocks.priceForSlot).not.toHaveBeenCalled();
      assertNoMutationOrProviderCall();
    },
  );

  it.each([
    [0, -1, true],
    [0, 0, true],
    [0, 1, false],
    [48, -1, true],
    [48, 0, true],
    [48, 1, false],
  ] as const)('preserves a %i-hour deadline at offset %i ms (allowed=%s)', async (hours, offset, allowed) => {
    mocks.getSetting.mockResolvedValue({ selfServiceRescheduleHours: hours });
    const now = new Date(moveStart - hours * 3_600_000 + offset);
    const result = previewReschedule('signed-test-token', input, now);
    if (allowed) {
      await expect(result).resolves.toEqual({ currentTotalPence: 10000, differencePence: 0, newTotalPence: 10000 });
      expect(mocks.priceForSlot).toHaveBeenCalledOnce();
    } else {
      await expect(result).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(mocks.priceForSlot).not.toHaveBeenCalled();
    }
    assertNoMutationOrProviderCall();
  });

  it.each([
    ['CONFIRMED', 'EN_ROUTE_TO_PICKUP'],
    ['IN_PROGRESS', 'NOT_STARTED'],
    ['COMPLETED', 'NOT_STARTED'],
    ['CANCELLED', 'NOT_STARTED'],
    ['PENDING_PAYMENT', 'NOT_STARTED'],
  ])('preserves the status/stage restriction for %s / %s', async (status, jobStage) => {
    mocks.getSetting.mockResolvedValue({ selfServiceRescheduleHours: 0 });
    mocks.findBooking.mockResolvedValue({ ...booking, status, jobStage });
    await expect(previewReschedule('signed-test-token', input, new Date(moveStart - 1))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.priceForSlot).not.toHaveBeenCalled();
    assertNoMutationOrProviderCall();
  });
});
