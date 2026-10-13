import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CsvLocation {
  council_area: string;
  ferry: 'CHECK' | 'NO' | 'YES';
  island: 'N' | 'Y';
  name: string;
  postcode_area: string;
  region: string;
  slug: string;
  tier: string;
}

export interface CsvRoute {
  from_slug: string;
  slug: string;
  to_slug: string;
}

export interface GeneratedLocation extends CsvLocation {
  confidence: 'fallback' | 'high' | 'manual';
  lat: number;
  lng: number;
  nearestCities: string[];
  nearestLocations: string[];
  regionHub: string;
}

export interface GeneratedDistance {
  ferry: boolean;
  from: string;
  miles: number;
  minutes: number;
  to: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const outputDir = resolve(root, 'apps/web/src/content/locations');

export function repoPath(path: string): string {
  return resolve(root, path);
}

function parseCsv<T extends Record<string, string>>(raw: string): T[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && raw[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...data] = rows;
  if (!headers) return [];
  return data.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])) as T);
}

export function readLocationsCsv(): CsvLocation[] {
  return parseCsv<CsvLocation>(readFileSync(repoPath('docs/data/scotland-locations.csv'), 'utf8'));
}

export function readRoutesCsv(): CsvRoute[] {
  return parseCsv<CsvRoute>(readFileSync(repoPath('docs/data/routes.csv'), 'utf8'));
}

const knownCoordinates: Record<string, { lat: number; lng: number }> = {
  aberdeen: { lat: 57.1497, lng: -2.0943 },
  ayr: { lat: 55.4586, lng: -4.6292 },
  dundee: { lat: 56.462, lng: -2.9707 },
  dunfermline: { lat: 56.0717, lng: -3.4522 },
  edinburgh: { lat: 55.9533, lng: -3.1883 },
  'fort-william': { lat: 56.8198, lng: -5.1052 },
  glasgow: { lat: 55.8642, lng: -4.2518 },
  inverness: { lat: 57.4778, lng: -4.2247 },
  perth: { lat: 56.3969, lng: -3.437 },
  'st-andrews': { lat: 56.3398, lng: -2.7967 },
  stirling: { lat: 56.1165, lng: -3.9369 },
};

const regionAnchors: Record<string, { lat: number; lng: number }> = {
  'argyll-and-bute': { lat: 56.15, lng: -5.05 },
  'ayrshire-and-arran': { lat: 55.55, lng: -4.65 },
  'edinburgh-and-lothians': { lat: 55.93, lng: -3.25 },
  fife: { lat: 56.2, lng: -3.15 },
  'forth-valley': { lat: 56.08, lng: -3.9 },
  'glasgow-and-clyde': { lat: 55.86, lng: -4.35 },
  highlands: { lat: 57.25, lng: -4.4 },
  islands: { lat: 58.55, lng: -4.2 },
  lanarkshire: { lat: 55.72, lng: -3.85 },
  'north-east': { lat: 57.25, lng: -2.3 },
  'south-of-scotland': { lat: 55.25, lng: -3.0 },
  tayside: { lat: 56.55, lng: -3.15 },
};

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
}

export function coordinateFor(location: CsvLocation): { confidence: GeneratedLocation['confidence']; lat: number; lng: number } {
  const known = knownCoordinates[location.slug];
  if (known) return { ...known, confidence: 'high' };
  const anchor = regionAnchors[location.region] ?? { lat: 56.4, lng: -3.8 };
  const seed = hash(location.slug);
  const latOffset = (((seed % 1000) / 1000) - 0.5) * 0.6;
  const lngOffset = ((((seed >>> 10) % 1000) / 1000) - 0.5) * 0.9;
  return {
    confidence: 'fallback',
    lat: Number((anchor.lat + latOffset).toFixed(5)),
    lng: Number((anchor.lng + lngOffset).toFixed(5)),
  };
}

export function haversineMiles(left: { lat: number; lng: number }, right: { lat: number; lng: number }): number {
  const radiusMiles = 3958.8;
  const toRad = (degrees: number): number => degrees * Math.PI / 180;
  const dLat = toRad(right.lat - left.lat);
  const dLng = toRad(right.lng - left.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusMiles * Math.asin(Math.sqrt(a));
}

export function roadEstimateMiles(left: { lat: number; lng: number }, right: { lat: number; lng: number }): number {
  return Number((haversineMiles(left, right) * 1.25).toFixed(2));
}

export function estimateMinutes(miles: number): number {
  return Math.max(10, Math.round((miles / 45) * 60));
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
