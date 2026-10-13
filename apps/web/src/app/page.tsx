import { CalendarDays, CreditCard, MapPin, Receipt } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { StructuredData } from '@/components/marketing/structured-data';
import { ScotlandRouteMap } from '@/components/maps/scotland-route-map';
import { cityMarketingLinks, howItWorksSteps, regionLinks } from '@/content/marketing';
import { serviceContent } from '@/content/services';
import { services as navServices } from '@/content/navigation';
import { formatFromPrice, getExampleRoutes, getFromPrices, getRenderedFaqs, getReviewSummary, getWorkedExample, todayLabel } from '@/server/marketing';
import { getPublicSettings } from '@/server/settings';

export const revalidate = 86400;

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  description: 'See fixed prices for every day of the next four weeks and book removals or man and van moves online.',
  title: 'Removals and man and van across Scotland',
};

const proofItems = [
  { icon: Receipt, text: 'Fixed price shown before you pay' },
  { icon: CalendarDays, text: 'Prices for every slot over four weeks - cheapest days highlighted' },
  { icon: MapPin, text: 'Live van tracking on moving day' },
  { icon: CreditCard, text: 'Card, Apple Pay or Google Pay, processed by Stripe' },
];

export default async function HomePage(): Promise<ReactNode> {
  const [settings, fromPrices, workedExample, exampleRoutes, faqs, reviews] = await Promise.all([
    getPublicSettings(),
    getFromPrices(),
    getWorkedExample(),
    getExampleRoutes(),
    getRenderedFaqs(8),
    getReviewSummary(),
  ]);
  const visibleReviews = reviews.count >= 3;
  const faqJson = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      name: faq.question,
    })),
  };

  return (
    <>
      <StructuredData data={faqJson} />
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <h1>Removals and man and van across Scotland</h1>
            <p>See fixed prices for every day of the next four weeks and book online in a few minutes.</p>
            <BookingStartCard />
            <p className="field-help">Mainland Scotland is priced instantly. Ferry routes are priced by our team.</p>
          </div>
          <ScotlandRouteMap />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>What you get</h2>
          <div className="proof-grid">
            {proofItems.map((item) => {
              const Icon = item.icon;
              return (
                <article className="proof-item" key={item.text}>
                  <Icon aria-hidden="true" color="#6D3BD7" size={26} />
                  <h3>{item.text}</h3>
                </article>
              );
            })}
            {settings.insurance.goodsInTransitCoverPence ? (
              <article className="proof-item">
                <Receipt aria-hidden="true" color="#6D3BD7" size={26} />
                <h3>Goods in transit cover shown before launch</h3>
              </article>
            ) : null}
            {settings.trust.yearsTrading ? (
              <article className="proof-item">
                <CalendarDays aria-hidden="true" color="#6D3BD7" size={26} />
                <h3>{settings.trust.yearsTrading} years moving Scotland</h3>
              </article>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <h2>How it works</h2>
          <ol className="step-list">
            {howItWorksSteps.map((step, index) => (
              <li key={step.title}>
                <span>{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
          <Link className="text-link" href="/how-it-works">
            More about how it works
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Services</h2>
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
                    <small>{service.summary}</small>
                  </span>
                  <em>{price ? formatFromPrice(price) : 'Price in booking'}</em>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container two-column">
          <div>
            <h2>How your price is worked out</h2>
            <p className="lead">Your price is built from things you can see: distance, floors, how much you're moving, access, and the day you choose.</p>
            <Link className="text-link" href="/pricing">
              See every rate
            </Link>
          </div>
          <div className="table-card">
            <h3>Example: 1-bedroom flat, 8 miles, 2nd floor with no lift, weekday afternoon</h3>
            <dl className="breakdown-list">
              {workedExample.breakdown.map((line) => (
                <div key={line.label}>
                  <dt>{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
              <div>
                <dt>Total example</dt>
                <dd>{workedExample.total}</dd>
              </div>
            </dl>
            <p className="field-help">Generated from the active pricing config on {workedExample.dateLabel}.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container coverage-block">
          <h2>Areas we cover</h2>
          <p className="lead">Mainland Scotland is priced instantly. Island moves that need a ferry are priced by our team.</p>
          <div className="city-links">
            {cityMarketingLinks.map((city) => (
              <Link href={city.href} key={city.href}>{city.label}</Link>
            ))}
          </div>
          <div className="region-grid">
            {regionLinks.map((region) => (
              <Link href={region.href} key={region.href}>
                <strong>{region.label}</strong>
                <span>{region.count} towns</span>
              </Link>
            ))}
          </div>
          <Link className="text-link" href="/areas">
            All areas
          </Link>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <h2>Real example prices</h2>
          <table className="data-table">
            <caption>Cheapest available weekday slot when this page was updated on {todayLabel()}. Your price depends on your items, access and date.</caption>
            <thead>
              <tr>
                <th scope="col">Route</th>
                <th scope="col">Move</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {exampleRoutes.map((route) => (
                <tr key={`${route.route}-${route.detail}`}>
                  <td>{route.route}</td>
                  <td>{route.detail}</td>
                  <td>{route.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {visibleReviews ? (
        <section className="section">
          <div className="container">
            <h2>Reviews</h2>
            <p className="lead">{reviews.average?.toFixed(1)} average from {reviews.count} verified booking reviews.</p>
            <div className="review-grid">
              {reviews.reviews.slice(0, 3).map((review) => (
                <article className="review-card" key={`${review.displayName}-${review.date}`}>
                  <strong>{review.displayName}</strong>
                  <p>{review.comment}</p>
                  <small>{review.town ? `${review.town} - ` : ''}{review.date} - Verified booking</small>
                </article>
              ))}
            </div>
            <Link className="text-link" href="/reviews">Read all reviews</Link>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="container">
          <h2>Questions</h2>
          <div className="accordion-list">
            {faqs.map((faq) => (
              <details className="accordion-item" key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
          <Link className="text-link" href="/help">
            More answers
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="container state-grid">
          <div>
            <h2>Ready when you are</h2>
            <p className="lead">Start with addresses and the things you are moving. The booking flow shows the fixed price before you pay.</p>
          </div>
          <BookingStartCard title="Ready when you are" />
        </div>
      </section>
    </>
  );
}
