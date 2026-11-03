import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { aboutCompanyDescription, aboutCopy } from '@/content/about';
import { getPublicSettings } from '@/server/settings';

import { createPageMetadata, getSeoSettings } from '@/server/seo';

export async function generateMetadata(): Promise<Metadata> {
  return createPageMetadata({
    path: '/about',
    settings: await getSeoSettings(),
    description: aboutCopy.description,
    title: aboutCopy.title,
  });
}

export default async function AboutPage(): Promise<ReactNode> {
  const settings = await getPublicSettings();
  const legal = aboutCompanyDescription(settings.company);
  return (
    <>
      <section className="section page-hero">
        <div className="container two-column">
          <div>
            <h1 className="page-title">{aboutCopy.title}</h1>
            <p className="lead">{aboutCopy.lead}</p>
            {legal ? <p>{legal}</p> : null}
          </div>
          <BookingStartCard title={aboutCopy.bookingTitle} />
        </div>
      </section>
      <section className="section section-muted">
        <div className="container two-column">
          <div className="table-card">
            <h2>{aboutCopy.howHeading}</h2>
            <p>{aboutCopy.howBody}</p>
          </div>
          <div className="table-card">
            <h2>{aboutCopy.helpHeading}</h2>
            <p>{aboutCopy.helpBody}</p>
            <Link className="text-link" href="/contact">{aboutCopy.contactLabel}</Link>
          </div>
        </div>
      </section>
    </>
  );
}
