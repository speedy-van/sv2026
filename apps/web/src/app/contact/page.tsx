import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ContactForm } from '@/components/marketing/contact-form';
import { getPublicSettings } from '@/server/settings';

export const metadata: Metadata = {
  alternates: { canonical: '/contact' },
  description: 'Contact Speedy Van about a booking, quote or move.',
  title: 'Contact',
};

export default async function ContactPage(): Promise<ReactNode> {
  const settings = await getPublicSettings();
  const phoneHref = settings.contact.phoneE164 ? `tel:${settings.contact.phoneE164}` : null;
  return (
    <section className="section page-hero">
      <div className="container two-column">
        <div>
          <h1 className="page-title">Contact</h1>
          <p className="lead">Send a message about a move, quote or existing booking.</p>
          <div className="contact-list">
            {settings.contact.phoneDisplay && phoneHref ? <Link href={phoneHref}>{settings.contact.phoneDisplay}</Link> : null}
            {settings.contact.emailPublic ? <Link href={`mailto:${settings.contact.emailPublic}`}>{settings.contact.emailPublic}</Link> : null}
            {settings.contact.whatsappE164 ? <Link href={`https://wa.me/${settings.contact.whatsappE164.replace('+', '')}`}>WhatsApp</Link> : null}
            {settings.contact.phoneHours ? <span>{settings.contact.phoneHours}</span> : null}
            {settings.company.registeredOffice ? <span>Registered office: {settings.company.registeredOffice}</span> : null}
          </div>
          <Link className="button button-secondary" href="/manage">Already booked? Manage your booking</Link>
        </div>
        <ContactForm />
      </div>
    </section>
  );
}
