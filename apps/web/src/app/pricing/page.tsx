import { formatGBP, poundsToPence } from '@sv/contracts';
import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { pricingPageCopy } from '@/content/pricing';
import { getPricingConfigForMarketing, getRenderedFaqs, getWorkedExample } from '@/server/marketing';
import { createPageMetadata, getSeoSettings } from '@/server/seo';

export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  return createPageMetadata({
    path: '/pricing',
    settings: await getSeoSettings(),
    description: pricingPageCopy.description,
    title: pricingPageCopy.title,
  });
}

function moneyFromPounds(value: number): string {
  return formatGBP(poundsToPence(value));
}

export default async function PricingPage(): Promise<ReactNode> {
  const [config, example, faqs] = await Promise.all([
    getPricingConfigForMarketing(),
    getWorkedExample(),
    getRenderedFaqs(6),
  ]);
  const serviceRows = Object.entries(config.services).map(([key, service]) => ({
    key,
    label: service.label,
    price: moneyFromPounds(service.basePrice),
  }));
  return (
    <>
      <section className="section page-hero">
        <div className="container two-column">
          <div>
            <h1 className="page-title">{pricingPageCopy.title}</h1>
            <p className="lead">{pricingPageCopy.lead}</p>
            <Link className="button button-primary" href="/book">
              See my prices
            </Link>
          </div>
          <BookingStartCard title="Price your move" />
        </div>
      </section>
      <section className="section section-muted">
        <div className="container">
          <h2>Base prices</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Base price</th>
              </tr>
            </thead>
            <tbody>
              {serviceRows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{row.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="section">
        <div className="container two-column">
          <div className="table-card">
            <h2>Factors</h2>
            <dl className="breakdown-list">
              <div>
                <dt>Distance</dt>
                <dd>
                  {config.distance.freeMiles} miles included, then {moneyFromPounds(config.distance.perMile)}{' '}
                  per mile
                </dd>
              </div>
              <div>
                <dt>Floors</dt>
                <dd>{moneyFromPounds(config.floors.perFloor)} per floor, multiplied when there is no lift</dd>
              </div>
              <div>
                <dt>Inventory</dt>
                <dd>
                  {moneyFromPounds(config.inventory.perItem)} per item and{' '}
                  {moneyFromPounds(config.inventory.perM3)} per m3
                </dd>
              </div>
              <div>
                <dt>Carry distance</dt>
                <dd>
                  {config.access.freeCarryMetres} m included, then{' '}
                  {moneyFromPounds(config.access.perMetreAfterFree)} per metre
                </dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>
                  {moneyFromPounds(config.access.narrowAccess)} narrow access,{' '}
                  {moneyFromPounds(config.access.permitZone)} permit zone
                </dd>
              </div>
              <div>
                <dt>Extras</dt>
                <dd>
                  {moneyFromPounds(config.addons.packing)} packing, {moneyFromPounds(config.addons.assembly)}{' '}
                  assembly, {moneyFromPounds(config.addons.helper)} per helper
                </dd>
              </div>
            </dl>
          </div>
          <div className="table-card">
            <h2>Date and time</h2>
            <dl className="breakdown-list">
              <div>
                <dt>Today</dt>
                <dd>+{Math.round((config.multipliers.urgency.dayOffset0 - 1) * 100)}%</dd>
              </div>
              <div>
                <dt>Tomorrow</dt>
                <dd>+{Math.round((config.multipliers.urgency.dayOffset1 - 1) * 100)}%</dd>
              </div>
              <div>
                <dt>Day after tomorrow</dt>
                <dd>+{Math.round((config.multipliers.urgency.dayOffset2 - 1) * 100)}%</dd>
              </div>
              <div>
                <dt>Weekend</dt>
                <dd>+{Math.round((config.multipliers.weekend - 1) * 100)}%</dd>
              </div>
              <div>
                <dt>Peak months</dt>
                <dd>+{Math.round((config.multipliers.peakMonth - 1) * 100)}%</dd>
              </div>
              <div>
                <dt>Last {config.multipliers.endOfMonthLastDays} days</dt>
                <dd>+{Math.round((config.multipliers.endOfMonth - 1) * 100)}%</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
      <section className="section section-muted">
        <div className="container two-column">
          <div>
            <h2>Worked example</h2>
            <p className="lead">1-bedroom flat, 8 miles, 2nd floor with no lift, weekday afternoon.</p>
          </div>
          <div className="table-card">
            <dl className="breakdown-list">
              {example.breakdown.map((line) => (
                <div key={line.label}>
                  <dt>{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
              <div>
                <dt>Total example</dt>
                <dd>{example.total}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <h2>Pricing questions</h2>
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
