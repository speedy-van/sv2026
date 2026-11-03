'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  AddressSchema,
  BookingCreateSchema,
  type CatalogueResponseSchema,
  ContactSchema,
  CouponCodeSchema,
  ManualQuoteRequestSchema,
  QuoteRequestSchema,
  formatGBP,
  parseFlatNotation,
  routeTouchesScotland,
  type AddressSuggestionSchema,
} from '@sv/contracts';
import {
  AlertTriangle,
  ArrowDownToLine,
  Bath,
  BedDouble,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CookingPot,
  CreditCard,
  Flower2,
  Home,
  Loader2,
  Lock,
  MapPin,
  Minus,
  Package,
  PackagePlus,
  Plus,
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
import { Suspense, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { bookingNavigationCopy, bookingSteps as steps } from '../../content/booking-navigation';
import { bookingConfirmationCopy } from '@/content/booking-confirmation';
import { bookingItemsCopy, crewPriceOnTap, slotPartOfDay } from '@/content/booking-items';
import { AddressSuggestionList, suggestionOptionId, useListboxKeyboard } from '../booking/address-suggestions';
import { couponCopy } from '@/content/payments';
import { PaymentModeNotice } from '../customer/payment-mode-notice';
import { distanceBand, trackBookingEvent, trackBookingStart } from './analytics';
import {
  checkCoupon,
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
} from './booking-store';
import { serviceByKey, serviceOptions } from './content';

const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const stripePromise = stripeKey ? loadStripe(stripeKey) : null;

type Suggestion = z.infer<typeof AddressSuggestionSchema>;
type ContactInput = z.infer<typeof ContactSchema>;
type ManualQuoteInput = z.infer<typeof ManualQuoteRequestSchema>;
type CataloguePreset = z.infer<typeof CatalogueResponseSchema>['presets'][number];
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

function itemCount(items: DraftItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

function pluralItems(count: number): string {
  return `${String(count)} ${count === 1 ? 'item' : 'items'}`;
}

/** Civil dates are formatted in UTC so the day never shifts with the browser's zone. */
function formatMoveDate(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', weekday: 'short' }): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
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

// The persist API only exists in the browser, so it is read lazily rather than during server render.
function subscribeDraftHydration(onChange: () => void): () => void {
  return useBookingDraft.persist.onFinishHydration(onChange);
}

function draftHasHydrated(): boolean {
  return useBookingDraft.persist.hasHydrated();
}

function useBookingStep(): [BookingStep, (step: BookingStep) => void] {
  const params = useSearchParams();
  const draft = useBookingDraft();
  // Server render and first hydration see `false`; client navigations (e.g. from a landing quote card) read the store directly, so the requested step paints without a flash of step one.
  const hydrated = useSyncExternalStore(subscribeDraftHydration, draftHasHydrated, () => false);
  const guard = firstIncompleteStep(draft);
  const step = selectedStep(params);
  const allowQuoteRestore = params.has('quote');
  useEffect(() => {
    if (hydrated && !allowQuoteRestore && stepIndex(step) > stepIndex(guard)) {
      window.history.replaceState(null, '', `/book?step=${guard}`);
    }
  }, [allowQuoteRestore, guard, hydrated, step]);
  return [
    !hydrated ? 'move' : !allowQuoteRestore && stepIndex(step) > stepIndex(guard) ? guard : step,
    (next) => {
      // Steps are client state; native history keeps useSearchParams in sync without a server round trip or loading screen.
      window.history.pushState(null, '', `/book?step=${next}`);
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
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [line1, setLine1] = useState('');
  const [flat, setFlat] = useState('');
  const [town, setTown] = useState('');
  const [postcode, setPostcode] = useState('');
  const liveRef = useRef<HTMLDivElement>(null);
  const searchVersion = useRef(0);
  const selectionPending = useRef(false);
  const mounted = useRef(false);
  const fieldId = `${label.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}-address`;
  const listId = `${fieldId}-suggestions`;
  const keyboard = useListboxKeyboard({
    items: suggestions,
    onClose: () => { setOpen(false); },
    onOpen: () => { setOpen(true); },
    onPick: (suggestion) => void selectSuggestion(suggestion),
    open,
  });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const version = ++searchVersion.current;
    if (query.trim().length < 2 || manual || value) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      suggestAddresses(query, sessionToken)
        .then((result) => {
          if (cancelled || version !== searchVersion.current) return;
          setSuggestions(result);
          if (liveRef.current) liveRef.current.textContent = result.length === 0 ? 'No addresses found' : `${String(result.length)} addresses found`;
        })
        .catch(() => {
          if (cancelled || version !== searchVersion.current) return;
          setError("Address search isn't responding. Try again or enter the address manually.");
        })
        .finally(() => { if (!cancelled && version === searchVersion.current) setLoading(false); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [attempt, manual, query, sessionToken, value]);

  async function selectSuggestion(suggestion: Suggestion): Promise<void> {
    if (selectionPending.current) return;
    selectionPending.current = true;
    searchVersion.current += 1;
    setLoading(false);
    setRetrieving(true);
    setOpen(false);
    setSuggestions([]);
    setError(null);
    try {
      const result = await retrieveAddress(suggestion.id, sessionToken);
      if (!mounted.current) return;
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
      if (!mounted.current) return;
      setError("Address search isn't responding. Try again or enter the address manually.");
    } finally {
      selectionPending.current = false;
      if (mounted.current) setRetrieving(false);
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
      <div className="address-field">
        <span className="address-field-label">{label}</span>
        <div className="address-selected">
          <MapPin aria-hidden="true" size={18} />
          <span title={value.label}>{value.label}</span>
          <button aria-label={`Change ${label.toLowerCase()} address`} className="button button-ghost" onClick={() => { onChange(null); }} type="button">
            Change
          </button>
        </div>
      </div>
    );
  }

  const listOpen = open && suggestions.length > 0;
  const noResults = open && !loading && !error && suggestions.length === 0 && query.trim().length >= 2;

  return (
    <div className="address-field">
      <label htmlFor={fieldId}>{label}</label>
      {!manual ? (
        <>
          <div className="address-input-wrap">
            <Search aria-hidden="true" size={18} />
            <input
              aria-activedescendant={listOpen && keyboard.activeIndex >= 0 ? suggestionOptionId(listId, keyboard.activeIndex) : undefined}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded={listOpen}
              autoComplete="off"
              className="text-input"
              disabled={retrieving}
              id={fieldId}
              onBlur={() => { setOpen(false); }}
              onChange={(event) => { searchVersion.current += 1; setSuggestions([]); setError(null); setQuery(event.target.value); setOpen(true); }}
              onFocus={() => { setOpen(true); }}
              onKeyDown={keyboard.onKeyDown}
              placeholder="Street or postcode"
              role="combobox"
              type="text"
              value={query}
            />
            {loading || retrieving ? <Loader2 aria-hidden="true" className="address-input-spinner spin" size={18} /> : null}
          </div>
          <div aria-live="polite" className="sr-only" ref={liveRef} />
          <AddressSuggestionList activeIndex={keyboard.activeIndex} id={listId} onHover={keyboard.setActiveIndex} onPick={(suggestion) => void selectSuggestion(suggestion)} open={listOpen} suggestions={suggestions} />
          {noResults ? <p className="field-help">No matches yet. Try the postcode, or enter the address manually.</p> : null}
          <button className="link-button" disabled={retrieving} onClick={() => { searchVersion.current += 1; setError(null); setManual(true); }} type="button">
            Enter address manually
          </button>
        </>
      ) : (
        <div className="manual-address">
          <label className="field">
            Street address
            <input autoComplete="address-line1" className="text-input" onChange={(event) => { setLine1(event.target.value); }} placeholder="Street address" type="text" value={line1} />
          </label>
          <label className="field">
            <span>Flat or floor <span className="field-optional">(optional)</span></span>
            <input autoComplete="address-line2" className="text-input" onChange={(event) => { setFlat(event.target.value); }} placeholder="Flat or floor (optional)" type="text" value={flat} />
          </label>
          <div className="manual-address-row">
            <label className="field">
              Town
              <input autoComplete="address-level2" className="text-input" onChange={(event) => { setTown(event.target.value); }} placeholder="Town" type="text" value={town} />
            </label>
            <label className="field">
              Postcode
              <input autoCapitalize="characters" autoComplete="postal-code" className="text-input" onChange={(event) => { setPostcode(event.target.value); }} placeholder="Postcode" type="text" value={postcode} />
            </label>
          </div>
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
      {error ? (
        <InlineAlert tone="danger">
          {error}{' '}
          {!manual ? <button className="link-button" onClick={() => { setOpen(true); setAttempt((current) => current + 1); }} type="button">Try again</button> : null}
        </InlineAlert>
      ) : null}
    </div>
  );
}

const floorChoices = [
  { hint: 'Street level', icon: Home, key: 'GROUND', label: 'Ground' },
  { hint: 'Stairs or lift', icon: Building2, key: 'FLOOR', label: 'Upstairs' },
  { hint: 'Below street', icon: ArrowDownToLine, key: 'BASEMENT', label: 'Basement' },
] as const satisfies ReadonlyArray<{ hint: string; icon: LucideIcon; key: AccessDetail['floorChoice']; label: string }>;

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
  // Reopen with the extras showing when the customer already set one.
  const [notesOpen, setNotesOpen] = useState(() => value.narrowAccess || value.permitZone || value.carryMetres > 10);
  const notesId = useId();
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
      <div aria-label={`${label}: which floor?`} className="choice-grid compact floor-choices" role="group">
        {floorChoices.map((choice) => {
          const Icon = choice.icon;
          return (
            <button aria-pressed={value.floorChoice === choice.key} className={classNames('choice-card', value.floorChoice === choice.key && 'selected')} key={choice.key} onClick={() => { patch({ floorChoice: choice.key, floorNumber: choice.key === 'FLOOR' ? value.floorNumber ?? 1 : undefined }); }} type="button">
              <Icon aria-hidden="true" size={20} />
              <strong>{choice.label}</strong>
              <span>{choice.hint}</span>
              {value.floorChoice === choice.key ? <Check aria-hidden="true" className="choice-check" size={16} strokeWidth={3} /> : null}
            </button>
          );
        })}
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
      <div className="tricky-toggle-row">
        <button aria-controls={notesId} aria-describedby={`${notesId}-hint`} aria-expanded={notesOpen} className="link-button tricky-toggle" onClick={() => { setNotesOpen((current) => !current); }} type="button">
          Anything tricky?
          <ChevronDown aria-hidden="true" size={18} />
        </button>
        <span className="tricky-toggle-hint" id={`${notesId}-hint`}>Long carry, narrow stairs, parking</span>
      </div>
      {notesOpen ? (
        <div className="tricky-grid" id={notesId}>
          <label className="field">
            Carry distance
            <input className="range-input" min={10} max={100} step={5} onChange={(event) => { patch({ carryMetres: Number(event.target.value) }); }} type="range" value={value.carryMetres} />
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
  const [editingAddresses, setEditingAddresses] = useState(false);
  const selectedService = serviceByKey(draft.service);
  const canContinue = Boolean(draft.service && draft.pickup && (selectedService?.requiresDropoff === false || draft.dropoff) && draft.variant);
  const touchesScotland = draft.pickup && (draft.dropoff || selectedService?.requiresDropoff === false)
    ? routeTouchesScotland({ pickup: draft.pickup.postcode, dropoff: draft.dropoff?.postcode ?? null })
    : true;
  const addressesComplete = Boolean(draft.pickup && (selectedService?.requiresDropoff === false || draft.dropoff));
  const showAddresses = editingAddresses || !addressesComplete || !touchesScotland;

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
        <StepHeading lead="Tell us what you are moving and where it is going." title="Your move" />
        <fieldset className="field service-fieldset">
          <legend>What are you moving?</legend>
          <div aria-label="Move type" className="service-grid" role="radiogroup">
            {serviceOptions.map((service) => {
              const Icon = service.icon;
              const checked = draft.service === service.key;
              return (
                <button
                  aria-checked={checked}
                  className={classNames('service-card', checked && 'selected')}
                  data-value={service.key}
                  key={service.key}
                  onClick={() => { if (!checked) chooseService(service.key); }}
                  role="radio"
                  type="button"
                >
                  <Icon aria-hidden="true" size={22} />
                  <span>{service.label}</span>
                </button>
              );
            })}
          </div>
          {selectedService ? <span className="field-help">{selectedService.description}</span> : null}
        </fieldset>
        {addressesComplete && touchesScotland ? (
          <div className="button-row">
            <button
              aria-controls="booking-addresses"
              aria-expanded={showAddresses}
              className="button button-ghost"
              onClick={() => { setEditingAddresses(!showAddresses); }}
              type="button"
            >
              <MapPin aria-hidden="true" size={18} />
              {showAddresses ? bookingNavigationCopy.finishEditingAddresses : bookingNavigationCopy.editAddresses}
            </button>
          </div>
        ) : null}
        <div hidden={!showAddresses} id="booking-addresses">
          <div className="field-grid">
            <AddressField label={selectedService?.requiresDropoff === false ? 'Collection address' : 'From'} onChange={(pickup) => {
              setEditingAddresses(true);
              draft.setDraft({ pickup, quote: null, quotePublicId: null, selectedDate: null, selectedSlot: null });
            }} value={draft.pickup} />
            {selectedService?.requiresDropoff === false ? null : (
              <AddressField label="To" onChange={(dropoff) => {
                setEditingAddresses(true);
                draft.setDraft({ dropoff, quote: null, quotePublicId: null, selectedDate: null, selectedSlot: null });
              }} value={draft.dropoff} />
            )}
          </div>
        </div>
        {!touchesScotland ? <InlineAlert tone="danger">We move people to and from Scotland. One address needs to be in Scotland.</InlineAlert> : null}
        {selectedService && selectedService.variants.length > 1 ? (
          <fieldset className="field service-fieldset">
            <legend>{selectedService.key === 'house-removals' ? 'How big is the home?' : 'Size or type'}</legend>
            <div aria-label="Size or type" className="pill-row" role="radiogroup">
              {selectedService.variants.map((variant) => {
                const checked = (draft.variant ?? selectedService.variants[0]?.key) === variant.key;
                return (
                  <button
                    aria-checked={checked}
                    className={classNames('pill', checked && 'selected')}
                    data-value={variant.key}
                    key={variant.key}
                    onClick={() => { draft.setDraft({ quote: null, selectedDate: null, selectedSlot: null, variant: variant.key }); }}
                    role="radio"
                    type="button"
                  >
                    {variant.label}
                    {variant.manualQuote ? <small>individual price</small> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}
      </section>
      <StepNext disabled={!canContinue || !touchesScotland} hint={canContinue ? null : missingMoveHint(draft.service, draft.pickup, draft.dropoff, selectedService?.requiresDropoff !== false)} label="Continue to access" onClick={goNext} />
    </div>
  );
}

function missingMoveHint(service: ServiceKey | null, pickup: Address | null, dropoff: Address | null, needsDropoff: boolean): string {
  if (!service) return 'Choose what you are moving to continue.';
  if (!pickup) return 'Add the pickup address to continue.';
  if (needsDropoff && !dropoff) return 'Add the delivery address to continue.';
  return 'Complete the details above to continue.';
}

function StepHeading({ lead, title }: { lead?: string; title: string }): ReactNode {
  return (
    <>
      <h1 className="booking-step-title" tabIndex={-1}>{title}</h1>
      {lead ? <p className="lead">{lead}</p> : null}
    </>
  );
}

/** The primary step action. On phones it stays pinned to the bottom of the screen. */
function StepNext({ disabled = false, hint = null, label, onClick, price = null }: {
  disabled?: boolean;
  hint?: string | null;
  label: string;
  onClick: () => void;
  price?: ReactNode;
}): ReactNode {
  return (
    <div className="booking-next-bar">
      {price ? <div className="booking-next-price">{price}</div> : null}
      {disabled && hint ? <p className="booking-next-hint" role="status">{hint}</p> : null}
      <button className="button button-primary booking-next" disabled={disabled} onClick={onClick} type="button">
        {label}
        <ChevronRight aria-hidden="true" size={18} />
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
        <StepHeading lead="A quick check for stairs, lifts and parking so the price is accurate. Most homes take ten seconds." title="Access" />
      </section>
      {draft.pickup ? <AccessCard address={draft.pickup} kind="pickup" label="Pickup access" onChange={(pickupAccess) => { draft.setDraft({ pickupAccess, quote: null }); }} value={draft.pickupAccess} /> : null}
      {selectedService?.requiresDropoff !== false && draft.dropoff ? <AccessCard address={draft.dropoff} kind="dropoff" label="Dropoff access" onChange={(dropoffAccess) => { draft.setDraft({ dropoffAccess, quote: null }); }} value={draft.dropoffAccess ?? defaultAccess} /> : null}
      <StepNext disabled={!canContinue} label="Continue to items" onClick={goNext} />
    </div>
  );
}

/** 06-booking-flow §4.5: the size chosen in step 1 maps to the preset of the same slug. */
function presetSlugFor(service: ServiceKey | null, variant: string | null): string | null {
  if (service === 'house-removals') return variant;
  if (service === 'student') return 'student-room';
  if (service === 'office' && variant === 'small') return 'small-office';
  return null;
}

const shownInventorySlugs = new Set(inventoryCategories.flatMap((category) => category.items.map((item) => item.slug)));

/** Own items always stay; catalogue items are replaced by the preset or topped up with it. */
function itemsWithPreset(current: DraftItem[], preset: CataloguePreset, available: ReadonlySet<string>, mode: 'add' | 'replace'): DraftItem[] {
  const quantities = new Map<string, number>();
  if (mode === 'add') {
    for (const item of current) if (item.kind === 'catalogue' && item.itemSlug) quantities.set(item.itemSlug, item.quantity);
  }
  for (const item of preset.items) {
    if (!available.has(item.itemSlug)) continue;
    quantities.set(item.itemSlug, Math.min(99, (quantities.get(item.itemSlug) ?? 0) + item.quantity));
  }
  return [
    ...[...quantities].map(([itemSlug, quantity]) => ({ itemSlug, kind: 'catalogue' as const, quantity })),
    ...current.filter((item) => item.kind === 'custom'),
  ];
}

function ItemsStep({ goNext }: { goNext: () => void }): ReactNode {
  const draft = useBookingDraft();
  const setDraft = draft.setDraft;
  const catalogue = useQuery({ queryFn: getCatalogue, queryKey: ['catalogue'] });
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set(['bedrooms']));
  const [search, setSearch] = useState('');
  const [customName, setCustomName] = useState('');
  const [autoFilledLabel, setAutoFilledLabel] = useState<string | null>(null);
  const [pendingPreset, setPendingPreset] = useState<CataloguePreset | null>(null);
  const [appliedPresetSlug, setAppliedPresetSlug] = useState<string | null>(null);
  const selected = new Map(draft.items.filter((item) => item.kind === 'catalogue' && item.itemSlug).map((item) => [item.itemSlug as string, item.quantity]));
  const catalogueBySlug = new Map((catalogue.data?.items ?? []).map((item) => [item.slug, item]));
  const missingItems = catalogue.data
    ? inventoryCategories.flatMap((category) => category.items.filter((item) => !catalogueBySlug.has(item.slug)).map((item) => item.label))
    : [];
  const presets = catalogue.data?.presets ?? [];
  // Presets can hold items no room list shows; list them so they can still be changed.
  const extraSelected = [...selected.keys()].filter((slug) => !shownInventorySlugs.has(slug) && catalogueBySlug.has(slug));

  function applyPreset(preset: CataloguePreset, mode: 'add' | 'replace'): void {
    setDraft({
      items: itemsWithPreset(useBookingDraft.getState().items, preset, new Set(catalogueBySlug.keys()), mode),
      quote: null,
      quotePublicId: null,
      selectedDate: null,
      selectedSlot: null,
    });
    setPendingPreset(null);
    setAutoFilledLabel(preset.label);
    setAppliedPresetSlug(preset.slug);
    // A filled list reads best as a room-by-room overview; rooms open on demand.
    setOpenCategories(new Set());
  }

  function choosePreset(preset: CataloguePreset): void {
    if (useBookingDraft.getState().items.length === 0) applyPreset(preset, 'replace');
    else setPendingPreset(preset);
  }

  // Fill a typical list once for the size picked in step 1; an emptied list is never refilled.
  const catalogueData = catalogue.data;
  const service = draft.service;
  const variant = draft.variant;
  useEffect(() => {
    const preset = catalogueData?.presets.find((candidate) => candidate.slug === presetSlugFor(service, variant));
    if (!catalogueData || !preset) return;
    const offerKey = `${service ?? ''}:${preset.slug}`;
    const state = useBookingDraft.getState();
    if (state.presetOffered === offerKey) return;
    if (state.items.length > 0) {
      setDraft({ presetOffered: offerKey });
      return;
    }
    setDraft({
      items: itemsWithPreset([], preset, new Set(catalogueData.items.map((item) => item.slug)), 'replace'),
      presetOffered: offerKey,
      quote: null,
      quotePublicId: null,
      selectedDate: null,
      selectedSlot: null,
    });
    setAutoFilledLabel(preset.label);
    setAppliedPresetSlug(preset.slug);
    setOpenCategories(new Set());
  }, [catalogueData, service, setDraft, variant]);

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

  function categorySummary(category: InventoryCategoryConfig): string {
    return [...new Map(category.items.map((item) => [item.slug, item])).values()]
      .filter((item) => (selected.get(item.slug) ?? 0) > 0)
      .map((item) => {
        const quantity = selected.get(item.slug) ?? 0;
        return quantity > 1 ? `${item.label} ×${String(quantity)}` : item.label;
      })
      .join(', ');
  }

  function matchesSearch(item: InventoryItemConfig, query: string): boolean {
    const catalogueItem = catalogueBySlug.get(item.slug);
    return Boolean(
      item.label.toLowerCase().includes(query) ||
      item.detail?.toLowerCase().includes(query) ||
      catalogueItem?.name.toLowerCase().includes(query) ||
      catalogueItem?.aliases.some((alias) => alias.toLowerCase().includes(query)),
    );
  }

  // One search across every room; the same slug can sit in several rooms, so list it once.
  const searchQuery = search.trim().toLowerCase();
  const searchResults = searchQuery
    ? [...new Map(inventoryCategories.flatMap((category) => category.items.filter((item) => matchesSearch(item, searchQuery)).map((item) => [item.slug, { category: category.title, item }] as const))).values()]
    : [];

  function itemRow(item: InventoryItemConfig, key: string, room?: string): ReactNode {
    const catalogueItem = catalogueBySlug.get(item.slug);
    const quantity = selected.get(item.slug) ?? 0;
    return (
      <div className={classNames('inventory-item-row', quantity > 0 && 'selected', !catalogueItem && 'unavailable')} key={key}>
        <div className="inventory-item-copy">
          <span>{item.label}</span>
          {room ? <small>{room}</small> : null}
          {item.detail ? <small>{item.detail}</small> : null}
          {!catalogueItem ? <small>Pricing unavailable</small> : null}
        </div>
        {catalogueItem ? (
          <Quantity label={item.label} value={quantity} onChange={(next) => { setQuantity(item.slug, next); }} />
        ) : null}
      </div>
    );
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
    if (customName.trim().length < 2 || customName.trim().length > 60) return;
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

  function removeItemAt(index: number): void {
    const current = useBookingDraft.getState();
    draft.setDraft({
      items: current.items.filter((_, candidate) => candidate !== index),
      quote: null,
      quotePublicId: null,
      selectedDate: null,
      selectedSlot: null,
    });
  }

  return (
    <div className="booking-step">
      <section className="booking-panel">
        <StepHeading lead="Add the bigger things you are moving. A rough list is fine; it sets the van size and time." title="Items" />
        {catalogue.isLoading ? <div className="skeleton skeleton-card" /> : null}
        {catalogue.isError ? (
          <InlineAlert tone="danger">
            We could not load the item list.{' '}
            <button className="link-button" onClick={() => { void catalogue.refetch(); }} type="button">Try again</button>
          </InlineAlert>
        ) : null}
        {missingItems.length > 0 ? (
          <InlineAlert tone="warning">Pricing metadata is missing for {missingItems.slice(0, 4).join(', ')}{missingItems.length > 4 ? ` and ${String(missingItems.length - 4)} more` : ''}.</InlineAlert>
        ) : null}
        {presets.length > 0 ? (
          <div className="preset-start">
            <div className="preset-start-copy">
              <strong>{bookingItemsCopy.quickStart}</strong>
              <span>{bookingItemsCopy.quickStartHelp}</span>
            </div>
            <div aria-label={bookingItemsCopy.quickStart} className="preset-chips" role="group">
              {presets.map((preset) => (
                <button aria-pressed={(pendingPreset?.slug ?? appliedPresetSlug) === preset.slug} className={classNames('pill', (pendingPreset?.slug ?? appliedPresetSlug) === preset.slug && 'selected')} key={preset.slug} onClick={() => { choosePreset(preset); }} type="button">
                  {preset.label}
                </button>
              ))}
            </div>
            {pendingPreset ? (
              <div className="preset-confirm" role="status">
                <span>{bookingItemsCopy.replaceOrAdd(pendingPreset.label)}</span>
                <div className="preset-confirm-actions">
                  <button className="button button-primary" onClick={() => { applyPreset(pendingPreset, 'replace'); }} type="button">{bookingItemsCopy.replaceList}</button>
                  <button className="button button-secondary" onClick={() => { applyPreset(pendingPreset, 'add'); }} type="button">{bookingItemsCopy.addToList}</button>
                  <button className="link-button" onClick={() => { setPendingPreset(null); }} type="button">{bookingItemsCopy.cancel}</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {autoFilledLabel && !pendingPreset ? (
          <div className="preset-note" role="status">
            <Check aria-hidden="true" size={18} />
            <span>{bookingItemsCopy.autoFilled(autoFilledLabel)}</span>
            <button aria-label={bookingItemsCopy.dismiss} onClick={() => { setAutoFilledLabel(null); }} type="button">
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        ) : null}
        <label className="field inventory-search-field">
          <span className="sr-only">Search all items</span>
          <div className="inventory-search-wrap">
            <Search aria-hidden="true" size={18} />
            <input
              className="text-input"
              onChange={(event) => { setSearch(event.target.value); }}
              placeholder="Search all items, e.g. sofa, fridge, boxes"
              type="search"
              value={search}
            />
            {search ? (
              <button aria-label="Clear search" onClick={() => { setSearch(''); }} type="button">
                <X aria-hidden="true" size={16} />
              </button>
            ) : null}
          </div>
        </label>
        {searchQuery ? (
          <div aria-label="Search results" className="inventory-list" role="region">
            {searchResults.map(({ category, item }) => itemRow(item, `search-${item.slug}`, category))}
            {searchResults.length === 0 ? <p className="field-help">Nothing matches “{search.trim()}”. Add it below as your own item.</p> : null}
          </div>
        ) : null}
        <div className="inventory-accordion" hidden={Boolean(searchQuery)}>
          {extraSelected.length > 0 ? (
            <section className="inventory-category open">
              <div className="inventory-category-trigger inventory-category-static">
                <Package aria-hidden="true" size={22} />
                <h2>{bookingItemsCopy.moreInList}</h2>
              </div>
              <div aria-label={bookingItemsCopy.moreInList} className="inventory-category-panel" role="region">
                <div className="inventory-list">
                  {extraSelected.map((slug) => itemRow({ label: catalogueBySlug.get(slug)?.name ?? slug, slug }, `extra-${slug}`))}
                </div>
              </div>
            </section>
          ) : null}
          {inventoryCategories.map((category) => {
            const Icon = category.icon;
            const isOpen = openCategories.has(category.key);
            const panelId = `${category.key}-inventory-panel`;
            const selectedCount = categoryQuantity(category);
            return (
              <section className={classNames('inventory-category', isOpen && 'open')} key={category.key}>
                <button aria-controls={panelId} aria-expanded={isOpen} className="inventory-category-trigger" onClick={() => { toggleCategory(category.key); }} type="button">
                  <Icon aria-hidden="true" size={22} />
                  <span className="inventory-category-title">
                    {category.title}
                    {!isOpen && selectedCount > 0 ? <small className="inventory-category-summary">{categorySummary(category)}</small> : null}
                  </span>
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
                    <div className="inventory-list">
                      {category.items.map((item) => itemRow(item, `${category.key}-${item.slug}-${item.label}`))}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
        <form className="custom-item" onSubmit={(event) => { event.preventDefault(); addCustom(); }}>
          <label className="field-label" htmlFor="custom-item-name">Can't find something? Add it as your own item.</label>
          <div className="coupon-row">
            <input className="text-input" id="custom-item-name" maxLength={60} onChange={(event) => { setCustomName(event.target.value); }} placeholder="Item name" type="text" value={customName} />
            <button className="button button-secondary" disabled={customName.trim().length < 2} type="submit">
              <PackagePlus aria-hidden="true" size={18} />
              Add own item
            </button>
          </div>
          {draft.items.some((item) => item.kind === 'custom') ? (
            <ul aria-label="Your own items" className="custom-item-list">
              {draft.items.map((item, index) => item.kind === 'custom' ? (
                <li key={`${item.name ?? 'item'}-${String(index)}`}>
                  <span>{item.name}</span>
                  <button aria-label={`Remove ${item.name ?? 'item'}`} onClick={() => { removeItemAt(index); }} type="button">
                    <X aria-hidden="true" size={14} />
                  </button>
                </li>
              ) : null)}
            </ul>
          ) : null}
        </form>
      </section>
      <section className="booking-panel">
        <h2>Extras</h2>
        <div className="toggle-row">
          <span className="toggle-copy">
            <strong>Extra helpers</strong>
            <small>On top of your driver, for heavy or awkward items</small>
          </span>
          <Quantity max={3} label="extra helpers" value={draft.addons.helpers} onChange={(helpers) => { draft.setDraft({ addons: { ...draft.addons, helpers }, quote: null, quotePublicId: null, selectedDate: null, selectedSlot: null }); }} />
        </div>
        <label className="toggle-row">
          <span className="toggle-copy">
            <strong>Packing help</strong>
            <small>We pack boxes on the day</small>
          </span>
          <input checked={draft.addons.packing} onChange={(event) => { draft.setDraft({ addons: { ...draft.addons, packing: event.target.checked }, quote: null, quotePublicId: null, selectedDate: null, selectedSlot: null }); }} type="checkbox" />
        </label>
        <label className="toggle-row">
          <span className="toggle-copy">
            <strong>Furniture assembly</strong>
            <small>Beds, wardrobes and tables taken apart and rebuilt</small>
          </span>
          <input checked={draft.addons.assembly} onChange={(event) => { draft.setDraft({ addons: { ...draft.addons, assembly: event.target.checked }, quote: null, quotePublicId: null, selectedDate: null, selectedSlot: null }); }} type="checkbox" />
        </label>
      </section>
      <StepNext
        disabled={draft.items.length === 0 && draft.service !== 'piano'}
        hint="Add at least one item to see prices."
        label="See my prices"
        onClick={goNext}
        price={<span className="booking-summary-count">{pluralItems(itemCount(draft.items))} selected</span>}
      />
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
        <Minus aria-hidden="true" size={16} strokeWidth={2.75} />
      </button>
      <output aria-live="polite">{value}</output>
      <button aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => { commit(pendingValue.current + 1); }} type="button">
        <Plus aria-hidden="true" size={16} strokeWidth={2.75} />
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

type CrewSize = 1 | 2 | 3 | 4;

function crewSize(helpers: number): CrewSize {
  return helpers === 3 ? 4 : helpers === 2 ? 3 : helpers === 1 ? 2 : 1;
}

function buildCrewInput(helpers: number): z.infer<typeof QuoteRequestSchema> {
  const state = useBookingDraft.getState();
  return quoteInputFromDraft({ ...state, addons: { ...state.addons, helpers } });
}

function PricesStep({ goNext }: { goNext: () => void }): ReactNode {
  const draft = useBookingDraft();
  const setDraft = draft.setDraft;

  // Each quote must retain the helper count chosen in Items (driver + up to 3 helpers).
  const [crewQuotes, setCrewQuotes] = useState<Partial<Record<CrewSize, QuoteDto | null>>>({});
  const [crewLoading, setCrewLoading] = useState<Partial<Record<CrewSize, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [manualReasons, setManualReasons] = useState<string[] | null>(null);
  const [visibleCount, setVisibleCount] = useState(7);
  const [expiredQuoteIds, setExpiredQuoteIds] = useState<Set<string>>(() => new Set());

  const crewKeysRef = useRef<Partial<Record<CrewSize, string | null>>>({});
  const crewQuoteIdsRef = useRef<Partial<Record<CrewSize, string>>>({});
  const mountedRef = useRef(false);
  // Per-crew generation counters prevent stale async results from applying
  const loadGenRef = useRef<Record<CrewSize, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });

  const activeCrewNum = crewSize(draft.addons.helpers);
  const activeQuote = crewQuotes[activeCrewNum];
  const isActiveLoading = crewLoading[activeCrewNum] ?? false;

  const applyQuoteForCrew = useCallback((quote: QuoteDto, moverCount: CrewSize): void => {
    const state = useBookingDraft.getState();
    const nowActive = crewSize(state.addons.helpers);
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

  const restoreCrewQuote = useCallback(async (moverCount: CrewSize, publicId: string): Promise<QuoteDto | null> => {
    crewQuoteIdsRef.current[moverCount] = publicId;
    const gen = ++loadGenRef.current[moverCount];
    setCrewLoading((current) => ({ ...current, [moverCount]: true }));
    setCrewQuotes((current) => ({ ...current, [moverCount]: null }));
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
      setCrewQuotes((current) => ({ ...current, [moverCount]: result.quote }));
      applyQuoteForCrew(result.quote, moverCount);
      return result.quote;
    } catch (cause) {
      if (!mountedRef.current || gen !== loadGenRef.current[moverCount]) return null;
      const nowActive = crewSize(useBookingDraft.getState().addons.helpers);
      if (moverCount === nowActive) setError(cause instanceof Error ? cause.message : 'We could not check current availability. Try again.');
      return null;
    } finally {
      if (mountedRef.current && gen === loadGenRef.current[moverCount]) setCrewLoading((current) => ({ ...current, [moverCount]: false }));
    }
  }, [applyQuoteForCrew]);

  const fetchCrewQuote = useCallback(async (moverCount: CrewSize, force = false): Promise<QuoteDto | null> => {
    let input: z.infer<typeof QuoteRequestSchema>;
    try {
      input = buildCrewInput(moverCount - 1);
    } catch (cause) {
      const nowActive = crewSize(useBookingDraft.getState().addons.helpers);
      if (moverCount === nowActive) setError(cause instanceof Error ? cause.message : 'Complete your move details first.');
      return null;
    }

    const key = JSON.stringify(input);
    if (!force && crewKeysRef.current[moverCount] === key) return null;
    crewKeysRef.current[moverCount] = key;

    const gen = ++loadGenRef.current[moverCount];
    setCrewLoading((current) => ({ ...current, [moverCount]: true }));
    setError(null);

    try {
      const result = await createQuote(input);
      if (!mountedRef.current || gen !== loadGenRef.current[moverCount]) return null;

      if ('manualQuote' in result) {
        const nowActive = crewSize(useBookingDraft.getState().addons.helpers);
        if (moverCount === nowActive) {
          setDraft({ quotePublicId: result.manualQuote.quotePublicId });
          setManualReasons(result.manualQuote.reasons);
          trackBookingEvent('manual_quote_shown', { reason: result.manualQuote.reasons[0], service: input.service });
        }
        return null;
      }

      setCrewQuotes((current) => ({ ...current, [moverCount]: result.quote }));
      crewQuoteIdsRef.current[moverCount] = result.quote.publicId;
      applyQuoteForCrew(result.quote, moverCount);
      return result.quote;
    } catch (cause) {
      if (!mountedRef.current || gen !== loadGenRef.current[moverCount]) return null;
      crewKeysRef.current[moverCount] = null;
      const nowActive = crewSize(useBookingDraft.getState().addons.helpers);
      if (moverCount === nowActive) setError(cause instanceof Error ? cause.message : 'We could not get prices just now.');
      return null;
    } finally {
      if (mountedRef.current && gen === loadGenRef.current[moverCount]) setCrewLoading((current) => ({ ...current, [moverCount]: false }));
    }
  }, [applyQuoteForCrew, setDraft]);

  // Persisted prices are a snapshot; restore their current availability without creating another quote.
  useEffect(() => {
    mountedRef.current = true;
    const state = useBookingDraft.getState();
    const currActive = crewSize(state.addons.helpers);
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
      // Prefetch one alternative; additional crew sizes load when chosen.
      void fetchCrewQuote(other);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [applyQuoteForCrew, fetchCrewQuote, restoreCrewQuote]);

  function handleCrewSwitch(moverCount: CrewSize): void {
    if (moverCount === activeCrewNum) return;
    setDraft({ addons: { ...draft.addons, helpers: moverCount - 1 } });
    const publicId = crewQuoteIdsRef.current[moverCount];
    if (publicId) {
      void restoreCrewQuote(moverCount, publicId);
    } else {
      void fetchCrewQuote(moverCount).then((q) => { if (q) applyQuoteForCrew(q, moverCount); });
    }
  }

  function timeWindows(day: QuoteDto['calendar'][number]): ReactNode {
    return (
      <div aria-label="Available time windows" className="slot-list">
        {day.slots.map((slot) => (
          <button
            aria-pressed={draft.selectedSlot === slot.slot}
            className={classNames('slot-card', draft.selectedSlot === slot.slot && 'selected', !slot.available && 'disabled')}
            disabled={!slot.available}
            key={slot.slot}
            onClick={() => {
              setDraft({ selectedSlot: slot.slot });
              trackBookingEvent('slot_selected', {
                day_offset: Math.max(0, Math.round((new Date(`${day.date}T12:00:00Z`).getTime() - Date.now()) / 86_400_000)),
                slot: slot.slot,
                value: slot.pricePence / 100,
              });
            }}
            type="button"
          >
            <span>{slot.windowLabel}</span>
            <span className="slot-card-name">{slotPartOfDay[slot.slot]}</span>
            <strong>{formatGBP(slot.pricePence)}</strong>
            {!slot.available ? <em>{slot.reason?.replaceAll('_', ' ').toLowerCase()}</em> : null}
          </button>
        ))}
      </div>
    );
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

  return (
    <div className="booking-step">
      <section className="booking-panel">
        <StepHeading lead="Fixed prices for the next four weeks. Tap a day to see its times." title="Prices" />

        {/* Crew size tabs */}
        <div aria-label="Crew size" className="crew-tabs" role="group">
          {([1, 2, 3, 4] as const).map((moverCount) => {
            const isActive = activeCrewNum === moverCount;
            const minPrice = crewQuotes[moverCount]?.cheapest?.pricePence ?? null;
            const tabLoading = crewLoading[moverCount] ?? false;
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
                <span className="crew-tab-name">{moverCount === 1 ? '1 mover' : `${String(moverCount)} movers`}</span>
                {tabLoading ? (
                  <span className="crew-price-loading"><Loader2 aria-hidden="true" className="spin" size={14} /></span>
                ) : minPrice !== null ? (
                  <span className="crew-price">From {formatGBP(minPrice)}</span>
                ) : (
                  <span className="crew-price crew-price-pending">{crewPriceOnTap}</span>
                )}
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
                setCrewQuotes({});
                crewKeysRef.current = {};
                crewQuoteIdsRef.current = {};
                for (const size of [1, 2, 3, 4] as const) loadGenRef.current[size] += 1;
                setCrewLoading({});
                setDraft({ quote: null, selectedDate: null, selectedSlot: null });
                void fetchCrewQuote(activeCrewNum, true).then((q) => {
                  if (!q) return;
                  applyQuoteForCrew(q, activeCrewNum);
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
            <div aria-label="Available move dates" className="price-date-list" role="group">
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

                return [
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
                    type="button"
                  >
                    <span className="price-date-left">
                      <span className="price-date-weekday">{wday}</span>
                      <span className="price-date-day">{dnum}</span>
                      <span className="price-date-month">{mon}</span>                    </span>
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
                  </button>,
                  selectedDay === day ? <div className="price-date-slots" key={`${day.date}-slots`}>{timeWindows(day)}</div> : null,
                ];
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

        {/* A selected day outside the shown rows keeps its time windows below the list. */}
        {selectedDay && activeQuote && !quoteExpired && !shownDays.includes(selectedDay) ? timeWindows(selectedDay) : null}

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

      <StepNext
        disabled={!selectedSlot?.available || isActiveLoading || quoteExpired || Boolean(error)}
        label="Continue"
        onClick={goNext}
        price={selectedDay && selectedSlot?.available && !quoteExpired ? (
          <>
            <strong>{formatGBP(selectedSlot.pricePence)}</strong>
            <span>{formatMoveDate(selectedDay.date)} · {selectedSlot.windowLabel}</span>
          </>
        ) : null}
      />
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

interface AppliedCoupon {
  code: string;
  totalPence: number;
}

interface CheckoutPrice {
  coupon: AppliedCoupon | null;
  listTotal: number;
  total: number;
}

function PayStep(): ReactNode {
  const draft = useBookingDraft();
  const selected = draft.quote?.calendar.find((day) => day.date === draft.selectedDate)?.slots.find((slot) => slot.slot === draft.selectedSlot);
  const listTotal = selected?.pricePence ?? 0;
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  // A coupon is checked against one engine price; a different slot or quote needs a fresh check.
  useEffect(() => {
    setCoupon(null);
  }, [listTotal, draft.quotePublicId]);
  const price: CheckoutPrice = { coupon, listTotal, total: coupon?.totalPence ?? listTotal };
  useEffect(() => {
    trackBookingEvent('begin_checkout', { currency: 'GBP', value: price.total / 100 });
  }, [price.total]);
  return (
    <div className="booking-step">
      <section className="booking-panel">
        <StepHeading lead="Last step. Your price is fixed and you will get a confirmation email straight away." title="Details and pay" />
        <PaymentModeNotice />
        <Summary className="checkout-summary-inline" quote={draft.quote} total={price.total} />
        <CouponField applied={coupon} listTotal={listTotal} onChange={setCoupon} />
        {stripePromise ? (
          <Elements options={{ amount: price.total, currency: 'gbp', mode: 'payment' }} stripe={stripePromise}>
            <StripePayForm price={price} />
          </Elements>
        ) : (
          <MockPayForm price={price} />
        )}
      </section>
    </div>
  );
}

function CouponField({ applied, listTotal, onChange }: {
  applied: AppliedCoupon | null;
  listTotal: number;
  onChange: (coupon: AppliedCoupon | null) => void;
}): ReactNode {
  const draft = useBookingDraft();
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (!applied && !expanded) {
    return (
      <button className="link-button coupon-toggle" onClick={() => { setExpanded(true); }} type="button">
        Have a discount code?
      </button>
    );
  }
  if (applied) {
    return (
      <div className="coupon-field">
        <InlineAlert tone="success">
          {couponCopy.applied(formatGBP(applied.totalPence))} {couponCopy.listPrice}: {formatGBP(listTotal)}.
        </InlineAlert>
        <button className="button button-ghost" onClick={() => { onChange(null); }} type="button">{couponCopy.remove}</button>
      </div>
    );
  }
  return (
    <form className="coupon-field" onSubmit={(event) => {
      event.preventDefault();
      const parsed = CouponCodeSchema.safeParse(code);
      if (!parsed.success || !draft.quotePublicId || !draft.selectedDate || !draft.selectedSlot) {
        setError('That code is not valid for this booking.');
        return;
      }
      setChecking(true);
      setError(null);
      void checkCoupon({
        couponCode: parsed.data,
        date: draft.selectedDate,
        expectedTotalPence: listTotal,
        quotePublicId: draft.quotePublicId,
        slot: draft.selectedSlot,
      }).then(
        (result) => { onChange({ code: parsed.data, totalPence: result.totalPence }); },
        (cause: unknown) => { setError(cause instanceof Error ? cause.message : 'That code is not valid for this booking.'); },
      ).finally(() => { setChecking(false); });
    }}>
      <label className="field-label" htmlFor="coupon-code">{couponCopy.label}</label>
      <div className="coupon-row">
        <input
          aria-describedby={error ? 'coupon-error' : undefined}
          aria-invalid={error ? true : undefined}
          autoCapitalize="characters"
          autoComplete="off"
          className="text-input"
          id="coupon-code"
          maxLength={40}
          onChange={(event) => { setCode(event.target.value); }}
          value={code}
        />
        <button className="button button-secondary" disabled={checking || code.trim().length === 0} type="submit">
          {checking ? couponCopy.applying : couponCopy.apply}
        </button>
      </div>
      {error ? <div id="coupon-error"><InlineAlert tone="danger">{error}</InlineAlert></div> : null}
    </form>
  );
}

function Summary({ className, quote, total }: { className?: string; quote: QuoteDto | null; total: number }): ReactNode {
  const draft = useBookingDraft();
  const windowLabel = quote?.calendar.find((day) => day.date === draft.selectedDate)?.slots.find((slot) => slot.slot === draft.selectedSlot)?.windowLabel;
  const pickupTown = quote?.pickup.town ?? draft.pickup?.town;
  const dropoffTown = quote ? quote.dropoff?.town : draft.dropoff?.town;
  return (
    <div className={classNames('checkout-summary', className)}>
      <div><span>Service</span><strong>{serviceByKey(draft.service)?.label ?? 'Not chosen yet'}</strong></div>
      <div><span>Route</span><strong>{pickupTown ? `${pickupTown}${dropoffTown ? ` to ${dropoffTown}` : ''}` : 'Add addresses'}</strong></div>
      <div><span>Date</span><strong>{draft.selectedDate ? `${formatMoveDate(draft.selectedDate)}${windowLabel ? `, ${windowLabel}` : ''}` : 'Pick on the prices step'}</strong></div>
      <div><span>Items</span><strong>{pluralItems(itemCount(draft.items))}</strong></div>
      <div className="checkout-summary-total"><span>Total</span><strong>{total > 0 ? formatGBP(total) : '—'}</strong></div>
    </div>
  );
}

function usePaymentSubmit(price: CheckoutPrice) {
  const router = useRouter();
  const draft = useBookingDraft();
  return async (contact: ContactInput, options: { navigate?: boolean } = {}): Promise<Awaited<ReturnType<typeof createBooking>>> => {
    if (!draft.quotePublicId || !draft.selectedDate || !draft.selectedSlot) throw new Error('Choose a slot first.');
    const parsed = BookingCreateSchema.parse({
      contact,
      couponCode: price.coupon?.code,
      customerNotes: draft.customerNotes || undefined,
      date: draft.selectedDate,
      expectedTotalPence: price.listTotal,
      idempotencyKey: draft.ensureCheckoutKey(),
      marketingOptIn: draft.marketingOptIn,
      quotePublicId: draft.quotePublicId,
      slot: draft.selectedSlot,
      startWithinCancellationPeriodAck: draft.shortNoticeAck,
      termsAccepted: draft.termsAccepted,
    });
    const booking = await createBooking(parsed);
    draft.setDraft({ paymentIntentId: booking.clientSecret.split('_secret_')[0] ?? null, statusToken: booking.statusToken });
    // The card form was set up for this amount; never confirm a payment for a different one.
    if (booking.totalPence !== price.total) throw new Error(couponCopy.changed);
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

const contactFieldErrors: Record<keyof ContactInput, string> = {
  email: 'Enter an email address, like name@example.com.',
  name: 'Enter your full name.',
  phone: 'Enter a mobile number, like 07700 900123.',
};

function ContactField({ autoComplete, form, inputMode, label, name, type = 'text' }: {
  autoComplete: string;
  form: ReturnType<typeof useForm<ContactInput>>;
  inputMode?: 'email' | 'tel' | 'text';
  label: string;
  name: keyof ContactInput;
  type?: 'email' | 'tel' | 'text';
}): ReactNode {
  const invalid = Boolean(form.formState.errors[name]);
  const errorId = `contact-${name}-error`;
  return (
    <label className="field">
      {label}
      <input
        aria-describedby={invalid ? errorId : undefined}
        aria-invalid={invalid || undefined}
        autoComplete={autoComplete}
        className="text-input"
        inputMode={inputMode}
        placeholder={label}
        type={type}
        {...form.register(name)}
      />
      {invalid ? <span className="field-error" id={errorId}>{contactFieldErrors[name]}</span> : null}
    </label>
  );
}

function DetailsFields({ consentError, form }: { consentError: boolean; form: ReturnType<typeof useForm<ContactInput>> }): ReactNode {
  const draft = useBookingDraft();
  const missingConsent = consentError && (!draft.termsAccepted || !draft.shortNoticeAck);
  return (
    <div className="details-grid">
      <h2 className="details-heading">Your details</h2>
      <ContactField autoComplete="name" form={form} label="Full name" name="name" />
      <ContactField autoComplete="email" form={form} inputMode="email" label="Email" name="email" type="email" />
      <ContactField autoComplete="tel" form={form} inputMode="tel" label="Mobile" name="phone" type="tel" />
      <label className="field details-notes">
        <span>Notes for the driver <span className="field-optional">(optional)</span></span>
        <textarea className="text-input" onChange={(event) => { draft.setDraft({ customerNotes: event.target.value }); }} placeholder="Parking, door codes, anything fragile" rows={3} value={draft.customerNotes} />
      </label>
      <div className={classNames('consent-box', missingConsent && 'consent-box-error')}>
        <label className="toggle-row">
          <span>I agree to the <a className="text-link" href="/legal/terms" rel="noopener" target="_blank">terms</a> and <a className="text-link" href="/legal/cancellation" rel="noopener" target="_blank">cancellation policy</a></span>
          <input checked={draft.termsAccepted} onChange={(event) => { draft.setDraft({ termsAccepted: event.target.checked }); }} type="checkbox" />
        </label>
        <label className="toggle-row">
          <span>I ask Speedy Van to start services within the 14-day cancellation period if needed</span>
          <input checked={draft.shortNoticeAck} onChange={(event) => { draft.setDraft({ shortNoticeAck: event.target.checked }); }} type="checkbox" />
        </label>
        <label className="toggle-row">
          <span>Email me occasional offers <span className="field-optional">(optional)</span></span>
          <input checked={draft.marketingOptIn} onChange={(event) => { draft.setDraft({ marketingOptIn: event.target.checked }); }} type="checkbox" />
        </label>
        {missingConsent ? <p className="field-error" role="alert">Tick the first two boxes so we can take your booking.</p> : null}
      </div>
    </div>
  );
}

function MockPayForm({ price }: { price: CheckoutPrice }): ReactNode {
  const { total } = price;
  const form = useForm<ContactInput>({ defaultValues: useBookingDraft.getState().contact, resolver: zodResolver(ContactSchema) });
  const draft = useBookingDraft();
  const router = useRouter();
  const submitPayment = usePaymentSubmit(price);
  const [error, setError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState(false);
  return (
    <form noValidate onSubmit={(event) => {
      setConsentError(true);
      void form.handleSubmit(async (contact) => {
        setError(null);
        if (!useBookingDraft.getState().termsAccepted || !useBookingDraft.getState().shortNoticeAck) return;
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
      <DetailsFields consentError={consentError} form={form} />
      <div className="mock-payment">
        <CreditCard aria-hidden="true" size={20} />
        <span>Test payment mode. Use this locally when Stripe keys are not loaded.</span>
      </div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {error && draft.statusToken ? <a className="text-link" href={`/book/confirmation?t=${encodeURIComponent(draft.statusToken)}`}>{bookingConfirmationCopy.checkAgain}</a> : null}
      <div className="booking-next-bar">
        <button className="button button-primary booking-next" disabled={form.formState.isSubmitting} type="submit">
          {form.formState.isSubmitting ? 'Processing payment…' : <><Lock aria-hidden="true" size={16} />{`Pay ${formatGBP(total)}`}</>}
        </button>
      </div>
    </form>
  );
}

function StripePayForm({ price }: { price: CheckoutPrice }): ReactNode {
  const { total } = price;
  const form = useForm<ContactInput>({ defaultValues: useBookingDraft.getState().contact, resolver: zodResolver(ContactSchema) });
  const draft = useBookingDraft();
  const elements = useElements();
  const stripe = useStripe();
  const router = useRouter();
  const submitPayment = usePaymentSubmit(price);
  const [error, setError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState(false);
  return (
    <form noValidate onSubmit={(event) => {
      setConsentError(true);
      void form.handleSubmit(async (contact) => {
        setError(null);
        if (!useBookingDraft.getState().termsAccepted || !useBookingDraft.getState().shortNoticeAck) return;
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
      <DetailsFields consentError={consentError} form={form} />
      <PaymentElement options={{ layout: 'accordion' }} />
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {error && draft.statusToken ? <a className="text-link" href={`/book/confirmation?t=${encodeURIComponent(draft.statusToken)}`}>{bookingConfirmationCopy.checkAgain}</a> : null}
      <div className="booking-next-bar">
        <button className="button button-primary booking-next" disabled={!stripe || form.formState.isSubmitting} type="submit">
          {form.formState.isSubmitting ? 'Processing payment…' : <><Lock aria-hidden="true" size={16} />{`Pay ${formatGBP(total)}`}</>}
        </button>
      </div>
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
        <div className="booking-main">{children}</div>
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
  const previousStepRef = useRef(step);
  // A new step starts at the top, and keyboard and screen reader users land on its heading.
  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ behavior: reduceMotion ? 'auto' : 'smooth', top: 0 });
    document.querySelector<HTMLElement>('.booking-step-title')?.focus({ preventScroll: true });
  }, [step]);
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
