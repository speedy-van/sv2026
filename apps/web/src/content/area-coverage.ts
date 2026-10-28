import type { LocationPage, RoutePage } from './locations';

export const areaCoverageCopy = {
  allAreas: 'All areas',
  allTowns: 'All towns and cities',
  cities: 'Moving services by city',
  councilCoverage: 'Towns and cities by council area',
  ferry:
    'Moves that need a ferry crossing are quoted individually by our team. Share both addresses and any crossing details before arranging your move.',
  lead: 'Removals, man and van jobs and furniture moves across Scotland. Mainland routes are priced online; moves that need a ferry crossing are quoted individually.',
  localNotes: 'Moving in the local area',
  regions: 'Regions',
  routeLead:
    'Find the road distance, journey time and example prices for your route. Your booking price uses your exact addresses, items and access details.',
  routes: 'Removal routes across Scotland',
  routesInRegion: 'Routes from this region',
  title: 'Areas we cover',
} as const;

export function localAreaDescription(location: LocationPage): string {
  return `${location.name} is in ${location.councilArea}, in the ${location.postcodeArea} postcode area. Your price uses the full pickup and delivery addresses, items and access details.`;
}

export function cityPriceQuestion(
  city: string,
  price: string,
  profile: string,
  available: boolean,
): { answer: string; question: string } {
  return {
    answer: available
      ? `${price} for this example: ${profile}. It assumes ground floors at both addresses, no access charges and no optional extras. Your exact addresses, items, access and chosen slot determine your price.`
      : `${price}. Add your exact addresses, items and access details in the booking form to check the available options.`,
    question: `How much does man and van in ${city} cost?`,
  };
}

export interface CouncilLocationGroup {
  councilArea: string;
  locations: LocationPage[];
}

export function groupLocationsByCouncil(locations: readonly LocationPage[]): CouncilLocationGroup[] {
  const groups = new Map<string, LocationPage[]>();
  for (const location of locations) {
    const group = groups.get(location.councilArea) ?? [];
    group.push(location);
    groups.set(location.councilArea, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en-GB'))
    .map(([councilArea, group]) => ({
      councilArea,
      locations: group.sort((left, right) => left.name.localeCompare(right.name, 'en-GB')),
    }));
}

export function regionalCoverageLead(region: string, councils: readonly string[]): string {
  const councilNames = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(councils);
  return `Plan a removal, man and van job or furniture move in ${region}. Browse the towns and cities covered in ${councilNames}, then add your pickup and delivery addresses for a price.`;
}

export function routesFromLocations(
  locations: readonly LocationPage[],
  routes: readonly RoutePage[],
): RoutePage[] {
  const slugs = new Set(locations.map((location) => location.slug));
  return routes.filter((route) => slugs.has(route.fromSlug));
}
