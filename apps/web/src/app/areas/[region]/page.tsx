import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { StructuredData } from '@/components/marketing/structured-data';
import { breadcrumbJsonLd, locationUrl, regionLabels, regionLocations, regions, type RegionSlug } from '@/content/locations';

export const revalidate = 86400;

export function generateStaticParams(): Array<{ region: string }> {
  return regions.map((region) => ({ region: region.slug }));
}

function isRegion(slug: string): slug is RegionSlug {
  return slug in regionLabels;
}

export async function generateMetadata({ params }: { params: Promise<{ region: string }> }): Promise<Metadata> {
  const { region: slug } = await params;
  if (!isRegion(slug)) return {};
  return {
    alternates: { canonical: `/areas/${slug}` },
    description: `Speedy Van removal and man and van coverage in ${regionLabels[slug]}, with local pages for nearby towns and routes.`,
    title: `Removals in ${regionLabels[slug]}`,
  };
}

export default async function RegionPage({ params }: { params: Promise<{ region: string }> }): Promise<ReactNode> {
  const { region: slug } = await params;
  if (!isRegion(slug)) notFound();
  const locations = regionLocations(slug);
  const breadcrumbs = breadcrumbJsonLd([
    { href: '/', name: 'Home' },
    { href: '/areas', name: 'Areas' },
    { href: `/areas/${slug}`, name: regionLabels[slug] },
  ]);

  return (
    <>
      <StructuredData data={breadcrumbs} />
      <section className="section page-hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <nav aria-label="Breadcrumb" className="breadcrumbs">
              <Link href="/">Home</Link>
              <span>/</span>
              <Link href="/areas">Areas</Link>
            </nav>
            <h1 className="page-title">Removals in {regionLabels[slug]}</h1>
            <p className="lead">Browse local removal, man and van and furniture routes covered by Speedy Van in this part of Scotland.</p>
          </div>
          <BookingStartCard title={`Start a ${regionLabels[slug]} move`} />
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <h2>Towns and cities</h2>
          <div className="region-grid">
            {locations.map((location) => (
              <Link href={locationUrl(location)} key={location.slug}>
                <strong>{location.name}</strong>
                <span>Tier {location.tier} coverage page</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
