import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FaqSearch } from '@/components/marketing/faq-search';
import { StructuredData } from '@/components/marketing/structured-data';
import { getRenderedFaqs } from '@/server/marketing';
import { getPublicSettings } from '@/server/settings';

export const metadata: Metadata = {
  alternates: { canonical: '/help' },
  description: 'Speedy Van FAQs for booking, pricing, payments, coverage and move-day questions.',
  title: 'Help and FAQs',
};

export default async function HelpPage(): Promise<ReactNode> {
  const [faqs, settings] = await Promise.all([getRenderedFaqs(), getPublicSettings()]);
  return (
    <>
      <StructuredData
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqs.map((faq) => ({ '@type': 'Question', acceptedAnswer: { '@type': 'Answer', text: faq.answer }, name: faq.question })),
        }}
      />
      <section className="section page-hero">
        <div className="container two-column">
          <div>
            <h1 className="page-title">Help and FAQs</h1>
            <p className="lead">Search the common questions about bookings, pricing, payments, coverage and move day.</p>
          </div>
          <div className="table-card">
            <h2>Contact</h2>
            {settings.contact.emailPublic ? <Link className="text-link" href={`mailto:${settings.contact.emailPublic}`}>{settings.contact.emailPublic}</Link> : <Link className="text-link" href="/contact">Contact Speedy Van</Link>}
          </div>
        </div>
      </section>
      <section className="section section-muted">
        <div className="container">
          <FaqSearch faqs={faqs} />
        </div>
      </section>
    </>
  );
}
