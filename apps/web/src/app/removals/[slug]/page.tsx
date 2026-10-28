import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { LocalMovePlanning } from '@/components/marketing/local-move-planning';
import { LocalSearchServices } from '@/components/marketing/local-search-services';
import { StructuredData } from '@/components/marketing/structured-data';
import {
  locationCopy,
  locationFaqs,
  locationPageCopy,
  locationSearchHeading,
  locationSearchTitle,
} from '@/content/location-copy';
import {
  breadcrumbJsonLd,
  isCitySlug,
  isIndexableLocation,
  locationPages,
  locationUrl,
  locationsBySlug,
  nearestLocations,
  nearbyCities,
  regionLabels,
  routeJsonLd,
  routePages,
  routeUrl,
  routesBySlug,
  serviceJsonLd,
} from '@/content/locations';
import { serviceContent } from '@/content/services';
import { getLocationExamples, getRouteExamples, todayLabel } from '@/server/marketing';
import { getPublishedLocationContent } from '@/server/location-content';
import { createPageMetadata, getSeoSettings } from '@/server/seo';

export const revalidate = 86400;

export function generateStaticParams(): Array<{ slug: string }> {
  return [
    ...locationPages.map((location) => ({ slug: location.slug })),
    ...routePages.map((route) => ({ slug: route.slug })),
  ];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const settings = await getSeoSettings();
  const location = locationsBySlug.get(slug);
  if (location) {
    const published = await getPublishedLocationContent(slug);
    return createPageMetadata({
      path: locationUrl(location),
      description: locationCopy(location).description,
      title: locationSearchTitle(location),
      settings,
      indexable: isIndexableLocation(location, settings.seo.indexTier3, published?.localNotes),
    });
  }
  const route = routesBySlug.get(slug);
  if (route)
    return createPageMetadata({
      path: routeUrl(route),
      description: `Plan a ${route.fromName} to ${route.toName} move with road distance, drive time and available prices for different move sizes.`,
      title: `${route.fromName} to ${route.toName} removals`,
      settings,
    });
  notFound();
}

