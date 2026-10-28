'use client';

import { MapPin, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { defaultAccess, useBookingDraft, type Address, type ServiceKey } from '@/components/booking-flow/booking-store';
import { retrieveQuickAddress, suggestQuickAddresses, type AddressSuggestion } from './address-search-client';

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
  const [query, setQuery] = useState('');
  const [sessionToken, setSessionToken] = useState(() => crypto.randomUUID());
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const liveRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const inputId = `${reactId.replace(/:/gu, '')}-${fieldId(label)}`;

  useEffect(() => {
    if (query.trim().length < 2 || value) {
      setSuggestions([]);
      return;
    }

    const handle = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      suggestQuickAddresses(query, sessionToken)
        .then((result) => {
          setSuggestions(result);
          if (liveRef.current) liveRef.current.textContent = `${String(result.length)} addresses found`;
        })
        .catch(() => {
          setError('Address search is not responding.');
        })
        .finally(() => {
          setLoading(false);
        });
    }, 200);

    return () => {
      window.clearTimeout(handle);
    };
  }, [query, sessionToken, value]);

  async function selectSuggestion(suggestion: AddressSuggestion): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await retrieveQuickAddress(suggestion.id, sessionToken);
      if ('needsPostcode' in result) {
        setError('Choose a full address or continue to enter it manually.');
        setSuggestions([]);
        return;
      }
      onChange(result.address);
      setQuery('');
      setSuggestions([]);
      setSessionToken(crypto.randomUUID());
    } catch {
      setError('Address search is not responding.');
    } finally {
      setLoading(false);
    }
  }

  if (value) {
    return (
      <AddressGlassSurface className="address-selected">
        <MapPin aria-hidden="true" size={18} />
        <span>{value.label}</span>
        <button className="button button-ghost" onClick={() => { onChange(null); }} type="button">
          Change
        </button>
      </AddressGlassSurface>
    );
  }

  return (
    <div className="address-field">
      <label htmlFor={inputId}>{label}</label>
      <AddressGlassSurface className="address-input-wrap">
        <Search aria-hidden="true" size={18} />
        <input
          aria-autocomplete="list"
          aria-controls={`${inputId}-suggestions`}
          aria-expanded={suggestions.length > 0}
          className="text-input"
          id={inputId}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Address"
          role="combobox"
          type="text"
          value={query}
        />
      </AddressGlassSurface>
      <div aria-live="polite" className="sr-only" ref={liveRef} />
      {loading ? <p className="field-help">Searching addresses...</p> : null}
      <ul className="address-suggestions" hidden={suggestions.length === 0} id={`${inputId}-suggestions`} role="listbox">
        {suggestions.map((suggestion) => (
          <button aria-selected="false" key={suggestion.id} onClick={() => void selectSuggestion(suggestion)} role="option" type="button">
            <strong>{suggestion.primary}</strong>
            <span>{suggestion.secondary}</span>
          </button>
        ))}
      </ul>
      {error ? <span className="field-help" role="status">{error}</span> : null}
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
      selectedDate: null,
      selectedSlot: null,
      service: selectedService.service,
      variant: selectedService.variant,
    });
    router.push('/book');
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
