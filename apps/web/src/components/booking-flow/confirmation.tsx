'use client';

import { formatGBP } from '@sv/contracts';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy, Download, Loader2, Share2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { trackPurchase } from './analytics';
import { getBookingStatus } from './api';
import { useBookingDraft } from './booking-store';

function downloadIcs(reference: string): void {
  const content = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${reference}@speedyvan.uk`,
    `SUMMARY:Speedy Van move (${reference})`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${reference}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

export function BookingConfirmation(): ReactNode {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<ConfirmationLoading />}>
        <BookingConfirmationInner />
      </Suspense>
    </QueryClientProvider>
  );
}

function ConfirmationLoading(): ReactNode {
  return (
    <section className="booking-page">
      <div className="booking-panel confirmation-card">
        <Loader2 aria-hidden="true" className="spin" size={28} />
        <h1>Payment received</h1>
        <p>We're confirming your booking. Your email will arrive in a few minutes.</p>
      </div>
    </section>
  );
}

function BookingConfirmationInner(): ReactNode {
  const params = useSearchParams();
  const token = params.get('t') ?? params.get('token') ?? '';
  const clearDraft = useBookingDraft((state) => state.clear);
  const [copied, setCopied] = useState(false);
  const status = useQuery({
    enabled: token.length > 0,
    queryFn: () => getBookingStatus(token),
    queryKey: ['booking-status', token],
    refetchInterval: (query) => query.state.data?.status === 'CONFIRMED' ? false : 1000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const data = status.data;
  useEffect(() => {
    if (data?.status === 'CONFIRMED') clearDraft();
  }, [clearDraft, data?.status]);
  const summary = useMemo(() => data?.summary as { dateLabel?: string; routeLabel?: string; service?: string; slotLabel?: string; totalPence?: number } | null | undefined, [data]);
  useEffect(() => {
    if (data?.status !== 'CONFIRMED' || !data.reference) return;
    trackPurchase({
      reference: data.reference,
      ...(summary?.service ? { service: summary.service } : {}),
      totalPence: summary?.totalPence ?? 0,
    });
  }, [data?.reference, data?.status, summary?.service, summary?.totalPence]);

  if (!token) {
    return (
      <section className="booking-page">
        <div className="booking-panel">
          <h1>Confirmation link missing</h1>
          <p>Open the confirmation link from your payment page or email.</p>
        </div>
      </section>
    );
  }

  if (status.isLoading || data?.status === 'PENDING_PAYMENT') {
    return (
      <section className="booking-page">
        <div className="booking-panel confirmation-card">
          <Loader2 aria-hidden="true" className="spin" size={28} />
          <h1>Payment received</h1>
          <p>We're confirming your booking. Your email will arrive in a few minutes.</p>
        </div>
      </section>
    );
  }

  if (status.isError || !data) {
    return (
      <section className="booking-page">
        <div className="booking-panel confirmation-card" role="alert">
          <h1>We could not load this booking</h1>
          <p>Try refreshing the page. If payment completed, your confirmation email will still arrive.</p>
        </div>
      </section>
    );
  }

  if (data.status !== 'CONFIRMED') {
    return (
      <section className="booking-page">
        <div className="booking-panel confirmation-card">
          <h1>Your booking is {data.status.toLowerCase().replaceAll('_', ' ')}</h1>
          <p>Use the manage link from your email for next steps.</p>
        </div>
      </section>
    );
  }

  const reference = data.reference;
  if (reference === null) {
    return (
      <section className="booking-page">
        <div className="booking-panel confirmation-card" role="alert">
          <h1>We could not load this booking</h1>
          <p>Try refreshing the page. If payment completed, your confirmation email will still arrive.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="booking-page">
      <div className="booking-panel confirmation-card">
        <CheckCircle2 aria-hidden="true" color="#12805C" size={48} />
        <h1>You're booked</h1>
        <div className="reference-box">
          <span>{reference}</span>
          <button className="button button-secondary" onClick={() => {
            void navigator.clipboard.writeText(reference);
            setCopied(true);
          }} type="button">
            <Copy aria-hidden="true" size={16} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="checkout-summary">
          <div><span>Date</span><strong>{summary?.dateLabel}</strong></div>
          <div><span>Window</span><strong>{summary?.slotLabel}</strong></div>
          <div><span>Route</span><strong>{summary?.routeLabel}</strong></div>
          <div><span>Total paid</span><strong>{formatGBP(summary?.totalPence ?? 0)}</strong></div>
        </div>
        <ol className="next-list">
          <li>Confirmation email now.</li>
          <li>We assign your driver and email you their name.</li>
          <li>Reminder the day before.</li>
          <li>Live tracking link on the day.</li>
        </ol>
        <div className="button-row">
          <button className="button button-secondary" onClick={() => { downloadIcs(reference); }} type="button">
            <Download aria-hidden="true" size={18} />
            Add to calendar
          </button>
          {data.manageUrl ? <a className="button button-primary" href={data.manageUrl}>Manage your booking</a> : null}
          <button className="button button-secondary" onClick={() => {
            void navigator.share({ text: `Speedy Van booking ${reference}`, url: window.location.href });
          }} type="button">
            <Share2 aria-hidden="true" size={18} />
            Share details
          </button>
        </div>
      </div>
    </section>
  );
}
