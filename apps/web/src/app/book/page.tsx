import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BookingFlow } from '@/components/booking-flow/booking-flow';

export const metadata: Metadata = {
  description: 'Get a fixed Speedy Van price and book a moving slot online.',
  title: 'Book your move',
};

export default function BookPage(): ReactNode {
  return <BookingFlow />;
}
