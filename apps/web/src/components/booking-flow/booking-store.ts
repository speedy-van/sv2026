'use client';

import type { AddressSchema, AccessDetailSchema, QuoteDtoSchema, ServiceKeySchema, SlotSchema } from '@sv/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { z } from 'zod';

export type BookingStep = 'move' | 'items' | 'prices' | 'pay';
export type Address = z.infer<typeof AddressSchema>;
export type AccessDetail = z.infer<typeof AccessDetailSchema>;
export type QuoteDto = z.infer<typeof QuoteDtoSchema>;
export type ServiceKey = z.infer<typeof ServiceKeySchema>;
export type Slot = z.infer<typeof SlotSchema>;

export interface DraftItem {
  itemSlug?: string;
  kind: 'catalogue' | 'custom';
  name?: string;
  quantity: number;
  size?: 'S' | 'M' | 'L' | 'XL';
}

export interface BookingDraftState {
  addons: {
    assembly: boolean;
    helpers: number;
    packing: boolean;
  };
  contact: {
    email: string;
    name: string;
    phone: string;
  };
  customerNotes: string;
  dropoff: Address | null;
  dropoffAccess: AccessDetail | null;
  idempotencyKey: string | null;
  items: DraftItem[];
  marketingOptIn: boolean;
  pickup: Address | null;
  pickupAccess: AccessDetail;
  quote: QuoteDto | null;
  quotePublicId: string | null;
  selectedDate: string | null;
  selectedSlot: Slot | null;
  service: ServiceKey | null;
  statusToken: string | null;
  termsAccepted: boolean;
  shortNoticeAck: boolean;
  variant: string | null;
  clear: () => void;
  ensureCheckoutKey: () => string;
  setDraft: (patch: Partial<Omit<BookingDraftState, 'clear' | 'ensureCheckoutKey' | 'setDraft'>>) => void;
}

export const defaultAccess: AccessDetail = {
  carryMetres: 10,
  floorChoice: 'GROUND',
  hasLift: false,
  narrowAccess: false,
  permitZone: false,
};

const initialDraft = {
  addons: { assembly: false, helpers: 0, packing: false },
  contact: { email: '', name: '', phone: '' },
  customerNotes: '',
  dropoff: null,
  dropoffAccess: defaultAccess,
  idempotencyKey: null,
  items: [] as DraftItem[],
  marketingOptIn: false,
  pickup: null,
  pickupAccess: defaultAccess,
  quote: null,
  quotePublicId: null,
  selectedDate: null,
  selectedSlot: null,
  service: null,
  shortNoticeAck: false,
  statusToken: null,
  termsAccepted: false,
  variant: null,
};

function newId(): string {
  return crypto.randomUUID();
}

export const useBookingDraft = create<BookingDraftState>()(
  persist(
    (set, get) => ({
      ...initialDraft,
      clear: () => {
        set({ ...initialDraft });
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('sv-booking-draft-v1');
        }
      },
      ensureCheckoutKey: () => {
        const existing = get().idempotencyKey;
        if (existing) return existing;
        const id = newId();
        set({ idempotencyKey: id });
        return id;
      },
      setDraft: (patch) => set(patch),
    }),
    {
      name: 'sv-booking-draft-v1',
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
    },
  ),
);

export function firstIncompleteStep(state: BookingDraftState): BookingStep {
  if (state.quote && state.quotePublicId) {
    if (!state.selectedDate || !state.selectedSlot) return 'prices';
    return 'pay';
  }
  if (!state.service || !state.pickup || (state.service !== 'rubbish' && !state.dropoff) || !state.variant) return 'move';
  if (state.items.length === 0 && state.service !== 'piano') return 'items';
  if (!state.quote || !state.selectedDate || !state.selectedSlot) return 'prices';
  return 'pay';
}
