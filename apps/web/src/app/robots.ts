import type { MetadataRoute } from 'next';
import { canonicalOrigin } from '@/content/locations';

export default function robots(): MetadataRoute.Robots {
  const origin = canonicalOrigin();
  return {
    rules: [
      {
        allow: '/',
        disallow: ['/api/', '/book/confirmation', '/manage', '/pay/', '/quote/', '/review/', '/styleguide', '/track/'],
        userAgent: '*',
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
