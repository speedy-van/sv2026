'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { headerCopy } from '@/content/navigation';
import { isBookingJourneyPath } from '@/lib/booking-journey';

export function StartBookingLink({ className }: { className: string }): ReactNode {
  const pathname = usePathname();
  if (isBookingJourneyPath(pathname)) return null;

  return <Link className={className} href="/book">{headerCopy.getPrice}</Link>;
}
