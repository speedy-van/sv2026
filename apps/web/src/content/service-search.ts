import type { LocationPage } from './locations';

export type SearchIntentId =
  'man-and-van' | 'furniture-removals' | 'sofa-removals' | 'house-removals' | 'flat-removals';

export interface SearchIntent {
  id: SearchIntentId;
  label: string;
  nearMeQuery: string;
  nearbyQuery: string;
  serviceSlug: string;
}

export interface ServiceSearchContent {
  coverageHeading: string;
  coverageLead: string;
  sections: Array<{ bullets?: string[]; heading: string; paragraphs: string[] }>;
}

export interface LocalSearchSection {
  heading: string;
  id: SearchIntentId;
  paragraphs: string[];
  serviceHref: string;
  serviceLabel: string;
}

export const searchIntents = [
  {
    id: 'man-and-van',
    label: 'Man and van',
    nearMeQuery: 'man and van near me',
    nearbyQuery: 'man and van nearby',
    serviceSlug: 'man-and-van',
  },
  {
    id: 'furniture-removals',
    label: 'Furniture removals',
    nearMeQuery: 'furniture removal near me',
    nearbyQuery: 'furniture removal nearby',
    serviceSlug: 'furniture-delivery',
  },
  {
    id: 'sofa-removals',
    label: 'Sofa removals',
    nearMeQuery: 'sofa removal near me',
    nearbyQuery: 'sofa removal nearby',
    serviceSlug: 'sofa-removals',
  },
  {
    id: 'house-removals',
    label: 'House removals',
    nearMeQuery: 'house removal near me',
    nearbyQuery: 'house removal nearby',
    serviceSlug: 'house-removals',
  },
  {
    id: 'flat-removals',
    label: 'Flat removals',
    nearMeQuery: 'flat removal near me',
    nearbyQuery: 'flat removal nearby',
    serviceSlug: 'flat-removals',
  },
] as const satisfies SearchIntent[];

