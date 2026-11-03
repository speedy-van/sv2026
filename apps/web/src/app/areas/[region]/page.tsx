import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { StructuredData } from '@/components/marketing/structured-data';
import {
  areaCoverageCopy,
  groupLocationsByCouncil,
  regionalCoverageLead,
  routesFromLocations,
} from '@/content/area-coverage';
import {
  breadcrumbJsonLd,
  locationUrl,
  regionLabels,
  regionLocations,
  regions,
  routePages,
  routeUrl,
  type RegionSlug,
} from '@/content/locations';
import { createPageMetadata, getSeoSettings } from '@/server/seo';

export const revalidate = 86400;
export const dynamicParams = false;

export function generateStaticParams(): Array<{ region: string }> {
  return regions.map((region) => ({ region: region.slug }));
}

function isRegion(slug: string): slug is RegionSlug {
  return Object.hasOwn(regionLabels, slug);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ region: string }>;
}): Promise<Metadata> {
  const { region: slug } = await params;
  if (!isRegion(slug)) notFound();
  return createPageMetadata({
    description: `Speedy Van removal and man and van coverage in ${regionLabels[slug]}, with local pages for nearby towns and routes.`,
    path: `/areas/${slug}`,
    settings: await getSeoSettings(),
    title: `Removals in ${regionLabels[slug]}`,
  });
}

export default async function RegionPage({
  params,
}: {
  params: Promise<{ region: string }>;
}): Promise<ReactNode> {
  const { region: slug } = await params;
  if (!isRegion(slug)) notFound();
  const locations = regionLocations(slug);
  const councilGroups = groupLocationsByCouncil(locations);
  const regionalRoutes = routesFromLocations(locations, routePages);
  const ferryLocations = locations.filter((location) => location.ferry !== 'NO');
  const settings = await getSeoSettings();
  const breadcrumbs = breadcrumbJsonLd([
    { href: '/', name: 'Home' },
    { href: '/areas', name: 'Areas' },
    { href: `/areas/${slug}`, name: regionLabels[slug] },
  ]);

  return (
    <>
      <StructuredData data={breadcrumbs} />
      <StructuredData
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: locations.map((location, index) => ({
            '@type': 'ListItem',
            name: location.name,
            position: index + 1,
            url: new URL(locationUrl(location), settings.web.canonicalOrigin).toString(),
          })),
          name: `Removals in ${regionLabels[slug]}`,
        }}
      />
      <section className="section page-hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <nav aria-label="Breadcrumb" className="breadcrumbs">
              <Link href="/">Home</Link>
              <span>/</span>
              <Link href="/areas">Areas</Link>
            </nav>
            <h1 className="page-title">Removals in {regionLabels[slug]}</h1>
            <p className="lead">
              {regionalCoverageLead(
                regionLabels[slug],
                councilGroups.map((group) => group.councilArea),
              )}
            </p>
            {ferryLocations.length > 0 ? <p>{areaCoverageCopy.ferry}</p> : null}
          </div>
          <BookingStartCard title={`Start a ${regionLabels[slug]} move`} />
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <h2>{areaCoverageCopy.councilCoverage}</h2>
          <div className="location-directory">
            {councilGroups.map((group) => (
              <section className="directory-group" key={group.councilArea}>
                <h3>{group.councilArea}</h3>
                <div className="city-links">
                  {group.locations.map((location) => (
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

      {regionalRoutes.length > 0 ? (
        <section className="section">
          <div className="container">
            <h2>{areaCoverageCopy.routesInRegion}</h2>
            <div className="city-links">
              {regionalRoutes.map((route) => (
                <Link href={routeUrl(route)} key={route.slug}>
                  {route.fromName} to {route.toName} removals
                </Link>
              ))}
            </div>
            <Link className="text-link" href="/areas">{areaCoverageCopy.allAreas}</Link>
          </div>
        </section>
      ) : null}
    </>
  );
}
