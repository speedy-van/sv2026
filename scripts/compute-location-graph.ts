import { resolve } from 'node:path';
import { haversineMiles, outputDir, readGeneratedLocations, writeJson, type GeneratedLocation } from './seo-data-lib';

const base = readGeneratedLocations();
const cities = base.filter((location) => location.tier === '1');

const generated: GeneratedLocation[] = base.map((location) => {
  const nearestLocations = base
    .filter((candidate) => candidate.slug !== location.slug)
    .map((candidate) => ({ miles: haversineMiles(location, candidate), slug: candidate.slug }))
    .sort((left, right) => left.miles - right.miles)
    .slice(0, 8)
    .map((candidate) => candidate.slug);
  const nearestCities = cities
    .map((city) => ({ miles: haversineMiles(location, city), slug: city.slug }))
    .sort((left, right) => left.miles - right.miles)
    .slice(0, 3)
    .map((city) => city.slug);
  return {
    ...location,
    nearestCities,
    nearestLocations,
    regionHub: nearestCities[0] ?? 'glasgow',
  };
});

writeJson(resolve(outputDir, 'locations.generated.json'), generated);
