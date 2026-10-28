import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/ui/states';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
  title: 'Styleguide',
};

export default function StyleguidePage(): ReactNode {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_ENABLE_STYLEGUIDE !== '1') {
    notFound();
  }

  return (
    <div className="section">
      <div className="container">
        <h1 className="page-title">Styleguide</h1>
        <p className="lead">Foundation components and required states.</p>
        <div className="state-grid" style={{ marginTop: 32 }}>
          <article className="component-card">
            <h2>Buttons</h2>
            <div className="chip-row">
              <button className="button button-primary" type="button">
                Primary
              </button>
              <button className="button button-brand" type="button">
                Brand
              </button>
              <button className="button button-secondary" type="button">
                Secondary
              </button>
              <button className="button button-ghost" type="button">
                Ghost
              </button>
              <button className="button button-danger" type="button">
                Danger
              </button>
              <button className="button button-primary" disabled type="button">
                Loading…
              </button>
            </div>
          </article>
          <article className="component-card">
            <h2>Inputs and chips</h2>
            <BookingStartCard />
          </article>
          <article className="component-card">
            <h2>States</h2>
            <div className="state-grid">
              <SkeletonCard />
              <EmptyState />
              <ErrorState />
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
