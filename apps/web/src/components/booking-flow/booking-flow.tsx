'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  AddressSchema,
  BookingCreateSchema,
  ContactSchema,
  ManualQuoteRequestSchema,
  QuoteRequestSchema,
  formatGBP,
  parseFlatNotation,
  routeTouchesScotland,
  type AddressSuggestionSchema,
} from '@sv/contracts';
import {
  AlertTriangle,
  Bath,
  BedDouble,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CookingPot,
  CreditCard,
  Flower2,
  Loader2,
  MapPin,
  Package,
  PackagePlus,
  Search,
  ShieldCheck,
  Sofa,
  Truck,
  User,
  Users,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { bookingNavigationCopy, bookingSteps as steps } from '../../content/booking-navigation';
import { bookingConfirmationCopy } from '@/content/booking-confirmation';
import { PaymentModeNotice } from '../customer/payment-mode-notice';
import { distanceBand, trackBookingEvent, trackBookingStart } from './analytics';
import {
  confirmTestPayment,
  createBooking,
  createQuote,
  getBookingStatus,
  getCatalogue,
  getQuoteByPublicId,
  lookupPostcode,
  requestManualQuote,
  retrieveAddress,
  suggestAddresses,
} from './api';
import {
  defaultAccess,
  firstIncompleteStep,
  useBookingDraft,
  type AccessDetail,
  type Address,
  type BookingStep,
  type DraftItem,
  type QuoteDto,
  type ServiceKey,
  type Slot,
} from './booking-store';
import { serviceByKey, serviceOptions } from './content';

const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const stripePromise = stripeKey ? loadStripe(stripeKey) : null;

type Suggestion = z.infer<typeof AddressSuggestionSchema>;
type ContactInput = z.infer<typeof ContactSchema>;
type ManualQuoteInput = z.infer<typeof ManualQuoteRequestSchema>;
type InventoryItemConfig = { detail?: string; label: string; slug: string };
type InventoryCategoryConfig = {
  description?: string;
  icon: LucideIcon;
  items: InventoryItemConfig[];
  key: string;
  title: string;
};

const inventoryCategories: InventoryCategoryConfig[] = [
  {
    icon: BedDouble,
    key: 'bedrooms',
    title: 'Bedrooms',
    items: [
      { label: 'Single Bed & Mattress', slug: 'bed-single' },
      { label: 'Double Bed & Mattress', slug: 'bed-double' },
      { label: 'Kingsize Bed & Mattress', slug: 'bed-king' },
      { label: 'Single Wardrobe', slug: 'wardrobe-single' },
      { label: 'Double Wardrobe', slug: 'wardrobe-double' },
      { label: 'Chest Of Drawers', slug: 'chest-of-drawers' },
      { label: 'Bedside Table', slug: 'bedside-table' },
      { label: 'Dressing Table', slug: 'dressing-table' },
      { label: 'Television', slug: 'tv-small' },
      { label: 'Side Table', slug: 'side-table' },
    ],
  },
  {
    icon: Sofa,
    key: 'living',
    title: 'Living',
    items: [
      { label: 'Two Seater Sofa', slug: 'sofa-2-seater' },
      { label: 'Three Seater Sofa', slug: 'sofa-3-seater' },
      { label: 'Four Seater Sofa', slug: 'sofa-4-seater' },
      { label: 'Armchair', slug: 'armchair' },
      { label: 'Coffee Table', slug: 'coffee-table' },
      { label: 'Small Television/TV (Less than 30")', slug: 'tv-small' },
      { label: 'Large Television/TV (Greater than 40")', slug: 'tv-large' },
      { label: 'TV Stand', slug: 'tv-unit' },
      { label: 'Bookcase', slug: 'bookcase-small' },
      { label: 'Rug', slug: 'rug' },
      { label: 'Floor Lamp', slug: 'floor-lamp' },
    ],
  },
  {
    icon: UtensilsCrossed,
    key: 'dining',
    title: 'Dining',
    items: [
      { label: '6 Seater Dining Table', slug: 'dining-table-large' },
      { label: '8 Seater Dining Table', slug: 'dining-table-8' },
      { label: 'Dining Chair', slug: 'dining-chair' },
      { label: 'Sideboard', slug: 'sideboard' },
      { label: 'Display Cabinet', slug: 'display-cabinet' },
      { label: 'Rug', slug: 'rug' },
      { label: '4 Seater Dining Table', slug: 'dining-table-small' },
    ],
  },
  {
    icon: CookingPot,
    key: 'kitchen',
    title: 'Kitchen',
    items: [
      { label: 'Fridge Freezer', slug: 'fridge-freezer' },
      { label: 'Washing Machine', slug: 'washing-machine' },
      { label: 'Tumble Dryer', slug: 'tumble-dryer' },
      { label: 'Microwave Oven', slug: 'microwave' },
      { label: 'Cooker', slug: 'cooker' },
      { label: 'Dishwasher', slug: 'dishwasher' },
      { label: 'Kitchen Table', slug: 'dining-table-small' },
      { label: 'Dining Chair', slug: 'dining-chair' },
      { label: 'Bin', slug: 'kitchen-bin' },
    ],
  },
  {
    icon: BriefcaseBusiness,
    key: 'office',
    title: 'Office',
    items: [
      { label: 'Office Chair', slug: 'chair-office' },
      { label: 'Desk', slug: 'desk-office' },
      { label: 'Lamp', slug: 'office-lamp' },
      { label: 'Display Cabinet', slug: 'display-cabinet' },
      { label: 'Printer', slug: 'printer-desktop' },
      { label: 'Filing Cabinet', slug: 'cabinet-filing-4' },
      { label: 'Computer', slug: 'computer' },
    ],
  },
  {
    icon: Bath,
    key: 'bathroom',
    title: 'Bathroom',
    items: [
      { label: 'Large Mirror', slug: 'mirror-large' },
      { label: 'Small Mirror', slug: 'mirror-small' },
      { label: 'Rug', slug: 'rug' },
      { label: 'Bathroom Cabinet', slug: 'bathroom-cabinet' },
      { label: 'Bath Tub', slug: 'bath-tub' },
    ],
  },
  {
    icon: Flower2,
    key: 'garden',
    title: 'Garden',
    items: [
      { label: 'Garden Table', slug: 'garden-table' },
      { label: 'Garden Chair', slug: 'garden-chair' },
      { label: 'Lawn Mower', slug: 'lawn-mower' },
      { label: 'Tool Box', slug: 'tool-box' },
      { label: 'Bench', slug: 'garden-bench' },
      { label: 'Parasol', slug: 'parasol' },
      { label: 'Bicycle', slug: 'bicycle' },
    ],
  },
  {
    description: "Whether you're packing yourself or would like us to help, estimating how many boxes you'll need is important for an accurate quote.",
    icon: Package,
    key: 'boxes-bags',
    title: 'Boxes & Bags',
    items: [
      { detail: 'Approx. 50 x 50 x 50 cm', label: 'Large Box', slug: 'box-large' },
      { detail: 'Approx. 45 x 45 x 35 cm', label: 'Medium Box', slug: 'box-medium' },
      { detail: 'Approx. 40 x 30 x 30 cm', label: 'Small Box', slug: 'box-small' },
      { label: 'Wardrobe Box', slug: 'box-wardrobe' },
      { label: 'Suitcase', slug: 'suitcase' },
      { label: 'Bag', slug: 'bag-holdall' },
    ],
  },
];

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function selectedStep(searchParams: URLSearchParams): BookingStep {
  const step = searchParams.get('step');
  return steps.some((candidate) => candidate.key === step) ? step as BookingStep : 'move';
}

function slotWindow(slot: Slot): string {
  if (slot === 'MORNING') return '8am-12pm';
  if (slot === 'AFTERNOON') return '12pm-5pm';
  return '5pm-9pm';
}

function itemCount(items: DraftItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

function stepIndex(step: BookingStep): number {
  return steps.findIndex((candidate) => candidate.key === step);
}

function nextStep(step: BookingStep): BookingStep {
  return steps[Math.min(stepIndex(step) + 1, steps.length - 1)]?.key ?? 'pay';
}

function previousStep(step: BookingStep): BookingStep {
  return steps[Math.max(stepIndex(step) - 1, 0)]?.key ?? 'move';
}

function useBookingStep(): [BookingStep, (step: BookingStep) => void] {
  const router = useRouter();
  const params = useSearchParams();
  const draft = useBookingDraft();
  const [hydrated, setHydrated] = useState(false);
  const guard = firstIncompleteStep(draft);
  const step = selectedStep(params);
  const allowQuoteRestore = params.has('quote');
  useEffect(() => {
    const unsubscribe = useBookingDraft.persist.onFinishHydration(() => { setHydrated(true); });
    if (useBookingDraft.persist.hasHydrated()) setHydrated(true);
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (hydrated && !allowQuoteRestore && stepIndex(step) > stepIndex(guard)) {
      router.replace(`/book?step=${guard}`);
    }
  }, [allowQuoteRestore, guard, hydrated, router, step]);
  return [
    !hydrated ? 'move' : !allowQuoteRestore && stepIndex(step) > stepIndex(guard) ? guard : step,
    (next) => {
      router.push(`/book?step=${next}`);
    },
  ];
}

function InlineAlert({ children, tone = 'info' }: { children: ReactNode; tone?: 'danger' | 'info' | 'success' | 'warning' }): ReactNode {
  return (
    <div className={`booking-alert booking-alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {tone === 'danger' ? <AlertTriangle aria-hidden="true" size={18} /> : <Check aria-hidden="true" size={18} />}
      <span>{children}</span>
    </div>
  );
}

function ProgressSteps({ current, setStep }: { current: BookingStep; setStep: (step: BookingStep) => void }): ReactNode {
  const currentIndex = stepIndex(current);
  return (
    <ol aria-label={bookingNavigationCopy.progress} className="booking-progress">
      {steps.map((step, index) => (
        <li className={classNames(index === currentIndex && 'is-current', index < currentIndex && 'is-complete')} key={step.key}>
          <button
            aria-current={index === currentIndex ? 'step' : undefined}
            aria-label={bookingNavigationCopy.stepLabel(index + 1, step.label, index < currentIndex)}
            disabled={index > currentIndex}
            onClick={() => { setStep(step.key); }}
            type="button"
          >
            <span aria-hidden="true" className="booking-step-marker">
              {index < currentIndex ? <Check size={18} strokeWidth={2.5} /> : index + 1}
            </span>
            <span className="booking-step-label">{step.label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function AddressField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (address: Address | null) => void;
  value: Address | null;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [sessionToken, setSessionToken] = useState(() => crypto.randomUUID());
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [line1, setLine1] = useState('');
  const [flat, setFlat] = useState('');
  const [town, setTown] = useState('');
  const [postcode, setPostcode] = useState('');
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2 || manual || value) {
      setSuggestions([]);
      return;
    }
    const handle = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      suggestAddresses(query, sessionToken)
        .then((result) => {
          setSuggestions(result);
          if (liveRef.current) liveRef.current.textContent = `${String(result.length)} addresses found`;
        })
        .catch(() => {
          setError("Address search isn't responding. Try again or enter the address manually.");
        })
        .finally(() => { setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(handle); };
  }, [manual, query, sessionToken, value]);

  async function selectSuggestion(suggestion: Suggestion): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await retrieveAddress(suggestion.id, sessionToken);
      if ('needsPostcode' in result) {
        setManual(true);
        setLine1(result.address.line1);
        setTown(result.address.town);
        setSessionToken(crypto.randomUUID());
        return;
      }
      onChange(result.address);
      trackBookingEvent('address_selected', { source: result.address.source });
      setQuery('');
      setSuggestions([]);
      setSessionToken(crypto.randomUUID());
    } catch {
      setError("Address search isn't responding. Try again or enter the address manually.");
    } finally {
      setLoading(false);
    }
  }

  async function saveManual(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const resolved = await lookupPostcode(postcode);
      const address = AddressSchema.parse({
        flat: flat || undefined,
        label: [flat, line1, resolved.town, resolved.postcode].filter(Boolean).join(', '),
        lat: resolved.lat,
        line1,
        lng: resolved.lng,
        postcode: resolved.postcode,
        source: 'MANUAL',
        town: town || resolved.town,
      });
      onChange(address);
      trackBookingEvent('address_selected', { source: address.source });
      setManual(false);
      setQuery('');
      setLine1('');
      setFlat('');
      setTown('');
      setPostcode('');
    } catch {
      setError("We can't find that postcode. Check it and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (value) {
    return (
      <div className="address-selected">
        <MapPin aria-hidden="true" size={18} />
        <span>{value.label}</span>
        <button className="button button-ghost" onClick={() => { onChange(null); }} type="button">
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="address-field">
      <label htmlFor={`${label}-address`}>{label}</label>
      {!manual ? (
        <>
          <div className="address-input-wrap">
            <Search aria-hidden="true" size={18} />
            <input
              aria-autocomplete="list"
              aria-controls={`${label}-suggestions`}
              aria-expanded={suggestions.length > 0}
              className="text-input"
              id={`${label}-address`}
              onChange={(event) => { setQuery(event.target.value); }}
              placeholder="Search address or postcode"
              role="combobox"
              type="text"
              value={query}
            />
          </div>
          <div aria-live="polite" className="sr-only" ref={liveRef} />
          {loading ? <p className="field-help">Searching addresses…</p> : null}
          <ul className="address-suggestions" hidden={suggestions.length === 0} id={`${label}-suggestions`} role="listbox">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <button aria-selected="false" onClick={() => void selectSuggestion(suggestion)} role="option" type="button">
                  <strong>{suggestion.primary}</strong>
                  <span>{suggestion.secondary}</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="link-button" onClick={() => { setManual(true); }} type="button">
            Enter address manually
          </button>
        </>
      ) : (
        <div className="manual-address">
          <input className="text-input" onChange={(event) => { setLine1(event.target.value); }} placeholder="Street address" type="text" value={line1} />
          <input className="text-input" onChange={(event) => { setFlat(event.target.value); }} placeholder="Flat or floor (optional)" type="text" value={flat} />
          <input className="text-input" onChange={(event) => { setTown(event.target.value); }} placeholder="Town" type="text" value={town} />
          <input className="text-input" onChange={(event) => { setPostcode(event.target.value); }} placeholder="Postcode" type="text" value={postcode} />
          <div className="button-row">
            <button className="button button-secondary" onClick={() => { setManual(false); }} type="button">
              Back to search
            </button>
            <button className="button button-primary" disabled={!line1 || !postcode || loading} onClick={() => void saveManual()} type="button">
              Use address
            </button>
          </div>
        </div>
      )}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
    </div>
  );
}

function AccessCard({
  address,
  kind,
  label,
  onChange,
  value,
}: {
  address: Address | null;
  kind: 'dropoff' | 'pickup';
  label: string;
  onChange: (next: AccessDetail) => void;
  value: AccessDetail;
}): ReactNode {
  const [notesOpen, setNotesOpen] = useState(false);
  const MarkerIcon = kind === 'pickup' ? Truck : MapPin;
  const suggestion = parseFlatNotation(address?.flat, address?.line1);
  function patch(next: Partial<AccessDetail>): void {
    onChange({ ...value, ...next });
  }
  return (
    <section className={classNames('booking-panel', 'access-card', kind === 'pickup' ? 'access-card-pickup' : 'access-card-dropoff')}>
      <div className="access-card-title">
        <span className="access-marker" aria-hidden="true">
          <MarkerIcon size={18} />
        </span>
        <h2>{label}</h2>
      </div>
      <p className="field-help">At {address?.line1 ?? 'the address'}</p>
      {suggestion ? (
        <div className="flat-suggestion">
          Looks like a {suggestion.label.toLowerCase()} flat.
          <button className="button button-secondary" onClick={() => { patch({ floorChoice: suggestion.kind, floorNumber: suggestion.kind === 'FLOOR' ? suggestion.floor : undefined }); }} type="button">
            Use {suggestion.label}
          </button>
        </div>
      ) : null}
      <div className="choice-grid compact">
        {(['GROUND', 'FLOOR', 'BASEMENT'] as const).map((choice) => (
          <button className={classNames('choice-card', value.floorChoice === choice && 'selected')} key={choice} onClick={() => { patch({ floorChoice: choice, floorNumber: choice === 'FLOOR' ? value.floorNumber ?? 1 : undefined }); }} type="button">
            {choice === 'BASEMENT' ? 'Basement' : choice === 'GROUND' ? 'Ground' : 'Floor'}
          </button>
        ))}
      </div>
      {value.floorChoice === 'FLOOR' ? (
        <label className="field">
          Floor number
          <input className="text-input" min={1} max={30} onChange={(event) => { patch({ floorNumber: Number(event.target.value) }); }} type="number" value={value.floorNumber ?? 1} />
        </label>
      ) : null}
      {value.floorChoice !== 'GROUND' ? (
        <label className="toggle-row">
          <span>Is there a lift you can use?</span>
          <input checked={value.hasLift} onChange={(event) => { patch({ hasLift: event.target.checked }); }} type="checkbox" />
        </label>
      ) : null}
      <button className="link-button" onClick={() => { setNotesOpen((current) => !current); }} type="button">
        Anything tricky?
      </button>
      {notesOpen ? (
        <div className="tricky-grid">
          <label className="field">
            Carry distance
            <input min={10} max={100} step={5} onChange={(event) => { patch({ carryMetres: Number(event.target.value) }); }} type="range" value={value.carryMetres} />
            <span className="field-help">{value.carryMetres} m, first 10 m included</span>
          </label>
          <label className="toggle-row">
            <span>Narrow stairs, tight corners or small lift</span>
            <input checked={value.narrowAccess} onChange={(event) => { patch({ narrowAccess: event.target.checked }); }} type="checkbox" />
          </label>
          <label className="toggle-row">
            <span>Parking permit or controlled parking zone</span>
            <input checked={value.permitZone} onChange={(event) => { patch({ permitZone: event.target.checked }); }} type="checkbox" />
          </label>
        </div>
      ) : null}
    </section>
  );
}

function MoveStep({ goNext }: { goNext: () => void }): ReactNode {
  const draft = useBookingDraft();
  const selectedService = serviceByKey(draft.service);
  const canContinue = Boolean(draft.service && draft.pickup && (selectedService?.requiresDropoff === false || draft.dropoff) && draft.variant);
  const touchesScotland = draft.pickup && (draft.dropoff || selectedService?.requiresDropoff === false)
    ? routeTouchesScotland({ pickup: draft.pickup.postcode, dropoff: draft.dropoff?.postcode ?? null })
    : true;

  function chooseService(key: ServiceKey): void {
    const service = serviceByKey(key);
    trackBookingStart({ service: key });
    draft.setDraft({
      dropoff: service?.requiresDropoff === false ? null : draft.dropoff,
      dropoffAccess: service?.requiresDropoff === false ? null : draft.dropoffAccess ?? defaultAccess,
      quote: null,
      selectedDate: null,
      selectedSlot: null,
      service: key,
      variant: service?.variants[0]?.key ?? null,
    });
  }

  return (
    <div className="booking-step">
      <section className="booking-panel">
        <h1>Your move</h1>
        <p className="lead">Tell us what you are moving and where it is going.</p>
        <label className="field">
          Move type
          <select className="text-input" onChange={(event) => { chooseService(event.target.value as ServiceKey); }} value={draft.service ?? ''}>
            <option disabled value="">Choose move type</option>
            {serviceOptions.map((service) => (
              <option key={service.key} value={service.key}>{service.label}</option>
            ))}
          </select>
          {selectedService ? <span className="field-help">{selectedService.description}</span> : null}
        </label>
        <div className="field-grid">
          <AddressField label={selectedService?.requiresDropoff === false ? 'Collection address' : 'From'} onChange={(pickup) => { draft.setDraft({ pickup, quote: null, selectedDate: null, selectedSlot: null }); }} value={draft.pickup} />
          {selectedService?.requiresDropoff === false ? null : (
            <AddressField label="To" onChange={(dropoff) => { draft.setDraft({ dropoff, quote: null, selectedDate: null, selectedSlot: null }); }} value={draft.dropoff} />
          )}
        </div>
        {!touchesScotland ? <InlineAlert tone="danger">We move people to and from Scotland. One address needs to be in Scotland.</InlineAlert> : null}
        {selectedService && selectedService.variants.length > 1 ? (
          <label className="field">
            Size or type
            <select className="text-input" onChange={(event) => { draft.setDraft({ quote: null, selectedDate: null, selectedSlot: null, variant: event.target.value }); }} value={draft.variant ?? selectedService.variants[0]?.key ?? ''}>
              {selectedService.variants.map((variant) => (
                <option key={variant.key} value={variant.key}>
                  {variant.manualQuote ? `${variant.label} - individual price` : variant.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>
      <button className="button button-primary booking-next" disabled={!canContinue || !touchesScotland} onClick={goNext} type="button">
        Continue to access
      </button>
    </div>
  );
}

function AccessStep({ goNext }: { goNext: () => void }): ReactNode {
  const draft = useBookingDraft();
  const selectedService = serviceByKey(draft.service);
  const canContinue = Boolean(draft.pickup && (selectedService?.requiresDropoff === false || draft.dropoff));

  return (
    <div className="booking-step">
      <section className="booking-panel">
        <h1>Access</h1>
        <p className="lead">A quick check for stairs, lifts and parking so the price is accurate.</p>
      </section>
      {draft.pickup ? <AccessCard address={draft.pickup} kind="pickup" label="Pickup access" onChange={(pickupAccess) => { draft.setDraft({ pickupAccess, quote: null }); }} value={draft.pickupAccess} /> : null}
      {selectedService?.requiresDropoff !== false && draft.dropoff ? <AccessCard address={draft.dropoff} kind="dropoff" label="Dropoff access" onChange={(dropoffAccess) => { draft.setDraft({ dropoffAccess, quote: null }); }} value={draft.dropoffAccess ?? defaultAccess} /> : null}
      <button className="button button-primary booking-next" disabled={!canContinue} onClick={goNext} type="button">
        Continue to items
      </button>
    </div>
  );
}

function ItemsStep({ goNext }: { goNext: () => void }): ReactNode {
  const draft = useBookingDraft();
  const catalogue = useQuery({ queryFn: getCatalogue, queryKey: ['catalogue'] });
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set(['bedrooms']));
  const [categorySearches, setCategorySearches] = useState<Record<string, string>>({});
  const [customName, setCustomName] = useState('');
  const selected = new Map(draft.items.filter((item) => item.kind === 'catalogue' && item.itemSlug).map((item) => [item.itemSlug as string, item.quantity]));
  const catalogueBySlug = new Map((catalogue.data?.items ?? []).map((item) => [item.slug, item]));
  const missingItems = catalogue.data
    ? inventoryCategories.flatMap((category) => category.items.filter((item) => !catalogueBySlug.has(item.slug)).map((item) => item.label))
    : [];

  function toggleCategory(key: string): void {
    setOpenCategories((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function categoryQuantity(category: InventoryCategoryConfig): number {
    return category.items.reduce((sum, item) => sum + (selected.get(item.slug) ?? 0), 0);
  }

  function filteredItems(category: InventoryCategoryConfig): InventoryItemConfig[] {
    const query = (categorySearches[category.key] ?? '').trim().toLowerCase();
    if (!query) return category.items;
    return category.items.filter((item) => {
      const catalogueItem = catalogueBySlug.get(item.slug);
      return (
        item.label.toLowerCase().includes(query) ||
        item.detail?.toLowerCase().includes(query) ||
        catalogueItem?.name.toLowerCase().includes(query) ||
        catalogueItem?.aliases.some((alias) => alias.toLowerCase().includes(query))
      );
    });
  }

  function setQuantity(slug: string, quantity: number): void {
    const item = catalogueBySlug.get(slug);
    if (!item) return;
    const nextQuantity = Math.max(0, Math.min(99, Math.trunc(quantity)));
    const current = useBookingDraft.getState();
    const rest = current.items.filter((candidate) => candidate.kind !== 'catalogue' || candidate.itemSlug !== slug);
    draft.setDraft({
      items: nextQuantity > 0 ? [...rest, { itemSlug: slug, kind: 'catalogue', quantity: nextQuantity }] : rest,
      quote: null,
      quotePublicId: null,
      selectedDate: null,
      selectedSlot: null,
    });
  }

  function addCustom(): void {
    if (customName.trim().length < 2) return;
    const current = useBookingDraft.getState();
    draft.setDraft({
      items: [...current.items, { kind: 'custom', name: customName.trim(), quantity: 1, size: 'M' }],
      quote: null,
      quotePublicId: null,
      selectedDate: null,
      selectedSlot: null,
    });
    setCustomName('');
  }

  return (
    <div className="booking-step">
      <section className="booking-panel">
        <h1>Items</h1>
        <p className="lead">Open each room, search inside it, and add the items you are moving.</p>
        {catalogue.isLoading ? <div className="skeleton skeleton-card" /> : null}
        {catalogue.isError ? <InlineAlert tone="danger">We could not load the item catalogue. Try again.</InlineAlert> : null}
        {missingItems.length > 0 ? (
          <InlineAlert tone="warning">Pricing metadata is missing for {missingItems.slice(0, 4).join(', ')}{missingItems.length > 4 ? ` and ${String(missingItems.length - 4)} more` : ''}.</InlineAlert>
        ) : null}
        <div className="inventory-accordion">
          {inventoryCategories.map((category) => {
            const Icon = category.icon;
            const isOpen = openCategories.has(category.key);
            const panelId = `${category.key}-inventory-panel`;
            const query = categorySearches[category.key] ?? '';
            const visibleItems = filteredItems(category);
            const selectedCount = categoryQuantity(category);
            return (
              <section className={classNames('inventory-category', isOpen && 'open')} key={category.key}>
                <button aria-controls={panelId} aria-expanded={isOpen} className="inventory-category-trigger" onClick={() => { toggleCategory(category.key); }} type="button">
                  <Icon aria-hidden="true" size={22} />
                  <span>{category.title}</span>
                  {selectedCount > 0 ? <strong>{selectedCount}</strong> : null}
                  <ChevronDown aria-hidden="true" className="inventory-chevron" size={20} />
                </button>
                {isOpen ? (
                  <div aria-label={`${category.title} items`} className="inventory-category-panel" id={panelId} role="region">
                    {category.key === 'boxes-bags' ? (
                      <div className="inventory-intro">
                        <h2>Your boxes and bags</h2>
                        <p>{category.description}</p>
                      </div>
                    ) : null}
                    <label className="field inventory-search-field">
                      Search items
                      <div className="inventory-search-wrap">
                        <Search aria-hidden="true" size={18} />
                        <input
                          className="text-input"
                          onChange={(event) => { setCategorySearches((current) => ({ ...current, [category.key]: event.target.value })); }}
                          placeholder={`Search ${category.title.toLowerCase()}`}
                          type="search"
                          value={query}
                        />
                        {query ? (
                          <button aria-label={`Clear ${category.title} search`} onClick={() => { setCategorySearches((current) => ({ ...current, [category.key]: '' })); }} type="button">
                            <X aria-hidden="true" size={16} />
                          </button>
                        ) : null}
                      </div>
                    </label>
                    <div className="inventory-list">
                      {visibleItems.map((item) => {
                        const catalogueItem = catalogueBySlug.get(item.slug);
                        const quantity = selected.get(item.slug) ?? 0;
                        return (
                          <div className={classNames('inventory-item-row', quantity > 0 && 'selected', !catalogueItem && 'unavailable')} key={`${category.key}-${item.slug}-${item.label}`}>
                            <div className="inventory-item-copy">
                              <span>{item.label}</span>
                              {item.detail ? <small>{item.detail}</small> : null}
                              {!catalogueItem ? <small>Pricing unavailable</small> : null}
                            </div>
                            {catalogueItem ? (
                              <Quantity label={item.label} value={quantity} onChange={(next) => { setQuantity(item.slug, next); }} />
                            ) : null}
                            {quantity > 0 ? <span className="inventory-selected-count">{quantity} selected</span> : null}
                          </div>
                        );
                      })}
                    </div>
                    {visibleItems.length === 0 ? <p className="field-help">No matching items</p> : null}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
        <div className="custom-item">
          <p>Can't find something? Add it as your own item.</p>
          <input className="text-input" onChange={(event) => { setCustomName(event.target.value); }} placeholder="Item name" type="text" value={customName} />
          <button className="button button-secondary" onClick={addCustom} type="button">
            <PackagePlus aria-hidden="true" size={18} />
            Add own item
          </button>
        </div>
      </section>
      <section className="booking-panel">
        <h2>Extras</h2>
        <label className="field">
          Extra helpers
          <Quantity max={3} label="extra helpers" value={draft.addons.helpers} onChange={(helpers) => { draft.setDraft({ addons: { ...draft.addons, helpers }, quote: null, quotePublicId: null, selectedDate: null, selectedSlot: null }); }} />
        </label>
        <label className="toggle-row">
          <span>Packing help</span>
          <input checked={draft.addons.packing} onChange={(event) => { draft.setDraft({ addons: { ...draft.addons, packing: event.target.checked }, quote: null, quotePublicId: null, selectedDate: null, selectedSlot: null }); }} type="checkbox" />
        </label>
        <label className="toggle-row">
          <span>Furniture assembly</span>
          <input checked={draft.addons.assembly} onChange={(event) => { draft.setDraft({ addons: { ...draft.addons, assembly: event.target.checked }, quote: null, quotePublicId: null, selectedDate: null, selectedSlot: null }); }} type="checkbox" />
        </label>
      </section>
      <div className="booking-summary-bar">
        <span>{itemCount(draft.items)} items selected</span>
        <button className="button button-primary" disabled={draft.items.length === 0 && draft.service !== 'piano'} onClick={goNext} type="button">
          See my prices
        </button>
      </div>
    </div>
  );
}

function Quantity({ label = 'quantity', max = 99, onChange, value }: { label?: string; max?: number; onChange: (value: number) => void; value: number }): ReactNode {
  const pendingValue = useRef(value);
  useEffect(() => {
    pendingValue.current = value;
  }, [value]);

  function commit(next: number): void {
    const clamped = Math.max(0, Math.min(max, Math.trunc(next)));
    pendingValue.current = clamped;
    onChange(clamped);
  }

  return (
    <div className="quantity">
      <button aria-label={`Decrease ${label}`} disabled={value <= 0} onClick={() => { commit(pendingValue.current - 1); }} type="button">
        -
      </button>
      <output aria-live="polite">{value}</output>
      <button aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => { commit(pendingValue.current + 1); }} type="button">
        +
      </button>
    </div>
  );
}

function quoteInputFromDraft(draft: ReturnType<typeof useBookingDraft.getState>): z.infer<typeof QuoteRequestSchema> {
  const service = serviceByKey(draft.service);
  if (!draft.service || !draft.variant || !draft.pickup || (service?.requiresDropoff !== false && !draft.dropoff)) {
    throw new Error('Complete your move details first.');
  }
  return QuoteRequestSchema.parse({
    addons: draft.addons,
    dropoff: service?.requiresDropoff === false ? null : draft.dropoff,
    dropoffAccess: service?.requiresDropoff === false ? null : draft.dropoffAccess,
    items: draft.items.map((item) => item.kind === 'catalogue'
      ? { itemSlug: item.itemSlug ?? '', kind: 'catalogue' as const, quantity: item.quantity }
      : { kind: 'custom' as const, name: item.name ?? 'Item', quantity: item.quantity, size: item.size ?? 'M' }),
    pickup: draft.pickup,
    pickupAccess: draft.pickupAccess,
    service: draft.service,
    variant: draft.variant,
  });
}

function buildCrewInput(helpers: 0 | 1): z.infer<typeof QuoteRequestSchema> {
  const state = useBookingDraft.getState();
  return quoteInputFromDraft({ ...state, addons: { ...state.addons, helpers } });
}

function PricesStep({ goNext }: { goNext: () => void }): ReactNode {
  const draft = useBookingDraft();
  const setDraft = draft.setDraft;

  // Local cache of quotes for each crew size (1 mover = helpers 0, 2 movers = helpers 1)
  const [crew1Quote, setCrew1Quote] = useState<QuoteDto | null>(null);
  const [crew2Quote, setCrew2Quote] = useState<QuoteDto | null>(null);
  const [crew1Loading, setCrew1Loading] = useState(false);
  const [crew2Loading, setCrew2Loading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualReasons, setManualReasons] = useState<string[] | null>(null);
  const [visibleCount, setVisibleCount] = useState(7);
  const [expiredQuoteIds, setExpiredQuoteIds] = useState<Set<string>>(() => new Set());

  const crew1KeyRef = useRef<string | null>(null);
  const crew2KeyRef = useRef<string | null>(null);
  const crewQuoteIdsRef = useRef<Partial<Record<1 | 2, string>>>({});
  const mountedRef = useRef(false);
  // Per-crew generation counters prevent stale async results from applying
  const loadGenRef = useRef<Record<1 | 2, number>>({ 1: 0, 2: 0 });

  const activeCrewNum: 1 | 2 = draft.addons.helpers >= 1 ? 2 : 1;
  const activeQuote = activeCrewNum === 1 ? crew1Quote : crew2Quote;
  const isActiveLoading = activeCrewNum === 1 ? crew1Loading : crew2Loading;

  const applyQuoteForCrew = useCallback((quote: QuoteDto, moverCount: 1 | 2): void => {
    const state = useBookingDraft.getState();
    const nowActive: 1 | 2 = state.addons.helpers >= 1 ? 2 : 1;
    if (moverCount !== nowActive) return;
    const selectedDay = quote.calendar.find((day) => day.date === state.selectedDate);
    const selectedStillAvailable = selectedDay?.slots.some((slot) => slot.slot === state.selectedSlot && slot.available);
    const best = quote.cheapest;
    setDraft({
      quote,
      quotePublicId: quote.publicId,
      selectedDate: selectedStillAvailable ? state.selectedDate : best?.date ?? null,
      selectedSlot: selectedStillAvailable ? state.selectedSlot : best?.slot ?? null,
    });
  }, [setDraft]);

  const restoreCrewQuote = useCallback(async (moverCount: 1 | 2, publicId: string): Promise<QuoteDto | null> => {
    crewQuoteIdsRef.current[moverCount] = publicId;
    const gen = ++loadGenRef.current[moverCount];
    const setLoading = moverCount === 1 ? setCrew1Loading : setCrew2Loading;
    const setQuote = moverCount === 1 ? setCrew1Quote : setCrew2Quote;
    setLoading(true);
    setQuote(null);
    setError(null);
    try {
      const result = await getQuoteByPublicId(publicId);
      if (!mountedRef.current || gen !== loadGenRef.current[moverCount]) return null;
      setExpiredQuoteIds((current) => {
        const next = new Set(current);
        if (result.expired) next.add(result.quote.publicId);
        else next.delete(result.quote.publicId);
        return next;
      });
      setQuote(result.quote);
      applyQuoteForCrew(result.quote, moverCount);
      return result.quote;
    } catch (cause) {
      if (!mountedRef.current || gen !== loadGenRef.current[moverCount]) return null;
      const nowActive: 1 | 2 = useBookingDraft.getState().addons.helpers >= 1 ? 2 : 1;
      if (moverCount === nowActive) setError(cause instanceof Error ? cause.message : 'We could not check current availability. Try again.');
      return null;
    } finally {
      if (mountedRef.current && gen === loadGenRef.current[moverCount]) setLoading(false);
    }
  }, [applyQuoteForCrew]);

  const fetchCrewQuote = useCallback(async (moverCount: 1 | 2, force = false): Promise<QuoteDto | null> => {
    let input: z.infer<typeof QuoteRequestSchema>;
    try {
      input = buildCrewInput(moverCount === 1 ? 0 : 1);
    } catch (cause) {
      const nowActive: 1 | 2 = useBookingDraft.getState().addons.helpers >= 1 ? 2 : 1;
      if (moverCount === nowActive) setError(cause instanceof Error ? cause.message : 'Complete your move details first.');
      return null;
    }

    const key = JSON.stringify(input);
    const keyRef = moverCount === 1 ? crew1KeyRef : crew2KeyRef;
    if (!force && keyRef.current === key) return null;
    keyRef.current = key;

    const gen = ++loadGenRef.current[moverCount];
    const setLoading = moverCount === 1 ? setCrew1Loading : setCrew2Loading;
    const setQuote = moverCount === 1 ? setCrew1Quote : setCrew2Quote;

    setLoading(true);
    setError(null);

    try {
      const result = await createQuote(input);
      if (!mountedRef.current || gen !== loadGenRef.current[moverCount]) return null;

      if ('manualQuote' in result) {
        const nowActive: 1 | 2 = useBookingDraft.getState().addons.helpers >= 1 ? 2 : 1;
        if (moverCount === nowActive) {
          setDraft({ quotePublicId: result.manualQuote.quotePublicId });
          setManualReasons(result.manualQuote.reasons);
          trackBookingEvent('manual_quote_shown', { reason: result.manualQuote.reasons[0], service: input.service });
        }
        return null;
      }

      setQuote(result.quote);
      crewQuoteIdsRef.current[moverCount] = result.quote.publicId;
      return result.quote;
    } catch (cause) {
      if (!mountedRef.current || gen !== loadGenRef.current[moverCount]) return null;
      const nowActive: 1 | 2 = useBookingDraft.getState().addons.helpers >= 1 ? 2 : 1;
      if (moverCount === nowActive) setError(cause instanceof Error ? cause.message : 'We could not get prices just now.');
      return null;
    } finally {
      if (mountedRef.current && gen === loadGenRef.current[moverCount]) setLoading(false);
    }
  }, [setDraft]);

  // Persisted prices are a snapshot; restore their current availability without creating another quote.
  useEffect(() => {
    mountedRef.current = true;
    const state = useBookingDraft.getState();
    const currActive: 1 | 2 = state.addons.helpers >= 1 ? 2 : 1;
    const other: 1 | 2 = currActive === 1 ? 2 : 1;

    if (state.quote) {
      void restoreCrewQuote(currActive, state.quote.publicId);
    } else {
      void fetchCrewQuote(currActive).then((quote) => {
        if (!quote) return;
        applyQuoteForCrew(quote, currActive);
        trackBookingEvent('quote_shown', {
          distance_band: distanceBand(quote.distanceMiles),
          service: quote.service,
          value: (quote.cheapest?.pricePence ?? 0) / 100,
        });
      });
      // A new quote still loads both crew options; restoring an existing one is read-only.
      void fetchCrewQuote(other);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [applyQuoteForCrew, fetchCrewQuote, restoreCrewQuote]);

  function handleCrewSwitch(moverCount: 1 | 2): void {
    if (moverCount === activeCrewNum) return;
    setDraft({ addons: { ...draft.addons, helpers: moverCount - 1 } });
    const publicId = crewQuoteIdsRef.current[moverCount];
    if (publicId) {
      void restoreCrewQuote(moverCount, publicId);
    } else {
      void fetchCrewQuote(moverCount).then((q) => { if (q) applyQuoteForCrew(q, moverCount); });
    }
  }

  if (manualReasons) return <ManualQuotePanel reasons={manualReasons} />;

  // Date-list calculations
  const calendar = activeQuote?.calendar ?? [];
  const firstIdx = Math.max(0, calendar.findIndex((d) => d.slots.some((s) => s.available)));
  const shownDays = calendar.slice(firstIdx, firstIdx + visibleCount);
  const hasMore = firstIdx + visibleCount < calendar.length;
  const canCollapse = visibleCount > 7;

  // Best-price date among currently shown rows
  let bestDate: string | null = null;
  let bestPricePence = Infinity;
  for (const day of shownDays) {
    for (const slot of day.slots) {
      if (slot.available && slot.pricePence < bestPricePence) {
        bestPricePence = slot.pricePence;
        bestDate = day.date;
      }
    }
  }

  const selectedDay =
    activeQuote?.calendar.find((d) => d.date === draft.selectedDate) ??
    activeQuote?.calendar.find((d) => d.slots.some((s) => s.available));
  const selectedSlot =
    selectedDay?.slots.find((s) => s.slot === draft.selectedSlot) ??
    selectedDay?.slots.find((s) => s.available);

  const quoteExpired = activeQuote ? expiredQuoteIds.has(activeQuote.publicId) || new Date(activeQuote.expiresAt) <= new Date() : false;
  const crew1Min = crew1Quote?.cheapest?.pricePence ?? null;
  const crew2Min = crew2Quote?.cheapest?.pricePence ?? null;

  return (
    <div className="booking-step">
      <section className="booking-panel">
        <h1>Prices</h1>

        {/* Crew size tabs */}
        <div aria-label="Crew size" className="crew-tabs" role="group">
          {([1, 2] as const).map((moverCount) => {
            const isActive = activeCrewNum === moverCount;
            const minPrice = moverCount === 1 ? crew1Min : crew2Min;
            const tabLoading = moverCount === 1 ? crew1Loading : crew2Loading;
            const Icon = moverCount === 1 ? User : Users;
            return (
              <button
                aria-pressed={isActive}
                className={classNames('crew-tab', isActive && 'crew-tab-active')}
                key={moverCount}
                onClick={() => { handleCrewSwitch(moverCount); }}
                type="button"
              >
                <Icon aria-hidden="true" size={22} />
                <span className="crew-tab-name">{moverCount === 1 ? '1 mover' : '2 movers'}</span>
                {tabLoading ? (
                  <span className="crew-price-loading"><Loader2 aria-hidden="true" className="spin" size={14} /></span>
                ) : minPrice !== null ? (
                  <span className="crew-price">From {formatGBP(minPrice)}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Loading / empty state */}
        {!activeQuote && (
          <div aria-live="polite" className="reveal-card price-loading-card" role={error ? undefined : 'status'}>
            <p>Planning your route</p>
            <p>Checking our vans for the next 4 weeks</p>
            <p>Working out fixed prices</p>
            {isActiveLoading ? (
              <div className="price-loading-indicator">
                <Loader2 aria-hidden="true" className="spin" size={18} />
                <span>Checking prices…</span>
              </div>
            ) : error ? (
              <button className="button button-primary" onClick={() => {
                const publicId = crewQuoteIdsRef.current[activeCrewNum];
                if (publicId) void restoreCrewQuote(activeCrewNum, publicId);
                else void fetchCrewQuote(activeCrewNum, true).then((quote) => { if (quote) applyQuoteForCrew(quote, activeCrewNum); });
              }} type="button">
                <CalendarDays aria-hidden="true" size={18} />
                Try again
              </button>
            ) : null}
          </div>
        )}

        {/* Expired-quote notice */}
        {quoteExpired && (
          <InlineAlert tone="warning">
            Prices have expired.{' '}
            <button
              className="link-button"
              onClick={() => {
                setCrew1Quote(null);
                setCrew2Quote(null);
                crew1KeyRef.current = null;
                crew2KeyRef.current = null;
                crewQuoteIdsRef.current = {};
                setDraft({ quote: null, selectedDate: null, selectedSlot: null });
                void fetchCrewQuote(activeCrewNum, true).then((q) => {
                  if (!q) return;
                  const best = q.cheapest;
                  setDraft({ quote: q, quotePublicId: q.publicId, selectedDate: best?.date ?? null, selectedSlot: best?.slot ?? null });
                });
                void fetchCrewQuote(activeCrewNum === 1 ? 2 : 1, true);
              }}
              type="button"
            >
              Refresh prices
            </button>
          </InlineAlert>
        )}

        {/* Date-based pricing list */}
        {activeQuote && !quoteExpired && (
          <>
            <div aria-label="Available move dates" className="price-date-list" role="list">
              {shownDays.map((day) => {
                const available = day.slots.filter((s) => s.available);
                const lowest = [...available].sort((a, b) => a.pricePence - b.pricePence)[0];
                const availCount = available.length;
                const isUnavailable = availCount === 0;
                const isBest = day.date === bestDate;
                const isSelected = draft.selectedDate === day.date;

                const dateObj = new Date(`${day.date}T12:00:00Z`);
                const wday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(dateObj);
                const dnum = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' }).format(dateObj);
                const mon = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(dateObj);
                const priceStr = lowest ? formatGBP(lowest.pricePence) : undefined;

                return (
                  <button
                    aria-label={`${wday} ${dnum} ${mon}${priceStr ? `, from ${priceStr}` : ', unavailable'}`}
                    aria-pressed={isSelected}
                    className={classNames(
                      'price-date-row',
                      isBest && 'price-date-row-best',
                      isSelected && 'price-date-row-selected',
                    )}
                    disabled={isUnavailable}
                    key={day.date}
                    onClick={() => {
                      if (!lowest) return;
                      const sameSlot = day.slots.find((s) => s.slot === draft.selectedSlot && s.available);
                      const chosen = sameSlot ?? lowest;
                      setDraft({ selectedDate: day.date, selectedSlot: chosen.slot });
                      trackBookingEvent('slot_selected', {
                        day_offset: Math.max(0, Math.round((new Date(`${day.date}T12:00:00Z`).getTime() - Date.now()) / 86_400_000)),
                        slot: chosen.slot,
                        value: chosen.pricePence / 100,
                      });
                    }}
                    role="listitem"
                    type="button"
                  >
                    <span className="price-date-left">
                      <span className="price-date-weekday">{wday},</span>
                      <span className="price-date-month">{mon}</span>
                      <span className="price-date-day">{dnum}</span>
                    </span>
                    <span className="price-date-right">
                      {isBest && (
                        <span aria-hidden="true" className="price-avail-badge price-badge-best">Best Price</span>
                      )}
                      {priceStr ? (
                        <strong className="price-date-price">{priceStr}</strong>
                      ) : (
                        <span className="price-date-unavail">Full</span>
                      )}
                      {!isUnavailable && <ChevronRight aria-hidden="true" className="price-date-chevron" size={16} />}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Show more / fewer dates */}
            <div className="show-more-row">
              {hasMore && (
                <button className="show-more-btn" onClick={() => { setVisibleCount((c) => c + 7); }} type="button">
                  Show more dates
                  <ChevronDown aria-hidden="true" size={16} />
                </button>
              )}
              {canCollapse && !hasMore && (
                <button
                  className="show-more-btn"
                  onClick={() => {
                    const selIdx = shownDays.findIndex((d) => d.date === draft.selectedDate);
                    setVisibleCount(selIdx >= 7 ? selIdx + 1 : 7);
                  }}
                  type="button"
                >
                  Show fewer dates
                  <ChevronDown aria-hidden="true" className="show-fewer-chevron" size={16} />
                </button>
              )}
            </div>
          </>
        )}

        {/* Time-window picker for selected date */}
        {selectedDay && activeQuote && !quoteExpired && (
          <div aria-label="Available time windows" className="slot-list">
            {selectedDay.slots.map((slot) => (
              <button
                aria-pressed={draft.selectedSlot === slot.slot}
                className={classNames('slot-card', draft.selectedSlot === slot.slot && 'selected', !slot.available && 'disabled')}
                disabled={!slot.available}
                key={slot.slot}
                onClick={() => {
                  setDraft({ selectedSlot: slot.slot });
                  trackBookingEvent('slot_selected', {
                    day_offset: Math.max(0, Math.round((new Date(`${selectedDay.date}T12:00:00Z`).getTime() - Date.now()) / 86_400_000)),
                    slot: slot.slot,
                    value: slot.pricePence / 100,
                  });
                }}
                type="button"
              >
                <span>{slot.windowLabel}</span>
                <strong>{formatGBP(slot.pricePence)}</strong>
                {!slot.available ? <em>{slot.reason?.replaceAll('_', ' ').toLowerCase()}</em> : null}
              </button>
            ))}
          </div>
        )}

        {/* Price breakdown */}
        {activeQuote && (
          <details className="booking-breakdown">
            <summary>How this price is worked out</summary>
            {activeQuote.breakdownLines.map((line) => (
              <div key={line.key}>
                <span>{line.label}</span>
                <strong>{formatGBP(line.pence)}</strong>
              </div>
            ))}
          </details>
        )}

        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </section>

      <button
        className="button button-primary booking-next"
        disabled={!selectedSlot?.available || isActiveLoading || quoteExpired || Boolean(error)}
        onClick={goNext}
        type="button"
      >
        Continue
      </button>
    </div>
  );
}

function ManualQuotePanel({ reasons }: { reasons: string[] }): ReactNode {
  const draft = useBookingDraft();
  const form = useForm<ManualQuoteInput>({ resolver: zodResolver(ManualQuoteRequestSchema) });
  const [sent, setSent] = useState<string | null>(null);
  async function submit(input: ManualQuoteInput): Promise<void> {
    if (!draft.quotePublicId) return;
    const result = await requestManualQuote(draft.quotePublicId, input);
    setSent(result.reference);
  }
  if (sent) return <InlineAlert tone="success">Request sent. Reference {sent}. We'll email your fixed price.</InlineAlert>;
  return (
    <form className="booking-panel" onSubmit={(event) => {
      void form.handleSubmit((input) => {
        void submit(input);
      })(event);
    }}>
      <h1>We will price this move individually</h1>
      <p>{reasons.includes('FERRY_ROUTE') ? 'Your route includes a ferry crossing.' : 'This move needs a quick check before we price it.'}</p>
      <input className="text-input" placeholder="Full name" {...form.register('contact.name')} />
      <input className="text-input" placeholder="Email" type="email" {...form.register('contact.email')} />
      <input className="text-input" placeholder="Mobile" {...form.register('contact.phone')} />
      <textarea className="text-input" placeholder="Anything else we should know?" rows={4} {...form.register('details')} />
      <button className="button button-primary" type="submit">Request manual quote</button>
    </form>
  );
}

function PayStep(): ReactNode {
  const draft = useBookingDraft();
  const selected = draft.quote?.calendar.find((day) => day.date === draft.selectedDate)?.slots.find((slot) => slot.slot === draft.selectedSlot);
  const total = selected?.pricePence ?? 0;
  useEffect(() => {
    trackBookingEvent('begin_checkout', { currency: 'GBP', value: total / 100 });
  }, [total]);
  return (
    <div className="booking-step">
      <section className="booking-panel">
        <h1>Details and pay</h1>
        <PaymentModeNotice />
        <Summary quote={draft.quote} total={total} />
        {stripePromise ? (
          <Elements options={{ amount: total, currency: 'gbp', mode: 'payment' }} stripe={stripePromise}>
            <StripePayForm total={total} />
          </Elements>
        ) : (
          <MockPayForm total={total} />
        )}
      </section>
    </div>
  );
}

function Summary({ quote, total }: { quote: QuoteDto | null; total: number }): ReactNode {
  const draft = useBookingDraft();
  return (
    <div className="checkout-summary">
      <div><span>Service</span><strong>{serviceByKey(draft.service)?.label ?? 'Move'}</strong></div>
      <div><span>Date</span><strong>{draft.selectedDate ?? 'Choose a date'} {draft.selectedSlot ? slotWindow(draft.selectedSlot) : ''}</strong></div>
      <div><span>Route</span><strong>{quote ? `${quote.pickup.town} to ${quote.dropoff?.town ?? quote.pickup.town}` : 'Route'}</strong></div>
      <div><span>Items</span><strong>{itemCount(draft.items)} items</strong></div>
      <div><span>Total</span><strong>{formatGBP(total)}</strong></div>
    </div>
  );
}

function usePaymentSubmit(total: number) {
  const router = useRouter();
  const draft = useBookingDraft();
  return async (contact: ContactInput, options: { navigate?: boolean } = {}): Promise<Awaited<ReturnType<typeof createBooking>>> => {
    if (!draft.quotePublicId || !draft.selectedDate || !draft.selectedSlot) throw new Error('Choose a slot first.');
    const parsed = BookingCreateSchema.parse({
      contact,
      customerNotes: draft.customerNotes || undefined,
      date: draft.selectedDate,
      expectedTotalPence: total,
      idempotencyKey: draft.ensureCheckoutKey(),
      marketingOptIn: draft.marketingOptIn,
      quotePublicId: draft.quotePublicId,
      slot: draft.selectedSlot,
      startWithinCancellationPeriodAck: draft.shortNoticeAck,
      termsAccepted: draft.termsAccepted,
    });
    const booking = await createBooking(parsed);
    draft.setDraft({ paymentIntentId: booking.clientSecret.split('_secret_')[0] ?? null, statusToken: booking.statusToken });
    if (options.navigate !== false) {
      router.push(`/book/confirmation?t=${encodeURIComponent(booking.statusToken)}`);
    }
    return booking;
  };
}

async function waitForConfirmedStatus(token: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const status = await getBookingStatus(token);
    if (status.status === 'CONFIRMED') return;
    await new Promise((resolve) => { window.setTimeout(resolve, 300); });
  }
}

function DetailsFields({ form }: { form: ReturnType<typeof useForm<ContactInput>> }): ReactNode {
  const draft = useBookingDraft();
  return (
    <div className="details-grid">
      <input className="text-input" placeholder="Full name" {...form.register('name')} />
      <input className="text-input" placeholder="Email" type="email" {...form.register('email')} />
      <input className="text-input" placeholder="Mobile" {...form.register('phone')} />
      <textarea className="text-input" onChange={(event) => { draft.setDraft({ customerNotes: event.target.value }); }} placeholder="Notes for the driver" rows={4} value={draft.customerNotes} />
      <label className="toggle-row">
        <span>I agree to the terms and cancellation policy</span>
        <input checked={draft.termsAccepted} onChange={(event) => { draft.setDraft({ termsAccepted: event.target.checked }); }} type="checkbox" />
      </label>
      <label className="toggle-row">
        <span>I ask Speedy Van to start services within the 14-day cancellation period if needed</span>
        <input checked={draft.shortNoticeAck} onChange={(event) => { draft.setDraft({ shortNoticeAck: event.target.checked }); }} type="checkbox" />
      </label>
      <label className="toggle-row">
        <span>Email me occasional offers</span>
        <input checked={draft.marketingOptIn} onChange={(event) => { draft.setDraft({ marketingOptIn: event.target.checked }); }} type="checkbox" />
      </label>
    </div>
  );
}

function MockPayForm({ total }: { total: number }): ReactNode {
  const form = useForm<ContactInput>({ defaultValues: useBookingDraft.getState().contact, resolver: zodResolver(ContactSchema) });
  const draft = useBookingDraft();
  const router = useRouter();
  const submitPayment = usePaymentSubmit(total);
  const [error, setError] = useState<string | null>(null);
  return (
    <form onSubmit={(event) => {
      void form.handleSubmit(async (contact) => {
        setError(null);
        trackBookingEvent('add_payment_info', { value: total / 100 });
        draft.setDraft({ contact });
        try {
          const booking = await submitPayment(contact, { navigate: false });
          await confirmTestPayment(booking.statusToken);
          await waitForConfirmedStatus(booking.statusToken);
          router.push(`/book/confirmation?t=${encodeURIComponent(booking.statusToken)}`);
        } catch (cause) {
          trackBookingEvent('payment_failed', { code: 'mock_payment' });
          setError(cause instanceof Error ? cause.message : 'Payment failed.');
        }
      })(event);
    }}>
      <DetailsFields form={form} />
      <div className="mock-payment">
        <CreditCard aria-hidden="true" size={20} />
        <span>Test payment mode. Use this locally when Stripe keys are not loaded.</span>
      </div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {error && draft.statusToken ? <a className="text-link" href={`/book/confirmation?t=${encodeURIComponent(draft.statusToken)}`}>{bookingConfirmationCopy.checkAgain}</a> : null}
      <button className="button button-primary booking-next" disabled={!draft.termsAccepted || !draft.shortNoticeAck || form.formState.isSubmitting} type="submit">
        {form.formState.isSubmitting ? 'Processing payment…' : `Pay ${formatGBP(total)}`}
      </button>
    </form>
  );
}

function StripePayForm({ total }: { total: number }): ReactNode {
  const form = useForm<ContactInput>({ defaultValues: useBookingDraft.getState().contact, resolver: zodResolver(ContactSchema) });
  const draft = useBookingDraft();
  const elements = useElements();
  const stripe = useStripe();
  const router = useRouter();
  const submitPayment = usePaymentSubmit(total);
  const [error, setError] = useState<string | null>(null);
  return (
    <form onSubmit={(event) => {
      void form.handleSubmit(async (contact) => {
        setError(null);
        trackBookingEvent('add_payment_info', { value: total / 100 });
        if (!stripe || !elements) return;
        const submitResult = await elements.submit();
        if (submitResult.error) {
          setError(submitResult.error.message ?? 'Check your payment details.');
          return;
        }
        try {
          draft.setDraft({ contact });
          const booking = await submitPayment(contact, { navigate: false });
          const confirm = await stripe.confirmPayment({
            clientSecret: booking.clientSecret,
            confirmParams: {
              payment_method_data: { billing_details: contact },
              return_url: `${window.location.origin}/book/confirmation?t=${encodeURIComponent(booking.statusToken)}`,
            },
            elements,
            redirect: 'if_required',
          });
          if (confirm.error) {
            trackBookingEvent('payment_failed', { code: confirm.error.code ?? 'stripe_confirm' });
            setError(confirm.error.message ?? 'Payment failed.');
          } else if (confirm.paymentIntent.status === 'succeeded' || confirm.paymentIntent.status === 'processing') {
            router.push(`/book/confirmation?t=${encodeURIComponent(booking.statusToken)}`);
          } else {
            setError(bookingConfirmationCopy.incompletePayment);
          }
        } catch (cause) {
          trackBookingEvent('payment_failed', { code: 'booking_submit' });
          setError(cause instanceof Error ? cause.message : 'Payment failed.');
        }
      })(event);
    }}>
      <DetailsFields form={form} />
      <PaymentElement options={{ layout: 'accordion' }} />
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {error && draft.statusToken ? <a className="text-link" href={`/book/confirmation?t=${encodeURIComponent(draft.statusToken)}`}>{bookingConfirmationCopy.checkAgain}</a> : null}
      <button className="button button-primary booking-next" disabled={!draft.termsAccepted || !draft.shortNoticeAck || !stripe || form.formState.isSubmitting} type="submit">
        {form.formState.isSubmitting ? 'Processing payment…' : `Pay ${formatGBP(total)}`}
      </button>
    </form>
  );
}

function BookingFrame({ children, step, setStep }: { children: ReactNode; setStep: (step: BookingStep) => void; step: BookingStep }): ReactNode {
  const draft = useBookingDraft();
  return (
    <div className="booking-page">
      <header className="booking-wizard-header">
        <button className="button button-ghost icon-button booking-back" disabled={step === 'move'} onClick={() => { setStep(previousStep(step)); }} type="button" aria-label={bookingNavigationCopy.back}>
          <ChevronLeft aria-hidden="true" size={22} />
        </button>
        <div className="booking-route-context">
          <span className="booking-step-count">{bookingNavigationCopy.stepCount(stepIndex(step) + 1, steps.length)}</span>
          <div className="route-chip">
            <Truck aria-hidden="true" size={18} />
            <span>{draft.pickup ? `${draft.pickup.town}${draft.dropoff ? ` to ${draft.dropoff.town}` : ''}` : bookingNavigationCopy.route}</span>
          </div>
        </div>
        <ProgressSteps current={step} setStep={setStep} />
      </header>
      <div className="booking-layout">
        <main>{children}</main>
        <aside className="booking-aside">
          <ShieldCheck aria-hidden="true" size={24} />
          <h2>Fixed price before you pay</h2>
          <p>No call needed for mainland Scotland. Ferry routes and large survey jobs go to a manual quote.</p>
          <Summary quote={draft.quote} total={draft.quote?.calendar.find((day) => day.date === draft.selectedDate)?.slots.find((slot) => slot.slot === draft.selectedSlot)?.pricePence ?? 0} />
        </aside>
      </div>
    </div>
  );
}

export function BookingFlow(): ReactNode {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div className="booking-page"><div className="skeleton skeleton-card" /></div>}>
        <BookingFlowInner />
      </Suspense>
    </QueryClientProvider>
  );
}

function BookingFlowInner(): ReactNode {
  const params = useSearchParams();
  const draft = useBookingDraft();
  const [step, setStep] = useBookingStep();
  const setNext = () => { setStep(nextStep(step)); };
  useEffect(() => {
    const publicId = params.get('quote');
    if (!publicId || draft.quotePublicId === publicId) return;
    let cancelled = false;
    void getQuoteByPublicId(publicId)
      .then(({ quote }) => {
        if (cancelled) return;
        const first = quote.cheapest;
        draft.setDraft({
          quote,
          quotePublicId: quote.publicId,
          selectedDate: first?.date ?? null,
          selectedSlot: first?.slot ?? null,
          service: quote.service,
          variant: quote.variant,
        });
      })
      .catch(() => {
        if (!cancelled) draft.setDraft({ quote: null, quotePublicId: null });
      });
    return () => {
      cancelled = true;
    };
  }, [draft, params]);
  return (
    <BookingFrame setStep={setStep} step={step}>
      {step === 'move' ? <MoveStep goNext={setNext} /> : null}
      {step === 'access' ? <AccessStep goNext={setNext} /> : null}
      {step === 'items' ? <ItemsStep goNext={setNext} /> : null}
      {step === 'prices' ? <PricesStep goNext={setNext} /> : null}
      {step === 'pay' ? <PayStep /> : null}
    </BookingFrame>
  );
}
