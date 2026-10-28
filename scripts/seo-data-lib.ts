import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  confidence: 'manual' | 'mapbox';
  lat: number;
  lng: number;
  mapboxId?: string;
  matchedCouncilArea: string;
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
export const scotlandBounds = {
  east: -0.5,
  north: 61.2,
  south: 54.5,
  west: -8.9,
} as const;

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

export interface LocationOverride {
  lat: string;
  lng: string;
  matched_council_area: string;
  slug: string;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvFileValue(key: string): string | undefined {
  const path = repoPath('.env.local');
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match || match[1] !== key) continue;
    return unquoteEnvValue(match[2] ?? '');
  }
  return undefined;
}

export function envValue(key: string): string | undefined {
  return process.env[key] ?? readEnvFileValue(key);
}

export function requireMapboxToken(): string {
  const token = envValue('MAPBOX_SECRET_TOKEN');
  if (!token) throw new Error('MAPBOX_SECRET_TOKEN is required for R1 SEO data generation. Add it to .env.local or the process environment.');
  if (!/^(?:pk|sk)\./u.test(token)) throw new Error('MAPBOX_SECRET_TOKEN must start with pk. or sk.');
  return token;
}

export function readLocationOverrides(): LocationOverride[] {
  const path = repoPath('docs/data/location-overrides.csv');
  if (!existsSync(path)) return [];
  return parseCsv<LocationOverride>(readFileSync(path, 'utf8'));
}

export function readGeneratedLocations(): GeneratedLocation[] {
  return JSON.parse(readFileSync(resolve(outputDir, 'locations.generated.json'), 'utf8')) as GeneratedLocation[];
}

export function insideScotlandBounds(point: { lat: number; lng: number }): boolean {
  return point.lat >= scotlandBounds.south && point.lat <= scotlandBounds.north && point.lng >= scotlandBounds.west && point.lng <= scotlandBounds.east;
}

export function normalizePlaceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/gu, 'and')
    .replace(/\bcity of\b/gu, '')
    .replace(/\bthe\b/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
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
