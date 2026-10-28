import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { ReactNode } from 'react';
import { showDraftLegalBanner } from '@/server/marketing';
import { getPublicSettings } from '@/server/settings';

import { createPageMetadata, getSeoSettings } from '@/server/seo';

export async function generateMetadata(): Promise<Metadata> {
  return createPageMetadata({
    path: '/accessibility',
    settings: await getSeoSettings(),
    description: 'Accessibility statement for Speedy Van.',
    indexable: false,
    title: 'Accessibility statement',
  });
}

export default async function AccessibilityPage(): Promise<ReactNode> {
  const [settings, showBanner] = await Promise.all([getPublicSettings(), showDraftLegalBanner()]);
  return (
    <section className="section page-hero">
      <div className="container legal-copy">
        {showBanner ? <p className="draft-banner">Draft - awaiting legal review</p> : null}
        <h1 className="page-title">Accessibility statement</h1>
        <p className="lead">Speedy Van targets WCAG 2.2 AA across the website.</p>
        <h2>What we check</h2>
        <p>Pages are built with landmarks, labels, visible focus, keyboard access, sufficient contrast, reduced-motion support and 44 px touch targets.</p>
        <h2>Known issues</h2>
        <p>Known issues are recorded before launch and fixed through the QA hardening phase.</p>
        <h2>Report a problem</h2>
        {settings.contact.emailPublic ? <p>Email <Link className="text-link" href={`mailto:${settings.contact.emailPublic}`}>{settings.contact.emailPublic}</Link>.</p> : <p>Use the contact page to report an accessibility problem.</p>}
      </div>
    </section>
  );
}
