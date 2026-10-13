import { resolve } from 'node:path';
import { coordinateFor, estimateMinutes, outputDir, readLocationsCsv, readRoutesCsv, roadEstimateMiles, writeJson, type GeneratedDistance } from './seo-data-lib';

const locations = readLocationsCsv().map((location) => ({ ...location, ...coordinateFor(location) }));
const bySlug = new Map(locations.map((location) => [location.slug, location]));
const cities = locations.filter((location) => location.tier === '1');
const routes = readRoutesCsv();
const cityDistances = new Map<string, GeneratedDistance>();
const routeDistances = new Map<string, GeneratedDistance>();

function distanceFor(from: string, to: string): GeneratedDistance | null {
  const fromLocation = bySlug.get(from);
  const toLocation = bySlug.get(to);
  if (!fromLocation || !toLocation || from === to) return null;
  const miles = roadEstimateMiles(fromLocation, toLocation);
  return {
    ferry: fromLocation.ferry === 'YES' || toLocation.ferry === 'YES',
    from,
    miles,
    minutes: estimateMinutes(miles),
    to,
  };
}

function addDistance(target: Map<string, GeneratedDistance>, from: string, to: string): void {
  const key = `${from}:${to}`;
  if (target.has(key)) return;
  const distance = distanceFor(from, to);
  if (distance) target.set(key, distance);
}

for (const location of locations) {
  const nearestCities = cities
    .map((city) => ({ miles: roadEstimateMiles(location, city), slug: city.slug }))
    .sort((left, right) => left.miles - right.miles)
    .slice(0, 3);
  for (const city of nearestCities) addDistance(cityDistances, location.slug, city.slug);
}

for (const route of routes) addDistance(routeDistances, route.from_slug, route.to_slug);

const byKey = (left: GeneratedDistance, right: GeneratedDistance): number => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`);

writeJson(resolve(outputDir, 'distances.generated.json'), {
  cityDistances: [...cityDistances.values()].sort(byKey),
  routes: [...routeDistances.values()].sort(byKey),
});
