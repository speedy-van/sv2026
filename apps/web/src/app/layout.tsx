import { SpeedInsights } from '@vercel/speed-insights/next';
import { Bricolage_Grotesque, Manrope } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ConsentBanner } from '@/components/consent/consent-banner';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { MobileStickyCta } from '@/components/layout/mobile-sticky-cta';
import { SiteBanner } from '@/components/layout/site-banner';
import { getPublicSettings } from '@/server/settings';
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

export const metadata: Metadata = {
  description: 'See fixed prices for removals and man and van moves across Scotland.',
  metadataBase: new URL('https://www.speedyvan.uk'),
  title: {
    default: 'Speedy Van',
    template: '%s | Speedy Van',
  },
};

export default async function RootLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const settings = await getPublicSettings();
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
          <ConsentBanner />
        </div>
        <SpeedInsights />
      </body>
    </html>
  );
}
