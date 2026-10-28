import { Bricolage_Grotesque, Manrope } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ConsentBanner } from '@/components/consent/consent-banner';
import { VisitorPresenceTracker } from '@/components/consent/visitor-presence-tracker';
import { Footer } from '@/components/layout/footer';
import { FloatingContact } from '@/components/layout/floating-contact';
import { Header } from '@/components/layout/header';
import { MobileStickyCta } from '@/components/layout/mobile-sticky-cta';
import { SiteBanner } from '@/components/layout/site-banner';
import { businessStructuredData, createPageMetadata, getSeoSettings } from '@/server/seo';
import './globals.css';

const body = Manrope({
  display: 'swap',
  subsets: ['latin'],
  variable: '--font-body',
});

const display = Bricolage_Grotesque({
  display: 'swap',
  subsets: ['latin'],
  variable: '--font-display',
});

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSeoSettings();
  const shared = createPageMetadata({
    description: 'See fixed prices for removals and man and van moves across Scotland.',
    path: '/',
    settings,
    title: settings.company.tradingName,
  });
  return {
    description: shared.description,
    metadataBase: new URL(settings.web.canonicalOrigin),
    openGraph: shared.openGraph,
    title: {
      default: settings.company.tradingName,
      template: `%s | ${settings.company.tradingName}`,
    },
    twitter: shared.twitter,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  let speedInsights: ReactNode = null;
  if (process.env.VERCEL) {
    const { SpeedInsights } = await import('@vercel/speed-insights/next');
    speedInsights = <SpeedInsights />;
  }
  const settings = await getSeoSettings();
  const phoneHref = settings.contact.phoneE164 ? `tel:${settings.contact.phoneE164}` : null;

  return (
    <html className={`${body.variable} ${display.variable}`} lang="en-GB">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div className="page-shell">
          <SiteBanner banner={settings.siteBanner} />
          <Header phoneDisplay={settings.contact.phoneDisplay} phoneHref={phoneHref} />
          <main id="main-content">{children}</main>
          <Footer settings={settings} />
          <MobileStickyCta phoneDisplay={settings.contact.phoneDisplay} phoneHref={phoneHref} />
          <FloatingContact
            phoneDisplay={settings.contact.phoneDisplay}
            phoneE164={settings.contact.phoneE164}
            whatsappE164={settings.contact.whatsappE164}
          />
          <ConsentBanner />
          <VisitorPresenceTracker />
        </div>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(businessStructuredData(settings)).replaceAll('<', '\\u003c'),
          }}
        />
        {speedInsights}
      </body>
    </html>
  );
}
