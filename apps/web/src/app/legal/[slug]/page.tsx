import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { cookieInventory } from '@/content/cookies';
import { isLegalSlug, legalPages, type LegalSlug } from '@/content/marketing';
import { showDraftLegalBanner } from '@/server/marketing';
import { getPublicSettings } from '@/server/settings';

export function generateStaticParams(): Array<{ slug: LegalSlug }> {
  return Object.keys(legalPages).map((slug) => ({ slug: slug as LegalSlug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isLegalSlug(slug)) return {};
  return {
    alternates: { canonical: `/legal/${slug}` },
    description: legalPages[slug].description,
    robots: { follow: true, index: false },
    title: legalPages[slug].title,
  };
}

function DraftBanner({ show }: { show: boolean }): ReactNode {
  return show ? <p className="draft-banner">Draft - awaiting legal review</p> : null;
}

function TermsContent(): ReactNode {
  return (
    <div className="legal-copy">
      <h2>Parties and service</h2>
      <p>These draft terms cover Speedy Van removals, man and van, collection and delivery services booked through the website.</p>
      <h2>Prices and payment</h2>
      <p>Prices are fixed for the details given at booking. If items, access or timing change, any extra cost is agreed before extra work is carried out. Payment is taken online before confirmation.</p>
      <h2>Customer responsibilities</h2>
      <p>Customers must give accurate addresses, items and access details, arrange parking or permits where needed, be present for the move, and pack items safely unless packing help is booked.</p>
      <h2>Items we will not carry</h2>
      <p>[SOLICITOR/OWNER TO CONFIRM] restricted items, including hazardous, illegal, perishable and high-value items such as cash, jewellery and documents.</p>
      <h2>Changes, cancellation and delays</h2>
      <p>Changes and cancellations follow the published cancellation policy. Delays outside Speedy Van's control are handled fairly and in plain language.</p>
      <h2>Liability and complaints</h2>
      <p>Liability limits, claim deadlines and insurance wording are [SOLICITOR/OWNER TO CONFIRM]. Complaints can be sent through the contact page.</p>
      <h2>Governing law</h2>
      <p>Scots law applies, while consumers keep the protections of where they live.</p>
    </div>
  );
}

function CancellationContent(): ReactNode {
  return (
    <div className="legal-copy">
      <h2>Plain-English policy</h2>
      <p>The final cancellation windows are generated from business settings before launch and reviewed by a solicitor.</p>
      <table className="data-table">
        <thead><tr><th scope="col">Timing</th><th scope="col">Refund</th></tr></thead>
        <tbody>
          <tr><td>Before the free-cancellation cutoff</td><td>Full refund, if enabled in settings</td></tr>
          <tr><td>Between the late and free-cancellation cutoffs</td><td>Late refund percentage from settings</td></tr>
          <tr><td>Inside the no-refund cutoff</td><td>No refund, subject to solicitor-approved wording</td></tr>
        </tbody>
      </table>
      <h2>Refund timing</h2>
      <p>Refunds are returned to the original payment method. Bank processing times depend on the payment provider and card issuer.</p>
    </div>
  );
}

function PrivacyContent(): ReactNode {
  return (
    <div className="legal-copy">
      <h2>Controller and lawful bases</h2>
      <p>The company operating Speedy Van is the controller. Booking and job data are processed for contract; accounting records for legal obligation; fraud prevention, job tracking and operational records for legitimate interests; analytics, ads and marketing email only with consent.</p>
      <h2>Processors</h2>
      <p>Processors include Vercel, Neon, Stripe, Mapbox, Resend, Expo, Apple push services, Sentry, Upstash and Google services when consented.</p>
      <h2>Rights and retention</h2>
      <p>Customers can request access, portability, rectification, erasure where allowed, and objection to marketing. Retention follows the database retention policy before launch.</p>
      <h2>Driver location</h2>
      <p>Driver location is used only for active jobs and operational safety, with a visible app indicator and limited retention.</p>
    </div>
  );
}

function CookiesContent(): ReactNode {
  return (
    <div className="legal-copy">
      <h2>Cookie choices</h2>
      <p>Necessary cookies keep booking, payments and consent working. Analytics and advertising cookies stay off unless the user chooses them.</p>
      <table className="data-table">
        <thead><tr><th scope="col">Cookie or storage</th><th scope="col">Category</th><th scope="col">Purpose</th><th scope="col">Set when</th></tr></thead>
        <tbody>
          {cookieInventory.map((item) => (
            <tr key={item.name}>
              <td>{item.name}</td>
              <td>{item.category}</td>
              <td>{item.purpose}</td>
              <td>{item.setWhen}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Use the Cookie settings button in the footer to change consent.</p>
    </div>
  );
}

function contentFor(slug: LegalSlug): ReactNode {
  if (slug === 'terms') return <TermsContent />;
  if (slug === 'privacy') return <PrivacyContent />;
  if (slug === 'cookies') return <CookiesContent />;
  return <CancellationContent />;
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }): Promise<ReactNode> {
  const { slug } = await params;
  if (!isLegalSlug(slug)) notFound();
  const [settings, showBanner] = await Promise.all([getPublicSettings(), showDraftLegalBanner()]);
  const company = settings.company.legalName ? `${settings.company.legalName}, trading as ${settings.company.tradingName}` : settings.company.tradingName;
  return (
    <section className="section page-hero">
      <div className="container">
        <DraftBanner show={showBanner} />
        <h1 className="page-title">{legalPages[slug].title}</h1>
        <p className="lead">Draft for {company}. A Scottish solicitor must approve this page before launch.</p>
        {contentFor(slug)}
      </div>
    </section>
  );
}
