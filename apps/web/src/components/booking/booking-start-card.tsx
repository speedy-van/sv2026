'use client';

import { Loader2, MapPin, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { defaultAccess, useBookingDraft, type Address, type ServiceKey } from '@/components/booking-flow/booking-store';
import { retrieveQuickAddress, suggestQuickAddresses, type AddressSuggestion } from './address-search-client';
import { AddressSuggestionList, suggestionOptionId, useListboxKeyboard } from './address-suggestions';

type ServiceChip = {
  label: string;
  requiresDropoff: boolean;
  service: ServiceKey;
  shortLabel: string;
  variant: string;
};

const serviceChips: ServiceChip[] = [
  { label: 'Home move', requiresDropoff: true, service: 'house-removals', shortLabel: 'Home', variant: 'studio' },
  { label: 'Man and van', requiresDropoff: true, service: 'man-and-van', shortLabel: 'Man & van', variant: 'standard' },
  { label: 'Furniture', requiresDropoff: true, service: 'furniture', shortLabel: 'Furniture', variant: 'standard' },
];
const defaultServiceChip = serviceChips[0] as ServiceChip;

function AddressGlassSurface({ children, className }: { children: ReactNode; className: string }): ReactNode {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <div
      className={`${className} address-glass`}
      onPointerLeave={() => {
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        surfaceRef.current?.style.removeProperty('--glass-x');
        surfaceRef.current?.style.removeProperty('--glass-y');
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        pointerRef.current = { x: event.clientX, y: event.clientY };
        if (frameRef.current !== null) return;
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null;
          const surface = surfaceRef.current;
          if (!surface) return;
          const bounds = surface.getBoundingClientRect();
          if (bounds.width === 0 || bounds.height === 0) return;
          const x = Math.max(0, Math.min(100, (pointerRef.current.x - bounds.left) / bounds.width * 100));
          const y = Math.max(0, Math.min(100, (pointerRef.current.y - bounds.top) / bounds.height * 100));
          surface.style.setProperty('--glass-x', `${String(x)}%`);
          surface.style.setProperty('--glass-y', `${String(y)}%`);
        });
      }}
      ref={surfaceRef}
    >
      {children}
    </div>
  );
}

function fieldId(label: string): string {
  return `quick-${label.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`;
}

