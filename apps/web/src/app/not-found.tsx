import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';

export default function NotFound(): ReactNode {
  return (
    <section className="section">
      <div className="container state-grid">
        <div>
          <h1 className="page-title">We can't find that page.</h1>
          <p className="lead">Start a booking, or use one of these links.</p>
          <div className="chip-row" style={{ marginTop: 24 }}>
            <Link className="button button-secondary" href="/services">
              Services
            </Link>
            <Link className="button button-secondary" href="/areas">
              Areas
            </Link>
            <Link className="button button-secondary" href="/help">
              Help
            </Link>
          </div>
        </div>
        <BookingStartCard />
      </div>
    </section>
  );
}
