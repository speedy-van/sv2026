import { describe, expect, it } from 'vitest';
import {
  AccessDetailSchema,
  AppError,
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  BookingCreateSchema,
  DISPATCH_STATUSES,
  DISPATCH_TRANSITIONS,
  IsoDateSchema,
  QuoteRequestSchema,
  SlotSchema,
  TRANSITION_ACTORS,
  assertTransition,
  canBookingTransition,
  canDispatchTransition,
  dispatchCanChangeWhile,
  formatGBP,
  isScottishPostcode,
  isValidUkPostcode,
  normalisePostcode,
  parseFlatNotation,
  routeTouchesScotland,
  stagePathFor,
  UkPostcodeSchema,
  CompanySettingsSchema,
} from '../src';

function transitionKey(from: string, to: string, actor: string): string {
  return `${from}->${to}:${actor}`;
}

describe('booking state machine', () => {
  it('matches the exhaustive booking transition table', () => {
    const allowed = new Set(
      BOOKING_TRANSITIONS.flatMap((transition) =>
        transition.actors.map((actor) => transitionKey(transition.from, transition.to, actor)),
      ),
    );

    for (const from of BOOKING_STATUSES) {
      for (const to of BOOKING_STATUSES) {
        for (const actor of TRANSITION_ACTORS) {
          const expected = allowed.has(transitionKey(from, to, actor));
          expect(canBookingTransition(from, to, actor)).toBe(expected);
          if (expected) {
            expect(() => {
              assertTransition('booking', from, to, actor);
            }).not.toThrow();
          } else {
            expect(() => {
              assertTransition('booking', from, to, actor);
            }).toThrow(AppError);
          }
        }
      }
    }
  });

  it('matches the exhaustive dispatch transition table', () => {
    const allowed = new Set(
      DISPATCH_TRANSITIONS.flatMap((transition) =>
        transition.actors.map((actor) => transitionKey(transition.from, transition.to, actor)),
      ),
    );

    for (const from of DISPATCH_STATUSES) {
      for (const to of DISPATCH_STATUSES) {
        for (const actor of TRANSITION_ACTORS) {
          const expected = allowed.has(transitionKey(from, to, actor));
          expect(canDispatchTransition(from, to, actor)).toBe(expected);
          if (expected) {
            expect(() => {
              assertTransition('dispatch', from, to, actor);
            }).not.toThrow();
          } else {
            expect(() => {
              assertTransition('dispatch', from, to, actor);
            }).toThrow(AppError);
          }
        }
      }
    }
  });

  it('uses service-specific stage paths and dispatch status guards', () => {
    expect(stagePathFor('man-and-van')).toEqual([
      'NOT_STARTED',
      'EN_ROUTE_TO_PICKUP',
      'AT_PICKUP',
      'LOADING',
      'EN_ROUTE_TO_DROPOFF',
      'AT_DROPOFF',
      'UNLOADING',
      'COMPLETED',
    ]);
    expect(stagePathFor('rubbish')).toEqual(['NOT_STARTED', 'EN_ROUTE_TO_PICKUP', 'AT_PICKUP', 'LOADING', 'COMPLETED']);
    expect(dispatchCanChangeWhile('CONFIRMED')).toBe(true);
    expect(dispatchCanChangeWhile('IN_PROGRESS')).toBe(true);
    expect(dispatchCanChangeWhile('PENDING_PAYMENT')).toBe(false);
  });
});

