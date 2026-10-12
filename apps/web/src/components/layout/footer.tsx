import type { PublicSettings } from '@sv/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cityLinks, companyLinks, helpLinks, services } from '@/content/navigation';
import { Logo } from './logo';

function legalLine(settings: PublicSettings): string | null {
  const { company } = settings;
  if (!company.legalName || !company.companyNumber || !company.registeredOffice || !company.registeredIn) {
    return null;
  }
  const vat = company.vatRegistered && company.vatNumber ? ` VAT number ${company.vatNumber}.` : '';
  return `${company.legalName}, trading as ${company.tradingName}. Registered in ${company.registeredIn}, company number ${company.companyNumber}. Registered office: ${company.registeredOffice}.${vat}`;
}

export function Footer({ settings }: { settings: PublicSettings }): ReactNode {
  const line = legalLine(settings);
  const phoneHref = settings.contact.phoneE164 ? `tel:${settings.contact.phoneE164}` : null;
  const whatsappHref = settings.contact.whatsappE164 ? `https://wa.me/${settings.contact.whatsappE164.replace('+', '')}` : null;

  return (
    <footer className="footer">
      <div className="container footer-grid">
        <section>
          <Logo inverse />
          <p className="legal-line">Pay by card, Apple Pay or Google Pay.</p>
          {line ? <p className="legal-line">{line}</p> : null}
          <p className="legal-line">© {new Date().getFullYear()} Speedy Van.</p>
        </section>
        <nav aria-label="Footer services">
          <h3>Services</h3>
          <ul className="footer-list">
            {services.map((service) => (
              <li key={service.href}>
                <Link href={service.href}>{service.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Footer areas">
          <h3>Areas</h3>
          <ul className="footer-list">
            {cityLinks.map((city) => (
              <li key={city.href}>
                <Link href={city.href}>{city.label}</Link>
              </li>
            ))}
            <li>
              <Link href="/areas">All areas</Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Footer company">
          <h3>Company</h3>
          <ul className="footer-list">
            {companyLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Footer help and contact">
          <h3>Help</h3>
          <ul className="footer-list">
            {helpLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
            <li>
              <Link href="/legal/terms">Terms</Link>
            </li>
            <li>
              <Link href="/legal/privacy">Privacy</Link>
            </li>
            <li>
              <Link href="/legal/cookies">Cookies</Link>
            </li>
            <li>
              <Link href="/accessibility">Accessibility</Link>
            </li>
            <li>
              <button className="button button-ghost" data-open-cookie-settings type="button">
                Cookie settings
              </button>
            </li>
            {settings.contact.phoneDisplay && phoneHref ? (
              <li>
                <Link href={phoneHref}>{settings.contact.phoneDisplay}</Link>
              </li>
            ) : null}
            {settings.contact.emailPublic ? (
              <li>
                <Link href={`mailto:${settings.contact.emailPublic}`}>{settings.contact.emailPublic}</Link>
              </li>
            ) : null}
            {whatsappHref ? (
              <li>
                <Link href={whatsappHref}>WhatsApp</Link>
              </li>
            ) : null}
            {settings.contact.phoneHours ? <li className="legal-line">{settings.contact.phoneHours}</li> : null}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
