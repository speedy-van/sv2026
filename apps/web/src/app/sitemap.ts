import type { MetadataRoute } from 'next';
import {
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
import { serviceLandingPages } from '@/content/services';
import { getPublishedLocationContentMap } from '@/server/location-content';
import { getSeoSettings } from '@/server/seo';

// Match town-page eligibility caching; publication changes can take up to 24 hours.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [settings, localContent] = await Promise.all([getSeoSettings(), getPublishedLocationContentMap()]);
  const origin = settings.web.canonicalOrigin.replace(/\/$/, '');
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
    '/areas',
    ...serviceLandingPages.map((service) => `/services/${service.slug}`),
    ...regions.map((region) => `/areas/${region.slug}`),
    ...locationPages
      .filter((location) =>
        isIndexableLocation(location, settings.seo.indexTier3, localContent.get(location.slug)?.localNotes),
      )
      .map(locationUrl),
    ...routePages.map(routeUrl),
    ...citySlugs
      .map((slug) => locationsBySlug.get(slug))
      .filter((location): location is NonNullable<typeof location> => Boolean(location))
      .map(cityUrl),
  ];
  return paths.map((path) => ({
    changeFrequency: path === '/' ? 'daily' : 'weekly',
    priority:
      path === '/' ? 1 : path.startsWith('/removals/') || path.startsWith('/man-and-van/') ? 0.75 : 0.65,
    url: `${origin}${path}`,
  }));
}