describe('address utilities', () => {
  it('normalises and validates UK and Scottish postcodes', () => {
    expect(normalisePostcode('g1  1aa')).toBe('G1 1AA');
    expect(UkPostcodeSchema.parse('eh1 1yz')).toBe('EH1 1YZ');
    expect(isValidUkPostcode('SW1A 1AA')).toBe(true);
    expect(isScottishPostcode('SW1A 1AA')).toBe(false);
    expect(isScottishPostcode('PA1 1AA')).toBe(true);
    expect(routeTouchesScotland({ pickup: 'SW1A 1AA', dropoff: 'G1 1AA' })).toBe(true);
    expect(routeTouchesScotland({ pickup: 'SW1A 1AA', dropoff: 'EC1A 1BB' })).toBe(false);
  });

  it('parses Scottish flat notation suggestions without applying them silently', () => {
    expect(parseFlatNotation('2/1')).toMatchObject({ floor: 2, label: '2nd floor', source: 'GLASGOW' });
    expect(parseFlatNotation('Flat 2/1')).toMatchObject({ floor: 2, label: '2nd floor' });
    expect(parseFlatNotation('2 / 1')).toMatchObject({ floor: 2, label: '2nd floor' });
    expect(parseFlatNotation('0/2')).toMatchObject({ floor: 0, label: 'Ground' });
    expect(parseFlatNotation('3F2')).toMatchObject({ floor: 3, label: '3rd floor', source: 'EDINBURGH' });
    expect(parseFlatNotation('Flat 3F2')).toMatchObject({ floor: 3, label: '3rd floor' });
    expect(parseFlatNotation('3f2')).toMatchObject({ floor: 3, label: '3rd floor' });
    expect(parseFlatNotation('GF1')).toMatchObject({ floor: 0, label: 'Ground' });
    expect(parseFlatNotation('GF')).toMatchObject({ floor: 0, label: 'Ground' });
    expect(parseFlatNotation('PF1')).toMatchObject({ floor: 1, label: '1st floor' });
    expect(parseFlatNotation('BF1')).toMatchObject({ floor: 1, label: 'Basement' });
    expect(parseFlatNotation('Basement flat')).toMatchObject({ floor: 1, label: 'Basement' });
    expect(parseFlatNotation('Flat 4')).toBeNull();
    expect(parseFlatNotation('Flat C')).toBeNull();
    expect(parseFlatNotation('12/3')).toBeNull();
    expect(parseFlatNotation('12/10/2026')).toBeNull();
  });
});

describe('core schemas and helpers', () => {
  it('validates money, dates, access details and booking creation', () => {
    expect(formatGBP(14800)).toBe('£148.00');
    expect(IsoDateSchema.safeParse('2028-02-29').success).toBe(true);
    expect(IsoDateSchema.safeParse('2027-02-29').success).toBe(false);
    expect(SlotSchema.parse('MORNING')).toBe('MORNING');
    expect(AccessDetailSchema.safeParse({ floorChoice: 'FLOOR', hasLift: false, carryMetres: 0, narrowAccess: false, permitZone: false }).success).toBe(false);
    expect(
      BookingCreateSchema.parse({
        quotePublicId: 'quote_123456',
        date: '2026-10-12',
        slot: 'AFTERNOON',
        expectedTotalPence: 14800,
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        contact: { name: 'Ada Lovelace', email: 'ADA@example.com', phone: '+44 7700 900123' },
        marketingOptIn: false,
        termsAccepted: true,
        startWithinCancellationPeriodAck: true,
      }).contact.email,
    ).toBe('ada@example.com');
  });

  it('enforces quote dropoff rules from the pricing service config', () => {
    const address = {
      line1: '12 Byres Road',
      town: 'Glasgow',
      postcode: 'G11 5JY',
      lat: 55.875,
      lng: -4.292,
      label: '12 Byres Road, Glasgow G11 5JY',
      source: 'MANUAL',
    };
    const access = { floorChoice: 'GROUND', hasLift: false, carryMetres: 0, narrowAccess: false, permitZone: false };
    expect(
      QuoteRequestSchema.safeParse({
        service: 'man-and-van',
        variant: 'standard',
        pickup: address,
        dropoff: null,
        pickupAccess: access,
        dropoffAccess: null,
        items: [],
        addons: { helpers: 0, packing: false, assembly: false },
      }).success,
    ).toBe(false);
    expect(
      QuoteRequestSchema.safeParse({
        service: 'rubbish',
        variant: 'standard',
        pickup: address,
        dropoff: null,
        pickupAccess: access,
        dropoffAccess: null,
        items: [],
        addons: { helpers: 0, packing: false, assembly: false },
      }).success,
    ).toBe(true);
  });

  it('validates settings payloads', () => {
    expect(
      CompanySettingsSchema.parse({
        legalName: null,
        tradingName: 'Speedy Van',
        companyNumber: null,
        registeredIn: null,
        registeredOffice: null,
        vatRegistered: false,
        vatNumber: null,
        icoRegistrationNumber: null,
      }).tradingName,
    ).toBe('Speedy Van');
  });
});
