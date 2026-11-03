import type { LocationPage } from './locations';

export function locationSearchHeading(location: LocationPage): string {
  return location.tier === 1
    ? `House and flat removals in ${location.name}`
    : `Removals and man and van in ${location.name}`;
}

export function locationSearchTitle(location: LocationPage): string {
  return location.tier === 1 ? `House & flat removals in ${location.name}` : `Removals in ${location.name}`;
}

export function cityManAndVanCopy(location: LocationPage): {
  title: string;
  description: string;
  lead: string;
} {
  return {
    title: `Man and van in ${location.name}`,
    description: `Man and van in ${location.name} for small moves, single furniture items and student jobs. Check prices using both addresses and access details.`,
    lead: `Find man and van transport in ${location.name} for a room move, a few boxes or a single item. Enter both addresses, your inventory and access details to check available prices.`,
  };
}

export function locationCopy(location: LocationPage): {
  description: string;
  lead: string;
  routeNote: string | null;
  quoteAction: string;
} {
  if (location.ferry === 'YES')
    return {
      description: `Removals to and from ${location.name}. Ask for an individual quote based on your route, any ferry crossing, items and access.`,
      lead: `Plan a move to, from or around ${location.name} in ${location.councilArea}. Moves that include a ferry crossing are priced individually.`,
      routeNote: `Moves involving ${location.name} are quoted individually. Contact our team to check your exact route and any ferry crossing, with both addresses, items and access details.`,
      quoteAction: 'Request an individual quote',
    };
  if (location.ferry === 'CHECK')
    return {
      description: `Removals in ${location.name}. Check your exact route and any ferry crossing with our team before confirming your price.`,
      lead: `Plan your move in ${location.name} and ${location.councilArea}. The exact addresses determine whether a ferry crossing needs to be included.`,
      routeNote: `Routes involving ${location.name} need an address-based check for any ferry crossing. Our team can confirm the route and how it will be quoted.`,
      quoteAction: 'Check your route with us',
    };
  return {
    description: `House, flat and furniture removals in ${location.name}. Find man and van for small moves, priced using both addresses, items and access.`,
    lead: `Fixed-price moves to, from and around ${location.name} and ${location.councilArea}. Enter your addresses, items and access to see available slots.`,
    routeNote: null,
    quoteAction: 'Start your move',
  };
}

export const locationPageCopy = {
  exampleCaption:
    'Ground floors, no access charges or optional extras. The within-town distance is a stated example; inter-city distances are the recorded road routes. Presets use the current item catalogue. Your exact addresses and items determine your quote.',
  quoteFactors:
    'Distance, inventory, stairs, lift access, carry distance, optional extras and the available slot you choose determine your fixed quote.',
  routeCaption:
    'Ground floors at both addresses, no access charges or optional extras. Distances and drive times are estimates between the named places; your exact addresses can change the route.',
  routePreparation:
    'List your furniture and boxes, then add the floor, lift, carry distance and parking details at both addresses. The booking calendar uses those details to show available fixed prices.',
} as const;

export function locationFaqs(
  location: LocationPage,
  smallMovePrice?: string,
): Array<{ question: string; answer: string }> {
  const copy = locationCopy(location);
  return [
    {
      question: `How are removals in ${location.name} priced?`,
      answer:
        copy.routeNote ??
        `The stated small-move example is ${smallMovePrice?.toLowerCase() ?? 'priced in booking'}. ${locationPageCopy.quoteFactors}`,
    },
    {
      question: `Do you cover ${location.name}?`,
      answer: `We cover moves to, from and around ${location.name} in ${location.councilArea}. ${copy.routeNote ?? 'Enter your exact addresses to check your route and available prices.'}`,
    },
    { question: 'What details do I need for a quote?', answer: locationPageCopy.routePreparation },
    {
      question: `Can I book furniture or sofa removals in ${location.name}?`,
      answer: `Choose furniture transport for a sofa, bed, table or other listed items going to another address. This is not a disposal or clearance service. ${copy.routeNote ?? 'List each item and check doorways, stairs, lifts and parking at pickup and delivery before choosing a slot.'}`,
    },
    {
      question: 'How do I find a nearby man and van for a small move?',
      answer: `Use your full pickup and delivery addresses, rather than the town name alone, to check a small move in or around ${location.name}. The nearby-town links help you find the right coverage page. ${copy.routeNote ?? 'Choose man and van, add the actual items and enter access details at both ends.'}`,
    },
  ];
}
