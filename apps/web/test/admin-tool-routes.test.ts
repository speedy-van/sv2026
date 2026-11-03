import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), audit: vi.fn(), origin: vi.fn(), schedule: vi.fn(), roots: vi.fn(), context: vi.fn(), create: vi.fn(), actions: vi.fn(), preview: vi.fn(), cancel: vi.fn(), refund: vi.fn(), offline: vi.fn(), extra: vi.fn(), resend: vi.fn(), quotes: vi.fn(), quote: vi.fn(), price: vi.fn(), decline: vi.fn(), reports: vi.fn(), export: vi.fn(), settings: vi.fn(), preferences: vi.fn(), leads: vi.fn(), abandoned: vi.fn() }));
vi.mock('@sv/db', () => ({ Prisma: { JsonNull: null }, prisma: { auditLog: { create: mocks.audit } } }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/auth/browser-session', () => ({ assertBrowserSessionOrigin: mocks.origin }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn(), enforceAdminDriverRateLimit: vi.fn() }));
vi.mock('../src/server/admin/booking-edit-routes', () => ({ handleAdminBookingEdit: vi.fn() }));
vi.mock('../src/server/admin/booking-actions', () => ({ readAdminBookingCreateContext: mocks.context, createAdminPhoneBooking: mocks.create, readAdminBookingActionsContext: mocks.actions, previewAdminBookingCancellation: mocks.preview, cancelAdminBooking: mocks.cancel, refundAdminBookingPayment: mocks.refund, recordAdminOfflinePayment: mocks.offline, createAdminExtraCharge: mocks.extra, resendAdminBookingEmail: mocks.resend }));
vi.mock('../src/server/admin/manual-quotes', () => ({ listAdminManualQuotes: mocks.quotes, readAdminManualQuote: mocks.quote, priceAdminManualQuote: mocks.price, declineAdminManualQuote: mocks.decline }));
vi.mock('../src/server/admin/reports', () => ({ readAdminReports: mocks.reports, exportAdminReports: mocks.export }));
vi.mock('../src/server/admin/notification-settings', () => ({ readAdminNotificationSettings: mocks.settings, updateAdminNotificationSettings: mocks.preferences }));
vi.mock('../src/server/admin/leads', () => ({ readAdminBookingActivity: mocks.leads, readAdminAbandonedCheckouts: mocks.abandoned }));
vi.mock('../src/server/admin/booking-edit-dispatch', () => ({ scheduleAdminBookingEdit: mocks.schedule }));
vi.mock('../src/server/outbox/schedule-roots', () => ({ scheduleOutboxRoots: mocks.roots }));
vi.mock('../src/server/services/quote', () => ({ createQuote: vi.fn() }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxEventNow: vi.fn() }));
import { handleAdminRoute, type AdminMethod } from '../src/server/admin/routes';
const saved = { id: 'booking-one', ok: true, version: 4 };
const mutations = [
  { name: 'cancel', path: 'bookings/booking-one/cancel', body: { expectedVersion: 3, refund: { mode: 'NONE' }, reason: 'Customer requested cancellation.', notifyCustomer: false, expectedRefundPence: 0 } },
  { name: 'refund', path: 'bookings/booking-one/refunds', body: { expectedVersion: 3, paymentId: 'payment-one', amountPence: 500, reason: 'Agreed adjustment.' } },
  { name: 'offline', path: 'bookings/booking-one/payments/offline', body: { expectedVersion: 3, amountPence: 500, reference: 'BANK-001', paidAt: '2031-01-01T12:00:00.000Z' } },
  { name: 'extra', path: 'bookings/booking-one/extra-charges', body: { expectedVersion: 3, amountPence: 500, description: 'Extra items approved.' } },
  { name: 'resend', path: 'bookings/booking-one/resend-email', body: { expectedVersion: 3, template: 'PAYMENT_LINK' } },
] as const;
function request(method: AdminMethod, path: string, body?: unknown, query = ''): Request {
  return new Request(`https://example.test/api/v1/admin/${path}${query}`, { method, headers: { 'content-type': 'application/json', 'x-request-id': 'request-one', origin: 'https://example.test' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ app: 'admin', role: 'OWNER', sessionId: 'session-one', userId: 'owner-one' });
  for (const item of mutations) mocks[item.name].mockResolvedValue(saved);
  mocks.context.mockResolvedValue({ ready: false, reason: 'Pricing not configured.', services: [] });
  mocks.reports.mockResolvedValue({ bookings: 2 }); mocks.settings.mockResolvedValue({ devices: [] });
  mocks.leads.mockResolvedValue({ items: [] }); mocks.abandoned.mockResolvedValue({ items: [] });
  mocks.quotes.mockResolvedValue({ items: [] }); mocks.quote.mockResolvedValue({ id: 'quote-one' }); mocks.actions.mockResolvedValue(saved);
});
describe('admin tools dispatch real services through validated authenticated routes', () => {
  it.each(mutations)('applies $name and dispatches only the committed booking version', async ({ name, path, body }) => {
    const response = await handleAdminRoute(request('POST', path, body), 'POST', path);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(saved);
    expect(mocks[name]).toHaveBeenCalledExactlyOnceWith('booking-one', body, { role: 'OWNER', userId: 'owner-one', requestId: 'request-one' });
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith('booking-one', 4); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(mutations)('rejects malformed $name without mutation or scheduling', async ({ name, path, body }) => {
    expect((await handleAdminRoute(request('POST', path, { ...body, expectedVersion: -1 }), 'POST', path)).status).toBe(400);
    expect(mocks[name]).not.toHaveBeenCalled(); expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it.each(mutations)('requires authentication for $name', async ({ name, path, body }) => {
    mocks.authenticate.mockRejectedValue(new AppError('UNAUTHORIZED', 'Sign in.'));
    expect((await handleAdminRoute(request('POST', path, body), 'POST', path)).status).toBe(401);
    expect(mocks[name]).not.toHaveBeenCalled();
  });
  it.each(mutations)('checks browser origin for $name before mutation', async ({ name, path, body }) => {
    mocks.origin.mockImplementation(() => { throw new AppError('FORBIDDEN', 'Invalid origin.'); });
    expect((await handleAdminRoute(request('POST', path, body), 'POST', path)).status).toBe(403);
    expect(mocks[name]).not.toHaveBeenCalled();
  });
  it.each([['bookings/create-context','context'],['bookings/booking-one/actions-context','actions'],['leads/activity','leads'],['checkouts/abandoned','abandoned'],['notification-settings','settings'],['manual-quotes','quotes'],['manual-quotes/quote-one','quote']] as const)('reads %s through its real service', async (path, name) => {
    expect((await handleAdminRoute(request('GET', path), 'GET', path)).status).toBe(200); expect(mocks[name]).toHaveBeenCalledOnce(); expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('validates the report date range and supports the reports screen path', async () => {
    expect((await handleAdminRoute(request('GET','reports',undefined,'?from=2031-01-01&to=2031-01-31'),'GET','reports')).status).toBe(200);
    expect(mocks.reports).toHaveBeenCalledExactlyOnceWith({ from: '2031-01-01', to: '2031-01-31' });
    expect((await handleAdminRoute(request('GET','reports',undefined,'?from=2031-01-31&to=2031-01-01'),'GET','reports')).status).toBe(400);
    expect(mocks.reports).toHaveBeenCalledOnce();
  });
  it('passes the current staff identity to device preference updates', async () => {
    mocks.preferences.mockResolvedValue({ ok: true });
    const body = { deviceId: 'my-phone', pendingBookingAlerts: true };
    expect((await handleAdminRoute(request('PATCH', 'notification-settings', body), 'PATCH', 'notification-settings')).status).toBe(200);
    expect(mocks.preferences).toHaveBeenCalledWith({ app: 'admin', role: 'OWNER', userId: 'owner-one', sessionId: 'session-one' }, body, 'request-one');
  });
  it.each([
    { suffix: 'price', name: 'price', body: { expectedUpdatedAt: '2031-01-01T12:00:00.000Z', pricePence: 20000, date: '2031-01-02', slot: 'MORNING', message: 'Agreed price.', validForHours: 1 } },
    { suffix: 'decline', name: 'decline', body: { expectedUpdatedAt: '2031-01-01T12:00:00.000Z', message: 'This move cannot be offered.' } },
  ] as const)('validates and dispatches manual quote $suffix for the exact committed update', async ({ suffix, name, body }) => {
    const path = `manual-quotes/quote-one/${suffix}`;
    mocks[name].mockResolvedValue({ ok: true, id: 'quote-one', updatedAt: '2031-01-01T12:01:00.000Z' });
    expect((await handleAdminRoute(request('POST', path, body), 'POST', path)).status).toBe(200);
    expect(mocks.roots).toHaveBeenCalledExactlyOnceWith({ prefix: 'manual-quote:quote-one:2031-01-01T12:01:00.000Z:' });
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect((await handleAdminRoute(request('POST', path, { ...body, expectedUpdatedAt: 'invalid' }), 'POST', path)).status).toBe(400);
    expect(mocks[name]).toHaveBeenCalledOnce();
    mocks.authenticate.mockRejectedValue(new AppError('UNAUTHORIZED', 'Sign in.'));
    expect((await handleAdminRoute(request('POST', path, body), 'POST', path)).status).toBe(401);
    expect(mocks[name]).toHaveBeenCalledOnce();
  });
  it('requires a server-priced total and idempotency key for phone creation', async () => {
    const body = { quotePublicId: 'quote_phone', date: '2031-01-02', slot: 'MORNING', contact: { name: 'Customer', email: 'customer@example.test', phone: '07700900001' }, payment: { mode: 'LINK' }, expectedTotalPence: 20000, idempotencyKey: 'd51d9e06-87c6-4b73-b69c-fc6792dc7370' };
    mocks.create.mockResolvedValue(saved);
    expect((await handleAdminRoute(request('POST', 'bookings', body), 'POST', 'bookings')).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(body, { role: 'OWNER', userId: 'owner-one', requestId: 'request-one' });
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith('booking-one', 4);
    expect((await handleAdminRoute(request('POST', 'bookings', { ...body, idempotencyKey: 'invalid' }), 'POST', 'bookings')).status).toBe(400);
    expect(mocks.create).toHaveBeenCalledOnce();
    mocks.authenticate.mockRejectedValue(new AppError('UNAUTHORIZED', 'Sign in.'));
    expect((await handleAdminRoute(request('POST', 'bookings', body), 'POST', 'bookings')).status).toBe(401);
  });
});