const serviceSearchContent: Record<string, ServiceSearchContent> = {
  'man-and-van': {
    coverageHeading: 'Find man and van services in your city or town',
    coverageLead:
      'Looking for a man and van near you? Choose the place where your move starts or ends, then enter both addresses. Prepare your inventory and access details with the city or town guidance, then use the booking calendar to compare available dates and prices.',
    sections: [
      {
        heading: 'A small load needs an accurate item list',
        paragraphs: [
          'Man and van is a useful starting point for a few pieces of furniture, boxes from one room or an item collected from another address. Describe the load itself rather than choosing by the number of miles alone. A local journey with bulky furniture can need more planning than a longer trip with a few boxes.',
          'Search the inventory for each item and set its quantity. Include chairs, bags and boxes travelling with the main item. For an unusual size or shape, contact the team with measurements before relying on a quote. If you are moving most of a house or flat, compare the home-move options so you can start from a room-size inventory and edit it.',
        ],
        bullets: [
          'Single furniture items or a small group of belongings',
          'Collections from a seller, shop or another home',
          'Short local moves and journeys between covered towns',
        ],
      },
      {
        heading: 'Plan the collection and delivery separately',
        paragraphs: [
          'A ground-floor pickup and an upstairs delivery are different access tasks. Enter the floor and lift details for each address, then check the distance between the entrance and a legal stopping place. Include narrow doors, shared stairs or tight turns that affect the route out or in.',
          'For a marketplace or shop collection, confirm the correct address, when the item can be released and who can provide access. Measure a bulky purchase before booking it. The destination needs its own check: an item that leaves the seller’s house easily may face a smaller doorway or lift at your property.',
        ],
      },
      {
        heading: 'Compare available prices for the actual journey',
        paragraphs: [
          'The booking flow combines your two addresses, inventory, access and selected options before showing the eligible dates and time windows. Review those details before comparing prices. Extra helpers, packing or assembly should be selected when you need them, rather than assumed to be part of every small move.',
          'For a nearby man and van move, use the calendar to compare eligible dates and prices after entering both addresses. Ferry routes and jobs needing an individual review follow the manual-quote route; contact the team with your route and load details to plan those journeys.',
        ],
      },
      {
        heading: 'Choose transport that matches the job',
        paragraphs: [
          'For a sofa only, the sofa-removals guide covers the different sofa types and the measurements to check. For beds, wardrobes or several pieces, furniture removals and delivery focuses on the full furniture list. Whole-home and flat moves have their own inventory starting points.',
          'The destination must be another address receiving the belongings. Furniture transport does not include disposal, recycling, rubbish collection or house clearance. If the route or item is uncertain, explain it to the team before choosing a slot rather than leaving a material detail out of the quote.',
        ],
      },
    ],
  },
  'furniture-delivery': {
    coverageHeading: 'Furniture removals and delivery by city and town',
    coverageLead:
      'For furniture removal near you, choose your collection or delivery town below. Each link leads to practical furniture-transport guidance for that place. Enter both full addresses, the furniture and access details, then compare the available dates and prices for your journey.',
    sections: [
      {
        heading: 'Collection, delivery and moving furniture between homes',
        paragraphs: [
          'Furniture removals here means taking furniture from one address to another. That can be a sofa collected from a seller, a bed delivered to a new home or several pieces moved together. Select every item and quantity, including the smaller pieces travelling with the main purchase.',
          'Keep the collection and delivery arrangements clear. Check that a seller or shop can release the goods in the selected time window and that someone can provide access at the destination. Use the actual collection address, rather than a shop’s office address or a town-centre postcode.',
        ],
        bullets: [
          'Sofas, armchairs, tables, beds and other listed furniture',
          'Private-seller, shop and home-to-home collections',
          'Transport to a receiving address, with no disposal or waste collection',
        ],
      },
      {
        heading: 'Measure the item and its route through each property',
        paragraphs: [
          'Record width, depth and height, and check whether legs, arms or other parts are fixed or removable. Look at the tightest opening rather than only the front door: a hallway turn, lift entrance or stair landing can determine whether the furniture has a usable route.',
          'Check these measurements at both ends before committing to a purchase or a move. Review the furniture assembly option if you need assembly. Ask the team about dismantling or uncertain fit and handling before booking, with measurements to explain the item and access.',
        ],
      },
      {
        heading: 'Access can matter as much as the driving distance',
        paragraphs: [
          'A nearby furniture delivery still needs floors, lift availability, carry distance and narrow access entered for pickup and dropoff separately. Do not copy the collection details into the delivery side unless they genuinely match. Check stopping restrictions with the relevant property or authority instead of assuming the van can park at the door.',
          'The inventory, route, access, extras and available date determine the quote. The example on this page describes one stated sofa profile, not every furniture job. Add a wardrobe, extra bed or upstairs access to your own booking so the prices reflect the work you need.',
        ],
      },
      {
        heading: 'Furniture transport has a receiving destination',
        paragraphs: [
          'Furniture collection and delivery covers belongings being moved to another home, buyer, shop or other receiving address. It does not include disposal, recycling, rubbish removal or house clearance. Please use a suitable separate service for unwanted items that need to enter a waste stream.',
          'For a sofa-specific move, use the sofa-removals checklist for seating types and access measurements. For the contents of a whole home, start with house or flat removals and edit the room-size inventory. Ferry crossings and unusual handling requirements need a route or job review before a price can be relied on.',
        ],
      },
    ],
  },
  'sofa-removals': {
    coverageHeading: 'Sofa removals and collection in Scottish cities and towns',
    coverageLead:
      'Searching for sofa removal near you or a nearby sofa collection? Choose the collection or delivery town, check the sofa guidance and then enter both addresses. Compare available dates for sofa transport to a receiving address. This service does not include disposal or waste collection.',
    sections: [
      {
        heading: 'Select the sofa you are actually moving',
        paragraphs: [
          'A two-seater, four-seater, corner sofa and sofa bed are not interchangeable inventory entries. Choose the closest listed type and the correct quantity. Add any armchairs, footstools, boxes or other furniture travelling with it rather than treating the whole load as one sofa.',
          'For a modular or unusual sofa, establish how many pieces it has and whether it separates for transport. Measure each part as it will travel. If the catalogue entry does not describe its size or shape, contact the team with those measurements before relying on a quote.',
        ],
        bullets: [
          'Two-, three- and four-seater sofa choices',
          'Corner sofas and sofa beds',
          'Additional chairs and furniture entered as separate items',
        ],
      },
      {
        heading: 'Check doors, corners, stairs and lifts before collection',
        paragraphs: [
          'Measure the sofa’s width, height and depth, including fixed arms and feet. Then follow its route out of the collection property and into the destination. Check door openings, hall turns, stair landings and lift openings as well as the room where the sofa will sit.',
          'Ask the seller which parts are removable and confirm that information before booking. Do not assume a sofa will fit into a lift because people can use it. When an opening or turn is doubtful, contact the team with measurements before choosing a slot; an online price is not a fit guarantee.',
        ],
      },
      {
        heading: 'Agree readiness at both ends of the sofa journey',
        paragraphs: [
          'For a seller or shop collection, confirm that the sofa is available for release, where collection takes place and who will provide access. Coordinate the available collection window with the receiving address. The booking needs the real pickup point, not a seller’s approximate neighbourhood.',
          'Enter collection and delivery floors, lifts, narrow access and carry distances independently. A short nearby sofa move can still include shared stairs or a long walk from the stopping place. Select any applicable helper or assembly option explicitly, and include other furniture before comparing prices.',
        ],
      },
      {
        heading: 'Sofa removal means transport, with no disposal',
        paragraphs: [
          'This service moves a sofa to another receiving address, for example a new home or a buyer’s property. It does not include sofa disposal, recycling, rubbish collection or house clearance. A collection address and a delivery destination are required for the transport journey.',
          'The displayed example is a three-seater sofa travelling five miles with ground-floor access. Your sofa type, additional items, route and access may produce a different price. Availability is shown for the actual booking, while ferry routes and uncertain handling details require individual review.',
        ],
      },
    ],
  },
  'house-removals': {
    coverageHeading: 'House removals by Scottish city and town',
    coverageLead:
      'Find house removals near you by choosing the place you are moving from or to. The town pages bring together the actual council area, route information and access questions to prepare. Nearby coverage does not replace checking both full addresses and available dates.',
    sections: [
      {
        heading: 'Build one inventory for the belongings that are moving',
        paragraphs: [
          'Choose a home-size starting point, then edit it room by room. A bedroom count helps start the list, but the furniture, boxes and quantities must match your move. Include belongings from storage areas that are coming with you, and remove furniture that stays at the old property.',
          'The size describes the load, not a separate pickup-house and delivery-house size. Moving from a larger house to a smaller one does not tell the system which items you are taking. Check the inventory itself, including beds, wardrobes, tables and the boxes packed around them.',
        ],
        bullets: [
          'Review each room rather than accepting a preset unchanged',
          'Count boxes and smaller items alongside bulky furniture',
          'Include only the belongings travelling on this move',
        ],
      },
      {
        heading: 'Prepare both the old home and the new address',
        paragraphs: [
          'Describe pickup and dropoff access separately. Floors, lifts, narrow turns and the walk to a legal stopping place can differ considerably between the properties. For large furniture, measure doors, hallways and stairs along the complete route out and in.',
          'Check keys, entry arrangements and any building or parking requirements before the move. Ask the appropriate property contact or authority about restrictions rather than assuming a permit or stopping space is included. The new address needs this preparation even if you already know the old home well.',
        ],
      },
      {
        heading: 'Choose the work and date your house move needs',
        paragraphs: [
          'Review packing, furniture assembly and helper options before revealing prices. Choose the work you need and keep the inventory and access details consistent with it. A whole-home move should not be entered as a single furniture item to reach a smaller example price.',
          'Compare the available dates and time windows for your actual route and load. A short house removal nearby is still priced using the work at both addresses, and a longer route needs the correct destination. Ferry routes and larger or unusual jobs may need an individual fixed quote rather than the general example on this page.',
        ],
      },
      {
        heading: 'Use the service that matches how much is moving',
        paragraphs: [
          'For a flat or studio, the flat-removals guide concentrates on shared stairs, lifts, furnished-property inventories and separate access at each end. For a few belongings or a single-room load, compare man and van. For one sofa or several pieces without the rest of the home, use the furniture transport options.',
          'House-removal prices depend on the details you provide and the available slot, not a claim that every house of the same bedroom count costs the same. Review any changes before payment so that extra furniture, a different route or harder access is reflected in the prices you choose from.',
        ],
      },
    ],
  },
  'flat-removals': {
    coverageHeading: 'Flat removals in Scottish cities and towns',
    coverageLead:
      'Looking for flat removals near you? Choose your city or town, then plan the inventory and access for the old and new flat. A nearby move can still have different stairs, lift dimensions and carry distances at each end, so use both full addresses for your quote.',
    sections: [
      {
        heading: 'Start with the flat size, then edit the contents',
        paragraphs: [
          'A studio or bedroom-size option starts an inventory; it does not replace checking what is moving. Remove landlord-owned furniture that stays in a furnished flat and add the belongings you are taking. Include boxes, bags, desks and stored items alongside the main furniture.',
          'The size refers to the single load travelling between addresses. You do not need a second bedroom count for the destination. If a new flat is smaller, change the inventory to show what you will actually take rather than assuming the property sizes explain the difference.',
        ],
        bullets: [
          'Studio and bedroom-size inventory starting points',
          'Editable item quantities for furnished and unfurnished moves',
          'Separate pickup and dropoff access details',
        ],
      },
      {
        heading: 'Check the usable route through the building',
        paragraphs: [
          'Record the actual floor for each property and whether a suitable lift can be used. A flat number alone is not an access description. Check shared doors, stair widths, tight landings and the dimensions of the lift opening and interior against the furniture that needs to pass through them.',
          'Measure the destination route as well as the collection route. A wardrobe or sofa that leaves one flat easily may not turn through the next building’s landing. Contact the team before booking when a fit or handling question remains unresolved, and describe narrow access accurately in the form.',
        ],
      },
      {
        heading: 'Plan stopping, entry and collection arrangements',
        paragraphs: [
          'Check how far belongings must be carried between each entrance and a legal stopping place. Include the relevant carry distance and parking or permit-zone details in the access questions. Confirm restrictions with the building contact or appropriate authority; do not assume a town-wide rule applies to your street.',
          'Arrange keys, building entry and any shared-lift or loading arrangements before the move. For a nearby flat removal, the drive may be short while the access tasks still take planning. Make sure the receiving property can be accessed during the selected time window.',
        ],
      },
      {
        heading: 'Compare prices after the flat details are complete',
        paragraphs: [
          'The booking uses the inventory, route, access at both addresses and selected extras to show eligible dates and prices. Packing help, assembly and extra helpers are choices to review, not automatic parts of every flat move. A studio example with ground-floor access is not a price promise for an upstairs two-bedroom move.',
          'For only a few belongings, compare man and van; for one sofa, use the sofa checklist. A flat move that needs a ferry crossing is quoted individually, and uncertain routes or unusually large jobs need review. Keep the details accurate before payment so the chosen price describes the move you are planning.',
        ],
      },
    ],
  },
};

