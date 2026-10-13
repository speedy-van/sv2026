import type { MetadataRoute } from 'next';
import {
  canonicalOrigin,
  citySlugs,
  cityUrl,
  isIndexableLocation,
  locationPages,
  locationUrl,
  locationsBySlug,
  regions,
  routePages,
  routeUrl,
} from '@/content/locations';
import { serviceContent } from '@/content/services';
import { getPublicSettings } from '@/server/settings';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = await getPublicSettings().catch(() => null);
  const origin = settings?.web.canonicalOrigin ?? canonicalOrigin();
  const now = new Date();
  const paths = [
    '/',
    '/services',
    '/pricing',
    '/how-it-works',
    '/about',
    '/contact',
    '/reviews',
    '/help',
    '/drive-with-us',
    '/accessibility',
    '/areas',
    ...serviceContent.map((service) => `/services/${service.slug}`),
    ...regions.map((region) => `/areas/${region.slug}`),
    ...locationPages.filter((location) => isIndexableLocation(location, settings?.seo.indexTier3 ?? false)).map(locationUrl),
    ...routePages.map(routeUrl),
    ...citySlugs.map((slug) => locationsBySlug.get(slug)).filter((location): location is NonNullable<typeof location> => Boolean(location)).map(cityUrl),
  ];
  return paths.map((path) => ({
    changeFrequency: path === '/' ? 'daily' : 'weekly',
    lastModified: now,
    priority: path === '/' ? 1 : path.startsWith('/removals/') || path.startsWith('/man-and-van/') ? 0.75 : 0.65,
    url: `${origin}${path}`,
  }));
}
