import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  construct: vi.fn(), handle: vi.fn(), after: vi.fn<(callback: () => Promise<void>) => void>(), dispatch: vi.fn(),
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('../src/server/integrations/stripe', () => ({ constructStripeEvent: mocks.construct }));
vi.mock('../src/server/services/stripe-webhook', () => ({ handleStripeEvent: mocks.handle }));
vi.mock('../src/server/outbox/dispatch', () => ({ dispatchPendingOutbox: mocks.dispatch }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: vi.fn() }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
import { POST } from '../src/app/api/webhooks/stripe/route';
const request = () =>
  new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'unit-signature' },
    body: 'signed-unit-event',
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.construct.mockReturnValue({ id: 'evt_unit', type: 'payment_intent.succeeded', data: { object: { id: 'pi_unit' } } });
  mocks.handle.mockResolvedValue('processed');
});
describe('payment webhook notification dispatch scheduling', () => {
  it.each(['processed', 'replay'])(
    'schedules background delivery only after a validated committed %s webhook',
    async (result) => {
      mocks.handle.mockResolvedValue(result);
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(mocks.construct).toHaveBeenCalledWith('signed-unit-event', 'unit-signature');
      expect(mocks.dispatch).not.toHaveBeenCalled();
      const callback = mocks.after.mock.calls[0]?.[0];
      if (!callback) throw new Error('Expected a scheduled dispatcher.');
      await callback();
      expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith('pi_unit');
    },
  );
  it('does not schedule notification delivery on a failed/cancelled payment', async () => {
    mocks.construct.mockReturnValue({ id: 'evt_unit', type: 'payment_intent.canceled' });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it('rejects invalid signatures without processing money or scheduling side effects', async () => {
    mocks.construct.mockImplementation(() => {
      throw new AppError('VALIDATION_ERROR', 'Invalid signature');
    });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.handle).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it('preserves a failing webhook response and does not schedule delivery', async () => {
    mocks.handle.mockRejectedValue(new Error('Unit transaction failed'));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
