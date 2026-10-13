import { Receipt } from 'lucide-react';
import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { serviceContent } from '@/content/services';
import { services as navServices } from '@/content/navigation';
import { formatFromPrice, getFromPrices } from '@/server/marketing';

export const revalidate = 86400;

export const metadata: Metadata = {
  alternates: { canonical: '/services' },
  description: 'Removal, man and van, furniture, storage, student, office, rubbish, piano and same-day services across Scotland.',
  title: 'Our services',
};

export default async function ServicesPage(): Promise<ReactNode> {
  const fromPrices = await getFromPrices();
  return (
    <section className="section page-hero">
      <div className="container">
        <h1 className="page-title">Our services</h1>
        <p className="lead">Choose the move type that matches what you are moving. Every instant-price service uses the same server pricing engine.</p>
        <div className="service-list">
          {serviceContent.map((service) => {
            const nav = navServices.find((item) => item.href === `/services/${service.slug}`);
            const Icon = nav?.icon ?? Receipt;
            const price = fromPrices.get(service.slug);
            return (
              <Link className="service-row" href={`/services/${service.slug}`} key={service.slug}>
                <Icon aria-hidden="true" color="#6D3BD7" size={24} />
                <span>
                  <strong>{service.label}</strong>
                  <small>{service.lead}</small>
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
