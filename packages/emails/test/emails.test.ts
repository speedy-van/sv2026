import { describe, expect, it } from 'vitest';
import { EMAIL_TEMPLATE_KEYS, renderEmailTemplate } from '../src/index';

const fixture = {
  amountPence: 15890,
  paidPence: 15890,
  totalPence: 15890,
  refundedPence: 0,
  balancePence: 0,
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

  it('distinguishes the current booking total from money actually received and refunded', async () => {
    const rendered = await renderEmailTemplate('booking-confirmed', {
      ...fixture, totalPence: 20000, paidPence: 15890, refundedPence: 1000, balancePence: 5110,
    });
    expect(rendered.text).toContain('Booking total: £200.00.');
    expect(rendered.text).toContain('Amount paid: £158.90.');
    expect(rendered.text).toContain('Amount refunded: £10.00.');
    expect(rendered.text).toContain('Balance remaining: £51.10.');
    expect(rendered.text).not.toContain('Amount paid: £200.00.');
  });

  it('does not present a legacy booking total as proof of payment', async () => {
    const rendered = await renderEmailTemplate('booking-confirmed', {
      amountPence: 15890, reference: fixture.reference, manageUrl: fixture.manageUrl,
    });
    expect(rendered.text).toContain('Booking total: £158.90.');
    expect(rendered.text).not.toContain('Amount paid:');
  });

  it('labels an overpayment as credit due', async () => {
    const rendered = await renderEmailTemplate('booking-confirmed', {
      ...fixture, totalPence: 15000, balancePence: -890,
    });
    expect(rendered.text).toContain('Credit due: £8.90.');
    expect(rendered.text).not.toContain('Balance remaining:');
  });

  it('escapes untrusted booking details and renders a mobile-width confirmation with a plain-text alternative', async () => {
    const rendered = await renderEmailTemplate('booking-confirmed', { ...fixture, customerName: '<script>alert(1)</script>', pickupLabel: '1 <img src=x onerror=alert(1)> Road' });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain('width:100%');
    expect(rendered.html).toContain('max-width:560px');
    expect(rendered.html).toContain('width=device-width');
    expect(rendered.text).toContain('Booking reference SV-7K3Q2M');
    expect(rendered.text).toContain('Contact: bookings@speedyvan.uk');
  });

  it('does not render an active-content action URL', async () => {
    const rendered = await renderEmailTemplate('booking-confirmed', { ...fixture, manageUrl: 'javascript:alert(1)' });
    expect(rendered.html).not.toContain('href="javascript:');
    expect(rendered.html).toContain('https://www.speedyvan.uk');
  });
});
