import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { coordinateFor, outputDir, readLocationsCsv, repoPath, writeJson, type GeneratedLocation } from './seo-data-lib';

const locations = readLocationsCsv();
const generated: GeneratedLocation[] = locations.map((location) => ({
  ...location,
  ...coordinateFor(location),
  nearestCities: [],
  nearestLocations: [],
  regionHub: '',
}));

writeJson(resolve(outputDir, 'locations.generated.json'), generated);
mkdirSync(outputDir, { recursive: true });
const fallbackCount = generated.filter((location) => location.confidence === 'fallback').length;
const report = [
  '# Geocode report',
  '',
  `Generated locations: ${String(generated.length)}`,
  `High-confidence seed coordinates: ${String(generated.length - fallbackCount)}`,
  `Fallback coordinates needing Mapbox/manual review: ${String(fallbackCount)}`,
  '',
  'Local Phase 10 run did not have MAPBOX_SECRET_TOKEN available, so non-seeded locations use deterministic region-bounded fallback coordinates. Run this script with MAPBOX_SECRET_TOKEN to replace them with live geocodes before launch.',
  '',
  '## Manual review required',
  '',
  ...generated.filter((location) => location.confidence === 'fallback').map((location) => `- ${location.name}, ${location.council_area} (${location.slug})`),
  '',
].join('\n');
writeFileSync(repoPath('apps/web/src/content/locations/geocode-report.md'), report);
