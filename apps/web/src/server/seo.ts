import 'server-only';

import type { PublicSettings } from '@sv/contracts';
import type { Metadata } from 'next';
import { cache } from 'react';
import { brandLogo } from '@/content/brand';
import { getPublicSettings } from './settings';

type SeoSettings = Pick<PublicSettings, 'company' | 'web'>;

export const getSeoSettings = cache(getPublicSettings);

export function createPageMetadata({
  description,
  follow = true,
  indexable = true,
  path,
  settings,
  title,
}: {
  description: string;
  follow?: boolean;
  indexable?: boolean;
  path: string;
  settings: SeoSettings;
  title: string;
}): Metadata {
  const origin = settings.web.canonicalOrigin;
  const siteName = settings.company.tradingName;
  const canonical = new URL(path, origin);
  canonical.search = '';
  canonical.hash = '';
  const url = canonical.toString();
  const image = new URL(brandLogo.src, origin).toString();
  const socialTitle = title === siteName ? title : `${title} | ${siteName}`;
  return {
    alternates: { canonical: url },
    description,
    openGraph: {
      description,
      images: [{ alt: `${siteName} logo`, height: brandLogo.height, url: image, width: brandLogo.width }],
      locale: 'en_GB',
      siteName,
      title: socialTitle,
      type: 'website',
      url,
    },
    ...(!indexable ? { robots: { follow, index: false } } : {}),
    // The root layout title template does not apply to the home page in the
    // same segment. Resolve the shared document/social title explicitly.
    title: { absolute: socialTitle },
    twitter: {
      card: 'summary',
      description,
      images: [{ alt: `${siteName} logo`, url: image }],
      title: socialTitle,
    },
  };
}

export function businessStructuredData(
  settings: Pick<PublicSettings, 'company' | 'contact' | 'web'>,
): unknown {
  const origin = settings.web.canonicalOrigin.replace(/\/$/, '');
  const businessId = `${origin}/#business`;
  const sameAs = [...Object.values(settings.web.socials), settings.web.googleBusinessProfileUrl].filter(
    (url): url is string => Boolean(url),
  );
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@id': businessId,
        '@type': 'MovingCompany',
        areaServed: { '@type': 'AdministrativeArea', name: 'Scotland' },
        ...(settings.contact.showAddressPublicly && settings.company.registeredOffice
          ? { address: settings.company.registeredOffice }
          : {}),
        ...(settings.contact.emailPublic ? { email: settings.contact.emailPublic } : {}),
        ...(settings.company.legalName ? { legalName: settings.company.legalName } : {}),
        logo: new URL(brandLogo.src, origin).toString(),
        name: settings.company.tradingName,
        ...(sameAs.length ? { sameAs: [...new Set(sameAs)] } : {}),
        ...(settings.contact.phoneE164 ? { telephone: settings.contact.phoneE164 } : {}),
        url: origin,
      },
      {
        '@id': `${origin}/#website`,
        '@type': 'WebSite',
        name: settings.company.tradingName,
        publisher: { '@id': businessId },
        url: origin,
      },
    ],
  };
}
