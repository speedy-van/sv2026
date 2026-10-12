import { CalendarDays, CreditCard, MapPin, Receipt } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { ScotlandRouteMap } from '@/components/maps/scotland-route-map';

export const metadata: Metadata = {
  description: 'See fixed prices for every day of the next four weeks and book removals or man and van moves online.',
  title: 'Removals and man and van across Scotland',
};

const proofItems = [
  {
    icon: Receipt,
    text: 'Fixed price shown before you pay',
  },
  {
    icon: CalendarDays,
    text: 'Prices for every slot over four weeks',
  },
  {
    icon: MapPin,
    text: 'Live van tracking on moving day',
  },
  {
    icon: CreditCard,
    text: 'Card, Apple Pay or Google Pay, processed by Stripe',
  },
];

export default function HomePage(): ReactNode {
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <h1>Removals and man and van across Scotland</h1>
            <p>See fixed prices for every day of the next four weeks and book online in a few minutes.</p>
            <BookingStartCard />
            <p className="field-help">Mainland Scotland is priced instantly. Ferry routes are priced by our team.</p>
          </div>
          <ScotlandRouteMap />
        </div>
      </section>
      <section className="section">
        <div className="container">
          <h2>What you get</h2>
          <div className="proof-grid">
            {proofItems.map((item) => {
              const Icon = item.icon;
              return (
                <article className="proof-item" key={item.text}>
                  <Icon aria-hidden="true" color="#6D3BD7" size={26} />
                  <div>
                    <h3>{item.text}</h3>
                    <p>Built into the booking system, with the server as the source of truth.</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container state-grid">
          <div>
            <h2>How it starts</h2>
            <p className="lead">Tell us about your move, pick your fixed price, then pay online to confirm the slot.</p>
          </div>
          <BookingStartCard title="Ready when you are" />
        </div>
      </section>
    </>
  );
}
