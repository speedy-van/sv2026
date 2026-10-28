import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  render: vi.fn(),
  fetch: vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock('../src/server/env', () => ({ serverEnv: mocks.env }));
vi.mock('@sv/emails', () => ({ renderEmailTemplate: mocks.render }));

const payload = { template: 'manage-link' as const, to: ['customer@example.test'], data: { reference: 'SV-UNIT01' } };

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.env.mockReturnValue({ RESEND_API_KEY: 're_unit_test', EMAIL_FROM: 'sender@example.test' });
  mocks.render.mockResolvedValue({ html: '<p>Unit message</p>', text: 'Unit message', subject: 'Unit subject' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('bounded Resend transport using the actual SDK with intercepted fetch', () => {
  it('uses the outbox identity as provider idempotency key and clears its timeout after success', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValue(Response.json({ id: 'email-unit' }));
    const { sendTransactionalEmail } = await import('../src/server/integrations/resend');
    await sendTransactionalEmail(payload, 'event-unit');
    const init = mocks.fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('event-unit');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the actual pending fetch at10seconds and maps failure to a typed error without provider details', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('Unit transport aborted.')); }, { once: true });
    }));
    const { sendTransactionalEmail } = await import('../src/server/integrations/resend');
    const task = sendTransactionalEmail(payload, 'event-unit');
    const rejection = expect(task).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', message: 'Email could not be sent.', details: undefined });
    await vi.advanceTimersByTimeAsync(9999);
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the abort timer for a provider rejection and keeps its response text out of the typed error', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValue(Response.json({ name: 'validation_error', message: 'Private provider response' }, { status: 400 }));
    const { sendTransactionalEmail } = await import('../src/server/integrations/resend');
    await expect(sendTransactionalEmail(payload, 'event-unit')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', details: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });
});
