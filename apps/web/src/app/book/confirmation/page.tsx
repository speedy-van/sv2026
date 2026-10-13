import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BookingConfirmation } from '@/components/booking-flow/confirmation';

export const metadata: Metadata = {
  description: 'Check your Speedy Van booking confirmation.',
  title: 'Booking confirmation',
};

export default function ConfirmationPage(): ReactNode {
  return <BookingConfirmation />;
}
