import type { ServiceKey } from '@sv/pricing';

export interface ServiceContent {
  engineKey: ServiceKey;
  faqs: Array<{ answer: string; question: string }>;
  goodToKnow: string[];
  included: string[];
  label: string;
  lead: string;
  options: string[];
  profileLabel: string;
  related: string[];
  reviewedByOwner: boolean;
  slug: string;
  summary: string;
  title: string;
  variantKey: string;
}

export const serviceContent = [
  {
    engineKey: 'house-removals',
    faqs: [
      { question: 'Can I add more rooms later?', answer: 'Yes. Revisit your quote before paying, update the items and access, then reveal fresh prices.' },
      { question: 'Do stairs change the price?', answer: 'Yes. Floors and lift access are priced before payment so the crew and price match the move.' },
      { question: 'Can I move between Scottish cities?', answer: 'Yes. Mainland Scotland routes are priced instantly when at least one address is in Scotland.' },
      { question: 'What happens after I book?', answer: 'You get confirmation straight away and a manage-booking link for changes before the move.' },
    ],
    goodToKnow: [
      'Flat notation like 2/1 or 3F2 means floor and door; enter the actual floor so the access price is right.',
      'Parking restrictions and long carries are priced before payment when you tell us about them.',
      'Large or unusual jobs can be routed to the team for a manual fixed quote.',
    ],
    included: ['Homes and flats', 'Floor and lift pricing', 'Item inventory', 'Morning, afternoon and evening slots', 'Online payment', 'Confirmation email'],
    label: 'Home moves',
    lead: 'Fixed online prices for flats, houses and whole-home moves across mainland Scotland.',
    options: ['Studio to 4+ bedroom variants', 'Packing help', 'Furniture assembly', 'Extra helpers'],
    profileLabel: 'Studio flat, under 5 miles, ground floor',
    related: ['man-and-van', 'storage-moves', 'student-moves'],
    reviewedByOwner: false,
    slug: 'house-removals',
    summary: 'Flats, houses and whole-home moves.',
    title: 'House removals',
    variantKey: 'studio',
  },
  {
    engineKey: 'man-and-van',
    faqs: [
      { question: 'Is this for small moves?', answer: 'Yes. It is the quickest route for a few items, single-room moves and light loads.' },
      { question: 'Can I book for today?', answer: 'Same-day booking is shown only when a slot is still open and inside the booking rules.' },
      { question: 'Can I add helpers?', answer: 'Yes. Extra helpers can be added before the price is revealed.' },
      { question: 'Can rubbish be collected too?', answer: 'Use rubbish removal when there is only a collection address and no delivery address.' },
    ],
    goodToKnow: [
      'Add every bulky item before revealing prices so the van size and crew time are right.',
      'Use the access questions for stairs, long carries, permits and narrow turns.',
    ],
    included: ['Small moves', 'Single-item jobs', 'Item search', 'Fixed slot prices', 'Online confirmation'],
    label: 'Man and van',
    lead: 'For smaller moves, single bulky items and quick transport jobs.',
    options: ['Standard small-move pricing', 'Packing help', 'Furniture assembly', 'Extra helpers'],
    profileLabel: 'One armchair, under 5 miles, ground floor',
    related: ['furniture-delivery', 'same-day-delivery', 'student-moves'],
    reviewedByOwner: false,
    slug: 'man-and-van',
    summary: 'Small moves and single-item jobs.',
    title: 'Man and van',
    variantKey: 'standard',
  },
  {
    engineKey: 'furniture',
    faqs: [
      { question: 'Can you move one sofa?', answer: 'Yes. Add the sofa and the two addresses, then choose from the priced slots.' },
      { question: 'Do you collect from shops?', answer: 'Yes when the collection and delivery details fit the booking form and the route is covered.' },
      { question: 'Should I mention tight stairs?', answer: 'Yes. Narrow access and carry distance affect planning and price.' },
      { question: 'Can I add assembly?', answer: 'Furniture assembly can be added before checkout when it applies.' },
    ],
    goodToKnow: [
      'Measure bulky items and tight entrances before booking when the fit is uncertain.',
      'Choose permit-zone access when the van cannot legally stop close to either address.',
    ],
    included: ['Sofas and beds', 'Bulky furniture', 'Access pricing', 'Slot calendar', 'Card payment'],
    label: 'Furniture delivery',
    lead: 'Book a fixed-price furniture collection or delivery without a phone call.',
    options: ['Standard furniture delivery', 'Assembly add-on', 'Extra helper add-on'],
    profileLabel: 'Three-seater sofa, under 5 miles, ground floor',
    related: ['man-and-van', 'ikea-delivery', 'same-day-delivery'],
    reviewedByOwner: false,
    slug: 'furniture-delivery',
    summary: 'Sofas, beds, tables and bulky items.',
    title: 'Furniture delivery',
    variantKey: 'standard',
  },
  {
    engineKey: 'student',
    faqs: [
      { question: 'Is this for halls?', answer: 'Yes. Choose the halls variant and add the boxes, bags and small items you are moving.' },
      { question: 'Can I move between student flats?', answer: 'Yes. Use the shared flat or house variant.' },
      { question: 'Can I book around term dates?', answer: 'The calendar shows live fixed prices for the next four weeks.' },
      { question: 'Can I share the manage link?', answer: 'The booking email includes a manage link for changes before the move.' },
    ],
    goodToKnow: [
      'Student moves often have more bags than furniture; add bags and boxes so the price is accurate.',
      'Check building access rules for halls before move day.',
    ],
    included: ['Halls and shared flats', 'Boxes and bags', 'Live slot prices', 'Online confirmation'],
    label: 'Student moves',
    lead: 'Student room and shared-flat moves with clear prices before you pay.',
    options: ['Halls of residence', 'Shared flat or house', 'Extra helpers'],
    profileLabel: 'Student room preset, under 5 miles, ground floor',
    related: ['man-and-van', 'storage-moves', 'same-day-delivery'],
    reviewedByOwner: false,
    slug: 'student-moves',
    summary: 'Halls, flats and term-time moves.',
    title: 'Student moves',
    variantKey: 'halls',
  },
  {
    engineKey: 'office',
    faqs: [
      { question: 'Can I price a small office online?', answer: 'Yes. Small office moves are priced from the inventory and access details.' },
      { question: 'What about larger offices?', answer: 'Larger office moves can be routed to a manual fixed quote when a survey is needed.' },
      { question: 'Can desks and archive boxes be added?', answer: 'Yes. The item list includes office furniture, equipment and archive boxes.' },
      { question: 'Do you price lifts and stairs?', answer: 'Yes. Floors, lift availability and carry distance are included before payment.' },
    ],
    goodToKnow: [
      'Tell us about building loading rules, goods lifts and permits before booking.',
      'Large offices may need a manual quote so the plan is right.',
    ],
    included: ['Small offices', 'Desks and chairs', 'Archive boxes', 'Access pricing', 'Manual quote routing for larger jobs'],
    label: 'Office moves',
    lead: 'Small office removals with fixed pricing for desks, chairs, boxes and access.',
    options: ['Up to 5 desks', '6-15 desks', '16+ desks by manual quote'],
    profileLabel: 'Small office preset, under 5 miles, ground floor',
    related: ['storage-moves', 'man-and-van', 'same-day-delivery'],
    reviewedByOwner: false,
    slug: 'office-removals',
    summary: 'Small offices and workplace moves.',
    title: 'Office removals',
    variantKey: 'small',
  },
  {
    engineKey: 'storage',
    faqs: [
      { question: 'Can you move items into storage?', answer: 'Yes. Choose the into-storage variant and add the items you are moving.' },
      { question: 'Can you move from storage?', answer: 'Yes. Use the out-of-storage variant when the unit is the pickup address.' },
      { question: 'Do I add storage access details?', answer: 'Yes. Add carry distance, lifts and any narrow access just like a home move.' },
      { question: 'Can I book a few boxes only?', answer: 'Yes. Add the boxes and reveal the available slot prices.' },
    ],
    goodToKnow: [
      'Storage sites can have loading rules and lift limits; include them in access notes.',
      'If the route uses a ferry, the team prices it manually.',
    ],
    included: ['Into storage', 'Out of storage', 'Between units', 'Boxes and furniture', 'Fixed slot prices'],
    label: 'Storage moves',
    lead: 'Move furniture and boxes into, out of or between storage units.',
    options: ['Into storage', 'Out of storage', 'Extra helpers'],
    profileLabel: 'Five medium boxes, under 5 miles, ground floor',
    related: ['house-removals', 'student-moves', 'office-removals'],
    reviewedByOwner: false,
    slug: 'storage-moves',
    summary: 'To storage, from storage or between units.',
    title: 'Storage moves',
    variantKey: 'to-storage',
  },
  {
    engineKey: 'ikea',
    faqs: [
      { question: 'Can I add flat-pack boxes?', answer: 'Yes. Add the number of flat-pack boxes or add a custom item if the exact item is not listed.' },
      { question: 'Can assembly be included?', answer: 'Furniture assembly is an optional add-on before checkout.' },
      { question: 'Do I need two addresses?', answer: 'Yes. IKEA and flat-pack delivery is priced as a pickup and dropoff route.' },
      { question: 'Can I choose a same-day slot?', answer: 'Available same-day slots appear in the calendar when they meet the booking rules.' },
    ],
    goodToKnow: [
      'Keep order references and collection instructions ready for the driver.',
      'Large or unusually heavy items should be described before checkout.',
    ],
    included: ['Flat-pack boxes', 'Collection and delivery', 'Assembly add-on', 'Slot calendar'],
    label: 'IKEA and flat-pack',
    lead: 'Flat-pack collection, delivery and optional assembly priced before payment.',
    options: ['Standard flat-pack delivery', 'Furniture assembly', 'Extra helpers'],
    profileLabel: 'Three small flat-pack boxes, under 5 miles, ground floor',
    related: ['furniture-delivery', 'man-and-van', 'same-day-delivery'],
    reviewedByOwner: false,
    slug: 'ikea-delivery',
    summary: 'Flat-pack collection and delivery.',
    title: 'IKEA and flat-pack delivery',
    variantKey: 'standard',
  },
  {
    engineKey: 'rubbish',
    faqs: [
      { question: 'Why is there only one address?', answer: 'Rubbish removal is a collection-only job, so the booking path uses a single address.' },
      { question: 'Can I add bags and bulky items?', answer: 'Yes. Add the bags or items before revealing prices.' },
      { question: 'What can you not take?', answer: 'The final restricted-items list is confirmed before launch. Contact Speedy Van before booking anything hazardous or unusual.' },
      { question: 'Does distance affect rubbish removal?', answer: 'No. The pricing engine treats rubbish removal as a single-address job.' },
    ],
    goodToKnow: [
      'Use the collection address only; there is no dropoff step for rubbish removal.',
      'Do not book hazardous or unusual waste until the team confirms it can be collected.',
    ],
    included: ['Single-address booking', 'Bags and bulky items', 'Access pricing', 'Online confirmation'],
    label: 'Rubbish removal',
    lead: 'Collection-only rubbish removal with a single address and fixed online pricing.',
    options: ['Standard collection', 'Extra helpers'],
    profileLabel: 'Five black bags, collection address only',
    related: ['man-and-van', 'same-day-delivery', 'storage-moves'],
    reviewedByOwner: false,
    slug: 'rubbish-removal',
    summary: 'Clearance priced as a single-address job.',
    title: 'Rubbish removal',
    variantKey: 'standard',
  },
  {
    engineKey: 'piano',
    faqs: [
      { question: 'Can upright pianos be priced online?', answer: 'Yes when the access details fit the online flow.' },
      { question: 'Do grand pianos need a survey?', answer: 'Grand and baby grand variants are routed to a manual quote by default.' },
      { question: 'Should I add stairs?', answer: 'Yes. Piano access must be accurate so the right route is chosen.' },
      { question: 'Can I add other items?', answer: 'Use the booking form to add every item that is moving with the piano.' },
    ],
    goodToKnow: [
      'Grand pianos are routed to manual quote because access and handling need review.',
      'Tell us about narrow turns and long carries before checkout.',
    ],
    included: ['Digital and upright variants', 'Manual quote routing for grand pianos', 'Access questions', 'Fixed slot prices when available'],
    label: 'Piano moving',
    lead: 'Piano moves with access checks and manual quotes for larger piano types.',
    options: ['Digital piano', 'Upright piano', 'Baby grand by manual quote', 'Grand by manual quote'],
    profileLabel: 'Upright piano, under 5 miles, ground floor',
    related: ['house-removals', 'man-and-van', 'furniture-delivery'],
    reviewedByOwner: false,
    slug: 'piano-moving',
    summary: 'Piano moves with access checks.',
    title: 'Piano moving',
    variantKey: 'upright',
  },
  {
    engineKey: 'same-day',
    faqs: [
      { question: 'Is same-day always available?', answer: 'No. Same-day slots show only when a remaining slot is still open.' },
      { question: 'Can I book for a future day?', answer: 'Use another service for future-day pricing; same-day delivery is for today only.' },
      { question: 'What can I send?', answer: 'Small deliveries and light items that fit the item list or custom item sizes.' },
      { question: 'Do I pay online?', answer: 'Yes. The booking is confirmed after online payment.' },
    ],
    goodToKnow: [
      'Same-day delivery only shows today\'s remaining slots.',
      'If no eligible slot remains, the page shows today as fully booked.',
    ],
    included: ['Today-only slots', 'Small item delivery', 'Fixed online payment', 'Confirmation email'],
    label: 'Same-day delivery',
    lead: 'Urgent small deliveries when there is still a slot available today.',
    options: ['Standard same-day delivery', 'Extra helpers'],
    profileLabel: 'One medium box, today only',
    related: ['man-and-van', 'furniture-delivery', 'ikea-delivery'],
    reviewedByOwner: false,
    slug: 'same-day-delivery',
    summary: 'Urgent small deliveries when slots are free.',
    title: 'Same-day delivery',
    variantKey: 'standard',
  },
] as const satisfies ServiceContent[];

export type ServiceSlug = (typeof serviceContent)[number]['slug'];

export function serviceBySlug(slug: string): ServiceContent | undefined {
  return serviceContent.find((service) => service.slug === slug);
}

export function serviceByEngineKey(engineKey: ServiceKey): ServiceContent | undefined {
  return serviceContent.find((service) => service.engineKey === engineKey);
}
