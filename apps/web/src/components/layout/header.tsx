import { ChevronRight, MapPin, Phone } from 'lucide-react';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { ReactNode } from 'react';
import { cityLinks, headerCopy, headerLinks, services } from '@/content/navigation';
import { HeaderDropdown, HeaderShell, MobileMenu } from './header-interactions';
import { Logo } from './logo';
import { StartBookingLink } from './start-booking-link';

export function Header({ phoneDisplay, phoneHref }: { phoneDisplay: string | null; phoneHref: string | null }): ReactNode {
  const phoneLink = phoneHref ? (
    <Link aria-label={`Call ${phoneDisplay ?? 'Speedy Van'}`} className="button button-secondary icon-button" href={phoneHref}>
      <Phone aria-hidden="true" size={20} />
    </Link>
  ) : null;

  return (
    <HeaderShell>
      <div className="container header-inner">
        <Logo />
        <nav aria-label={headerCopy.mainNavigation} className="desktop-nav">
          <HeaderDropdown label={headerCopy.services}>
            <p className="nav-panel-heading">{headerCopy.servicesIntro}</p>
            <div className="service-panel">
              {services.map((service) => {
                const Icon = service.icon;
                return (
                  <Link className="panel-link" href={service.href} key={service.href}>
                    <span aria-hidden="true" className="panel-icon"><Icon size={20} /></span>
                    <span className="panel-link-copy">
                      <strong>{service.label}</strong>
                      <span>{service.summary}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
            <Link className="nav-panel-footer" href="/services">
              {headerCopy.allServices}<ChevronRight aria-hidden="true" size={17} />
            </Link>
          </HeaderDropdown>
          <HeaderDropdown label={headerCopy.areas}>
            <p className="nav-panel-heading">{headerCopy.areasIntro}</p>
            <div className="areas-panel">
              {cityLinks.map((city) => (
                <Link className="area-panel-link" href={city.href} key={city.href}>
                  <MapPin aria-hidden="true" size={17} />
                  {city.label}
                  <ChevronRight aria-hidden="true" size={15} />
                </Link>
              ))}
            </div>
            <Link className="nav-panel-footer" href="/areas">
              {headerCopy.allAreas}<ChevronRight aria-hidden="true" size={17} />
            </Link>
          </HeaderDropdown>
          {headerLinks.map((link) => (
            <Link className="nav-link" href={link.href} key={link.href}>{link.label}</Link>
          ))}
        </nav>
        <div className="header-actions">
          {phoneDisplay && phoneHref ? (
            <Link aria-label={`Call ${phoneDisplay}`} className="header-phone" href={phoneHref}>
              <Phone aria-hidden="true" size={18} />
              <span>{phoneDisplay}</span>
            </Link>
          ) : null}
          <StartBookingLink className="button button-primary header-price" />
        </div>
        <div className="mobile-actions">
          <StartBookingLink className="button button-primary mobile-header-price" />
          {phoneLink}
          <MobileMenu logo={<Logo />}>
            <nav aria-label={headerCopy.mobileNavigation} className="mobile-menu-links">
              <Link href="/services">{headerCopy.services}<ChevronRight aria-hidden="true" size={20} /></Link>
              <Link href="/areas">{headerCopy.areas}<ChevronRight aria-hidden="true" size={20} /></Link>
              {headerLinks.map((link) => (
                <Link href={link.href} key={link.href}>{link.label}<ChevronRight aria-hidden="true" size={20} /></Link>
              ))}
              <Link href="/contact">{headerCopy.contact}<ChevronRight aria-hidden="true" size={20} /></Link>
            </nav>
            <div className="mobile-menu-footer">
              {phoneDisplay && phoneHref ? (
                <Link className="mobile-menu-phone" href={phoneHref}>
                  <Phone aria-hidden="true" size={20} />{phoneDisplay}
                </Link>
              ) : null}
              <StartBookingLink className="button button-primary" />
            </div>
          </MobileMenu>
        </div>
      </div>
    </HeaderShell>
  );
}
