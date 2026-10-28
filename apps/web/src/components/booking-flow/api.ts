'use client';

import {
  AddressRetrieveResponseSchema,
  AddressSuggestResponseSchema,
  BookingCreateResponseSchema,
  BookingStatusResponseSchema,
  CatalogueResponseSchema,
  ManualQuoteRequestResponseSchema,
  PostcodeLookupResponseSchema,
  QuoteDtoSchema,
  type BookingCreateSchema,
  type ManualQuoteRequestSchema,
  type QuoteRequestSchema,
} from '@sv/contracts';
import { z } from 'zod';

const QuoteGetResponseSchema = z.object({ quote: QuoteDtoSchema, expired: z.boolean() }).strict();
const QuoteCreateResponseSchema = z.union([
  z.object({ manualQuote: z.object({ quotePublicId: z.string().min(1), reasons: z.array(z.string()) }).strict() }).strict(),
  z.object({ quote: QuoteDtoSchema }).strict(),
]);

function responseErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object' || !('error' in body)) return fallback;
  const error = body.error;
  if (!error || typeof error !== 'object' || !('message' in error)) return fallback;
  return String(error.message);
}

async function jsonFetch<T>(url: string, init: RequestInit, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, 'Request failed'));
  }
  return parse(body);
}

export async function getCatalogue() {
  return jsonFetch('/api/v1/catalogue', { headers: { accept: 'application/json' } }, (body) => CatalogueResponseSchema.parse(body));
}

export async function suggestAddresses(q: string, sessionToken: string) {
  return jsonFetch(
    '/api/v1/address/suggest',
    {
      body: JSON.stringify({ q, sessionToken }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    (body) => AddressSuggestResponseSchema.parse(body).suggestions,
  );
}

export async function retrieveAddress(id: string, sessionToken: string) {
  return jsonFetch(
    '/api/v1/address/retrieve',
    {
      body: JSON.stringify({ id, sessionToken }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    (body) => AddressRetrieveResponseSchema.parse(body),
  );
}

export async function lookupPostcode(postcode: string) {
  return jsonFetch(`/api/v1/address/postcode/${encodeURIComponent(postcode)}`, { headers: { accept: 'application/json' } }, (body) => PostcodeLookupResponseSchema.parse(body));
}

export async function createQuote(input: z.infer<typeof QuoteRequestSchema>) {
  const response = await fetch('/api/v1/quotes', {
    body: JSON.stringify(input),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    method: 'POST',
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, 'Quote failed'));
  }
  return QuoteCreateResponseSchema.parse(body);
}

export async function getQuoteByPublicId(publicId: string) {
  return jsonFetch(`/api/v1/quotes/${encodeURIComponent(publicId)}`, { headers: { accept: 'application/json' } }, (body) => QuoteGetResponseSchema.parse(body));
}

export async function createBooking(input: z.infer<typeof BookingCreateSchema>) {
  return jsonFetch(
    '/api/v1/bookings',
    {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    (body) => BookingCreateResponseSchema.parse(body),
  );
}

export async function requestManualQuote(publicId: string, input: z.infer<typeof ManualQuoteRequestSchema>) {
  return jsonFetch(
    `/api/v1/quotes/${encodeURIComponent(publicId)}/manual-request`,
    {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    (body) => ManualQuoteRequestResponseSchema.parse(body),
  );
}

export async function getBookingStatus(token: string) {
  return jsonFetch(
    `/api/v1/bookings/status?token=${encodeURIComponent(token)}`,
    { cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
    (body) => BookingStatusResponseSchema.parse(body),
  );
}

export async function confirmTestPayment(token: string): Promise<void> {
  await jsonFetch(
    '/api/test/payments/succeed',
    {
      body: JSON.stringify({ token }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    () => ({ ok: true }),
  );
}
