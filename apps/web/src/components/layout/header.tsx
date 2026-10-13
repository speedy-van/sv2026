'use client';

import { Menu, Phone, X } from 'lucide-react';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { useEffect, useState, type ReactNode } from 'react';
import { cityLinks, services } from '@/content/navigation';
import { Logo } from './logo';

export function Header({ phoneDisplay, phoneHref }: { phoneDisplay: string | null; phoneHref: string | null }): ReactNode {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('no-scroll', mobileOpen);
    return () => { document.body.classList.remove('no-scroll'); };
  }, [mobileOpen]);

  const phoneLink = phoneHref ? (
    <Link aria-label={`Call ${phoneDisplay ?? 'Speedy Van'}`} className="button button-secondary icon-button" href={phoneHref}>
      <Phone aria-hidden="true" size={20} />
    </Link>
  ) : null;

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Logo />
        <nav aria-label="Main navigation" className="desktop-nav">
          <div className="nav-panel-wrap">
            <button className="nav-trigger" type="button">
              Services
            </button>
            <div className="nav-panel service-panel">
              {services.map((service) => {
                const Icon = service.icon;
                return (
                  <Link className="panel-link" href={service.href} key={service.href}>
                    <Icon aria-hidden="true" color="#6D3BD7" size={22} />
                    <span>
                      <strong>{service.label}</strong>
                      <br />
                      {service.summary}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="nav-panel-wrap">
            <button className="nav-trigger" type="button">
              Areas
            </button>
            <div className="nav-panel service-panel">
              {cityLinks.map((city) => (
                <Link className="panel-link" href={city.href} key={city.href}>
                  <span>
                    <strong>{city.label}</strong>
                    <br />
                    Moves around {city.label}
                  </span>
                </Link>
              ))}
              <Link className="panel-link" href="/areas">
                <span>
                  <strong>All areas</strong>
                  <br />
                  Mainland Scotland coverage
                </span>
              </Link>
            </div>
          </div>
          <Link className="nav-link" href="/pricing">
            Prices
          </Link>
          <Link className="nav-link" href="/help">
            Help
          </Link>
          <Link className="nav-link" href="/contact">
            Contact
          </Link>
        </nav>
        <div className="header-actions">
          {phoneDisplay && phoneHref ? (
            <Link className="nav-link" href={phoneHref}>
              {phoneDisplay}
            </Link>
          ) : null}
          <Link className="button button-primary" href="/book">
            Get a price
          </Link>
        </div>
        <div className="mobile-actions">
          {phoneLink}
          <button aria-expanded={mobileOpen} aria-label="Open menu" className="button button-secondary icon-button" onClick={() => { setMobileOpen(true); }} type="button">
            <Menu aria-hidden="true" size={21} />
          </button>
        </div>
      </div>
      <div className="mobile-menu" hidden={!mobileOpen}>
        <div className="mobile-menu-header">
          <Logo />
          <button aria-label="Close menu" className="button button-secondary icon-button" onClick={() => { setMobileOpen(false); }} type="button">
            <X aria-hidden="true" size={21} />
          </button>
        </div>
        <nav aria-label="Mobile navigation" className="mobile-menu-links">
          <Link href="/book" onClick={() => { setMobileOpen(false); }}>
            Get a price
          </Link>
          <Link href="/services" onClick={() => { setMobileOpen(false); }}>
            Services
          </Link>
          <Link href="/areas" onClick={() => { setMobileOpen(false); }}>
            Areas
          </Link>
          <Link href="/pricing" onClick={() => { setMobileOpen(false); }}>
            Prices
          </Link>
          <Link href="/help" onClick={() => { setMobileOpen(false); }}>
            Help
          </Link>
          <Link href="/contact" onClick={() => { setMobileOpen(false); }}>
            Contact
          </Link>
          {phoneDisplay && phoneHref ? (
            <Link href={phoneHref} onClick={() => { setMobileOpen(false); }}>
              Call {phoneDisplay}
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
