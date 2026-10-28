export const cityMarketingLinks = [
  { href: '/removals/glasgow', label: 'Glasgow' },
  { href: '/removals/edinburgh', label: 'Edinburgh' },
  { href: '/removals/aberdeen', label: 'Aberdeen' },
  { href: '/removals/dundee', label: 'Dundee' },
  { href: '/removals/inverness', label: 'Inverness' },
  { href: '/removals/perth', label: 'Perth' },
  { href: '/removals/stirling', label: 'Stirling' },
  { href: '/removals/dunfermline', label: 'Dunfermline' },
] as const;

export const regionLinks = [
  { count: 8, href: '/areas/argyll-and-bute', label: 'Argyll and Bute' },
  { count: 20, href: '/areas/ayrshire-and-arran', label: 'Ayrshire and Arran' },
  { count: 25, href: '/areas/edinburgh-and-lothians', label: 'Edinburgh and Lothians' },
  { count: 16, href: '/areas/fife', label: 'Fife' },
  { count: 17, href: '/areas/forth-valley', label: 'Forth Valley' },
  { count: 25, href: '/areas/glasgow-and-clyde', label: 'Glasgow and Clyde' },
  { count: 20, href: '/areas/highlands', label: 'Highlands' },
  { count: 4, href: '/areas/islands', label: 'Islands' },
  { count: 23, href: '/areas/lanarkshire', label: 'Lanarkshire' },
  { count: 24, href: '/areas/north-east', label: 'North East' },
  { count: 22, href: '/areas/south-of-scotland', label: 'South of Scotland' },
  { count: 17, href: '/areas/tayside', label: 'Tayside' },
] as const;

export const howItWorksSteps = [
  {
    body: "Addresses, floors and the things you're moving. Takes about a minute.",
    title: 'Tell us about your move',
  },
  {
    body: 'Every morning, afternoon and evening for four weeks, each with a fixed price. Flexible days cost less.',
    title: 'Pick your price',
  },
  {
    body: 'Pay online, get your confirmation straight away, and follow your van live on the day.',
    title: 'We move you',
  },
] as const;

const guideDraftContent = [
  {
    body: [
      'Scottish flat notation often describes the floor and door. In Glasgow, 2/1 commonly means second floor, first door. In Edinburgh, 3F2 commonly means third floor, second flat.',
      'Enter the real floor in the booking flow so the access price and crew plan are accurate.',
      'This guide is a draft for owner review before publication.',
    ],
    slug: 'tenement-flat-notation',
    title: 'Tenement move notation in Glasgow and Edinburgh',
  },
  {
    body: [
      'Start with the large furniture, then boxes and bags. Add any custom item that is not in the catalogue.',
      'The price changes when the volume, item count or access changes, so complete the list before payment.',
      'This guide is a draft for owner review before publication.',
    ],
    slug: 'estimate-how-much-you-have',
    title: 'How to estimate how much you have',
  },
  {
    body: [
      'Pack documents, chargers and overnight essentials separately. Add boxes and bags to the booking inventory.',
      'Check building access before move day, especially halls and shared flats.',
      'This guide is a draft for owner review before publication.',
    ],
    slug: 'student-move-checklist',
    title: 'Student move checklist',
  },
  {
    body: [
      'Parking rules vary by council and street. Check your council before move day and choose permit-zone access if the van cannot stop close to the door.',
      'Do not rely on this guide as legal advice.',
      'This guide is a draft for owner review before publication.',
    ],
    slug: 'parking-for-removal-vans',
    title: 'Parking for removal vans',
  },
  {
    body: [
      'Pack rarely used items first, keep essentials aside and label boxes by room.',
      'Add packing help in the booking flow if you want it included in the price.',
      'This guide is a draft for owner review before publication.',
    ],
    slug: 'packing-timeline',
    title: 'Packing timeline before a move',
  },
  {
    body: [
      'Glasgow to Edinburgh is a common mainland route, so the online flow can show fixed prices when the addresses and access are complete.',
      'Choose a cheaper flexible slot if your date is not fixed.',
      'This guide is a draft for owner review before publication.',
    ],
    slug: 'glasgow-edinburgh-move',
    title: 'Planning a Glasgow to Edinburgh move',
  },
] as const;

export const guideDrafts = guideDraftContent.map((guide) => ({
  ...guide,
  readingMinutes: Math.max(1, Math.ceil(guide.body.join(' ').trim().split(/\s+/).length / 200)),
}));

export const legalPages = {
  cancellation: {
    description: 'Draft cancellation policy for Speedy Van bookings.',
    title: 'Cancellation policy',
  },
  cookies: {
    description: 'Draft cookie policy and cookie inventory for Speedy Van.',
    title: 'Cookie policy',
  },
  privacy: {
    description: 'Draft privacy policy for Speedy Van.',
    title: 'Privacy policy',
  },
  terms: {
    description: 'Draft terms of service for Speedy Van.',
    title: 'Terms of service',
  },
} as const;

export type LegalSlug = keyof typeof legalPages;

export function isLegalSlug(slug: string): slug is LegalSlug {
  return Object.hasOwn(legalPages, slug);
}

export const serviceDirectoryCopy = {
  description: 'House and flat removals, man and van, furniture and sofa transport, and specialist moving services across Scotland.',
  lead: 'Find help with a house or flat move, a few boxes, furniture collection or sofa transport. Choose your service, then add pickup and delivery details to check the available prices.',
  title: 'Our services',
} as const;
