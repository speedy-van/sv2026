import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { getPublicSettings } from '@/server/settings';

import { createPageMetadata, getSeoSettings } from '@/server/seo';

export async function generateMetadata(): Promise<Metadata> {
  return createPageMetadata({
    path: '/about',
    settings: await getSeoSettings(),
    description: 'About Speedy Van and the booking system behind fixed online removals prices.',
    title: 'About Speedy Van',
  });
}

export default async function AboutPage(): Promise<ReactNode> {
  const settings = await getPublicSettings();
  const legal = settings.company.legalName && settings.company.registeredIn
    ? `${settings.company.legalName}, trading as ${settings.company.tradingName}, is registered in ${settings.company.registeredIn}.`
    : null;
  return (
    <>
      <section className="section page-hero">
        <div className="container two-column">
          <div>
            <h1 className="page-title">About Speedy Van</h1>
            <p className="lead">Speedy Van is built around fixed online pricing, clear access questions and live booking states.</p>
            {legal ? <p>{legal}</p> : null}
          </div>
          <BookingStartCard title="Start a price" />
        </div>
      </section>
      <section className="section section-muted">
        <div className="container two-column">
          <div className="table-card">
            <h2>How we work</h2>
            <p>The booking flow shows the working: route, inventory, access, date and slot before payment.</p>
          </div>
          <div className="table-card">
            <h2>Photos</h2>
            <p>Team and van photos will appear here when the owner uploads approved images.</p>
          </div>
        </div>
      </section>
    </>
  );
}
