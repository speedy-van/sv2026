import { DEFAULT_PRICING_CONFIG } from '@sv/pricing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { legalCopy } from '../src/content/legal';

const mocks = vi.hoisted(() => ({ faqs: vi.fn(), publicSettings: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: { faq: { findMany: mocks.faqs } } }));
vi.mock('../src/server/services/catalogue', () => ({
  getActivePricingConfig: vi.fn(() => Promise.resolve({ config: DEFAULT_PRICING_CONFIG })),
  getCatalogue: vi.fn(),
}));
vi.mock('../src/server/services/availability', () => ({ overlayAvailability: vi.fn() }));
vi.mock('../src/server/settings', () => ({
  getPublicSettings: mocks.publicSettings,
  getOperationsSettings: vi.fn(() => Promise.resolve({ minLeadMinutes: 120, serviceAreaRule: 'SCOTLAND_ONLY' })),
  getSetting: vi.fn(),
}));

import { getRenderedFaqs } from '../src/server/marketing';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicSettings.mockResolvedValue({
    cancellation: { freeCancellationHours: null, noRefundHours: null, lateCancellationRefundPercent: null, selfServiceRescheduleHours: null },
    contact: { phoneDisplay: null },
    operations: { crossBorderMoves: false },
  });
});

describe('FAQ policy rendering from current and existing seeded content', () => {
  it('replaces existing database placeholders with complete pending-policy messages', async () => {
    mocks.faqs.mockResolvedValue([
      { category: 'CHANGES', question: 'How do I cancel?', answer: 'Cancel {freeHours}+ hours before; refund {latePercent}%.' },
      { category: 'CHANGES', question: 'Can I change my moving date?', answer: 'Until {rescheduleHours} hours before.' },
      { category: 'ITEMS', question: "Is there anything you can't move?", answer: 'Owner to write: hazardous materials, gas bottles, fuel, etc.' },
    ]);
    const faqs = await getRenderedFaqs();
    expect(faqs.map((faq) => faq.answer)).toEqual([
      legalCopy.cancellationPending,
      legalCopy.reschedulePending,
      legalCopy.restrictedItemsPending,
    ]);
  });

  it('keeps fallback FAQs readable when no policy values or contact phone are available', async () => {
    mocks.faqs.mockRejectedValue(new Error('FAQ store unavailable'));
    const faqs = await getRenderedFaqs();
    expect(faqs.find((faq) => faq.question === 'How do I cancel?')?.answer).toBe(legalCopy.cancellationPending);
    expect(faqs.find((faq) => faq.question === 'How far ahead can I book online?')?.answer).toContain('use the contact page');
    expect(faqs.map((faq) => faq.answer).join(' ')).not.toMatch(/\{\w+\}|Owner to write|before launch|published refund%|undefined|null/);
  });
});
