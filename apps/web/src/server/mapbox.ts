import 'server-only';

import { AddressSchema, AppError, normalisePostcode } from '@sv/contracts';
import type { z } from 'zod';
import { getRedis } from './redis';
import { serverEnv } from './env';

type Address = z.infer<typeof AddressSchema>;

export interface AddressSuggestion {
  id: string;
  kind: 'address' | 'place' | 'poi' | 'postcode';
  primary: string;
  secondary: string;
}

export interface RouteResult {
  distanceMiles: number;
  durationMinutes: number;
  ferry: boolean;
  geometry: string;
}

interface MapboxFeature {
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: {
    coordinates?: { latitude?: number; longitude?: number };
    context?: {
      place?: { name?: string };
      postcode?: { name?: string };
    };
    feature_type?: string;
    full_address?: string;
    mapbox_id?: string;
    name?: string;
    place_formatted?: string;
  };
}

interface MapboxSuggestion {
  feature_type?: string;
  full_address?: string;
  mapbox_id?: string;
  name?: string;
  place_formatted?: string;
}

interface MapboxRetrieveResponse {
  features?: MapboxFeature[];
}

interface MapboxSuggestResponse {
  suggestions?: MapboxSuggestion[];
}

interface MapboxDirectionsResponse {
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: string;
    legs?: Array<{
      steps?: Array<{ mode?: string }>;
    }>;
  }>;
}

const metresPerMile = 1609.344;
const routeCache = new Map<string, RouteResult>();

const mockAddresses: Record<string, Address> = {
  'mock:glasgow': {
    label: '1 George Square, Glasgow G2 1DU',
    lat: 55.861,
    line1: '1 George Square',
    lng: -4.25,
    postcode: 'G2 1DU',
    source: 'MAPBOX',
    town: 'Glasgow',
    mapboxId: 'mock:glasgow',
  },
  'mock:edinburgh': {
    label: '1 Princes Street, Edinburgh EH1 1BB',
    lat: 55.953,
    line1: '1 Princes Street',
    lng: -3.189,
    postcode: 'EH1 1BB',
    source: 'MAPBOX',
    town: 'Edinburgh',
    mapboxId: 'mock:edinburgh',
  },
  'mock:london': {
    label: '10 Downing Street, London SW1A 2AA',
    lat: 51.503,
    line1: '10 Downing Street',
    lng: -0.127,
    postcode: 'SW1A 2AA',
    source: 'MAPBOX',
    town: 'London',
    mapboxId: 'mock:london',
  },
  'mock:bute': {
    label: '1 Ferry Road, Rothesay PA20 0AA',
    lat: 55.837,
    line1: '1 Ferry Road',
    lng: -5.055,
    postcode: 'PA20 0AA',
    source: 'MAPBOX',
    town: 'Rothesay',
    mapboxId: 'mock:bute',
  },
};

const transparentPng = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
);

function mockSuggestions(q: string): AddressSuggestion[] {
  const query = q.toLowerCase();
  const entries = Object.entries(mockAddresses).filter(([, address]) => address.label.toLowerCase().includes(query) || address.town.toLowerCase().includes(query));
  const fallback = entries.length > 0 ? entries : Object.entries(mockAddresses).slice(0, 4);
  return fallback.map(([id, address]) => ({
    id,
    kind: 'address',
    primary: address.line1,
    secondary: `${address.town} ${address.postcode}`,
  }));
}

function routeKey(pickup: Address, dropoff: Address): string {
  return `${pickup.lng.toFixed(4)},${pickup.lat.toFixed(4)}:${dropoff.lng.toFixed(4)},${dropoff.lat.toFixed(4)}`;
}

async function fetchJson<T>(url: URL, timeoutMs = 6000, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Mapbox returned ${String(response.status)}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new AppError('UPSTREAM_UNAVAILABLE', 'Address and route data is taking longer than usual. Try again.', {
    upstream: 'mapbox',
    reason: lastError instanceof Error ? lastError.message : String(lastError),
  });
}

