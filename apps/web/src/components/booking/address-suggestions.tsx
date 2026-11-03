'use client';

import { Building2, Hash, MapPin } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface SuggestionLike {
  id: string;
  kind: 'address' | 'place' | 'poi' | 'postcode';
  primary: string;
  secondary: string;
}

// Every result is in the UK, so the country adds length without telling the customer anything.
export function suggestionPlace(secondary: string): string {
  return secondary.replace(/,?\s*United Kingdom$/u, '');
}

export function suggestionOptionId(listId: string, index: number): string {
  return `${listId}-option-${String(index)}`;
}

export interface ListboxKeyboard {
  activeIndex: number;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  setActiveIndex: (index: number) => void;
}

/** Arrow keys move through suggestions, Enter picks one, Escape closes the list. */
export function useListboxKeyboard<T>({ items, onClose, onOpen, onPick, open }: {
  items: T[];
  onClose: () => void;
  onOpen: () => void;
  onPick: (item: T) => void;
  open: boolean;
}): ListboxKeyboard {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [itemsSeen, setItemsSeen] = useState(items);
  if (itemsSeen !== items) {
    setItemsSeen(items);
    setActiveIndex(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setActiveIndex(-1);
      onClose();
      return;
    }
    if (items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onOpen();
      setActiveIndex((current) => open ? (current + 1) % items.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      onOpen();
      setActiveIndex((current) => !open || current <= 0 ? items.length - 1 : current - 1);
    } else if (event.key === 'Enter' && open) {
      const item = items[activeIndex === -1 ? 0 : activeIndex];
      if (!item) return;
      event.preventDefault();
      onPick(item);
    }
  }

  return { activeIndex, onKeyDown, setActiveIndex };
}

function KindIcon({ kind }: { kind: SuggestionLike['kind'] }): ReactNode {
  if (kind === 'postcode') return <Hash aria-hidden="true" size={16} />;
  if (kind === 'poi') return <Building2 aria-hidden="true" size={16} />;
  return <MapPin aria-hidden="true" size={16} />;
}

export function AddressSuggestionList<T extends SuggestionLike>({
  activeIndex,
  id,
  onHover,
  onPick,
  open,
  suggestions,
}: {
  activeIndex: number;
  id: string;
  onHover: (index: number) => void;
  onPick: (suggestion: T) => void;
  open: boolean;
  suggestions: T[];
}): ReactNode {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const option = list?.children.item(activeIndex);
    if (!open || !list || !(option instanceof HTMLElement)) return;
    const listBounds = list.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    // Scroll only the popup; moving the active option must not jump the page.
    if (optionBounds.top < listBounds.top) list.scrollTop -= listBounds.top - optionBounds.top;
    else if (optionBounds.bottom > listBounds.bottom) list.scrollTop += optionBounds.bottom - listBounds.bottom;
  }, [activeIndex, open]);

  return (
    <ul aria-label="Address suggestions" className="address-suggestions" hidden={!open || suggestions.length === 0} id={id} ref={listRef} role="listbox">
      {suggestions.map((suggestion, index) => (
        <li
          aria-selected={index === activeIndex}
          className={index === activeIndex ? 'is-active' : undefined}
          id={suggestionOptionId(id, index)}
          key={suggestion.id}
          onClick={() => { onPick(suggestion); }}
          // Keep focus in the input so the list does not close before the click lands.
          onMouseDown={(event) => { event.preventDefault(); }}
          onPointerMove={(event) => { if (event.pointerType === 'mouse') onHover(index); }}
          role="option"
        >
          <span aria-hidden="true" className="address-suggestion-icon">
            <KindIcon kind={suggestion.kind} />
          </span>
          <span className="address-suggestion-copy">
            <strong>{suggestion.primary}</strong>
            {suggestion.secondary ? <span>{suggestionPlace(suggestion.secondary)}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
