import { describe, expect, it } from 'vitest';
import { EMAIL_TEMPLATE_KEYS, renderEmailTemplate } from '../src/index';

const fixture = {
  amountPence: 15890,
  canonicalOrigin: 'https://www.speedyvan.uk',
  contactEmail: 'bookings@speedyvan.uk',
  customerName: 'Sarah McDonald',
  driverFirstName: 'Jamie',
  holdExpiresAt: 'Saturday 14 November, 6:30pm',
  legalLine: 'Speedy Van Ltd, Scotland.',
  manageUrl: '/manage/test-token',
  message: 'Paisley to Edinburgh, morning slot.',
  moveDateLabel: 'Saturday 14 November',
  oldMoveDateLabel: 'Friday 13 November',
  payUrl: '/pay/test-token',
  proofUrl: '/proof/test-token',
  reference: 'SV-7K3Q2M',
  refundPence: 7420,
  reviewUrl: '/review/test-token',
  role: 'Admin' as const,
  routeLabel: 'Paisley to Edinburgh',
  serviceLabel: 'Man and van',
  signInCode: '123 456',
  slotLabel: '8am-12pm',
  trackingUrl: '/track/test-token',
};

describe('@sv/emails', () => {
  it('renders every documented template without unresolved placeholders', async () => {
    expect.assertions(EMAIL_TEMPLATE_KEYS.length * 6);
    for (const template of EMAIL_TEMPLATE_KEYS) {
      const rendered = await renderEmailTemplate(template, fixture);
      expect(rendered.subject.length, template).toBeLessThanOrEqual(60);
      expect(rendered.html, template).toContain('Speedy Van');
      expect(rendered.html, template).not.toMatch(/\{[A-Za-z0-9_]+\}/);
      expect(rendered.text, template).not.toMatch(/undefined|null/);
      expect(rendered.html, template).toMatch(/https:\/\/www\.speedyvan\.uk/);
      expect(rendered.text.length, template).toBeGreaterThan(40);
    }
  });

  it('renders a stable booking-confirmed snapshot', async () => {
    const rendered = await renderEmailTemplate('booking-confirmed', fixture);
    expect(rendered.subject).toBe("You're booked: Saturday 14 November (SV-7K3Q2M)");
    expect(rendered.text).toContain('Amount paid: £158.90.');
    expect(rendered.text).toContain('Manage booking');
  });
});