function mapboxToken(): string {
  const env = serverEnv();
  if (env.MAPBOX_MODE === 'mock') {
    return 'mock-token';
  }
  if (!env.MAPBOX_SECRET_TOKEN) {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Address search is not configured yet.');
  }
  return env.MAPBOX_SECRET_TOKEN;
}

function kindFromFeatureType(featureType: string | undefined): AddressSuggestion['kind'] {
  if (featureType === 'postcode') return 'postcode';
  if (featureType === 'poi') return 'poi';
  if (featureType === 'place') return 'place';
  return 'address';
}

function addressFromFeature(feature: MapboxFeature): Address | { needsPostcode: true; address: Omit<Address, 'postcode'> } {
  const props = feature.properties;
  const coordinates = props?.coordinates;
  const lng = coordinates?.longitude ?? feature.geometry?.coordinates?.[0];
  const lat = coordinates?.latitude ?? feature.geometry?.coordinates?.[1];
  const postcode = props?.context?.postcode?.name;
  const town = props?.context?.place?.name ?? props?.place_formatted?.split(',').at(-1)?.trim() ?? 'Unknown';
  const line1 = props?.name ?? props?.full_address?.split(',')[0] ?? 'Selected address';
  const label = props?.full_address ?? [line1, town, postcode].filter(Boolean).join(', ');
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Address search returned an incomplete address.');
  }
  const base = {
    label,
    lat,
    line1,
    lng,
    source: 'MAPBOX' as const,
    town,
    mapboxId: props?.mapbox_id,
  };
  if (!postcode) {
    return { needsPostcode: true, address: base };
  }
  return AddressSchema.parse({ ...base, postcode });
}

export async function suggestAddresses(q: string, sessionToken: string, proximity?: { lat: number; lng: number }): Promise<AddressSuggestion[]> {
  if (serverEnv().MAPBOX_MODE === 'mock') {
    await Promise.resolve();
    return mockSuggestions(q);
  }
  const url = new URL('https://api.mapbox.com/search/searchbox/v1/suggest');
  url.searchParams.set('access_token', mapboxToken());
  url.searchParams.set('country', 'gb');
  url.searchParams.set('language', 'en');
  url.searchParams.set('limit', '8');
  url.searchParams.set('q', q);
  url.searchParams.set('session_token', sessionToken);
  url.searchParams.set('types', 'address,postcode,poi');
  if (proximity) {
    url.searchParams.set('proximity', `${String(proximity.lng)},${String(proximity.lat)}`);
  } else {
    url.searchParams.set('proximity', '-4.2026,56.4907');
  }
  const body = await fetchJson<MapboxSuggestResponse>(url);
  return (body.suggestions ?? []).map((suggestion) => ({
    id: suggestion.mapbox_id ?? suggestion.full_address ?? suggestion.name ?? '',
    kind: kindFromFeatureType(suggestion.feature_type),
    primary: suggestion.name ?? suggestion.full_address ?? 'Address',
    secondary: suggestion.place_formatted ?? '',
  })).filter((suggestion) => suggestion.id.length > 0);
}

export async function retrieveAddress(id: string, sessionToken: string): Promise<Address | { needsPostcode: true; address: Omit<Address, 'postcode'> }> {
  if (serverEnv().MAPBOX_MODE === 'mock') {
    await Promise.resolve();
    const address = mockAddresses[id];
    if (!address) throw new AppError('NOT_FOUND', 'Address not found.');
    return address;
  }
  const url = new URL(`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(id)}`);
  url.searchParams.set('access_token', mapboxToken());
  url.searchParams.set('session_token', sessionToken);
  const body = await fetchJson<MapboxRetrieveResponse>(url);
  const feature = body.features?.[0];
  if (!feature) throw new AppError('NOT_FOUND', 'Address not found.');
  return addressFromFeature(feature);
}

