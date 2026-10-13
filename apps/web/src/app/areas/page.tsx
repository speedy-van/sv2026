import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { StructuredData } from '@/components/marketing/structured-data';
import { locationPages, locationUrl, regionLabels, regions } from '@/content/locations';

export const revalidate = 86400;

export const metadata: Metadata = {
  alternates: { canonical: '/areas' },
  description: 'Browse Speedy Van removal and man and van coverage across Scottish cities, towns and regions.',
  title: 'Areas we cover in Scotland',
};

export default function AreasPage(): ReactNode {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: regions.map((region, index) => ({
      '@type': 'ListItem',
      name: region.label,
      position: index + 1,
      url: `/areas/${region.slug}`,
    })),
    name: 'Speedy Van areas in Scotland',
  };

  return (
    <>
      <StructuredData data={jsonLd} />
      <section className="section page-hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <h1 className="page-title">Areas we cover</h1>
            <p className="lead">Fixed-price removals, man and van jobs and furniture moves across mainland Scotland, with local pages for towns and cities.</p>
          </div>
          <BookingStartCard title="Check your move" />
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <h2>Regions</h2>
          <div className="region-grid">
            {regions.map((region) => (
              <Link href={`/areas/${region.slug}`} key={region.slug}>
                <strong>{region.label}</strong>
                <span>{region.count} towns and cities</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>All towns and cities</h2>
          <div className="location-directory">
            {regions.map((region) => (
              <section className="directory-group" key={region.slug}>
                <h3>{regionLabels[region.slug]}</h3>
                <div className="city-links">
                  {locationPages
                    .filter((location) => location.region === region.slug)
                    .map((location) => (
                      <Link href={locationUrl(location)} key={location.slug}>{location.name}</Link>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
