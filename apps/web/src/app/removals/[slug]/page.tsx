import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { StructuredData } from '@/components/marketing/structured-data';
import {
  breadcrumbJsonLd,
  examplePrice,
  isIndexableLocation,
  locationPages,
  locationUrl,
  locationsBySlug,
  nearestLocations,
  nearbyCities,
  regionLabels,
  routeDistanceFor,
  routeJsonLd,
  routePages,
  routeUrl,
  routesBySlug,
  serviceJsonLd,
} from '@/content/locations';
import { getPricingConfigForMarketing } from '@/server/marketing';
import { getPublicSettings } from '@/server/settings';

export const revalidate = 86400;

export function generateStaticParams(): Array<{ slug: string }> {
  return [...locationPages.map((location) => ({ slug: location.slug })), ...routePages.map((route) => ({ slug: route.slug }))];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [settings] = await Promise.all([getPublicSettings().catch(() => null)]);
  const indexTier3 = settings?.seo.indexTier3 ?? false;
  const location = locationsBySlug.get(slug);
  if (location) {
    const indexable = isIndexableLocation(location, indexTier3);
    return {
      alternates: { canonical: locationUrl(location) },
      description: `Fixed-price removals and man and van moves in ${location.name}, ${regionLabels[location.region]}. Check live slots online.`,
      robots: indexable ? undefined : { follow: true, index: false },
      title: `Removals in ${location.name}`,
    };
  }
  const route = routesBySlug.get(slug);
  if (route) {
    return {
      alternates: { canonical: routeUrl(route) },
      description: `Plan a ${route.fromName} to ${route.toName} removal with Speedy Van, including example distance, journey time and fixed online prices.`,
      title: `${route.fromName} to ${route.toName} removals`,
    };
  }
  return {};
}

export default async function RemovalSeoPage({ params }: { params: Promise<{ slug: string }> }): Promise<ReactNode> {
  const { slug } = await params;
  const route = routesBySlug.get(slug);
  if (route) return <RoutePage route={route} />;
  const location = locationsBySlug.get(slug);
  if (!location) notFound();
  const [settings, config] = await Promise.all([getPublicSettings(), getPricingConfigForMarketing()]);
  const distance = routeDistanceFor(location);
  const fromPrice = examplePrice(config, 'house-removals', distance.miles);
  const indexable = isIndexableLocation(location, settings.seo.indexTier3);
  const data = [
    serviceJsonLd(location, settings.web.canonicalOrigin),
    breadcrumbJsonLd([
      { href: '/', name: 'Home' },
      { href: '/areas', name: 'Areas' },
      { href: `/areas/${location.region}`, name: regionLabels[location.region] },
      { href: locationUrl(location), name: location.name },
    ]),
  ];
  const nearby = nearestLocations(location);
  const cities = nearbyCities(location);

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
              <span>/</span>
              <Link href={`/areas/${location.region}`}>{regionLabels[location.region]}</Link>
            </nav>
            <h1 className="page-title">Removals in {location.name}</h1>
            <p className="lead">Book a fixed-price move in {location.name}, with live morning, afternoon and evening slots across mainland Scotland.</p>
            <p className="price-line">From {fromPrice} <span>studio example, nearest city route</span></p>
          </div>
          <BookingStartCard selected="Home move" title={`Start a ${location.name} move`} />
        </div>
      </section>

      {!indexable ? (
        <section className="section section-muted">
          <div className="container">
            <p className="empty-note">This tier 3 page is available for users but marked noindex until local owner notes are added.</p>
          </div>
        </section>
      ) : null}

      <section className="section section-muted">
        <div className="container two-column">
          <div>
            <h2>Local move details</h2>
            <dl className="breakdown-list">
              <div><dt>Region</dt><dd>{regionLabels[location.region]}</dd></div>
              <div><dt>Example distance</dt><dd>{distance.miles} miles</dd></div>
              <div><dt>Example drive time</dt><dd>{distance.minutes} minutes</dd></div>
              <div><dt>Pricing</dt><dd>Distance, items, floors, carries and slot demand</dd></div>
            </dl>
          </div>
          <div className="table-card">
            <h2>Popular services</h2>
            <ul className="plain-list">
              <li>House removals in {location.name}</li>
              <li>Man and van in {location.name}</li>
              <li>Furniture delivery around {regionLabels[location.region]}</li>
              <li>Storage, student and office moves</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container two-column">
          <div>
            <h2>Nearby towns</h2>
            <div className="related-list">
              {nearby.map((item) => <Link href={locationUrl(item)} key={item.slug}>{item.name}</Link>)}
            </div>
          </div>
          <div>
            <h2>Nearby city pages</h2>
            <div className="related-list">
              {cities.map((city) => <Link href={`/man-and-van/${city.slug}`} key={city.slug}>Man and van {city.name}</Link>)}
            </div>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <h2>Questions</h2>
          <div className="accordion-list">
            <details className="accordion-item">
              <summary>Can I get an instant price in {location.name}?</summary>
              <p>Yes. Enter the addresses, access and items you are moving, then choose from the fixed slot prices shown online.</p>
            </details>
            <details className="accordion-item">
              <summary>What changes the price?</summary>
              <p>Distance, inventory, stairs, lift access, carry distance, optional helpers and the slot you choose all affect the fixed price.</p>
            </details>
          </div>
        </div>
      </section>
    </>
  );
}

async function RoutePage({ route }: { route: (typeof routePages)[number] }): Promise<ReactNode> {
  const [settings, config] = await Promise.all([getPublicSettings(), getPricingConfigForMarketing()]);
  const fromPrice = examplePrice(config, 'house-removals', route.distanceMiles);
  const origin = settings.web.canonicalOrigin;
  const data = [
    routeJsonLd(route, origin),
    breadcrumbJsonLd([
      { href: '/', name: 'Home' },
      { href: '/areas', name: 'Areas' },
      { href: routeUrl(route), name: `${route.fromName} to ${route.toName}` },
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
            <h1 className="page-title">{route.fromName} to {route.toName} removals</h1>
            <p className="lead">Plan a fixed-price move between {route.fromName} and {route.toName}, with online booking for eligible mainland Scotland routes.</p>
            <p className="price-line">From {fromPrice} <span>studio example, {route.distanceMiles} miles</span></p>
          </div>
          <BookingStartCard selected="Home move" title="Start this route" />
        </div>
      </section>

      <section className="section section-muted">
        <div className="container two-column">
          <div>
            <h2>Route snapshot</h2>
            <dl className="breakdown-list">
              <div><dt>From</dt><dd>{route.fromName}</dd></div>
              <div><dt>To</dt><dd>{route.toName}</dd></div>
              <div><dt>Estimated road distance</dt><dd>{route.distanceMiles} miles</dd></div>
              <div><dt>Estimated drive time</dt><dd>{route.minutes} minutes</dd></div>
            </dl>
          </div>
          <div className="table-card">
            <h2>Before you book</h2>
            <p>Add each bulky item, floor, lift and long-carry detail before revealing prices so the van plan matches the route.</p>
            <Link className="text-link" href={`/removals/${route.fromSlug}`}>See {route.fromName} local page</Link>
            <Link className="text-link" href={`/removals/${route.toSlug}`}>See {route.toName} local page</Link>
          </div>
        </div>
      </section>
    </>
  );
}