export async function lookupPostcode(postcode: string): Promise<{ lat: number; lng: number; postcode: string; town: string }> {
  const normalized = normalisePostcode(postcode);
  if (serverEnv().MAPBOX_MODE === 'mock') {
    await Promise.resolve();
    const match = Object.values(mockAddresses).find((address) => address.postcode === normalized);
    if (!match) throw new AppError('NOT_FOUND', "We can't find that postcode. Check it and try again.");
    return { lat: match.lat, lng: match.lng, postcode: match.postcode, town: match.town };
  }
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('access_token', mapboxToken());
  url.searchParams.set('country', 'gb');
  url.searchParams.set('limit', '1');
  url.searchParams.set('postcode', normalized);
  const body = await fetchJson<MapboxRetrieveResponse>(url);
  const feature = body.features?.[0];
  if (!feature) throw new AppError('NOT_FOUND', "We can't find that postcode. Check it and try again.");
  const address = addressFromFeature(feature);
  if ('needsPostcode' in address) throw new AppError('NOT_FOUND', "We can't find that postcode. Check it and try again.");
  return { lat: address.lat, lng: address.lng, postcode: address.postcode, town: address.town };
}

export async function routeBetween(pickup: Address, dropoff: Address | null): Promise<RouteResult> {
  if (!dropoff) {
    return { distanceMiles: 0, durationMinutes: 0, ferry: false, geometry: '' };
  }

  const key = routeKey(pickup, dropoff);
  const cached = routeCache.get(key);
  if (cached) return cached;
  const redis = getRedis();
  const redisKey = `route:${key}`;
  const redisValue = redis ? await redis.get<RouteResult>(redisKey) : null;
  if (redisValue) {
    routeCache.set(key, redisValue);
    return redisValue;
  }

  let result: RouteResult;
  if (serverEnv().MAPBOX_MODE === 'mock') {
    const ferry = pickup.postcode.startsWith('PA20') || dropoff.postcode.startsWith('PA20');
    result = {
      distanceMiles: ferry ? 42.5 : 47.3,
      durationMinutes: ferry ? 95 : 69,
      ferry,
      geometry: ferry ? 'mock_ferry_polyline' : 'mock_road_polyline',
    };
  } else {
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${String(pickup.lng)},${String(pickup.lat)};${String(dropoff.lng)},${String(dropoff.lat)}`);
    url.searchParams.set('access_token', mapboxToken());
    url.searchParams.set('geometries', 'polyline');
    url.searchParams.set('overview', 'full');
    url.searchParams.set('steps', 'true');
    const body = await fetchJson<MapboxDirectionsResponse>(url);
    const route = body.routes?.[0];
    if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') {
      throw new AppError('UPSTREAM_UNAVAILABLE', 'Route planning is not responding. Try again.');
    }
    const ferry = route.legs?.some((leg) => leg.steps?.some((step) => step.mode === 'ferry')) ?? false;
    result = {
      distanceMiles: Math.round((route.distance / metresPerMile) * 100) / 100,
      durationMinutes: Math.max(0, Math.round(route.duration / 60)),
      ferry,
      geometry: route.geometry ?? '',
    };
  }

  routeCache.set(key, result);
  if (redis) {
    await redis.set(redisKey, result, { ex: 60 * 60 * 24 });
  }
  return result;
}

export async function staticRouteImage(geometry: string, width: number, height: number, dpr: number): Promise<{ body: Uint8Array; contentType: string }> {
  if (serverEnv().MAPBOX_MODE === 'mock' || geometry.length === 0) {
    await Promise.resolve();
    return { body: transparentPng, contentType: 'image/png' };
  }
  const clampedWidth = Math.min(Math.max(width, 180), 1200);
  const clampedHeight = Math.min(Math.max(height, 120), 1200);
  const clampedDpr = dpr === 2 ? 2 : 1;
  const overlay = `path-4+FFC93C-0.9(${encodeURIComponent(geometry)})`;
  const url = new URL(`https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlay}/auto/${String(clampedWidth)}x${String(clampedHeight)}@${String(clampedDpr)}x`);
  url.searchParams.set('access_token', mapboxToken());
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Route image is not responding. Try again.');
  }
  return { body: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'image/png' };
}
