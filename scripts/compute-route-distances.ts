import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  haversineMiles,
  outputDir,
  readGeneratedLocations,
  readRoutesCsv,
  repoPath,
  requireMapboxToken,
  writeJson,
  type GeneratedDistance,
  type GeneratedLocation,
} from './seo-data-lib';

interface MapboxStep {
  mode?: string;
}

interface MapboxLeg {
  steps?: MapboxStep[];
}

interface MapboxRoute {
  distance?: number;
  duration?: number;
  legs?: MapboxLeg[];
}

interface MapboxDirectionsResponse {
  code?: string;
  routes?: MapboxRoute[];
}

interface CachedDistance {
  ferry: boolean;
  miles: number;
  minutes: number;
}

const requiredPairs = [
  ['paisley', 'glasgow'],
  ['glasgow', 'edinburgh'],
  ['aberdeen', 'dundee'],
  ['inverness', 'perth'],
  ['stirling', 'falkirk'],
] as const;

const delay = (milliseconds: number): Promise<void> => new Promise((resolveDelay) => {
  setTimeout(resolveDelay, milliseconds);
});

function cachePath(): string {
  return repoPath('.tmp/mapbox-directions-cache.json');
}

function readCache(): Map<string, CachedDistance> {
  const path = cachePath();
  if (!existsSync(path)) return new Map();
  return new Map(Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, CachedDistance>));
}

function writeCache(cache: ReadonlyMap<string, CachedDistance>): void {
  const path = cachePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`);
}

function routeKey(from: string, to: string): string {
  return `${from}:${to}`;
}

function byKey(left: GeneratedDistance, right: GeneratedDistance): number {
  return routeKey(left.from, left.to).localeCompare(routeKey(right.from, right.to));
}

function nearestCitySlugs(location: GeneratedLocation, cities: readonly GeneratedLocation[]): string[] {
  if (location.nearestCities.length >= 3) return location.nearestCities.slice(0, 3);
  return cities
    .map((city) => ({ miles: haversineMiles(location, city), slug: city.slug }))
    .sort((left, right) => left.miles - right.miles)
    .slice(0, 3)
    .map((city) => city.slug);
}

async function fetchDirections(from: GeneratedLocation, to: GeneratedLocation, token: string): Promise<CachedDistance> {
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${String(from.lng)},${String(from.lat)};${String(to.lng)},${String(to.lat)}`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('alternatives', 'false');
  url.searchParams.set('overview', 'false');
  url.searchParams.set('steps', 'true');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (response.ok) {
      const body = await response.json() as MapboxDirectionsResponse;
      const route = body.routes?.[0];
      if (!route?.distance || !route.duration) throw new Error(`Mapbox returned no route for ${from.slug} to ${to.slug}.`);
      const stepFerry = route.legs?.some((leg) => leg.steps?.some((step) => step.mode === 'ferry')) ?? false;
      return {
        ferry: stepFerry || from.ferry === 'YES' || to.ferry === 'YES',
        miles: Number((route.distance / 1609.344).toFixed(2)),
        minutes: Math.max(1, Math.round(route.duration / 60)),
      };
    }
    if (response.status < 500 || attempt === 3) throw new Error(`Mapbox Directions failed with HTTP ${String(response.status)} for ${from.slug} to ${to.slug}.`);
    await delay(500 * attempt);
  }
  throw new Error(`Mapbox Directions failed for ${from.slug} to ${to.slug}.`);
}

async function distanceFor(from: GeneratedLocation, to: GeneratedLocation, token: string, cache: Map<string, CachedDistance>): Promise<GeneratedDistance> {
  const key = routeKey(from.slug, to.slug);
  const cached = cache.get(key);
  if (cached) return { ...cached, from: from.slug, to: to.slug };
  const distance = await fetchDirections(from, to, token);
  cache.set(key, distance);
  writeCache(cache);
  await delay(220);
  return { ...distance, from: from.slug, to: to.slug };
}

function addPair(target: Set<string>, from: string, to: string): void {
  if (from !== to) target.add(routeKey(from, to));
}

const token = requireMapboxToken();
const locations = readGeneratedLocations();
const bySlug = new Map(locations.map((location) => [location.slug, location]));
const cities = locations.filter((location) => location.tier === '1');
const cache = readCache();
const cityPairs = new Set<string>();
const routePairs = new Set<string>();

for (const location of locations) {
  for (const city of nearestCitySlugs(location, cities)) addPair(cityPairs, location.slug, city);
}
for (const route of readRoutesCsv()) addPair(routePairs, route.from_slug, route.to_slug);
for (const [from, to] of requiredPairs) addPair(cityPairs, from, to);

async function materialize(pairs: ReadonlySet<string>): Promise<GeneratedDistance[]> {
  const distances: GeneratedDistance[] = [];
  for (const pair of [...pairs].sort()) {
    const [fromSlug, toSlug] = pair.split(':');
    const from = fromSlug ? bySlug.get(fromSlug) : undefined;
    const to = toSlug ? bySlug.get(toSlug) : undefined;
    if (!from || !to) throw new Error(`Unknown route pair ${pair}.`);
    distances.push(await distanceFor(from, to, token, cache));
  }
  return distances;
}

writeJson(resolve(outputDir, 'distances.generated.json'), {
  cityDistances: (await materialize(cityPairs)).sort(byKey),
  routes: (await materialize(routePairs)).sort(byKey),
});