function QuickAddressField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (address: Address | null) => void;
  value: Address | null;
}): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [sessionToken, setSessionToken] = useState(() => crypto.randomUUID());
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const liveRef = useRef<HTMLDivElement>(null);
  const searchVersion = useRef(0);
  const selectionPending = useRef(false);
  const mounted = useRef(false);
  const reactId = useId();
  const inputId = `${reactId.replace(/:/gu, '')}-${fieldId(label)}`;
  const listId = `${inputId}-suggestions`;
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
    if (query.trim().length < 2 || value) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      suggestQuickAddresses(query, sessionToken)
        .then((result) => {
          if (cancelled || version !== searchVersion.current) return;
          setSuggestions(result);
          if (liveRef.current) liveRef.current.textContent = result.length === 0 ? 'No addresses found' : `${String(result.length)} addresses found`;
        })
        .catch(() => {
          if (cancelled || version !== searchVersion.current) return;
          setError('Address search is not responding.');
        })
        .finally(() => {
          if (cancelled || version !== searchVersion.current) return;
          setLoading(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [attempt, query, sessionToken, value]);

  async function selectSuggestion(suggestion: AddressSuggestion): Promise<void> {
    if (selectionPending.current) return;
    selectionPending.current = true;
    searchVersion.current += 1;
    setLoading(false);
    setRetrieving(true);
    setOpen(false);
    setSuggestions([]);
    setError(null);
    try {
      const result = await retrieveQuickAddress(suggestion.id, sessionToken);
      if (!mounted.current) return;
      if ('needsPostcode' in result) {
        setError('That result has no full postcode. Pick an exact address, or continue and enter it on the next page.');
        setSuggestions([]);
        return;
      }
      onChange(result.address);
      setQuery('');
      setSuggestions([]);
      setSessionToken(crypto.randomUUID());
    } catch {
      if (!mounted.current) return;
      setError('Address search is not responding.');
    } finally {
      selectionPending.current = false;
      if (mounted.current) setRetrieving(false);
    }
  }

  if (value) {
    return (
      <div className="address-field">
        <span className="address-field-label">{label}</span>
        <AddressGlassSurface className="address-selected">
          <MapPin aria-hidden="true" size={18} />
          <span title={value.label}>{value.label}</span>
          <button aria-label={`Change ${label.toLowerCase()} address`} className="button button-ghost" onClick={() => { onChange(null); }} type="button">
            Change
          </button>
        </AddressGlassSurface>
      </div>
    );
  }

  const listOpen = open && suggestions.length > 0;
  const noResults = open && !loading && !error && suggestions.length === 0 && query.trim().length >= 2;

  return (
    <div className="address-field">
      <label htmlFor={inputId}>{label}</label>
      <AddressGlassSurface className="address-input-wrap">
        <Search aria-hidden="true" size={18} />
        <input
          aria-activedescendant={listOpen && keyboard.activeIndex >= 0 ? suggestionOptionId(listId, keyboard.activeIndex) : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={listOpen}
          autoComplete="off"
          className="text-input"
          disabled={retrieving}
          id={inputId}
          onBlur={() => { setOpen(false); }}
          onChange={(event) => {
            searchVersion.current += 1;
            setSuggestions([]);
            setError(null);
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => { setOpen(true); }}
          onKeyDown={keyboard.onKeyDown}
          placeholder="Street or postcode"
          role="combobox"
          type="text"
          value={query}
        />
        {loading || retrieving ? <Loader2 aria-hidden="true" className="address-input-spinner spin" size={18} /> : null}
      </AddressGlassSurface>
      <div aria-live="polite" className="sr-only" ref={liveRef} />
      <AddressSuggestionList activeIndex={keyboard.activeIndex} id={listId} onHover={keyboard.setActiveIndex} onPick={(suggestion) => void selectSuggestion(suggestion)} open={listOpen} suggestions={suggestions} />
      {noResults ? <span className="field-help">No matches yet. Try a postcode, like G2 1DU.</span> : null}
      {error ? (
        <span className="field-help field-help-error" role="status">
          {error}{' '}
          <button className="link-button" onClick={() => { setOpen(true); setAttempt((current) => current + 1); }} type="button">Try again</button>
        </span>
      ) : null}
    </div>
  );
}

export function BookingStartCard({
  initialService,
  selected = 'Home move',
  title = 'Start your move',
}: {
  initialService?: Omit<ServiceChip, 'shortLabel'>;
  selected?: 'Home move' | 'Man and van' | 'Furniture';
  title?: string;
}): ReactNode {
  const router = useRouter();
  const setDraft = useBookingDraft((state) => state.setDraft);
  const [selectedService, setSelectedService] = useState<ServiceChip>(() => initialService ? { ...initialService, shortLabel: initialService.label } : serviceChips.find((chip) => chip.label === selected) ?? defaultServiceChip);
  const [pickup, setPickup] = useState<Address | null>(null);
  const [dropoff, setDropoff] = useState<Address | null>(null);

  function submit(): void {
    setDraft({
      dropoff: selectedService.requiresDropoff ? dropoff : null,
      dropoffAccess: selectedService.requiresDropoff ? defaultAccess : null,
      pickup,
      pickupAccess: defaultAccess,
      quote: null,
      quotePublicId: null,
      selectedDate: null,
      selectedSlot: null,
      service: selectedService.service,
      variant: selectedService.variant,
    });
    // A complete card already answers the move step, so the visitor carries straight on to access.
    router.push(pickup && (dropoff || !selectedService.requiresDropoff) ? '/book?step=access' : '/book');
  }

  return (
    <form
      className="booking-card"
      data-booking-card
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2>{title}</h2>
      <div aria-label="Service type" className="chip-row" role="radiogroup">
        {(initialService ? [selectedService] : serviceChips).map((chip) => (
          <button
            aria-checked={chip.label === selectedService.label}
            aria-label={chip.label}
            className={`chip ${chip.label === selectedService.label ? 'chip-selected' : ''}`}
            key={chip.label}
            onClick={() => {
              setSelectedService(chip);
              if (!chip.requiresDropoff) setDropoff(null);
            }}
            role="radio"
            type="button"
          >
            <span className="chip-label-full">{chip.label}</span>
            <span className="chip-label-short">{chip.shortLabel}</span>
          </button>
        ))}
      </div>
      <div className="field-grid">
        <QuickAddressField label={selectedService.requiresDropoff ? 'From' : 'Collection address'} onChange={setPickup} value={pickup} />
        {selectedService.requiresDropoff ? <QuickAddressField label="To" onChange={setDropoff} value={dropoff} /> : null}
      </div>
      <button className="button button-primary" type="submit">
        See my prices
      </button>
    </form>
  );
}
