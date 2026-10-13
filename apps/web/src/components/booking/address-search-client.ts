'use client';

import type { Address } from '@/components/booking-flow/booking-store';

export interface AddressSuggestion {
  id: string;
  kind: 'address' | 'postcode' | 'place' | 'poi';
  primary: string;
  secondary: string;
}

type AddressRetrieveResult = { address: Address } | { address: Partial<Address>; needsPostcode: true };

function responseErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object' || !('error' in body)) return fallback;
  const error = body.error;
  if (!error || typeof error !== 'object' || !('message' in error)) return fallback;
  return String(error.message);
}

function isSuggestion(value: unknown): value is AddressSuggestion {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Record<keyof AddressSuggestion, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.primary === 'string' &&
    typeof candidate.secondary === 'string' &&
    (candidate.kind === 'address' || candidate.kind === 'postcode' || candidate.kind === 'place' || candidate.kind === 'poi')
  );
}

function isAddress(value: unknown): value is Address {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Record<keyof Address, unknown>>;
  return (
    typeof candidate.label === 'string' &&
    typeof candidate.line1 === 'string' &&
    typeof candidate.postcode === 'string' &&
    typeof candidate.town === 'string' &&
    typeof candidate.lat === 'number' &&
    typeof candidate.lng === 'number'
  );
}

async function jsonFetch<T>(url: string, init: RequestInit, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, 'Request failed'));
  }
  return parse(body);
}

export async function suggestQuickAddresses(q: string, sessionToken: string): Promise<AddressSuggestion[]> {
  return jsonFetch(
    '/api/v1/address/suggest',
    {
      body: JSON.stringify({ q, sessionToken }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    (body) => {
      if (!body || typeof body !== 'object' || !('suggestions' in body) || !Array.isArray(body.suggestions)) {
        throw new Error('Address search returned an invalid response.');
      }
      return body.suggestions.filter(isSuggestion).slice(0, 10);
    },
  );
}

export async function retrieveQuickAddress(id: string, sessionToken: string): Promise<AddressRetrieveResult> {
  return jsonFetch(
    '/api/v1/address/retrieve',
    {
      body: JSON.stringify({ id, sessionToken }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    (body) => {
      if (!body || typeof body !== 'object' || !('address' in body)) {
        throw new Error('Address search returned an invalid response.');
      }
      if ('needsPostcode' in body && body.needsPostcode === true) {
        return { address: body.address as Partial<Address>, needsPostcode: true };
      }
      if (!isAddress(body.address)) {
        throw new Error('Address search returned an invalid response.');
      }
      return { address: body.address };
    },
  );
}
