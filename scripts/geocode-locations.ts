import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  insideScotlandBounds,
  normalizePlaceName,
  outputDir,
  readLocationOverrides,
  readLocationsCsv,
  repoPath,
  requireMapboxToken,
  scotlandBounds,
  writeJson,
  type CsvLocation,
  type GeneratedLocation,
} from './seo-data-lib';

interface MapboxFeature {
  id?: string;
  place_name?: string;
  text?: string;
  center?: [number, number];
  geometry?: {
    coordinates?: [number, number];
  };
  context?: Array<{ id?: string; text?: string }>;
  place_type?: string[];
  properties?: {
    context?: Record<string, { name?: string } | undefined>;
    coordinates?: {
      latitude?: number;
      longitude?: number;
    };
    feature_type?: string;
    full_address?: string;
    mapbox_id?: string;
    match_code?: {
      confidence?: string;
    };
    name?: string;
  };
}

interface MapboxResponse {
  features?: MapboxFeature[];
}

interface GeocodedLocation extends GeneratedLocation {
  matchKind: 'manual' | 'named-feature' | 'place';
  query: string;
}

interface ReviewItem {
  councilArea: string;
  issue: string;
  name: string;
  slug: string;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolveDelay) => {
  setTimeout(resolveDelay, milliseconds);
});

function contextNames(feature: MapboxFeature): string[] {
  const contextObject = feature.properties?.context;
  const objectNames = contextObject ? Object.values(contextObject).map((item) => item?.name).filter((item): item is string => Boolean(item)) : [];
  const legacyNames = feature.context?.map((item) => item.text).filter((item): item is string => Boolean(item)) ?? [];
  return [
    feature.properties?.name,
    feature.text,
    feature.place_name,
    feature.properties?.full_address,
    ...objectNames,
    ...legacyNames,
  ].filter((item): item is string => Boolean(item));
}

function coordinates(feature: MapboxFeature): { lat: number; lng: number } | null {
  const propertiesCoordinates = feature.properties?.coordinates;
  if (typeof propertiesCoordinates?.latitude === 'number' && typeof propertiesCoordinates.longitude === 'number') {
    return { lat: propertiesCoordinates.latitude, lng: propertiesCoordinates.longitude };
  }
  const pair = feature.center ?? feature.geometry?.coordinates;
  if (!pair) return null;
  return { lat: pair[1], lng: pair[0] };
}

function matchedCouncilArea(feature: MapboxFeature, expectedCouncilArea: string): string | null {
  const expected = normalizePlaceName(expectedCouncilArea);
  const names = contextNames(feature);
  return names.find((name) => normalizePlaceName(name).includes(expected) || expected.includes(normalizePlaceName(name))) ?? null;
}

function featureType(feature: MapboxFeature): string {
  return feature.properties?.feature_type ?? feature.place_type?.[0] ?? '';
}

function isHighConfidence(feature: MapboxFeature, location: CsvLocation): boolean {
  const point = coordinates(feature);
  if (!point || !insideScotlandBounds(point)) return false;
  const type = featureType(feature);
  if (type && !['locality', 'place', 'postcode'].includes(type)) return false;
  const confidence = feature.properties?.match_code?.confidence;
  if (confidence && !['exact', 'high'].includes(confidence)) return false;
  return Boolean(matchedCouncilArea(feature, location.council_area));
}

function containsLocationName(feature: MapboxFeature, location: CsvLocation): boolean {
  const expected = normalizePlaceName(location.name);
  return contextNames(feature).some((name) => normalizePlaceName(name).includes(expected));
}

function isNamedCouncilFeature(feature: MapboxFeature, location: CsvLocation): boolean {
  const point = coordinates(feature);
  if (!point || !insideScotlandBounds(point)) return false;
  const type = featureType(feature);
  if (['country', 'region', 'district', 'postcode'].includes(type)) return false;
  return Boolean(matchedCouncilArea(feature, location.council_area)) && containsLocationName(feature, location);
}

async function fetchJson(url: URL): Promise<MapboxResponse> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (response.ok) return await response.json() as MapboxResponse;
    if (response.status < 500 || attempt === 3) throw new Error(`Mapbox geocoding failed with HTTP ${String(response.status)}`);
    await delay(500 * attempt);
  }
  throw new Error('Mapbox geocoding failed.');
}

const overrides = new Map(readLocationOverrides().map((override) => [override.slug, override]));

async function fetchMapboxFeatures(query: string, token: string, types?: string): Promise<MapboxFeature[]> {
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', query);
  url.searchParams.set('access_token', token);
  url.searchParams.set('country', 'gb');
  url.searchParams.set('bbox', `${String(scotlandBounds.west)},${String(scotlandBounds.south)},${String(scotlandBounds.east)},${String(scotlandBounds.north)}`);
  if (types) url.searchParams.set('types', types);
  url.searchParams.set('limit', '5');
  const body = await fetchJson(url);
  return body.features ?? [];
}

function resultFromFeature(location: CsvLocation, feature: MapboxFeature, query: string, matchKind: GeocodedLocation['matchKind']): GeocodedLocation | ReviewItem {
  const point = coordinates(feature);
  const councilArea = matchedCouncilArea(feature, location.council_area);
  if (!point || !councilArea) {
    return { councilArea: location.council_area, issue: 'Selected Mapbox match is missing coordinates or council context.', name: location.name, slug: location.slug };
  }
  const mapboxId = feature.properties?.mapbox_id ?? feature.id;
  return {
    ...location,
    confidence: 'mapbox',
    lat: Number(point.lat.toFixed(6)),
    lng: Number(point.lng.toFixed(6)),
    ...(mapboxId ? { mapboxId } : {}),
    matchedCouncilArea: councilArea,
    matchKind,
    nearestCities: [],
    nearestLocations: [],
    query,
    regionHub: '',
  };
}

