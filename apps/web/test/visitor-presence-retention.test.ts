import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prune: vi.fn(), bookingCount: vi.fn(), webhook: vi.fn(), ticketCount: vi.fn(), outboxCreate: vi.fn() }));
vi.mock('@sv/db', () => ({ enqueueOutbox: vi.fn(), prisma: {
  booking: { count: mocks.bookingCount }, stripeEvent: { findFirst: mocks.webhook },
  pushTicket: { count: mocks.ticketCount }, outboxEvent: { create: mocks.outboxCreate },
} }));
vi.mock('../src/server/visitor-presence', () => ({ pruneVisitorPresence: mocks.prune }));
vi.mock('../src/server/settings', () => ({ getSetting: vi.fn() }));

import { runHourlyCron } from '../src/server/cron-jobs';

describe('presence physical cleanup uses the existing scheduled cron', () => {
  it('prunes stale anonymous records during the hourly run even when no heartbeat arrives', async () => {
    const now = new Date('2031-03-01T12:00:00.000Z');
    mocks.prune.mockResolvedValue(3);
    mocks.bookingCount.mockResolvedValue(0);
    mocks.webhook.mockResolvedValue(null);
    mocks.ticketCount.mockResolvedValue(0);
    const result = await runHourlyCron(now);
    expect(mocks.prune).toHaveBeenCalledExactlyOnceWith(now);
    expect(result.visitorPresenceDeleted).toBe(3);
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });
});
