import type { Redirect } from 'next/dist/lib/load-custom-routes';

export const redirects: Redirect[] = [
  {
    source: '/services/house-removal',
    destination: '/services/house-removals',
    statusCode: 301,
  },
  {
    source: '/areas/glasgow-west-end',
    destination: '/removals/glasgow',
    statusCode: 301,
  },
];
