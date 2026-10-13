import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import distancesData from '../src/content/locations/distances.generated.json';
import locationsData from '../src/content/locations/locations.generated.json';

interface GeneratedLocation {
  confidence: string;
  lat: number;
  lng: number;
  matchedCouncilArea?: string;
  slug: string;
}

interface GeneratedDistance {
  from: string;
  miles: number;
  to: string;
}

interface GeneratedDistances {
  cityDistances: GeneratedDistance[];
  routes: GeneratedDistance[];
}

const locations = locationsData as GeneratedLocation[];
const distances = distancesData as GeneratedDistances;
const scotlandBounds = {
  east: -0.5,
  north: 61.2,
  south: 54.5,
  west: -8.9,
} as const;

function distance(from: string, to: string): number | undefined {
  return [...distances.cityDistances, ...distances.routes].find((item) => item.from === from && item.to === to)?.miles;
}

describe('SEO generated location data', () => {
  it('contains no fallback coordinates and keeps every location inside Scotland bounds', () => {
    expect(locations).toHaveLength(221);
    for (const location of locations) {
      expect(location.confidence, location.slug).not.toBe('fallback');
      expect(location.lat, `${location.slug} latitude`).toBeGreaterThanOrEqual(scotlandBounds.south);
      expect(location.lat, `${location.slug} latitude`).toBeLessThanOrEqual(scotlandBounds.north);
      expect(location.lng, `${location.slug} longitude`).toBeGreaterThanOrEqual(scotlandBounds.west);
      expect(location.lng, `${location.slug} longitude`).toBeLessThanOrEqual(scotlandBounds.east);
    }
  });

  it('keeps named Scottish road distances within plausible Mapbox ranges', () => {
    expect(distance('paisley', 'glasgow')).toBeGreaterThanOrEqual(5);
    expect(distance('paisley', 'glasgow')).toBeLessThanOrEqual(11);
    expect(distance('glasgow', 'edinburgh')).toBeGreaterThanOrEqual(40);
    expect(distance('glasgow', 'edinburgh')).toBeLessThanOrEqual(52);
    expect(distance('aberdeen', 'dundee')).toBeGreaterThanOrEqual(60);
    expect(distance('aberdeen', 'dundee')).toBeLessThanOrEqual(72);
    expect(distance('inverness', 'perth')).toBeGreaterThanOrEqual(105);
    expect(distance('inverness', 'perth')).toBeLessThanOrEqual(120);
    expect(distance('stirling', 'falkirk')).toBeGreaterThanOrEqual(9);
    expect(distance('stirling', 'falkirk')).toBeLessThanOrEqual(18);
  });

  it('records a matched council area for every generated location in the geocode report', () => {
    const report = readFileSync(join(process.cwd(), 'src/content/locations/geocode-report.md'), 'utf8');
    for (const location of locations) {
      const matchedCouncilArea = location.matchedCouncilArea;
      expect(matchedCouncilArea, location.slug).toBeTruthy();
      expect(report).toContain(`| ${location.slug} |`);
      expect(report).toContain(`| ${matchedCouncilArea ?? ''} |`);
    }
  });
});
