import { Receipt } from 'lucide-react';
import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { StructuredData } from '@/components/marketing/structured-data';
import { cityMarketingLinks } from '@/content/marketing';
import { services as navServices } from '@/content/navigation';
import { serviceBySlug, serviceContent } from '@/content/services';
import { formatFromPrice, getFromPrices } from '@/server/marketing';
import { getPublicSettings } from '@/server/settings';

export const revalidate = 86400;

export function generateStaticParams(): Array<{ service: string }> {
  return serviceContent.map((service) => ({ service: service.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ service: string }> }): Promise<Metadata> {
  const { service: slug } = await params;
  const service = serviceBySlug(slug);
  if (!service) return {};
  return {
    alternates: { canonical: `/services/${service.slug}` },
    description: service.lead,
    title: `${service.label} in Scotland`,
  };
}

function selectedChip(slug: string): 'Furniture' | 'Home move' | 'Man and van' | 'Rubbish' {
  if (slug === 'furniture-delivery') return 'Furniture';
  if (slug === 'rubbish-removal') return 'Rubbish';
  if (slug === 'house-removals') return 'Home move';
  return 'Man and van';
}

export default async function ServicePage({ params }: { params: Promise<{ service: string }> }): Promise<ReactNode> {
  const { service: slug } = await params;
  const service = serviceBySlug(slug);
  if (!service) notFound();
  const [settings, fromPrices] = await Promise.all([getPublicSettings(), getFromPrices()]);
  const nav = navServices.find((item) => item.href === `/services/${service.slug}`);
  const Icon = nav?.icon ?? Receipt;
  const price = fromPrices.get(service.slug);
  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    areaServed: 'Scotland',
    name: `${service.label} in Scotland`,
    provider: {
      '@type': 'Organization',
      name: settings.company.tradingName,
      ...(settings.web.canonicalOrigin ? { url: settings.web.canonicalOrigin } : {}),
    },
  };
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', item: '/', name: 'Home', position: 1 },
      { '@type': 'ListItem', item: '/services', name: 'Services', position: 2 },
      { '@type': 'ListItem', item: `/services/${service.slug}`, name: service.label, position: 3 },
    ],
  };
  const faqJson = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: service.faqs.map((faq) => ({
      '@type': 'Question',
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      name: faq.question,
    })),
  };

  return (
    <>
      <StructuredData data={[serviceJsonLd, breadcrumbs, faqJson]} />
      <section className="section page-hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <nav aria-label="Breadcrumb" className="breadcrumbs">
              <Link href="/">Home</Link>
              <span>/</span>
              <Link href="/services">Services</Link>
            </nav>
            <Icon aria-hidden="true" color="#6D3BD7" size={34} />
            <h1 className="page-title">{service.label} in Scotland</h1>
            <p className="lead">{service.lead}</p>
            <p className="price-line">{price ? formatFromPrice(price) : 'Price shown in booking'} <span>{service.profileLabel}</span></p>
          </div>
          <BookingStartCard selected={selectedChip(service.slug)} title={`Start ${service.label.toLowerCase()}`} />
        </div>
      </section>

      <section className="section section-muted">
        <div className="container two-column">
          <div>
            <h2>What's included</h2>
            <ul className="check-list">
              {service.included.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="table-card">
            <h2>Price for this service</h2>
            <p>{price ? formatFromPrice(price) : 'Price shown in booking'} for {service.profileLabel.toLowerCase()}.</p>
            <p className="field-help">The final price is computed from distance, inventory, access, optional extras and the slot you choose.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container two-column">
          <div>
            <h2>Options</h2>
            <ul className="plain-list">
              {service.options.map((option) => <li key={option}>{option}</li>)}
            </ul>
          </div>
          <div>
            <h2>Good to know</h2>
            <ul className="plain-list">
              {service.goodToKnow.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <h2>Areas</h2>
          <p className="lead">The instant-price flow covers mainland Scotland. These city pages are part of the wider area directory.</p>
          <div className="city-links">
            {cityMarketingLinks.map((city) => <Link href={city.href} key={city.href}>{city.label}</Link>)}
          </div>
          <Link className="text-link" href="/areas">All areas</Link>
        </div>
      </section>

      <section className="section">
        <div className="container two-column">
          <div>
            <h2>Questions</h2>
            <div className="accordion-list">
              {service.faqs.map((faq) => (
                <details className="accordion-item" key={faq.question}>
                  <summary>{faq.question}</summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
          <div>
            <h2>Related services</h2>
            <div className="related-list">
              {service.related.map((slug) => {
                const related = serviceBySlug(slug);
                return related ? <Link href={`/services/${related.slug}`} key={related.slug}>{related.label}</Link> : null;
              })}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
