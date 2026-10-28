import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSetting: vi.fn() }));

vi.mock('@sv/db', () => ({ prisma: {} }));
vi.mock('../src/server/services/catalogue', () => ({
  getActivePricingConfig: vi.fn(),
  getCatalogue: vi.fn(),
}));
vi.mock('../src/server/services/availability', () => ({ overlayAvailability: vi.fn() }));
vi.mock('../src/server/settings', () => ({
  getOperationsSettings: vi.fn(),
  getSetting: mocks.getSetting,
}));

import { showDraftLegalBanner } from '../src/server/marketing';

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe.each(['production', 'development', 'test'])('legal review banner in %s', (environment) => {
  it('keeps the draft notice visible until legal approval is recorded', async () => {
    vi.stubEnv('NODE_ENV', environment);
    mocks.getSetting.mockResolvedValue({ legalApprovedAt: null });

    expect(await showDraftLegalBanner()).toBe(true);
    expect(mocks.getSetting).toHaveBeenCalledExactlyOnceWith('launch');
  });

  it('hides the draft notice when legal approval has been recorded', async () => {
    vi.stubEnv('NODE_ENV', environment);
    mocks.getSetting.mockResolvedValue({ legalApprovedAt: '2026-10-15T12:00:00.000Z' });

    expect(await showDraftLegalBanner()).toBe(false);
  });

  it('keeps the draft notice visible when the approval setting cannot be read', async () => {
    vi.stubEnv('NODE_ENV', environment);
    mocks.getSetting.mockRejectedValue(new Error('Settings are temporarily unavailable.'));

    expect(await showDraftLegalBanner()).toBe(true);
  });
});
