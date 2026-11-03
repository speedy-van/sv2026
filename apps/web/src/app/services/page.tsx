import { Receipt } from 'lucide-react';
import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { serviceDirectoryCopy } from '@/content/marketing';
import { serviceLandingPages, type ServiceContent } from '@/content/services';
import { services as navServices } from '@/content/navigation';
import { formatFromPrice, getFromPrices } from '@/server/marketing';
import { createPageMetadata, getSeoSettings } from '@/server/seo';

export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  return createPageMetadata({
    path: '/services',
    description: serviceDirectoryCopy.description,
    title: serviceDirectoryCopy.title,
    settings: await getSeoSettings(),
  });
}

export default async function ServicesPage(): Promise<ReactNode> {
  const fromPrices = await getFromPrices();
  return (
    <section className="section page-hero">
      <div className="container">
        <h1 className="page-title">{serviceDirectoryCopy.title}</h1>
        <p className="lead">{serviceDirectoryCopy.lead}</p>
        <div className="service-list">
          {serviceLandingPages.map((service: ServiceContent) => {
            const nav = navServices.find((item) => item.href === `/services/${service.slug}`);
            const Icon = nav?.icon ?? Receipt;
            const price = fromPrices.get(service.priceSourceSlug ?? service.slug);
            return (
              <Link className="service-row" href={`/services/${service.slug}`} key={service.slug}>
                <Icon aria-hidden="true" color="#6D3BD7" size={24} />
                <span>
                  <strong>{service.label}</strong>
                  <small>{service.summary}</small>
                </span>
                <em>{price ? formatFromPrice(price) : 'Price in booking'}</em>
              </Link>
            );
          })}
        </div>
        <div className="section-inline-card">
          <BookingStartCard title="Start a quote" />
        </div>
      </div>
    </section>
  );
}
