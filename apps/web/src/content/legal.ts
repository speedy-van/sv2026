import type { PublicSettings } from '@sv/contracts';

type CancellationSettings = PublicSettings['cancellation'];

export interface CancellationRule {
  timing: string;
  refund: string;
}

export const legalCopy = {
  draftBanner: 'Draft - awaiting legal review',
  contactLabel: 'Contact us about these terms',
  cancellationHeading: 'Cancellation and refunds',
  cancellationIntro: 'Refunds depend on how long before your booked slot you cancel. The current cancellation rules are shown below.',
  cancellationPending: 'Cancellation time limits and refund amounts are awaiting confirmation. Contact us before booking, or for help cancelling an existing booking.',
  cancellationLinkLabel: 'Read the cancellation policy',
  changesBody: 'Changes to your move may change its price. Check the cancellation policy before booking and contact us if you need help with an existing booking.',
  reschedulePending: 'The deadline for changing a move online is awaiting confirmation. Contact us before booking or if you need to change an existing booking.',
  restrictedItemsHeading: 'Items we cannot carry',
  restrictedItemsPending: 'The list of items we cannot carry is awaiting confirmation. Contact us before booking hazardous, unusual or high-value items.',
  liabilityHeading: 'Liability and complaints',
  liabilityPending: 'Liability limits, damage-claim deadlines and insurance terms are awaiting confirmation and legal review. Contact us to discuss these terms before booking or to raise a complaint.',
  timingLabel: 'Time before your booked slot',
  refundLabel: 'Refund',
  refundHeading: 'Refund timing',
  refundBody: 'Refunds are returned to the original payment method. Bank processing times depend on the payment provider and card issuer.',
  retentionBody: 'You can request access, portability, rectification or erasure where allowed, and object to marketing. The retention periods for different types of personal data are awaiting confirmation. Contact us to ask about the information we hold about you.',
  controllerPending: 'The legal identity and contact details of the company responsible for your personal data are awaiting confirmation. Contact us before providing information if you need these details.',
} as const;

export function legalDraftIntroduction(company: PublicSettings['company']): string {
  const name = company.legalName
    ? `${company.legalName}, trading as ${company.tradingName}`
    : company.tradingName;
  return `Draft for ${name}. This page is awaiting review by a Scottish solicitor. Any terms described as awaiting confirmation have not been finalised.`;
}

export function privacyControllerDescription(company: PublicSettings['company']): string {
  return company.legalName
    ? `${company.legalName}, trading as ${company.tradingName}, is responsible for your personal data.`
    : legalCopy.controllerPending;
}

function hours(value: number): string {
  return `${String(value)} ${value === 1 ? 'hour' : 'hours'}`;
}

export function cancellationRules(policy: CancellationSettings): CancellationRule[] | null {
  const { freeCancellationHours, noRefundHours, lateCancellationRefundPercent } = policy;
  if (
    freeCancellationHours === null ||
    noRefundHours === null ||
    lateCancellationRefundPercent === null ||
    noRefundHours > freeCancellationHours
  ) return null;

  const rules: CancellationRule[] = [{
    timing: `${hours(freeCancellationHours)} or more before the slot`,
    refund: 'Full refund',
  }];
  if (noRefundHours < freeCancellationHours) {
    rules.push({
      timing: `${hours(noRefundHours)} or more, but less than ${hours(freeCancellationHours)}, before the slot`,
      refund: `${String(lateCancellationRefundPercent)}% refund`,
    });
  }
  if (noRefundHours > 0) {
    rules.push({ timing: `Less than ${hours(noRefundHours)} before the slot`, refund: 'No refund' });
  }
  return rules;
}

export function renderPolicyFaqAnswer(
  question: string,
  answer: string,
  policy: CancellationSettings,
): string | null {
  if (question === 'How do I cancel?' || /\{(?:freeHours|noRefundHours|latePercent)\}/.test(answer)) {
    const rules = cancellationRules(policy);
    if (!rules) return legalCopy.cancellationPending;
    return `For an eligible booking that has not started, use your booking page to request cancellation. ${rules.map((rule) => `${rule.timing}: ${rule.refund.toLowerCase()}.`).join(' ')} See the cancellation policy for the full terms.`;
  }
  if (question === 'Can I change my moving date?' || answer.includes('{rescheduleHours}')) {
    if (policy.selfServiceRescheduleHours === null) return legalCopy.reschedulePending;
    return `For an eligible booking that has not started, you can change the date from your booking page until ${hours(policy.selfServiceRescheduleHours)} before your slot. If the new slot costs more you pay the difference; if it costs less we refund it.`;
  }
  if (answer.includes('Owner to write:')) return legalCopy.restrictedItemsPending;
  return null;
}
