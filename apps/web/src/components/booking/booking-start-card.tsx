import Link from 'next/link';
import type { ReactNode } from 'react';

const serviceChips = ['Home move', 'Man and van', 'Furniture', 'Rubbish'];

export function BookingStartCard({
  selected = 'Home move',
  title = 'Start with your move',
}: {
  selected?: (typeof serviceChips)[number];
  title?: string;
}): ReactNode {
  return (
    <form action="/book" className="booking-card" data-booking-card>
      <h2>{title}</h2>
      <div aria-label="Service type" className="chip-row" role="radiogroup">
        {serviceChips.map((chip) => (
          <button aria-checked={chip === selected} className={`chip ${chip === selected ? 'chip-selected' : ''}`} key={chip} role="radio" type="button">
            {chip}
          </button>
        ))}
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="pickup">From</label>
          <input className="text-input" id="pickup" name="pickup" placeholder="Pickup postcode or address" type="text" />
          <span className="field-help">Use the full booking flow for address search.</span>
        </div>
        <div className="field">
          <label htmlFor="dropoff">To</label>
          <input className="text-input" id="dropoff" name="dropoff" placeholder="Drop-off postcode or address" type="text" />
          <span className="field-help">Rubbish removal can use one address.</span>
        </div>
      </div>
      <Link className="button button-primary" href="/book">
        See my prices
      </Link>
    </form>
  );
}
