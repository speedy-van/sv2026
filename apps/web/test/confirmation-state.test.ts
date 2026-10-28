import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canRefreshCheckout,
  confirmationPollDurationMs,
  confirmationState,
  shouldPollConfirmation,
  type BookingStatusResponse,
} from '../src/components/booking-flow/confirmation-state';

type Checkout = NonNullable<BookingStatusResponse['checkout']>;

const now = new Date('2031-03-01T12:00:00.000Z');
const futureHold = '2031-03-01T12:15:00.000Z';
const elapsedHold = '2031-03-01T11:59:59.999Z';

function booking({
  status = 'PENDING_PAYMENT',
  paymentStatus = 'REQUIRES_PAYMENT',
  holdExpiresAt = futureHold,
  canRetry = true,
}: {
  status?: BookingStatusResponse['status'];
  paymentStatus?: Checkout['paymentStatus'];
  holdExpiresAt?: Checkout['holdExpiresAt'];
  canRetry?: boolean;
} = {}): BookingStatusResponse {
  return {
    status,
    reference: status === 'CONFIRMED' ? 'SV-TEST123' : null,
    summary: null,
    checkout: { paymentStatus, holdExpiresAt, canRetry },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('confirmation relies on server payment evidence', () => {
  it.each([null, 'succeeded', 'processing', 'success', 'unexpected']) (
    'does not establish payment receipt from redirect_status=%s',
    (redirectStatus) => {
      const data = booking();
      expect(confirmationState({ data, redirectStatus, timedOut: false })).toBe('checking');
      expect(confirmationState({ data, redirectStatus, timedOut: true })).toBe('pending');
    },
  );

  it('keeps a legacy response without checkout evidence unconfirmed', () => {
    const data: BookingStatusResponse = { status: 'PENDING_PAYMENT', reference: null, summary: null };
    expect(confirmationState({ data, redirectStatus: 'succeeded', timedOut: false })).toBe('checking');
    expect(confirmationState({ data, redirectStatus: 'succeeded', timedOut: true })).toBe('pending');
  });

  it('honours a confirmed booking despite a failed redirect and stale canceled checkout', () => {
    const data = booking({ status: 'CONFIRMED', paymentStatus: 'CANCELED', holdExpiresAt: elapsedHold });
    expect(confirmationState({ data, redirectStatus: 'failed', timedOut: true })).toBe('confirmed');
  });

  it.each([
    ['failed', 'failed'],
    ['canceled', 'canceled'],
    ['cancelled', 'canceled'],
  ] as const)('describes an unfinished attempt from %s without claiming receipt', (redirectStatus, expected) => {
    expect(confirmationState({ data: booking(), redirectStatus, timedOut: false })).toBe(expected);
  });

  it('shows the server failure even when the redirect claims success', () => {
    expect(confirmationState({
      data: booking({ paymentStatus: 'FAILED' }),
      redirectStatus: 'succeeded',
      timedOut: false,
    })).toBe('failed');
  });

  it('shows a server-canceled payment even when the redirect describes another failure', () => {
    expect(confirmationState({
      data: booking({ paymentStatus: 'CANCELED' }),
      redirectStatus: 'failed',
      timedOut: true,
    })).toBe('canceled');
  });

  it.each([
    ['PROCESSING', 'processing'],
    ['SUCCEEDED', 'received'],
  ] as const)('keeps server payment %s distinct from retryable or expired checkout states', (paymentStatus, expected) => {
    // A stale retry flag or elapsed hold must never invite a second payment.
    const data = booking({ paymentStatus, holdExpiresAt: elapsedHold, canRetry: true });
    for (const redirectStatus of [null, 'failed', 'canceled', 'succeeded']) {
      expect(confirmationState({ data, redirectStatus, timedOut: true })).toBe(expected);
    }
  });
});

describe('fresh checkout requires server closure of the previous payment attempt', () => {
  it.each(['REQUIRES_PAYMENT', 'FAILED'] as const)(
    'does not issue a fresh key for elapsed but still pending payment %s',
    (paymentStatus) => {
      const data = booking({ paymentStatus, holdExpiresAt: elapsedHold });
      expect(canRefreshCheckout(data)).toBe(false);
      vi.setSystemTime(new Date('2031-03-02T12:00:00.000Z'));
      expect(canRefreshCheckout(data)).toBe(false);
    },
  );

  it.each([null, 'REQUIRES_PAYMENT', 'FAILED', 'CANCELED'] as const)(
    'allows a new checkout when the server expired an unpaid booking/payment %s',
    (paymentStatus) => {
      expect(canRefreshCheckout(booking({ status: 'EXPIRED', paymentStatus }))).toBe(true);
    },
  );

  it.each(['PROCESSING', 'SUCCEEDED'] as const)(
    'never authorizes a new payment while server payment %s is in flight or received',
    (paymentStatus) => {
      for (const status of ['PENDING_PAYMENT', 'EXPIRED', 'CONFIRMED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED'] as const) {
        expect(canRefreshCheckout(booking({ status, paymentStatus, holdExpiresAt: elapsedHold })), status).toBe(false);
      }
    },
  );

  it.each([futureHold, elapsedHold])(
    'allows a fresh checkout after server payment cancellation regardless of hold %s',
    (holdExpiresAt) => {
      expect(canRefreshCheckout(booking({ paymentStatus: 'CANCELED', holdExpiresAt }))).toBe(true);
    },
  );

  it.each(['CONFIRMED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED'] as const)(
    'does not reopen terminal booking %s even with a canceled payment record',
    (status) => {
      expect(canRefreshCheckout(booking({ status, paymentStatus: 'CANCELED' }))).toBe(false);
    },
  );

  it('does not infer payment cancellation from a pending legacy response', () => {
    const data: BookingStatusResponse = { status: 'PENDING_PAYMENT', reference: null, summary: null };
    expect(canRefreshCheckout(data)).toBe(false);
  });
});

describe('checkout expiry and terminal booking safety', () => {
  it.each([
    [elapsedHold, 'expired'],
    [now.toISOString(), 'expired'],
    ['2031-03-01T12:00:00.001Z', 'checking'],
  ] as const)('evaluates the hold boundary %s using the current clock', (holdExpiresAt, expected) => {
    expect(confirmationState({ data: booking({ holdExpiresAt }), redirectStatus: null, timedOut: false })).toBe(expected);
  });

  it('does not invent an expiry when the server has supplied no hold timestamp', () => {
    expect(confirmationState({
      data: booking({ paymentStatus: null, holdExpiresAt: null }),
      redirectStatus: null,
      timedOut: true,
    })).toBe('pending');
  });

  it('honours server expiry even if a cached checkout still has a future hold', () => {
    expect(confirmationState({ data: booking({ status: 'EXPIRED' }), redirectStatus: null, timedOut: false })).toBe('expired');
  });

  it.each(['PROCESSING', 'SUCCEEDED'] as const)(
    'does not offer the expired/new-payment state when an expired booking has payment %s',
    (paymentStatus) => {
      const data = booking({ status: 'EXPIRED', paymentStatus, holdExpiresAt: elapsedHold, canRetry: true });
      expect(confirmationState({ data, redirectStatus: 'failed', timedOut: true })).toBe('unavailable');
    },
  );

  it('never reopens payment for a canceled booking with a stale retry flag', () => {
    const data = booking({ status: 'CANCELLED', canRetry: true });
    expect(confirmationState({ data, redirectStatus: 'succeeded', timedOut: true })).toBe('unavailable');
  });
});

describe('bounded confirmation polling', () => {
  it('checks an unanswered request only while its polling window remains open', () => {
    expect(shouldPollConfirmation(undefined, false)).toBe(true);
    expect(shouldPollConfirmation(undefined, true)).toBe(false);
  });

  it.each([null, 'REQUIRES_PAYMENT', 'FAILED', 'PROCESSING', 'SUCCEEDED'] as const)(
    'continues checking pending booking/payment %s until the bounded deadline',
    (paymentStatus) => {
      const data = booking({ paymentStatus });
      expect(shouldPollConfirmation(data, false)).toBe(true);
      expect(shouldPollConfirmation(data, true)).toBe(false);
    },
  );

  it('can recheck an older pending response that has no checkout data', () => {
    const data: BookingStatusResponse = { status: 'PENDING_PAYMENT', reference: null, summary: null };
    expect(shouldPollConfirmation(data, false)).toBe(true);
  });

  it('stops when the server has canceled the payment', () => {
    expect(shouldPollConfirmation(booking({ paymentStatus: 'CANCELED' }), false)).toBe(false);
  });

  it.each(['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED'] as const)(
    'does not poll a booking that has left checkout: %s',
    (status) => {
      expect(shouldPollConfirmation(booking({ status }), false)).toBe(false);
    },
  );

  it('allows a pending check just before 30 seconds and stops at the deadline', () => {
    let timedOut = false;
    const data = booking({ paymentStatus: 'PROCESSING' });
    const timer = setTimeout(() => { timedOut = true; }, confirmationPollDurationMs);

    vi.advanceTimersByTime(29_999);
    expect(shouldPollConfirmation(data, timedOut)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(shouldPollConfirmation(data, timedOut)).toBe(false);

    clearTimeout(timer);
  });
});
