import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BookingConfirmation } from '@/components/booking-flow/confirmation';
import { createPageMetadata, getSeoSettings } from '@/server/seo';

export async function generateMetadata(): Promise<Metadata> {
  return createPageMetadata({
    description: 'Check your Speedy Van booking confirmation.',
    follow: false,
    indexable: false,
    path: '/book/confirmation',
    settings: await getSeoSettings(),
    title: 'Booking confirmation',
  });
}

export default function ConfirmationPage(): ReactNode {
  return <BookingConfirmation />;
}
