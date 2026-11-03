import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { LocalMovePlanning } from '@/components/marketing/local-move-planning';
import { StructuredData } from '@/components/marketing/structured-data';
import { areaCoverageCopy, cityPriceQuestion, localAreaDescription } from '@/content/area-coverage';
import { localSearchTarget } from '@/content/keyword-targets';
import { cityManAndVanCopy } from '@/content/location-copy';
import {
  breadcrumbJsonLd,
  citySlugs,
  cityUrl,
  isCitySlug,
  locationsBySlug,
  nearestLocations,
  regionLabels,
  serviceJsonLd,
} from '@/content/locations';
import { serviceBySlug } from '@/content/services';
import { getPublishedLocationContent } from '@/server/location-content';
import { formatFromPrice, getLocationExamplePrice } from '@/server/marketing';
import { getPublicSettings } from '@/server/settings';
import { createPageMetadata } from '@/server/seo';

export const revalidate = 86400;
export const dynamicParams = false;

export function generateStaticParams(): Array<{ city: string }> {
  return citySlugs.map((city) => ({ city }));
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params;
  const location = locationsBySlug.get(city);
  if (!isCitySlug(city) || !location) notFound();
  const copy = cityManAndVanCopy(location);
  return createPageMetadata({
    description: copy.description,
    path: cityUrl(location),
    settings: await getPublicSettings(),
    title: copy.title,
  });
}

export default async function CityManAndVanPage({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<ReactNode> {
  const { city } = await params;
  const location = locationsBySlug.get(city);
  if (!isCitySlug(city) || !location) notFound();
  const [settings, fromPrice, localContent] = await Promise.all([
    getPublicSettings(),
    getLocationExamplePrice(location, 'man-and-van'),
    getPublishedLocationContent(city),
  ]);
  const service = serviceBySlug('man-and-van');
  const copy = cityManAndVanCopy(location);
  const faqs = [
    cityPriceQuestion(location.name, formatFromPrice(fromPrice), fromPrice.label, fromPrice.pence !== null),
    ...(service?.faqs.slice(1) ?? []),
  ];
  const data = [
    serviceJsonLd(location, settings.web.canonicalOrigin, 'man-and-van'),
    breadcrumbJsonLd([
      { href: '/', name: 'Home' },
      { href: '/areas', name: 'Areas' },
      { href: cityUrl(location), name: copy.title },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        name: faq.question,
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
            </nav>
            <h1 className="page-title">{copy.title}</h1>
            <p className="lead">{copy.lead}</p>
            <p className="price-line">
              {formatFromPrice(fromPrice)} {fromPrice.pence !== null ? <span>{fromPrice.label}</span> : null}
            </p>
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
            <p>{localAreaDescription(location)}</p>
            <Link className="text-link" href={localSearchTarget('house-removals', location)}>
              House removals in {location.name}
            </Link>
          </div>
        </div>
      </section>

      <LocalMovePlanning location={location} purpose="man-and-van" />

      {localContent ? (
        <section className="section">
          <div className="container article-body">
            <h2>{areaCoverageCopy.localNotes}</h2>
            {localContent.localNotes.split(/\n\s*\n/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="container">
          <h2>Nearby man and van areas</h2>
          <div className="region-grid">
            {nearestLocations(location, 6).map((nearby) => (
              <Link href={localSearchTarget('man-and-van', nearby)} key={nearby.slug}>
                <strong>{cityManAndVanCopy(nearby).title}</strong>
                <span>{regionLabels[nearby.region]}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <h2>Man and van questions in {location.name}</h2>
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
