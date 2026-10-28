import type { ServiceKey } from '@sv/pricing';

export interface ServiceContent {
  engineKey: ServiceKey;
  faqs: Array<{ answer: string; question: string }>;
  goodToKnow: string[];
  included: string[];
  label: string;
  lead: string;
  metaDescription?: string;
  options: string[];
  priceSourceSlug?: string;
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
      {
        question: 'How do I find house removals near me?',
        answer:
          'Choose your Scottish city or town, then enter the actual pickup and delivery addresses. Your house-removal price depends on the route, inventory, access and available date, rather than how close a directory listing appears.',
      },
      {
        question: 'Do you offer nearby house removals as well as longer moves?',
        answer:
          'Yes. Start with both addresses for a move within your town or to another covered location. Routes needing a ferry are checked and quoted individually.',
      },
      {
        question: 'Can I add more rooms later?',
        answer:
          'Yes. Before paying, update the inventory and access details, then reveal fresh prices. The bedroom size is a starting point for the load, not a separate size for each address.',
      },
      {
        question: 'Do stairs change the price?',
        answer: 'Yes. Floors and lift access are priced before payment so the crew and price match the move.',
      },
      {
        question: 'Can I move between Scottish cities?',
        answer:
          'Enter the two full addresses to check the route and eligible prices. A move can start and finish in different covered places; ferry routes and jobs needing individual review follow the manual-quote route.',
      },
      {
        question: 'What happens after I book?',
        answer: 'You get confirmation straight away and a manage-booking link for changes before the move.',
      },
    ],
    goodToKnow: [
      'Flat notation like 2/1 or 3F2 means floor and door; enter the actual floor so the access price is right.',
      'Parking restrictions and long carries are priced before payment when you tell us about them.',
      'Large or unusual jobs can be routed to the team for a manual fixed quote.',
    ],
    included: [
      'Homes and flats',
      'Floor and lift pricing',
      'Item inventory',
      'Morning, afternoon and evening slots',
      'Online payment',
      'Confirmation email',
    ],
    label: 'Home moves',
    lead: 'House removals across Scotland, from a few rooms to a whole home. Add both addresses, your furniture and boxes, and access at each end to see the available prices; ferry routes are quoted individually.',
    metaDescription:
      'House removals across Scotland. Build your inventory, add access at both addresses and compare available prices. Ferry routes quoted individually.',
    options: ['Studio to 4+ bedroom variants', 'Packing help', 'Furniture assembly', 'Extra helpers'],
    profileLabel: 'Studio flat preset, 5 miles, ground floor',
    related: ['flat-removals', 'man-and-van', 'storage-moves'],
    reviewedByOwner: false,
    slug: 'house-removals',
    summary: 'Flats, houses and whole-home moves.',
    title: 'House removals',
    variantKey: 'studio',
  },
  {
    engineKey: 'man-and-van',
    faqs: [
      {
        question: 'How do I book a man and van near me?',
        answer:
          'Find your city or town in the coverage list and enter both addresses. Add the items and access details, then use the calendar to compare available dates and prices for your route.',
      },
      {
        question: 'Can I use a nearby man and van for a short move?',
        answer:
          'Yes. Man and van covers small loads and single items between covered addresses, including local journeys. A short drive still needs an accurate inventory and access details at pickup and dropoff.',
      },
      {
        question: 'Is this for small moves?',
        answer:
          'Yes. Choose it for a few items, a single-room move or a small load. For the contents of a house or flat, the home-move options provide room-size starting points that you can edit.',
      },
      {
        question: 'Can I book for today?',
        answer: 'Same-day booking is shown only when a slot is still open and inside the booking rules.',
      },
      {
        question: 'Can I add helpers?',
        answer: 'Yes. Extra helpers can be added before the price is revealed.',
      },
      {
        question: 'Can extra items be collected too?',
        answer:
          'Yes. Add every item before revealing prices so the quote matches the van space and crew time.',
      },
    ],
    goodToKnow: [
      'Add every bulky item before revealing prices so the van size and crew time are right.',
      'Use the access questions for stairs, long carries, permits and narrow turns.',
    ],
    included: ['Small moves', 'Single-item jobs', 'Item search', 'Fixed slot prices', 'Online confirmation'],
    label: 'Man and van',
    lead: 'Man and van transport for small moves, single bulky items and collections across Scotland. Enter the pickup and dropoff addresses, then choose an available price for the load and access you describe.',
    metaDescription:
      'Man and van across Scotland for small moves and single items. Add both addresses, items and access to compare available dates and prices.',
    options: ['Standard small-move pricing', 'Packing help', 'Furniture assembly', 'Extra helpers'],
    profileLabel: 'One armchair, 5 miles, ground floor',
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
      {
        question: 'How do I find furniture removals near me?',
        answer:
          'Choose your town from the coverage list, then enter the collection and delivery addresses. Add each piece of furniture, its quantity and access at both ends to price the actual journey.',
      },
      {
        question: 'Can I arrange nearby furniture collection and delivery?',
        answer:
          'Yes. Furniture transport can be a short local journey or a move between covered towns. Check that the seller or shop can release the item during the collection slot before booking.',
      },
      {
        question: 'Does furniture removal include disposal?',
        answer:
          'No. This service transports furniture to another address. It does not include disposal, recycling, rubbish collection or house clearance.',
      },
      {
        question: 'Can you move one sofa?',
        answer:
          'Yes. Select the matching sofa type, check the dimensions and access at both addresses, then choose from the available prices. Use the sofa-removals page for a sofa-specific checklist.',
      },
      {
        question: 'Do you collect from shops?',
        answer: 'Yes when the collection and delivery details fit the booking form and the route is covered.',
      },
      {
        question: 'Should I mention tight stairs?',
        answer: 'Yes. Narrow access and carry distance affect planning and price.',
      },
    ],
    goodToKnow: [
      'Measure bulky items and tight entrances before booking when the fit is uncertain.',
      'Choose permit-zone access when the van cannot legally stop close to either address.',
    ],
    included: ['Sofas and beds', 'Bulky furniture', 'Access pricing', 'Slot calendar', 'Card payment'],
    label: 'Furniture delivery',
    lead: 'Furniture removals, collection and delivery across Scotland for sofas, beds, tables and other bulky items. This is transport between addresses; disposal and waste collection are outside the service.',
    metaDescription:
      'Furniture removals, collection and delivery across Scotland. Move sofas, beds and bulky items between addresses. Transport only; no disposal.',
    options: ['Standard furniture delivery', 'Assembly add-on', 'Extra helper add-on'],
    profileLabel: 'Three-seater sofa, 5 miles, ground floor',
    related: ['sofa-removals', 'man-and-van', 'ikea-delivery'],
    reviewedByOwner: false,
    slug: 'furniture-delivery',
    summary: 'Sofas, beds, tables and bulky items.',
    title: 'Furniture removals and delivery',
    variantKey: 'standard',
  },
  {
    engineKey: 'student',
    faqs: [
      {
        question: 'Is this for halls?',
        answer: 'Yes. Choose the halls variant and add the boxes, bags and small items you are moving.',
      },
      { question: 'Can I move between student flats?', answer: 'Yes. Use the shared flat or house variant.' },
      {
        question: 'Can I book around term dates?',
        answer: 'The calendar shows live fixed prices for the next four weeks.',
      },
      {
        question: 'Can I share the manage link?',
        answer: 'The booking email includes a manage link for changes before the move.',
      },
    ],
    goodToKnow: [
      'Student moves often have more bags than furniture; add bags and boxes so the price is accurate.',
      'Check building access rules for halls before move day.',
    ],
    included: ['Halls and shared flats', 'Boxes and bags', 'Live slot prices', 'Online confirmation'],
    label: 'Student moves',
    lead: 'Student room and shared-flat moves with clear prices before you pay.',
    options: ['Halls of residence', 'Shared flat or house', 'Extra helpers'],
    profileLabel: 'Student room preset, 5 miles, ground floor',
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
      {
        question: 'Can I price a small office online?',
        answer: 'Yes. Small office moves are priced from the inventory and access details.',
      },
      {
        question: 'What about larger offices?',
        answer: 'Larger office moves can be routed to a manual fixed quote when a survey is needed.',
      },
      {
        question: 'Can desks and archive boxes be added?',
        answer: 'Yes. The item list includes office furniture, equipment and archive boxes.',
      },
      {
        question: 'Do you price lifts and stairs?',
        answer: 'Yes. Floors, lift availability and carry distance are included before payment.',
      },
    ],
    goodToKnow: [
      'Tell us about building loading rules, goods lifts and permits before booking.',
      'Large offices may need a manual quote so the plan is right.',
    ],
    included: [
      'Small offices',
      'Desks and chairs',
      'Archive boxes',
      'Access pricing',
      'Manual quote routing for larger jobs',
    ],
    label: 'Office moves',
    lead: 'Small office removals with fixed pricing for desks, chairs, boxes and access.',
    options: ['Up to 5 desks', '6-15 desks', '16+ desks by manual quote'],
    profileLabel: 'Small office preset, 5 miles, ground floor',
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
      {
        question: 'Can you move items into storage?',
        answer: 'Yes. Choose the into-storage variant and add the items you are moving.',
      },
      {
        question: 'Can you move from storage?',
        answer: 'Yes. Use the out-of-storage variant when the unit is the pickup address.',
      },
      {
        question: 'Do I add storage access details?',
        answer: 'Yes. Add carry distance, lifts and any narrow access just like a home move.',
      },
      {
        question: 'Can I book a few boxes only?',
        answer: 'Yes. Add the boxes and reveal the available slot prices.',
      },
    ],
    goodToKnow: [
      'Storage sites can have loading rules and lift limits; include them in access notes.',
      'If the route uses a ferry, the team prices it manually.',
    ],
    included: ['Into storage', 'Out of storage', 'Between units', 'Boxes and furniture', 'Fixed slot prices'],
    label: 'Storage moves',
    lead: 'Move furniture and boxes into, out of or between storage units.',
    options: ['Into storage', 'Out of storage', 'Extra helpers'],
    profileLabel: 'Five medium boxes, 5 miles, ground floor',
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
      {
        question: 'Can I add flat-pack boxes?',
        answer:
          'Yes. Add the number of flat-pack boxes or add a custom item if the exact item is not listed.',
      },
      {
        question: 'Can assembly be included?',
        answer: 'Furniture assembly is an optional add-on before checkout.',
      },
      {
        question: 'Do I need two addresses?',
        answer: 'Yes. IKEA and flat-pack delivery is priced as a pickup and dropoff route.',
      },
      {
        question: 'Can I choose a same-day slot?',
        answer: 'Available same-day slots appear in the calendar when they meet the booking rules.',
      },
    ],
    goodToKnow: [
      'Keep order references and collection instructions ready for the driver.',
      'Large or unusually heavy items should be described before checkout.',
    ],
    included: ['Flat-pack boxes', 'Collection and delivery', 'Assembly add-on', 'Slot calendar'],
    label: 'IKEA and flat-pack',
    lead: 'Flat-pack collection, delivery and optional assembly priced before payment.',
    options: ['Standard flat-pack delivery', 'Furniture assembly', 'Extra helpers'],
    profileLabel: 'Three small flat-pack boxes, 5 miles, ground floor',
    related: ['furniture-delivery', 'man-and-van', 'same-day-delivery'],
    reviewedByOwner: false,
    slug: 'ikea-delivery',
    summary: 'Flat-pack collection and delivery.',
    title: 'IKEA and flat-pack delivery',
    variantKey: 'standard',
  },
  {
    engineKey: 'piano',
    faqs: [
      {
        question: 'Can upright pianos be priced online?',
        answer: 'Yes when the access details fit the online flow.',
      },
      {
        question: 'Do grand pianos need a survey?',
        answer: 'Grand and baby grand variants are routed to a manual quote by default.',
      },
      {
        question: 'Should I add stairs?',
        answer: 'Yes. Piano access must be accurate so the right route is chosen.',
      },
      {
        question: 'Can I add other items?',
        answer: 'Use the booking form to add every item that is moving with the piano.',
      },
    ],
    goodToKnow: [
      'Grand pianos are routed to manual quote because access and handling need review.',
      'Tell us about narrow turns and long carries before checkout.',
    ],
    included: [
      'Digital and upright variants',
      'Manual quote routing for grand pianos',
      'Access questions',
      'Fixed slot prices when available',
    ],
    label: 'Piano moving',
    lead: 'Piano moves with access checks and manual quotes for larger piano types.',
    options: ['Digital piano', 'Upright piano', 'Baby grand by manual quote', 'Grand by manual quote'],
    profileLabel: 'Upright piano, 5 miles, ground floor',
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
      {
        question: 'Is same-day always available?',
        answer: 'No. Same-day slots show only when a remaining slot is still open.',
      },
      {
        question: 'Can I book for a future day?',
        answer: 'Use another service for future-day pricing; same-day delivery is for today only.',
      },
      {
        question: 'What can I send?',
        answer: 'Small deliveries and light items that fit the item list or custom item sizes.',
      },
      { question: 'Do I pay online?', answer: 'Yes. The booking is confirmed after online payment.' },
    ],
    goodToKnow: [
      "Same-day delivery only shows today's remaining slots.",
      'If no eligible slot remains, the page shows today as fully booked.',
    ],
    included: ['Today-only slots', 'Small item delivery', 'Fixed online payment', 'Confirmation email'],
    label: 'Same-day delivery',
    lead: 'Urgent small deliveries when there is still a slot available today.',
    options: ['Standard same-day delivery', 'Extra helpers'],
    profileLabel: 'One medium box, 5 miles, ground floor, today only',
    related: ['man-and-van', 'furniture-delivery', 'ikea-delivery'],
    reviewedByOwner: false,
    slug: 'same-day-delivery',
    summary: 'Urgent small deliveries when slots are free.',
    title: 'Same-day delivery',
    variantKey: 'standard',
  },
] as const satisfies ServiceContent[];

