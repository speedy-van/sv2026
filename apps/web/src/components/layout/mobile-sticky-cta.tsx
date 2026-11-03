'use client';

import { Phone } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { useEffect, useState, type ReactNode } from 'react';
import { headerCopy } from '@/content/navigation';
import { isBookingJourneyPath } from '@/lib/booking-journey';

export function MobileStickyCta({ phoneDisplay, phoneHref }: { phoneDisplay: string | null; phoneHref: string | null }): ReactNode {
  const pathname = usePathname();
  if (isBookingJourneyPath(pathname)) return null;

  // The root layout persists, so each page needs fresh observer state.
  return <ObservedMobileStickyCta key={pathname} phoneDisplay={phoneDisplay} phoneHref={phoneHref} />;
}

function ObservedMobileStickyCta({ phoneDisplay, phoneHref }: { phoneDisplay: string | null; phoneHref: string | null }): ReactNode {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const bookingCards = Array.from(document.querySelectorAll('[data-booking-card]'));
    const footer = document.querySelector('footer');
    if (bookingCards.length === 0) return undefined;

    const cardVisibility = new Map<Element, boolean>(bookingCards.map((card) => [card, true]));
    let footerVisible = footer !== null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (cardVisibility.has(entry.target)) cardVisibility.set(entry.target, entry.isIntersecting);
          if (entry.target === footer) footerVisible = entry.isIntersecting;
        }
        setVisible(!Array.from(cardVisibility.values()).some((isVisible) => isVisible) && !footerVisible);
      },
      { threshold: 0.05 },
    );
    for (const bookingCard of bookingCards) observer.observe(bookingCard);
    if (footer) observer.observe(footer);
    return () => { observer.disconnect(); };
  }, []);

  if (!visible) return null;

  return (
    <div className="mobile-sticky-cta">
      <Link className="button button-primary" href="/book">
        {headerCopy.getPrice}
      </Link>
      {phoneHref ? (
        <Link aria-label={`Call ${phoneDisplay ?? 'Speedy Van'}`} className="button button-secondary icon-button" href={phoneHref}>
          <Phone aria-hidden="true" size={20} />
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}
