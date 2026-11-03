import type { PublicSettings } from '@sv/contracts';
import { describe, expect, it } from 'vitest';
import { aboutCompanyDescription } from '../src/content/about';
import {
  cancellationRules,
  legalCopy,
  legalDraftIntroduction,
  privacyControllerDescription,
  renderPolicyFaqAnswer,
} from '../src/content/legal';

const pendingPolicy: PublicSettings['cancellation'] = {
  freeCancellationHours: null,
  lateCancellationRefundPercent: null,
  noRefundHours: null,
  selfServiceRescheduleHours: null,
};

const configuredPolicy: PublicSettings['cancellation'] = {
  freeCancellationHours: 72,
  lateCancellationRefundPercent: 35,
  noRefundHours: 12,
  selfServiceRescheduleHours: 36,
};

const missingCompany: PublicSettings['company'] = {
  companyNumber: null,
  icoRegistrationNumber: null,
  legalName: null,
  registeredIn: null,
  registeredOffice: null,
  tradingName: 'Speedy Van',
  vatNumber: null,
  vatRegistered: null,
};

describe('customer-facing cancellation policy', () => {
  it.each([
    pendingPolicy,
    { ...configuredPolicy, freeCancellationHours: null },
    { ...configuredPolicy, noRefundHours: null },
    { ...configuredPolicy, lateCancellationRefundPercent: null },
    { ...configuredPolicy, noRefundHours: 96 },
  ])('does not publish a refund schedule from missing or inconsistent values', (policy) => {
    expect(cancellationRules(policy)).toBeNull();
    const answer = renderPolicyFaqAnswer('How do I cancel?', 'Cancel {freeHours}+ hours before.', policy);
    expect(answer).toBe(legalCopy.cancellationPending);
    expect(answer).not.toMatch(/\{|\d|full refund|published cancellation window|settings/i);
  });

  it('uses the actual configured refund boundaries and percentage', () => {
    expect(cancellationRules(configuredPolicy)).toEqual([
      { timing: '72 hours or more before the slot', refund: 'Full refund' },
      { timing: '12 hours or more, but less than 72 hours, before the slot', refund: '35% refund' },
      { timing: 'Less than 12 hours before the slot', refund: 'No refund' },
    ]);
    const answer = renderPolicyFaqAnswer('How do I cancel?', '', configuredPolicy);
    expect(answer).toContain('eligible booking that has not started');
    expect(answer).toContain('35% refund');
    expect(answer).not.toContain('48');
  });

  it('retains zero values and omits empty refund intervals', () => {
    expect(cancellationRules({ ...configuredPolicy, freeCancellationHours: 0, noRefundHours: 0, lateCancellationRefundPercent: 0 })).toEqual([
      { timing: '0 hours or more before the slot', refund: 'Full refund' },
    ]);
    expect(cancellationRules({ ...configuredPolicy, noRefundHours: 72 })).toEqual([
      { timing: '72 hours or more before the slot', refund: 'Full refund' },
      { timing: 'Less than 72 hours before the slot', refund: 'No refund' },
    ]);
  });

  it('never substitutes a rescheduling deadline for a missing setting', () => {
    expect(renderPolicyFaqAnswer('Can I change my moving date?', '', pendingPolicy)).toBe(legalCopy.reschedulePending);
    expect(renderPolicyFaqAnswer('Can I change my moving date?', '', configuredPolicy)).toContain('36 hours before your slot');
    expect(renderPolicyFaqAnswer('Can I change my moving date?', '', { ...configuredPolicy, selfServiceRescheduleHours: 1 })).toContain('1 hour before');
    expect(renderPolicyFaqAnswer('Can I change my moving date?', '', { ...configuredPolicy, selfServiceRescheduleHours: 0 })).toContain('0 hours before');
  });

  it('handles existing database templates without overwriting unrelated owner-written answers', () => {
    expect(renderPolicyFaqAnswer('Cancellation question', 'Refund: {latePercent}%', pendingPolicy)).toBe(legalCopy.cancellationPending);
    expect(renderPolicyFaqAnswer('Move date question', 'Until {rescheduleHours} hours before.', pendingPolicy)).toBe(legalCopy.reschedulePending);
    expect(renderPolicyFaqAnswer('Restricted items', 'Owner to write: hazardous materials, gas bottles, fuel, etc.', pendingPolicy)).toBe(legalCopy.restrictedItemsPending);
    expect(renderPolicyFaqAnswer("Is there anything you can't move?", 'Contact us about gas bottles before booking.', pendingPolicy)).toBeNull();
    expect(renderPolicyFaqAnswer('Another question', 'An owner-written answer.', pendingPolicy)).toBeNull();
  });
});

describe('business identity and draft-policy disclosure', () => {
  it('omits unknown About business facts but keeps an explicit privacy-controller gap', () => {
    expect(aboutCompanyDescription(missingCompany)).toBeNull();
    expect(privacyControllerDescription(missingCompany)).toBe(legalCopy.controllerPending);
    expect(legalDraftIntroduction(missingCompany)).toContain('awaiting review by a Scottish solicitor');
    expect(legalDraftIntroduction(missingCompany)).toContain('have not been finalised');
  });

  it('uses the supplied legal identity without inventing an address or company number', () => {
    const company = { ...missingCompany, legalName: 'Example Removals Ltd', registeredIn: 'Scotland' };
    expect(aboutCompanyDescription(company)).toBe('Example Removals Ltd, trading as Speedy Van, is registered in Scotland.');
    expect(privacyControllerDescription(company)).toBe('Example Removals Ltd, trading as Speedy Van, is responsible for your personal data.');
    expect(legalDraftIntroduction(company)).not.toMatch(/company number|registered office/i);
  });
});
