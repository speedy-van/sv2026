import type { PublicSettings } from '@sv/contracts';

export const aboutCopy = {
  title: 'About Speedy Van',
  description: 'House moves, small moves and furniture transport with online pricing and booking.',
  lead: 'Plan a house move, a small move or furniture transport with prices based on your route, items and access.',
  bookingTitle: 'See your moving price',
  howHeading: 'How we work',
  howBody: 'Add your collection and delivery addresses, the things you are moving and access at both ends. Compare the available dates and prices before you book.',
  helpHeading: 'Help with your move',
  helpBody: 'Moving a whole home, a few boxes or a single piece of furniture? Choose the service that fits your load. Contact us before booking if your route, items or access need an individual review.',
  contactLabel: 'Contact Speedy Van',
} as const;

export function aboutCompanyDescription(company: PublicSettings['company']): string | null {
  if (!company.legalName || !company.registeredIn) return null;
  return `${company.legalName}, trading as ${company.tradingName}, is registered in ${company.registeredIn}.`;
}