async function geocode(location: CsvLocation, token: string): Promise<GeocodedLocation | ReviewItem> {
  const override = overrides.get(location.slug);
  if (override) {
    const point = { lat: Number(override.lat), lng: Number(override.lng) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !insideScotlandBounds(point)) {
      return { councilArea: location.council_area, issue: 'Manual override is outside Scotland bounds or is not numeric.', name: location.name, slug: location.slug };
    }
    return {
      ...location,
      confidence: 'manual',
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      matchedCouncilArea: override.matched_council_area || location.council_area,
      matchKind: 'manual',
      nearestCities: [],
      nearestLocations: [],
      query: 'manual override',
      regionHub: '',
    };
  }

  const query = `${location.name}, ${location.council_area}, Scotland`;
  const placeFeature = (await fetchMapboxFeatures(query, token, 'place,locality')).find((candidate) => isHighConfidence(candidate, location));
  if (placeFeature) return resultFromFeature(location, placeFeature, query, 'place');

  const fallbackQueries = [`${location.name}, ${location.council_area}`, location.name];
  for (const fallbackQuery of fallbackQueries) {
    const namedFeature = (await fetchMapboxFeatures(fallbackQuery, token)).find((candidate) => isNamedCouncilFeature(candidate, location));
    if (namedFeature) return resultFromFeature(location, namedFeature, fallbackQuery, 'named-feature');
  }

  return { councilArea: location.council_area, issue: 'No Mapbox place/locality or same-council named feature match.', name: location.name, slug: location.slug };
}

function reportFor(generated: readonly GeocodedLocation[], review: readonly ReviewItem[]): string {
  return [
    '# Geocode report',
    '',
    `Generated locations: ${String(generated.length)}`,
    `Mapbox place/locality coordinates: ${String(generated.filter((location) => location.matchKind === 'place').length)}`,
    `Mapbox same-council named-feature coordinates: ${String(generated.filter((location) => location.matchKind === 'named-feature').length)}`,
    `Manual override coordinates: ${String(generated.filter((location) => location.confidence === 'manual').length)}`,
    `Manual review required: ${String(review.length)}`,
    '',
    '## Matched council areas',
    '',
    '| Slug | Location | Expected council area | Matched council area | Source |',
    '|---|---|---|---|---|',
    ...generated.map((location) => `| ${location.slug} | ${location.name} | ${location.council_area} | ${location.matchedCouncilArea} | ${location.matchKind} |`),
    '',
    '## Manual review required',
    '',
    ...(review.length === 0 ? ['_None._'] : review.map((item) => `- ${item.name}, ${item.councilArea} (${item.slug}): ${item.issue}`)),
    '',
  ].join('\n');
}

function questionsEntry(review: readonly ReviewItem[]): string {
  if (review.length === 0) return '';
  return [
    '',
    '### Q3 — Low-confidence Mapbox location matches   (Repair R1, 2026-10-13)',
    '**Blocking:** yes — the listed locations cannot enter `docs/data/location-overrides.csv` or generated SEO data without owner-confirmed coordinates.',
    '**Context:** Mapbox did not return a high-confidence `place`/`locality` match inside Scotland with the expected council-area context for these locations.',
    '**Options:** A) Confirm exact coordinates for each listed slug in `docs/data/location-overrides.csv`. B) Tell Codex which locations should be removed from the coverage list. Recommendation: A for any town Speedy Van should cover.',
    `**Locations:** ${review.map((item) => `${item.name} (${item.slug}, ${item.councilArea})`).join('; ')}`,
    '**Owner answer:**',
    '**Resolved:** pending',
    '',
  ].join('\n');
}

function withoutQuery(location: GeocodedLocation): GeneratedLocation {
  return {
    council_area: location.council_area,
    confidence: location.confidence,
    ferry: location.ferry,
    island: location.island,
    lat: location.lat,
    lng: location.lng,
    ...(location.mapboxId ? { mapboxId: location.mapboxId } : {}),
    matchedCouncilArea: location.matchedCouncilArea,
    name: location.name,
    nearestCities: location.nearestCities,
    nearestLocations: location.nearestLocations,
    postcode_area: location.postcode_area,
    region: location.region,
    regionHub: location.regionHub,
    slug: location.slug,
    tier: location.tier,
  };
}

const token = requireMapboxToken();
const inputLocations = readLocationsCsv();
const generated: GeocodedLocation[] = [];
const review: ReviewItem[] = [];

for (const [index, location] of inputLocations.entries()) {
  const result = await geocode(location, token);
  if ('issue' in result) review.push(result);
  else generated.push(result);
  if (index < inputLocations.length - 1) await delay(220);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(repoPath('apps/web/src/content/locations/geocode-report.md'), reportFor(generated, review));
const question = questionsEntry(review);
if (question) {
  const questionsPath = repoPath('docs/QUESTIONS.md');
  const existing = readFileSync(questionsPath, 'utf8');
  if (!existing.includes('Q3 — Low-confidence Mapbox location matches')) {
    writeFileSync(questionsPath, existing.replace('## Resolved', `${question}\n## Resolved`));
  }
}
if (review.length > 0) {
  throw new Error(`Mapbox geocoding needs owner review for ${String(review.length)} location(s). See geocode-report.md and docs/QUESTIONS.md.`);
}
writeJson(resolve(outputDir, 'locations.generated.json'), generated.map(withoutQuery));
