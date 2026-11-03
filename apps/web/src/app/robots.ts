import type { MetadataRoute } from 'next';
import { getSeoSettings } from '@/server/seo';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = (await getSeoSettings()).web.canonicalOrigin.replace(/\/$/, '');
  return {
    rules: [
      {
        allow: '/',
        // UI routes remain crawlable so search engines can observe their noindex
        // metadata. Authentication and bearer-token checks still protect data.
        disallow: ['/api/'],
        userAgent: '*',
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
