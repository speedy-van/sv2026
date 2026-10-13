import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { StructuredData } from '@/components/marketing/structured-data';
import {
  breadcrumbJsonLd,
  citySlugs,
  cityUrl,
  examplePrice,
  locationUrl,
  locationsBySlug,
  nearestLocations,
  regionLabels,
  routeDistanceFor,
  serviceJsonLd,
} from '@/content/locations';
import { getPricingConfigForMarketing } from '@/server/marketing';
import { getPublicSettings } from '@/server/settings';

export const revalidate = 86400;

export function generateStaticParams(): Array<{ city: string }> {
  return citySlugs.map((city) => ({ city }));
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params;
  const location = locationsBySlug.get(city);
  if (!location) return {};
  return {
    alternates: { canonical: cityUrl(location) },
    description: `Book man and van in ${location.name} with fixed online prices for small moves, single items and student jobs.`,
    title: `Man and van ${location.name}`,
  };
}

export default async function CityManAndVanPage({ params }: { params: Promise<{ city: string }> }): Promise<ReactNode> {
  const { city } = await params;
  const location = locationsBySlug.get(city);
  if (!location) notFound();
  const [settings, config] = await Promise.all([getPublicSettings(), getPricingConfigForMarketing()]);
  const distance = routeDistanceFor(location);
  const fromPrice = examplePrice(config, 'man-and-van', Math.max(3, Math.min(distance.miles, 12)));
  const data = [
    serviceJsonLd(location, settings.web.canonicalOrigin, 'man-and-van'),
    breadcrumbJsonLd([
      { href: '/', name: 'Home' },
      { href: '/areas', name: 'Areas' },
      { href: cityUrl(location), name: `Man and van ${location.name}` },
    ]),
  ];

  return (
    <>
      <StructuredData data={data} />
      <section className="section page-hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <nav aria-label="Breadcrumb" className="breadcrumbs">
              <Link href="/">Home</Link>
              <span>/</span>
              <Link href="/areas">Areas</Link>
            </nav>
            <h1 className="page-title">Man and van {location.name}</h1>
            <p className="lead">Book small moves, single-item transport and student moves in {location.name} with live fixed slot prices.</p>
            <p className="price-line">From {fromPrice} <span>one-item example, ground floor</span></p>
          </div>
          <BookingStartCard selected="Man and van" title={`Start a ${location.name} job`} />
        </div>
      </section>

      <section className="section section-muted">
        <div className="container two-column">
          <div>
            <h2>Good for</h2>
            <ul className="check-list">
              <li>Small flat and room moves</li>
              <li>Single sofas, beds, desks and bulky items</li>
              <li>Student moves and storage runs</li>
              <li>Same-day jobs when a slot is available</li>
            </ul>
          </div>
          <div className="table-card">
            <h2>Local area</h2>
            <p>{location.name} sits in {regionLabels[location.region]}. Prices use your exact addresses, items and access details.</p>
            <Link className="text-link" href={locationUrl(location)}>See removals in {location.name}</Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Nearby man and van areas</h2>
          <div className="region-grid">
            {nearestLocations(location, 6).map((nearby) => (
              <Link href={locationUrl(nearby)} key={nearby.slug}>
                <strong>{nearby.name}</strong>
                <span>{regionLabels[nearby.region]}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