export const serviceLandingPages = [
  ...serviceContent,
  {
    engineKey: 'furniture',
    faqs: [
      {
        question: 'How do I find sofa removals near me?',
        answer:
          'Choose your town in the coverage list and enter the sofa collection and delivery addresses. Select the sofa type, add quantities and describe the access at both ends. Prices depend on that route and load, with ferry routes quoted individually.',
      },
      {
        question: 'Can I arrange a nearby sofa collection from a seller?',
        answer:
          'Yes. Use the seller’s address as pickup and your address as dropoff. Agree when the sofa can be released, confirm its dimensions and check access at both properties before choosing an available slot.',
      },
      {
        question: 'Do you remove sofas for disposal?',
        answer:
          'No. Sofa removal here means transporting a sofa to another address, such as a new home or a buyer’s property. It does not include disposal, recycling or waste collection.',
      },
      {
        question: 'Which sofa type should I add?',
        answer:
          'Choose the closest match in the inventory: two-, three- or four-seater, corner sofa or sofa bed. Count separate pieces accurately and include any additional chairs or furniture. For an unusual size or shape, contact the team with measurements before relying on a quote.',
      },
      {
        question: 'What if the sofa might not fit through a doorway?',
        answer:
          'Measure the sofa and the full route through doors, hallways, stairs and landings at both addresses. If fit or handling is uncertain, contact the team before booking. An online quote is not a guarantee that an unmeasured item will fit.',
      },
      {
        question: 'Are stairs at the delivery address included?',
        answer:
          'Enter floors, lift access, narrow access and carry distance separately for collection and delivery. A ground-floor collection does not make an upstairs delivery a ground-floor move.',
      },
    ],
    goodToKnow: [
      'Measure width, height and depth, including fixed arms and feet, before committing to a sofa purchase.',
      'Check the tightest doorway, stair turn and lift opening at both properties; removable parts can change the measurements.',
      'Confirm collection permission and readiness with the seller or shop before booking a slot.',
      'Sofa bookings are transport only. Disposal, recycling and rubbish collection are not included.',
    ],
    included: [
      'Sofa collection and delivery',
      'Sofa-type inventory choices',
      'Separate pickup and dropoff access',
      'Available slot prices',
      'Online confirmation',
    ],
    label: 'Sofa removals',
    lead: 'Sofa removals and collection across Scotland, from a seller, shop or home to another address. Choose the sofa type and describe access at both ends. This is sofa transport, with no disposal or waste collection.',
    metaDescription:
      'Sofa removals and collection across Scotland. Plan transport between addresses, check access and compare available prices. No disposal.',
    options: [
      'Two-, three- and four-seater sofas',
      'Corner sofas',
      'Sofa beds',
      'Extra helpers where needed',
    ],
    priceSourceSlug: 'furniture-delivery',
    profileLabel: 'Three-seater sofa, 5 miles, ground floor',
    related: ['furniture-delivery', 'man-and-van', 'flat-removals'],
    reviewedByOwner: false,
    slug: 'sofa-removals',
    summary: 'Sofa collection and transport between addresses, with no disposal.',
    title: 'Sofa removals',
    variantKey: 'standard',
  },
  {
    engineKey: 'house-removals',
    faqs: [
      {
        question: 'How do I find flat removals near me?',
        answer:
          'Choose your Scottish city or town, then enter the collection and delivery addresses. Start with a studio or bedroom-size option, edit the actual inventory and give access details for both properties before choosing a price.',
      },
      {
        question: 'Can I book a nearby move between flats?',
        answer:
          'Yes. The route can be within the same town or between covered locations. Even a short journey needs the floor, lift, carry distance and parking details for each address; ferry routes are checked and quoted individually.',
      },
      {
        question: 'Does the bedroom size describe pickup or dropoff?',
        answer:
          'It describes the load you are moving, not two property sizes. Use it as an inventory starting point, then remove or add items. Pickup and dropoff have their own access questions, including separate floors and lifts.',
      },
      {
        question: 'Can I move a studio or a partly furnished flat?',
        answer:
          'Yes. Select the closest starting size and edit the furniture, boxes and other belongings to match what is actually moving. Leave out landlord-owned furniture that stays behind, and include items from cupboards or storage that you are taking.',
      },
      {
        question: 'What should I check about a shared stair or lift?',
        answer:
          'Check the floor, lift availability and usable dimensions, tight landings and the distance from the entrance to a legal stopping place. Record these details at both addresses and confirm any building access arrangements before move day.',
      },
      {
        question: 'Is packing or assembly automatic?',
        answer:
          'No. Review the optional packing, assembly and helper choices before revealing prices, and select only the work you need. The quote must reflect the inventory, access and extras you choose.',
      },
    ],
    goodToKnow: [
      'Use the actual floor and door details rather than relying on a flat number to describe access.',
      'A lift may be present but too small for an item; check its opening and usable size before selecting lift access.',
      'Count the furniture and boxes that are moving rather than assuming every furnished-flat item belongs in the load.',
      'Check access and stopping arrangements at the new flat as carefully as at the old one.',
    ],
    included: [
      'Studio and bedroom-size starting points',
      'Editable furniture and box inventory',
      'Pickup and dropoff floor details',
      'Lift and carry-distance questions',
      'Available slot prices',
      'Online confirmation',
    ],
    label: 'Flat removals',
    lead: 'Flat removals across Scotland, with an editable inventory and separate access details for the old and new address. Start with the size of your load, then check the stairs, lifts and carry distance at each end.',
    metaDescription:
      'Flat removals across Scotland. Plan your studio or flat inventory, check stairs and lifts at both addresses and compare available prices.',
    options: ['Studio and bedroom-size home moves', 'Packing help', 'Furniture assembly', 'Extra helpers'],
    priceSourceSlug: 'house-removals',
    profileLabel: 'Studio flat preset, 5 miles, ground floor',
    related: ['house-removals', 'man-and-van', 'sofa-removals'],
    reviewedByOwner: false,
    slug: 'flat-removals',
    summary: 'Studio and flat moves with an editable inventory and access at both ends.',
    title: 'Flat removals',
    variantKey: 'studio',
  },
] as const satisfies ServiceContent[];

export type ServiceSlug = (typeof serviceLandingPages)[number]['slug'];

export function serviceBySlug(slug: string): ServiceContent | undefined {
  return serviceLandingPages.find((service) => service.slug === slug);
}

export function serviceByEngineKey(engineKey: ServiceKey): ServiceContent | undefined {
  return serviceContent.find((service) => service.engineKey === engineKey);
}