export function getServiceSearchContent(slug: string): ServiceSearchContent | undefined {
  return Object.hasOwn(serviceSearchContent, slug) ? serviceSearchContent[slug] : undefined;
}

export function localSearchSections(location: LocationPage): LocalSearchSection[] {
  return [
    {
      id: 'man-and-van',
      heading: `Man and van in ${location.name}`,
      paragraphs: [
        `For a small move in, to or from ${location.name}, start with the belongings you need transported: a few furniture items, boxes from one room or a collection from another address. Add every item and its quantity rather than choosing only by how short the drive is. For most of a home, use the house or flat inventory options instead.`,
        `If you are looking for a man and van nearby, enter the actual collection and delivery points in ${location.name} or the other town on your route. Check floors, lifts, narrow turns and the walk from a legal stopping place at both ends. A seller’s collection time and the receiving property’s access both need to work with the slot you choose.`,
      ],
      serviceHref: '/services/man-and-van',
      serviceLabel: 'Man and van planning and booking',
    },
    {
      id: 'furniture-removals',
      heading: `Furniture removals and delivery in ${location.name}`,
      paragraphs: [
        `Furniture removal in ${location.name} covers collection and transport to another receiving address. Add the beds, tables, wardrobes, sofas or other pieces that are moving, with accurate quantities. Confirm that the seller, shop or household can release the furniture and that the destination can receive it during the chosen window.`,
        'Measure bulky pieces and check door openings, hallway turns, stairs and lift dimensions at both properties. Enter pickup and delivery access separately, and choose assembly or helpers only when you need those options. Furniture transport does not include disposal, recycling, rubbish collection or house clearance.',
      ],
      serviceHref: '/services/furniture-delivery',
      serviceLabel: 'Furniture removals, collection and delivery guidance',
    },
    {
      id: 'sofa-removals',
      heading: `Sofa removals and collection in ${location.name}`,
      paragraphs: [
        `For sofa transport in ${location.name}, choose the matching sofa type in the inventory: two-, three- or four-seater, corner sofa or sofa bed. Count separate pieces and add any chairs or other furniture travelling with it. Confirm the collection point and release arrangements with a seller before committing to a slot.`,
        'Measure the sofa as it will travel, including fixed arms or feet, then check the complete route out and in: doors, landings, stair turns and lifts. Tell us about access at both addresses, and contact the team first if fit is uncertain. Sofa removal is transport to another address and does not include disposal, recycling or waste collection.',
      ],
      serviceHref: '/services/sofa-removals',
      serviceLabel: 'Sofa types, measurements and collection guidance',
    },
    {
      id: 'house-removals',
      heading: `House removals in ${location.name}`,
      paragraphs: [
        `Plan a house removal to, from or within ${location.name} by reviewing what is actually leaving the property. Start with a home-size inventory, then check each room, furniture quantity and box count. Include belongings from cupboards or storage that are coming with you, and remove anything staying behind. The chosen size describes one load rather than a separate size for each address.`,
        'Check the old and new property independently: floors, lifts, door widths, narrow turns, carry distance and stopping arrangements can differ. Review packing, assembly and helper choices before revealing prices. A nearby move still needs the complete inventory and access details; the number of bedrooms alone does not determine the work.',
      ],
      serviceHref: '/services/house-removals',
      serviceLabel: 'House-removal inventory and preparation guidance',
    },
    {
      id: 'flat-removals',
      heading: `Flat removals in ${location.name}`,
      paragraphs: [
        `For a flat removal in ${location.name}, use a studio or bedroom-size option as a starting point and edit the contents to match your belongings. A furnished-flat move may leave the landlord’s furniture behind while still including boxes, bags, desks and other stored items. The inventory should describe what travels, rather than everything present in the flat.`,
        'Enter the actual floor and lift details at pickup and dropoff separately. Check whether furniture fits through shared doors, stairs, landings and the usable lift opening, then confirm building entry and the distance to a legal stopping place. A short move between nearby flats can have very different access at each end; do not rely on a flat number to explain it.',
      ],
      serviceHref: '/services/flat-removals',
      serviceLabel: 'Flat-removal inventory, stairs and lift guidance',
    },
  ];
}
