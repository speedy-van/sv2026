import 'server-only';

import distancesData from './locations/distances.generated.json';
import locationsData from './locations/locations.generated.json';
import { serviceByEngineKey } from './services';

export type RegionSlug =
  | 'argyll-and-bute'
  | 'ayrshire-and-arran'
  | 'edinburgh-and-lothians'
  | 'fife'
  | 'forth-valley'
  | 'glasgow-and-clyde'
  | 'highlands'
  | 'islands'
  | 'lanarkshire'
  | 'north-east'
  | 'south-of-scotland'
  | 'tayside';

export interface LocationPage {
  cityDistances: Array<{ ferry: boolean; miles: number; minutes: number; slug: string }>;
  confidence: 'manual' | 'mapbox';
  councilArea: string;
  ferry: 'NO' | 'YES' | 'CHECK';
  island: boolean;
  latitude: number;
  longitude: number;
  name: string;
  nearest: string[];
  nearestCities: string[];
  postcodeArea: string;
  region: RegionSlug;
  regionHub: string;
  slug: string;
  tier: 1 | 2 | 3;
}

export interface RoutePage {
  distanceMiles: number;
  fromName: string;
  fromSlug: string;
  minutes: number;
  slug: string;
  toName: string;
  toSlug: string;
}

export const regionLabels: Record<RegionSlug, string> = {
  'argyll-and-bute': 'Argyll and Bute',
  'ayrshire-and-arran': 'Ayrshire and Arran',
  'edinburgh-and-lothians': 'Edinburgh and Lothians',
  fife: 'Fife',
  'forth-valley': 'Forth Valley',
  'glasgow-and-clyde': 'Glasgow and Clyde',
  highlands: 'Highlands',
  islands: 'Islands',
  lanarkshire: 'Lanarkshire',
  'north-east': 'North East',
  'south-of-scotland': 'South of Scotland',
  tayside: 'Tayside',
};

export const citySlugs = ['glasgow', 'edinburgh', 'aberdeen', 'dundee', 'inverness', 'perth', 'stirling', 'dunfermline'] as const;

interface GeneratedLocationRow {
  council_area: string;
  confidence: 'manual' | 'mapbox';
  ferry: 'NO' | 'YES' | 'CHECK';
  island: 'Y' | 'N';
  lat: number;
  lng: number;
  name: string;
  nearestCities: string[];
  nearestLocations: string[];
  postcode_area: string;
  region: RegionSlug;
  regionHub: string;
  slug: string;
  tier: string;
}

interface GeneratedRouteRow {
  ferry: boolean;
  from: string;
  miles: number;
  minutes: number;
  to: string;
}

interface GeneratedDistancesFile {
  cityDistances: GeneratedRouteRow[];
  routes: GeneratedRouteRow[];
}

const generatedLocations = locationsData as GeneratedLocationRow[];
const generatedDistances: GeneratedDistancesFile = distancesData;

export const locationPages: LocationPage[] = generatedLocations.map((location) => ({
  cityDistances: generatedDistances.cityDistances
    .filter((route) => route.from === location.slug && (citySlugs as readonly string[]).includes(route.to))
    .map((route) => ({ ferry: route.ferry, miles: route.miles, minutes: route.minutes, slug: route.to }))
    .slice(0, 3),
  confidence: location.confidence,
  councilArea: location.council_area,
  ferry: location.ferry,
  island: location.island === 'Y',
  latitude: location.lat,
  longitude: location.lng,
  name: location.name,
  nearest: location.nearestLocations,
  nearestCities: location.nearestCities,
  postcodeArea: location.postcode_area,
  region: location.region,
  regionHub: location.regionHub,
  slug: location.slug,
  tier: location.tier === '1' ? 1 : location.tier === '2' ? 2 : 3,
}));

export const routePages: RoutePage[] = generatedDistances.routes
  .map((route) => {
    const from = locationPages.find((location) => location.slug === route.from);
    const to = locationPages.find((location) => location.slug === route.to);
    if (!from || !to) return null;
    return {
      distanceMiles: route.miles,
      fromName: from.name,
      fromSlug: from.slug,
      minutes: route.minutes,
      slug: `${from.slug}-to-${to.slug}`,
      toName: to.name,
      toSlug: to.slug,
    };
  })
  .filter((route): route is RoutePage => Boolean(route));

export const locationsBySlug = new Map(locationPages.map((location) => [location.slug, location]));
export const routesBySlug = new Map(routePages.map((route) => [route.slug, route]));

export const regions = (Object.keys(regionLabels) as RegionSlug[]).map((slug) => ({
  count: locationPages.filter((location) => location.region === slug).length,
  label: regionLabels[slug],
  slug,
}));

export function locationUrl(location: LocationPage): string {
  return `/removals/${location.slug}`;
}

export function routeUrl(route: RoutePage): string {
  return `/removals/${route.slug}`;
}

export function cityUrl(location: LocationPage): string {
  return `/man-and-van/${location.slug}`;
}

export function isCitySlug(slug: string): boolean {
  return (citySlugs as readonly string[]).includes(slug);
}

export function isIndexableLocation(location: LocationPage, indexTier3: boolean, publishedLocalNotes?: string | null): boolean {
  const noteWords = publishedLocalNotes?.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return location.tier < 3 || indexTier3 || noteWords >= 120;
}

export function canonicalOrigin(fallback = 'https://www.speedyvan.uk'): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? fallback;
}

export function nearestLocations(location: LocationPage, limit = 8): LocationPage[] {
  return location.nearest.map((slug) => locationsBySlug.get(slug)).filter((item): item is LocationPage => Boolean(item)).slice(0, limit);
}

export function nearbyCities(location: LocationPage): LocationPage[] {
  return location.nearestCities.map((slug) => locationsBySlug.get(slug)).filter((item): item is LocationPage => Boolean(item));
}

export function regionLocations(region: RegionSlug): LocationPage[] {
  return locationPages.filter((location) => location.region === region).sort((left, right) => left.name.localeCompare(right.name));
}

export function routeDistanceFor(location: LocationPage): { miles: number; minutes: number } {
  const first = location.cityDistances[0];
  if (!first) throw new Error(`No committed road distance is available for ${location.slug}.`);
  return { miles: first.miles, minutes: first.minutes };
}

export function routeJsonLd(route: RoutePage, origin: string): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    areaServed: [route.fromName, route.toName].map((name) => ({ '@type': 'City', name })),
    name: `${route.fromName} to ${route.toName} removals`,
    provider: { '@id': `${origin.replace(/\/$/, '')}/#business` },
    serviceType: 'Removals',
  };
}

export function serviceJsonLd(location: LocationPage, origin: string, service: 'house-removals' | 'man-and-van' = 'house-removals'): unknown {
  const content = serviceByEngineKey(service);
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    areaServed: { '@type': 'City', name: location.name, containedInPlace: { '@type': 'AdministrativeArea', name: location.councilArea } },
    name: `${content?.label ?? 'Removals'} in ${location.name}`,
    provider: { '@id': `${origin.replace(/\/$/, '')}/#business` },
    serviceType: content?.label ?? 'Removals',
  };
}

export function breadcrumbJsonLd(items: Array<{ href: string; name: string }>): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      item: item.href,
      name: item.name,
      position: index + 1,
    })),
  };
}
