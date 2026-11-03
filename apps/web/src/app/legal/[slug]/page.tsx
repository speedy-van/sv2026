import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import type { PublicSettings } from '@sv/contracts';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { cookieInventory, liveChatPrivacyNotice } from '@/content/cookies';
import { cancellationRules, legalCopy, legalDraftIntroduction, privacyControllerDescription } from '@/content/legal';
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
  return show ? <p className="draft-banner">{legalCopy.draftBanner}</p> : null;
}

function TermsContent({ policy }: { policy: PublicSettings['cancellation'] }): ReactNode {
  return (
    <div className="legal-copy">
      <h2>Parties and service</h2>
      <p>These draft terms cover Speedy Van removals, man and van, collection and delivery services booked through the website.</p>
      <h2>Prices and payment</h2>
      <p>Prices are fixed for the details given at booking. If items, access or timing change, any extra cost is agreed before extra work is carried out. Payment is taken online before confirmation.</p>
      <h2>Customer responsibilities</h2>
      <p>Customers must give accurate addresses, items and access details, arrange parking or permits where needed, be present for the move, and pack items safely unless packing help is booked.</p>
      <h2>{legalCopy.restrictedItemsHeading}</h2>
      <p>{legalCopy.restrictedItemsPending}</p>
      <h2>Changes, cancellation and delays</h2>
      <p>{cancellationRules(policy) ? legalCopy.changesBody : legalCopy.cancellationPending}</p>
      <Link className="text-link" href="/legal/cancellation">{legalCopy.cancellationLinkLabel}</Link>
      <h2>{legalCopy.liabilityHeading}</h2>
      <p>{legalCopy.liabilityPending}</p>
      <Link className="text-link" href="/contact">{legalCopy.contactLabel}</Link>
      <h2>Governing law</h2>
      <p>Scots law applies, while consumers keep the protections of where they live.</p>
    </div>
  );
}

function CancellationContent({ policy }: { policy: PublicSettings['cancellation'] }): ReactNode {
  const rules = cancellationRules(policy);
  return (
    <div className="legal-copy">
      <h2>{legalCopy.cancellationHeading}</h2>
      <p>{rules ? legalCopy.cancellationIntro : legalCopy.cancellationPending}</p>
      {rules ? (
        <table className="data-table">
          <thead><tr><th scope="col">{legalCopy.timingLabel}</th><th scope="col">{legalCopy.refundLabel}</th></tr></thead>
          <tbody>
            {rules.map((rule) => <tr key={rule.timing}><td>{rule.timing}</td><td>{rule.refund}</td></tr>)}
          </tbody>
        </table>
      ) : null}
      <Link className="text-link" href="/contact">{legalCopy.contactLabel}</Link>
      <h2>{legalCopy.refundHeading}</h2>
      <p>{legalCopy.refundBody}</p>
    </div>
  );
}

function PrivacyContent({ company }: { company: PublicSettings['company'] }): ReactNode {
  return (
    <div className="legal-copy">
      <h2>Controller and lawful bases</h2>
      <p>{privacyControllerDescription(company)}</p>
      <p>Booking and job data are processed for contract; accounting records for legal obligation; fraud prevention, job tracking and operational records for legitimate interests; analytics, ads and marketing email only with consent.</p>
      <h2>Processors</h2>
      <p>Processors include Vercel, Neon, Stripe, Mapbox, Resend, Expo, Apple push services, Sentry, Upstash and Google services when consented.</p>
      <h2>{liveChatPrivacyNotice.heading}</h2>
      <p>{liveChatPrivacyNotice.body}</p>
      <h2>Rights and retention</h2>
      <p>{legalCopy.retentionBody}</p>
      <Link className="text-link" href="/contact">{legalCopy.contactLabel}</Link>
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

function contentFor(slug: LegalSlug, settings: PublicSettings): ReactNode {
  if (slug === 'terms') return <TermsContent policy={settings.cancellation} />;
  if (slug === 'privacy') return <PrivacyContent company={settings.company} />;
  if (slug === 'cookies') return <CookiesContent />;
  return <CancellationContent policy={settings.cancellation} />;
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }): Promise<ReactNode> {
  const { slug } = await params;
  if (!isLegalSlug(slug)) notFound();
  const [settings, showBanner] = await Promise.all([getPublicSettings(), showDraftLegalBanner()]);
  return (
    <section className="section page-hero">
      <div className="container">
        <DraftBanner show={showBanner} />
        <h1 className="page-title">{legalPages[slug].title}</h1>
        <p className="lead">{legalDraftIntroduction(settings.company)}</p>
        {contentFor(slug, settings)}
      </div>
    </section>
  );
}
