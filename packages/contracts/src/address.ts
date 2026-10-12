import { z } from 'zod';

const UK_POSTCODE_PATTERN =
  /^([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})$/i;

export const SCOTTISH_POSTCODE_AREAS = [
  'AB',
  'DD',
  'DG',
  'EH',
  'FK',
  'G',
  'HS',
  'IV',
  'KA',
  'KW',
  'KY',
  'ML',
  'PA',
  'PH',
  'TD',
  'ZE',
] as const;

export type ScottishPostcodeArea = (typeof SCOTTISH_POSTCODE_AREAS)[number];

export function normalisePostcode(value: string): string {
  const compact = value.toUpperCase().replace(/\s+/g, '');
  if (compact.length <= 3) {
    return compact;
  }
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export function isValidUkPostcode(value: string): boolean {
  return UK_POSTCODE_PATTERN.test(normalisePostcode(value));
}

export function postcodeArea(value: string): string | null {
  if (!isValidUkPostcode(value)) {
    return null;
  }
  const outward = normalisePostcode(value).split(' ')[0];
  if (!outward) {
    return null;
  }
  const match = /^[A-Z]+/.exec(outward);
  return match?.[0] ?? null;
}

export function isScottishPostcode(value: string): boolean {
  const area = postcodeArea(value);
  return area !== null && (SCOTTISH_POSTCODE_AREAS as readonly string[]).includes(area);
}

export function routeTouchesScotland(postcodes: { pickup: string; dropoff?: string | null }): boolean {
  return isScottishPostcode(postcodes.pickup) || (postcodes.dropoff ? isScottishPostcode(postcodes.dropoff) : false);
}

export const UkPostcodeSchema = z
  .string()
  .trim()
  .transform(normalisePostcode)
  .refine(isValidUkPostcode, { message: 'Expected a valid UK postcode' });

export const ScottishPostcodeSchema = UkPostcodeSchema.refine(isScottishPostcode, {
  message: 'Expected a Scottish postcode area',
});

export type FlatFloorKind = 'BASEMENT' | 'GROUND' | 'FLOOR';

export interface FlatNotationSuggestion {
  floor: number;
  kind: FlatFloorKind;
  label: string;
  source: 'GLASGOW' | 'EDINBURGH' | 'NAMED';
}

function floorLabel(kind: FlatFloorKind, floor: number): string {
  if (kind === 'BASEMENT') {
    return 'Basement';
  }
  if (kind === 'GROUND' || floor === 0) {
    return 'Ground';
  }
  const suffix = floor === 1 ? 'st' : floor === 2 ? 'nd' : floor === 3 ? 'rd' : 'th';
  return `${String(floor)}${suffix} floor`;
}

function suggestion(floor: number, kind: FlatFloorKind, source: FlatNotationSuggestion['source']): FlatNotationSuggestion {
  return { floor, kind, label: floorLabel(kind, floor), source };
}

export function parseFlatNotation(...values: Array<string | null | undefined>): FlatNotationSuggestion | null {
  const raw = values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .trim();
  if (!raw) {
    return null;
  }
  const value = raw.replace(/\s+/g, ' ').trim();
  const lower = value.toLowerCase();

  if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(lower)) {
    return null;
  }
  if (/\bbasement(?:\s+flat)?\b/.test(lower)) {
    return suggestion(1, 'BASEMENT', 'NAMED');
  }

  const gfMatch = /\b(?:flat\s*)?gf\d*\b/i.exec(value);
  if (gfMatch) {
    return suggestion(0, 'GROUND', 'EDINBURGH');
  }
  const pfMatch = /\b(?:flat\s*)?pf\d*\b/i.exec(value);
  if (pfMatch) {
    return suggestion(1, 'FLOOR', 'EDINBURGH');
  }
  const bfMatch = /\b(?:flat\s*)?bf\d*\b/i.exec(value);
  if (bfMatch) {
    return suggestion(1, 'BASEMENT', 'EDINBURGH');
  }

  const edinburgh = /\b(?:flat\s*)?([1-9])\s*f\s*\d+\b/i.exec(value);
  if (edinburgh) {
    const floor = Number(edinburgh[1]);
    return suggestion(floor, 'FLOOR', 'EDINBURGH');
  }

  const glasgow = /\b(?:flat\s*)?([0-9])\s*\/\s*\d+\b/i.exec(value);
  if (glasgow) {
    const floor = Number(glasgow[1]);
    return suggestion(floor, floor === 0 ? 'GROUND' : 'FLOOR', 'GLASGOW');
  }

  return null;
}