export default async function RemovalSeoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<ReactNode> {
  const { slug } = await params;
  const route = routesBySlug.get(slug);
  if (route) return <RemovalRoutePage route={route} />;
  const location = locationsBySlug.get(slug);
  if (!location) notFound();
  const [settings, published, examples] = await Promise.all([
    getSeoSettings(),
    getPublishedLocationContent(slug),
    getLocationExamples(location),
  ]);
  const copy = locationCopy(location);
  const nearby = nearestLocations(location);
  const cities = nearbyCities(location);
  const cityLinks = isCitySlug(location.slug)
    ? [location, ...cities.filter((city) => city.slug !== location.slug)]
    : cities;
  const localRoutes = routePages.filter(
    (candidate) => candidate.fromSlug === location.slug || candidate.toSlug === location.slug,
  );
  const faqs = locationFaqs(location, examples[0]?.price);
  const data = [
    serviceJsonLd(location, settings.web.canonicalOrigin),
    breadcrumbJsonLd([
      { href: '/', name: 'Home' },
      { href: '/areas', name: 'Areas' },
      { href: `/areas/${location.region}`, name: regionLabels[location.region] },
      { href: locationUrl(location), name: location.name },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    },
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
              <span>/</span>
              <Link href={`/areas/${location.region}`}>{regionLabels[location.region]}</Link>
            </nav>
            <h1 className="page-title">{locationSearchHeading(location)}</h1>
            <p className="lead">{copy.lead}</p>
            <p className="field-help">
              {location.councilArea} · {location.postcodeArea} postcode area
            </p>
          </div>
          {copy.routeNote ? (
            <div className="table-card">
              <p>{copy.routeNote}</p>
              <Link className="button button-primary" href="/contact">
                {copy.quoteAction}
              </Link>
            </div>
          ) : (
            <BookingStartCard selected="Home move" title={`Start a ${location.name} move`} />
          )}
        </div>
      </section>
      {examples.length > 0 ? (
        <section className="section section-muted">
          <div className="container">
            <h2>Example moves in {location.name}</h2>
            <table className="data-table">
              <caption>
                {locationPageCopy.exampleCaption} Updated {todayLabel()}.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th scope="col">Move</th>
                  <th scope="col">Example price</th>
                </tr>
              </thead>
              <tbody>
                {examples.map((example) => (
                  <tr key={example.detail}>
                    <td>
                      {example.route}, {example.distanceMiles} miles
                    </td>
                    <td>{example.detail}</td>
                    <td>{example.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <LocalMovePlanning location={location} />
      {published ? (
        <section className="section section-muted">
          <div className="container article-body">
            <h2>Moving in {location.name}</h2>
            {published.localNotes.split(/\n\s*\n/u).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>
      ) : null}
      <LocalSearchServices location={location} />
      <section className="section">
        <div className="container two-column">
          <div>
            <h2>Services in {location.name}</h2>
            <div className="related-list">
              {serviceContent.map((service) => (
                <Link href={`/services/${service.slug}`} key={service.slug}>
                  {service.title}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <h2>Nearby towns</h2>
            <div className="related-list">
              {nearby.map((item) => (
                <Link href={locationUrl(item)} key={item.slug}>
                  {item.name}
                </Link>
              ))}
            </div>
            <Link className="text-link" href={`/areas/${location.region}`}>
              All areas in {regionLabels[location.region]}
            </Link>
          </div>
        </div>
      </section>
      <section className="section section-muted">
        <div className="container">
          <h2>City man and van services</h2>
          <div className="related-list">
            {cityLinks.map((city) => (
              <Link href={`/man-and-van/${city.slug}`} key={city.slug}>
                Man and van in {city.name}
              </Link>
            ))}
          </div>
          {localRoutes.length > 0 ? (
            <>
              <h2>Routes involving {location.name}</h2>
              <div className="related-list">
                {localRoutes.map((item) => (
                  <Link href={routeUrl(item)} key={item.slug}>
                    {item.fromName} to {item.toName} removals
                  </Link>
                ))}
              </div>
            </>
          ) : null}
          <Link className="text-link" href="/areas">
            All areas and removal routes
          </Link>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <h2>Questions about moving in {location.name}</h2>
          <div className="accordion-list">
            {faqs.map((faq) => (
              <details className="accordion-item" key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

async function RemovalRoutePage({ route }: { route: (typeof routePages)[number] }): Promise<ReactNode> {
  const [settings, destinationNotes, examples] = await Promise.all([
    getSeoSettings(),
    getPublishedLocationContent(route.toSlug),
    getRouteExamples(route),
  ]);
  const destination = locationsBySlug.get(route.toSlug);
  const reverse = routesBySlug.get(`${route.toSlug}-to-${route.fromSlug}`);
  const otherRoutes = routePages.filter(
    (candidate) => candidate.fromSlug === route.fromSlug && candidate.slug !== route.slug,
  );
  const data = [
    routeJsonLd(route, settings.web.canonicalOrigin),
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
              <Link href="/areas">Areas and routes</Link>
            </nav>
            <h1 className="page-title">
              {route.fromName} to {route.toName} removals
            </h1>
            <p className="lead">
              Compare example move sizes for the journey from {route.fromName} to {route.toName}, then check
              the available prices for your exact addresses.
            </p>
            <p>
              {route.distanceMiles} miles, about {route.minutes} minutes by road.
            </p>
          </div>
          <BookingStartCard selected="Home move" title="Start this route" />
        </div>
      </section>
      <section className="section section-muted">
        <div className="container">
          <h2>
            Example prices for {route.fromName} to {route.toName}
          </h2>
          <table className="data-table">
            <caption>
              {locationPageCopy.routeCaption} Updated {todayLabel()}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Move profile</th>
                <th scope="col">Example price</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((example) => (
                <tr key={example.detail}>
                  <td>{example.detail}</td>
                  <td>{example.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="section">
        <div className="container two-column">
          <div>
            <h2>Arriving in {route.toName}</h2>
            {destination ? (
              <p>
                {route.toName} is in {destination.councilArea}, in the {destination.postcodeArea} postcode
                area.
              </p>
            ) : null}
            {destinationNotes
              ? destinationNotes.localNotes
                  .split(/\n\s*\n/u)
                  .map((paragraph) => <p key={paragraph}>{paragraph}</p>)
              : null}
            <Link className="text-link" href={`/removals/${route.toSlug}`}>
              House removals in {route.toName}
            </Link>
          </div>
          <div>
            <h2>Before you book</h2>
            <p>{locationPageCopy.routePreparation}</p>
            <Link className="text-link" href={`/removals/${route.fromSlug}`}>
              House removals in {route.fromName}
            </Link>
            <Link className="text-link" href="/pricing">
              How removal prices are worked out
            </Link>
          </div>
        </div>
      </section>
      <section className="section section-muted">
        <div className="container">
          {reverse ? (
            <p>
              <Link className="text-link" href={routeUrl(reverse)}>
                Moving back? {reverse.fromName} to {reverse.toName} removals
              </Link>
            </p>
          ) : null}
          {otherRoutes.length > 0 ? (
            <>
              <h2>Other routes from {route.fromName}</h2>
              <div className="related-list">
                {otherRoutes.map((item) => (
                  <Link href={routeUrl(item)} key={item.slug}>
                    {item.fromName} to {item.toName} removals
                  </Link>
                ))}
              </div>
            </>
          ) : null}
          <Link className="text-link" href="/areas">
            All removal routes and areas
          </Link>
        </div>
      </section>
    </>
  );
}
