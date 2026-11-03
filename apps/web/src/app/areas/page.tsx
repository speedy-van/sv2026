import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { StructuredData } from '@/components/marketing/structured-data';
import { areaCoverageCopy } from '@/content/area-coverage';
import { localSearchTarget } from '@/content/keyword-targets';
import { searchIntents } from '@/content/service-search';
import {
  citySlugs,
  locationPages,
  locationsBySlug,
  locationUrl,
  regionLabels,
  regions,
  routePages,
  routeUrl,
} from '@/content/locations';
import { createPageMetadata, getSeoSettings } from '@/server/seo';

export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  return createPageMetadata({
    description:
      'Find removals and man and van services across Scotland. Browse cities, towns, council areas and removal routes, with individual quotes for ferry moves.',
    path: '/areas',
    settings: await getSeoSettings(),
    title: 'Areas we cover in Scotland',
  });
}

export default async function AreasPage(): Promise<ReactNode> {
  const settings = await getSeoSettings();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: regions.map((region, index) => ({
      '@type': 'ListItem',
      name: region.label,
      position: index + 1,
      url: new URL(`/areas/${region.slug}`, settings.web.canonicalOrigin).toString(),
    })),
    name: 'Speedy Van areas in Scotland',
  };

  return (
    <>
      <StructuredData data={jsonLd} />
      <section className="section page-hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <h1 className="page-title">{areaCoverageCopy.title}</h1>
            <p className="lead">{areaCoverageCopy.lead}</p>
          </div>
          <BookingStartCard title="Check your move" />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>{areaCoverageCopy.cities}</h2>
          <div className="location-directory">
            {citySlugs.map((slug) => {
              const city = locationsBySlug.get(slug);
              if (!city) return null;
              return (
                <section className="directory-group" key={city.slug}>
                  <h3>{city.name}</h3>
                  <div className="city-links">
                    {searchIntents.map((intent) => (
                      <Link href={localSearchTarget(intent.id, city)} key={intent.id}>
                        {intent.label} in {city.name}
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <h2>{areaCoverageCopy.regions}</h2>
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
          <h2>{areaCoverageCopy.allTowns}</h2>
          <div className="location-directory">
            {regions.map((region) => (
              <section className="directory-group" key={region.slug}>
                <h3>{regionLabels[region.slug]}</h3>
                <div className="city-links">
                  {locationPages
                    .filter((location) => location.region === region.slug)
                    .sort((left, right) => left.name.localeCompare(right.name, 'en-GB'))
                    .map((location) => (
                      <Link href={locationUrl(location)} key={location.slug}>
                        {location.name}
                      </Link>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <h2>{areaCoverageCopy.routes}</h2>
          <p>{areaCoverageCopy.routeLead}</p>
          <div className="city-links">
            {routePages.map((route) => (
              <Link href={routeUrl(route)} key={route.slug}>
                {route.fromName} to {route.toName} removals
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
