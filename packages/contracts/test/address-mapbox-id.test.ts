import { describe, expect, it } from 'vitest';
import {
  AddressRetrieveRequestSchema,
  AddressRetrieveResponseSchema,
  AddressSchema,
  AddressSuggestResponseSchema,
} from '../src';

const sessionToken = '00000000-0000-4000-8000-000000000001';
const address = {
  line1: '1 George Square',
  town: 'Glasgow',
  postcode: 'G2 1DU',
  lat: 55.861,
  lng: -4.25,
  label: '1 George Square, Glasgow G2 1DU',
  source: 'MAPBOX',
};

function suggestion(id: string): { id: string; primary: string; secondary: string; kind: 'address' } {
  return { id, primary: address.line1, secondary: `${address.town} ${address.postcode}`, kind: 'address' };
}

describe('opaque Mapbox address identifiers', () => {
  it.each([546, 1024])('preserves a %i-character id from suggestions through retrieval and the stored address', (length) => {
    const id = 'd'.repeat(length);
    const response = AddressSuggestResponseSchema.parse({ suggestions: [suggestion('short-id'), suggestion(id)] });
    expect(response.suggestions).toHaveLength(2);
    const request = AddressRetrieveRequestSchema.parse({ id: response.suggestions[1]?.id, sessionToken });
    expect(request.id).toBe(id);
    const retrieved = AddressRetrieveResponseSchema.parse({ address: { ...address, mapboxId: request.id } });
    expect(retrieved.address.mapboxId).toBe(id);
    expect(AddressSchema.parse(retrieved.address).mapboxId).toBe(id);
  });

  it('retains a bounded id length at every address boundary', () => {
    const id = 'd'.repeat(1025);
    expect(AddressSuggestResponseSchema.safeParse({ suggestions: [suggestion(id)] }).success).toBe(false);
    expect(AddressRetrieveRequestSchema.safeParse({ id, sessionToken }).success).toBe(false);
    expect(AddressRetrieveResponseSchema.safeParse({ address: { ...address, mapboxId: id } }).success).toBe(false);
    expect(AddressSchema.safeParse({ ...address, mapboxId: id }).success).toBe(false);
  });

  it.each(['', '   '])('rejects an empty suggestion or retrieval id (%j)', (id) => {
    expect(AddressSuggestResponseSchema.safeParse({ suggestions: [suggestion(id)] }).success).toBe(false);
    expect(AddressRetrieveRequestSchema.safeParse({ id, sessionToken }).success).toBe(false);
  });
});
