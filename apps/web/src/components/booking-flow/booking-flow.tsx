'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import NumberFlow from '@number-flow/react';
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
  CalendarDays,
  Check,
  ChevronLeft,
  CreditCard,
  Loader2,
  MapPin,
  PackagePlus,
  Search,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
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
import { categoryLabels, serviceByKey, serviceOptions } from './content';

const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const stripePromise = stripeKey ? loadStripe(stripeKey) : null;
const steps: Array<{ key: BookingStep; label: string }> = [
  { key: 'move', label: 'Your move' },
  { key: 'items', label: 'Items' },
  { key: 'prices', label: 'Prices' },
  { key: 'pay', label: 'Pay' },
];

type Suggestion = z.infer<typeof AddressSuggestionSchema>;
type ContactInput = z.infer<typeof ContactSchema>;
type ManualQuoteInput = z.infer<typeof ManualQuoteRequestSchema>;

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
  const guard = firstIncompleteStep(draft);
  const step = selectedStep(params);
  const allowQuoteRestore = params.has('quote');
  useEffect(() => {
    if (!allowQuoteRestore && stepIndex(step) > stepIndex(guard)) {
      router.replace(`/book?step=${guard}`);
    }
  }, [allowQuoteRestore, guard, router, step]);
  return [
    !allowQuoteRestore && stepIndex(step) > stepIndex(guard) ? guard : step,
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
    <ol aria-label="Booking progress" className="booking-progress">
      {steps.map((step, index) => (
        <li className={classNames(index === currentIndex && 'is-current', index < currentIndex && 'is-complete')} key={step.key}>
          <button disabled={index > currentIndex} onClick={() => { setStep(step.key); }} type="button">
            <span>{index + 1}</span>
            {step.label}
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
  label,
  onChange,
  value,
}: {
  address: Address | null;
  label: string;
  onChange: (next: AccessDetail) => void;
  value: AccessDetail;
}): ReactNode {
  const [notesOpen, setNotesOpen] = useState(false);
  const suggestion = parseFlatNotation(address?.flat, address?.line1);
  function patch(next: Partial<AccessDetail>): void {
    onChange({ ...value, ...next });
  }
  return (
    <section className="booking-panel">
      <h2>{label}</h2>
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
        {(['BASEMENT', 'GROUND', 'FLOOR'] as const).map((choice) => (
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
        <p className="lead">Choose the service, addresses and access details. Fixed prices come next.</p>
        <div aria-label="Service type" className="choice-grid" role="radiogroup">
          {serviceOptions.map((service) => {
            const Icon = service.icon;
            return (
              <button aria-checked={draft.service === service.key} className={classNames('choice-card', draft.service === service.key && 'selected')} key={service.key} onClick={() => { chooseService(service.key); }} role="radio" type="button">
                <Icon aria-hidden="true" size={22} />
                <strong>{service.label}</strong>
                <span>{service.description}</span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="booking-panel">
        <h2>Addresses</h2>
        <div className="field-grid">
          <AddressField label={selectedService?.requiresDropoff === false ? 'Collection address' : 'From'} onChange={(pickup) => { draft.setDraft({ pickup, quote: null, selectedDate: null, selectedSlot: null }); }} value={draft.pickup} />
          {selectedService?.requiresDropoff === false ? null : (
            <AddressField label="To" onChange={(dropoff) => { draft.setDraft({ dropoff, quote: null, selectedDate: null, selectedSlot: null }); }} value={draft.dropoff} />
          )}
        </div>
        {!touchesScotland ? <InlineAlert tone="danger">We move people to and from Scotland. One address needs to be in Scotland.</InlineAlert> : null}
      </section>
      {selectedService && selectedService.variants.length > 1 ? (
        <section className="booking-panel">
          <h2>Size or type</h2>
          <div className="choice-grid compact">
            {selectedService.variants.map((variant) => (
              <button className={classNames('choice-card', draft.variant === variant.key && 'selected')} key={variant.key} onClick={() => { draft.setDraft({ quote: null, selectedDate: null, selectedSlot: null, variant: variant.key }); }} type="button">
                <strong>{variant.label}</strong>
                {variant.manualQuote ? <span>We'll price this one individually.</span> : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {draft.pickup ? <AccessCard address={draft.pickup} label="Pickup access" onChange={(pickupAccess) => { draft.setDraft({ pickupAccess, quote: null }); }} value={draft.pickupAccess} /> : null}
      {selectedService?.requiresDropoff !== false && draft.dropoff && draft.dropoffAccess ? <AccessCard address={draft.dropoff} label="Dropoff access" onChange={(dropoffAccess) => { draft.setDraft({ dropoffAccess, quote: null }); }} value={draft.dropoffAccess} /> : null}
      <button className="button button-primary booking-next" disabled={!canContinue || !touchesScotland} onClick={goNext} type="button">
        Continue to items
      </button>
    </div>
  );
}

function ItemsStep({ goNext }: { goNext: () => void }): ReactNode {
  const draft = useBookingDraft();
  const catalogue = useQuery({ queryFn: getCatalogue, queryKey: ['catalogue'] });
  const [category, setCategory] = useState('Popular');
  const [search, setSearch] = useState('');
  const [customName, setCustomName] = useState('');
  const selected = new Map(draft.items.filter((item) => item.kind === 'catalogue' && item.itemSlug).map((item) => [item.itemSlug as string, item.quantity]));
  const items = (catalogue.data?.items ?? []).filter((item) => {
    const categoryMatch = category === 'Popular' ? item.aliases.length > 0 : item.category.toLowerCase() === category.toLowerCase();
    const query = search.trim().toLowerCase();
    const searchMatch = !query || item.name.toLowerCase().includes(query) || item.aliases.some((alias) => alias.toLowerCase().startsWith(query));
    return categoryMatch && searchMatch;
  }).slice(0, search ? 8 : 24);

  function setQuantity(slug: string, quantity: number): void {
    const item = catalogue.data?.items.find((candidate) => candidate.slug === slug);
    if (!item) return;
    const rest = draft.items.filter((candidate) => candidate.itemSlug !== slug);
    draft.setDraft({ items: quantity > 0 ? [...rest, { itemSlug: slug, kind: 'catalogue', quantity }] : rest, quote: null });
  }

  function addCustom(): void {
    if (customName.trim().length < 2) return;
    draft.setDraft({
      items: [...draft.items, { kind: 'custom', name: customName.trim(), quantity: 1, size: 'M' }],
      quote: null,
    });
    setCustomName('');
  }

  return (
    <div className="booking-step">
      <section className="booking-panel">
        <h1>Items</h1>
        <p className="lead">Add what you are moving. You can use a preset, search, or add your own item.</p>
        {catalogue.isLoading ? <div className="skeleton skeleton-card" /> : null}
        {catalogue.isError ? <InlineAlert tone="danger">We could not load the item catalogue. Try again.</InlineAlert> : null}
        <div className="chip-row">
          {categoryLabels.map((label) => (
            <button className={classNames('chip', category === label && 'chip-selected')} key={label} onClick={() => { setCategory(label); }} type="button">
              {label}
            </button>
          ))}
        </div>
        <input className="text-input" onChange={(event) => { setSearch(event.target.value); }} placeholder="Search items, like sofa or wardrobe" type="search" value={search} />
        <div className="item-list">
          {items.map((item) => {
            const quantity = selected.get(item.slug) ?? 0;
            return (
              <div className={classNames('item-row', quantity > 0 && 'selected')} key={item.slug}>
                <span>{item.name}</span>
                <Quantity value={quantity} onChange={(next) => { setQuantity(item.slug, next); }} />
              </div>
            );
          })}
        </div>
        {items.length === 0 && search ? (
          <div className="custom-item">
            <p>No catalogue matches. Add it as your own item.</p>
            <input className="text-input" onChange={(event) => { setCustomName(event.target.value); }} placeholder="Item name" type="text" value={customName} />
            <button className="button button-secondary" onClick={addCustom} type="button">
              <PackagePlus aria-hidden="true" size={18} />
              Add own item
            </button>
          </div>
        ) : null}
      </section>
      <section className="booking-panel">
        <h2>Extras</h2>
        <label className="field">
          Extra helpers
          <Quantity max={3} value={draft.addons.helpers} onChange={(helpers) => { draft.setDraft({ addons: { ...draft.addons, helpers }, quote: null }); }} />
        </label>
        <label className="toggle-row">
          <span>Packing help</span>
          <input checked={draft.addons.packing} onChange={(event) => { draft.setDraft({ addons: { ...draft.addons, packing: event.target.checked }, quote: null }); }} type="checkbox" />
        </label>
        <label className="toggle-row">
          <span>Furniture assembly</span>
          <input checked={draft.addons.assembly} onChange={(event) => { draft.setDraft({ addons: { ...draft.addons, assembly: event.target.checked }, quote: null }); }} type="checkbox" />
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

function Quantity({ max = 99, onChange, value }: { max?: number; onChange: (value: number) => void; value: number }): ReactNode {
  return (
    <div className="quantity">
      <button aria-label="Decrease quantity" onClick={() => { onChange(Math.max(0, value - 1)); }} type="button">
        -
      </button>
      <output aria-live="polite">{value}</output>
      <button aria-label="Increase quantity" onClick={() => { onChange(Math.min(max, value + 1)); }} type="button">
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

function PricesStep({ goNext }: { goNext: () => void }): ReactNode {
  const draft = useBookingDraft();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualReasons, setManualReasons] = useState<string[] | null>(null);
  const quote = draft.quote;
  const selectedDay = quote?.calendar.find((day) => day.date === draft.selectedDate) ?? quote?.calendar.find((day) => day.slots.some((slot) => slot.available));
  const selectedSlot = selectedDay?.slots.find((slot) => slot.slot === draft.selectedSlot) ?? selectedDay?.slots.find((slot) => slot.available);
  const cheapest = quote?.cheapest;

  async function revealPrices(): Promise<void> {
    setLoading(true);
    setError(null);
    setManualReasons(null);
    trackBookingEvent('quote_requested', { service: draft.service ?? undefined });
    try {
      const result = await createQuote(quoteInputFromDraft(useBookingDraft.getState()));
      if ('manualQuote' in result) {
        draft.setDraft({ quotePublicId: result.manualQuote.quotePublicId });
        setManualReasons(result.manualQuote.reasons);
        trackBookingEvent('manual_quote_shown', { reason: result.manualQuote.reasons[0], service: draft.service ?? undefined });
        return;
      }
      const first = result.quote.cheapest;
      draft.setDraft({
        quote: result.quote,
        quotePublicId: result.quote.publicId,
        selectedDate: first?.date ?? null,
        selectedSlot: first?.slot ?? null,
      });
      trackBookingEvent('quote_shown', {
        distance_band: distanceBand(result.quote.distanceMiles),
        service: result.quote.service,
        value: (result.quote.cheapest?.pricePence ?? 0) / 100,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not get prices just now.');
    } finally {
      setLoading(false);
    }
  }

  if (manualReasons) return <ManualQuotePanel reasons={manualReasons} />;

  return (
    <div className="booking-step">
      <section className="booking-panel">
        <h1>Prices</h1>
        {!quote ? (
          <div className="reveal-card" role="status">
            <p>Planning your route</p>
            <p>Checking our vans for the next 4 weeks</p>
            <p>Working out fixed prices</p>
            <button className="button button-primary" disabled={loading} onClick={() => void revealPrices()} type="button">
              {loading ? <Loader2 aria-hidden="true" className="spin" size={18} /> : <CalendarDays aria-hidden="true" size={18} />}
              {loading ? 'Checking prices…' : 'Reveal prices'}
            </button>
          </div>
        ) : (
          <>
            <div className="hero-price">
              <span>From</span>
              <strong>
                <NumberFlow value={(cheapest?.pricePence ?? 0) / 100} format={{ currency: 'GBP', style: 'currency' }} />
              </strong>
              <p>{cheapest ? `${cheapest.date}, ${slotWindow(cheapest.slot)}` : 'No available slots'}</p>
              <small>Prices held until {new Date(quote.expiresAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}</small>
            </div>
            <div className="calendar-grid">
              {quote.calendar.map((day) => {
                const lowest = day.slots.filter((slot) => slot.available).sort((left, right) => left.pricePence - right.pricePence)[0];
                return (
                  <button className={classNames('day-card', draft.selectedDate === day.date && 'selected', !lowest && 'disabled')} disabled={!lowest} key={day.date} onClick={() => {
                    draft.setDraft({ selectedDate: day.date, selectedSlot: lowest?.slot ?? null });
                    if (lowest) trackBookingEvent('slot_selected', { day_offset: Math.max(0, Math.round((new Date(`${day.date}T12:00:00Z`).getTime() - Date.now()) / 86_400_000)), slot: lowest.slot, value: lowest.pricePence / 100 });
                  }} type="button">
                    <span>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', weekday: 'short' })}</span>
                    <strong>{lowest ? formatGBP(lowest.pricePence) : 'Full'}</strong>
                  </button>
                );
              })}
            </div>
            {selectedDay ? (
              <div className="slot-list">
                {selectedDay.slots.map((slot) => (
                  <button className={classNames('slot-card', draft.selectedSlot === slot.slot && 'selected', !slot.available && 'disabled')} disabled={!slot.available} key={slot.slot} onClick={() => {
                    draft.setDraft({ selectedSlot: slot.slot });
                    trackBookingEvent('slot_selected', { day_offset: Math.max(0, Math.round((new Date(`${selectedDay.date}T12:00:00Z`).getTime() - Date.now()) / 86_400_000)), slot: slot.slot, value: slot.pricePence / 100 });
                  }} type="button">
                    <span>{slotWindow(slot.slot)}</span>
                    <strong>{formatGBP(slot.pricePence)}</strong>
                    {slot.lastOne ? <em>Last slot</em> : null}
                    {!slot.available ? <em>{slot.reason?.replaceAll('_', ' ').toLowerCase()}</em> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <details className="booking-breakdown">
              <summary>How this price is worked out</summary>
              {quote.breakdownLines.map((line) => (
                <div key={line.key}>
                  <span>{line.label}</span>
                  <strong>{formatGBP(line.pence)}</strong>
                </div>
              ))}
            </details>
          </>
        )}
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </section>
      <button className="button button-primary booking-next" disabled={!selectedSlot} onClick={goNext} type="button">
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
    draft.setDraft({ statusToken: booking.statusToken });
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
          } else {
            router.push(`/book/confirmation?t=${encodeURIComponent(booking.statusToken)}`);
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
        <button className="button button-ghost icon-button" disabled={step === 'move'} onClick={() => { setStep(previousStep(step)); }} type="button" aria-label="Back">
          <ChevronLeft aria-hidden="true" size={22} />
        </button>
        <div className="route-chip">
          <Truck aria-hidden="true" size={18} />
          <span>{draft.pickup ? `${draft.pickup.town}${draft.dropoff ? ` to ${draft.dropoff.town}` : ''}` : 'Your route'}</span>
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
      {step === 'items' ? <ItemsStep goNext={setNext} /> : null}
      {step === 'prices' ? <PricesStep goNext={setNext} /> : null}
      {step === 'pay' ? <PayStep /> : null}
    </BookingFrame>
  );
}
