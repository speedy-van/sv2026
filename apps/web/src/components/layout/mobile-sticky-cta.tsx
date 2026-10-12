'use client';

import { Phone } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

export function MobileStickyCta({ phoneDisplay, phoneHref }: { phoneDisplay: string | null; phoneHref: string | null }): ReactNode {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const bookingCard = document.querySelector('[data-booking-card]');
    const footer = document.querySelector('footer');
    if (!bookingCard) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const cardVisible = entries.find((entry) => entry.target === bookingCard)?.isIntersecting ?? false;
        const footerVisible = entries.find((entry) => entry.target === footer)?.isIntersecting ?? false;
        setVisible(!cardVisible && !footerVisible);
      },
      { threshold: 0.05 },
    );
    observer.observe(bookingCard);
    if (footer) observer.observe(footer);
    return () => { observer.disconnect(); };
  }, []);

  if (!visible) return null;

  return (
    <div className="mobile-sticky-cta">
      <Link className="button button-primary" href="/book">
        Get a price
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
