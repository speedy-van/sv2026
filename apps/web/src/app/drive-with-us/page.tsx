import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getPublicSettings } from '@/server/settings';

export const metadata: Metadata = {
  alternates: { canonical: '/drive-with-us' },
  description: 'Driver information for Speedy Van.',
  title: 'Drive with us',
};

export default async function DriveWithUsPage(): Promise<ReactNode> {
  const settings = await getPublicSettings();
  return (
    <section className="section page-hero">
      <div className="container two-column">
        <div>
          <h1 className="page-title">Drive with us</h1>
          <p className="lead">Drivers use the Speedy Van driver app for offers, job stages, photos, signatures and earnings.</p>
          <ul className="check-list">
            <li>Clear job details before accepting</li>
            <li>Step-by-step job flow on move day</li>
            <li>Navigation hand-off and completion records</li>
          </ul>
        </div>
        <div className="table-card">
          <h2>Apply</h2>
          <p>Driver requirements are owner-reviewed before launch.</p>
          {settings.contact.emailPublic ? <Link className="button button-primary" href={`mailto:${settings.contact.emailPublic}`}>Apply by email</Link> : <Link className="button button-primary" href="/contact">Contact Speedy Van</Link>}
        </div>
      </div>
    </section>
  );
}
