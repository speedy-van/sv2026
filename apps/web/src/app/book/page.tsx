import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BookingFlow } from '@/components/booking-flow/booking-flow';
import { createPageMetadata, getSeoSettings } from '@/server/seo';

export async function generateMetadata(): Promise<Metadata> {
  return createPageMetadata({
    description: 'Get a fixed Speedy Van price and book a moving slot online.',
    indexable: false,
    path: '/book',
    settings: await getSeoSettings(),
    title: 'Book your move',
  });
}

export default function BookPage(): ReactNode {
  return <BookingFlow />;
}
