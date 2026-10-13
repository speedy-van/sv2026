import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { howItWorksSteps } from '@/content/marketing';

export const metadata: Metadata = {
  alternates: { canonical: '/how-it-works' },
  description: 'How to get a Speedy Van price, choose a slot, manage a booking and track the move.',
  title: 'How it works',
};

export default function HowItWorksPage(): ReactNode {
  return (
    <>
      <section className="section page-hero">
        <div className="container two-column">
          <div>
            <h1 className="page-title">How it works</h1>
            <p className="lead">Start with the move details, choose a fixed slot price, then manage and track the booking online.</p>
          </div>
          <BookingStartCard title="Start with your move" />
        </div>
      </section>
      <section className="section section-muted">
        <div className="container">
          <ol className="step-list">
            {howItWorksSteps.map((step, index) => (
              <li key={step.title}>
                <span>{index + 1}</span>
                <h2>{step.title}</h2>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="section">
        <div className="container two-column">
          <div className="table-card">
            <h2>After booking</h2>
            <p>Your confirmation page and email include your reference and manage-booking link. The system then handles assignment, reminders and tracking links for move day.</p>
          </div>
          <div className="table-card">
            <h2>Changes</h2>
            <p>Use the manage-booking link for notes, rescheduling or cancellation when the booking rules allow it. Price differences are handled before confirmation.</p>
          </div>
        </div>
        <div className="container section-actions">
          <Link className="button button-primary" href="/book">See my prices</Link>
          <Link className="button button-secondary" href="/help">Read FAQs</Link>
        </div>
      </section>
    </>
  );
}
