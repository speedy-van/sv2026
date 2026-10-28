'use client';

import { formatGBP } from '@sv/contracts';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy, Download, Loader2, Share2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { bookingConfirmationCopy } from '@/content/booking-confirmation';
import { paymentCopy } from '@/content/payments';
import { stripeTestMode } from '@/lib/payment-mode';
import { PaymentModeNotice } from '../customer/payment-mode-notice';
import { trackPurchase } from './analytics';
import { getBookingStatus } from './api';
import { useBookingDraft } from './booking-store';
import {
  canRefreshCheckout,
  confirmationPollDurationMs,
  confirmationPollIntervalMs,
  confirmationState,
  shouldPollConfirmation,
  type ConfirmationState,
} from './confirmation-state';

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
  return <ConfirmationNotice state="checking" loading />;
}

function ConfirmationNotice({
  children,
  loading = false,
  message,
  state,
}: {
  children?: ReactNode;
  loading?: boolean;
  message?: string | undefined;
  state: Exclude<ConfirmationState, 'confirmed'>;
}): ReactNode {
  const copy = bookingConfirmationCopy[state];
  return (
    <section className="booking-page">
      <div className="booking-panel confirmation-card" aria-busy={loading}>
        {loading ? <Loader2 aria-hidden="true" className="spin" size={28} /> : null}
        <h1>{copy.title}</h1>
        <PaymentModeNotice />
        <p role={state === 'error' ? 'alert' : 'status'}>{message ?? copy.message}</p>
        {children}
      </div>
    </section>
  );
}

function BookingConfirmationInner(): ReactNode {
  const params = useSearchParams();
  const router = useRouter();
  const draft = useBookingDraft();
  const clearDraft = draft.clear;
  const [hydrated, setHydrated] = useState(false);
  const [storedToken, setStoredToken] = useState<string | null>(null);
  const [storedIntentId, setStoredIntentId] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [checkRound, setCheckRound] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [clearWarning, setClearWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const returnedIntentId = params.get('payment_intent');
  const canUseStoredToken = !returnedIntentId || returnedIntentId === storedIntentId;
  const token = params.get('t') ?? params.get('token') ?? (canUseStoredToken ? storedToken : null) ?? '';

  useEffect(() => {
    let active = true;
    let finished = false;
    function finishHydration(): void {
      if (!active || finished) return;
      finished = true;
      const state = useBookingDraft.getState();
      setStoredToken(state.statusToken);
      setStoredIntentId(state.paymentIntentId ?? null);
      setHydrated(true);
    }
    // Zustand omits .persist when browser storage cannot be accessed.
    const store: { persist?: typeof useBookingDraft.persist } = useBookingDraft;
    const persistence = store.persist;
    if (!persistence) {
      setStorageWarning(bookingConfirmationCopy.storageUnavailable);
      finishHydration();
      return;
    }
    const unsubscribe = persistence.onFinishHydration(finishHydration);
    if (persistence.hasHydrated()) {
      finishHydration();
    } else {
      const settle = (): void => {
        if (!active) return;
        if (!persistence.hasHydrated()) setStorageWarning(bookingConfirmationCopy.storageUnavailable);
        finishHydration();
      };
      try {
        void Promise.resolve(persistence.rehydrate()).then(settle, () => {
          if (active) setStorageWarning(bookingConfirmationCopy.storageUnavailable);
          finishHydration();
        });
      } catch {
        setStorageWarning(bookingConfirmationCopy.storageUnavailable);
        finishHydration();
      }
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Stripe's client secret must not remain in a copied/shared confirmation URL.
    const url = new URL(window.location.href);
    if (!url.searchParams.has('payment_intent_client_secret')) return;
    url.searchParams.delete('payment_intent_client_secret');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  useEffect(() => {
    setTimedOut(false);
    if (!token) return;
    const timer = window.setTimeout(() => {
      setTimedOut(true);
    }, confirmationPollDurationMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [checkRound, token]);

  const status = useQuery({
    enabled: hydrated && token.length > 0,
    queryFn: () => getBookingStatus(token),
    queryKey: ['booking-status', token],
    refetchInterval: (query) =>
      query.state.status !== 'error' && shouldPollConfirmation(query.state.data, timedOut)
        ? confirmationPollIntervalMs
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    staleTime: 0,
  });
  const data = status.data;
  useEffect(() => {
    if (!data || !token || params.has('t') || params.has('token')) return;
    const url = new URL(window.location.href);
    url.searchParams.set('t', token);
    url.searchParams.delete('payment_intent_client_secret');
    window.history.replaceState(window.history.state, '', url);
  }, [data, params, token]);
  useEffect(() => {
    if (data?.status !== 'CONFIRMED') return;
    try {
      clearDraft();
    } catch {
      setClearWarning(bookingConfirmationCopy.clearFailed);
    }
  }, [clearDraft, data?.status]);
  const summary = useMemo(
    () =>
      data?.summary as
        | {
            dateLabel?: string;
            routeLabel?: string;
            service?: string;
            slotLabel?: string;
            totalPence?: number;
          }
        | null
        | undefined,
    [data],
  );
  useEffect(() => {
    if (data?.status !== 'CONFIRMED' || !data.reference) return;
    try {
      trackPurchase({
        reference: data.reference,
        ...(summary?.service ? { service: summary.service } : {}),
        totalPence: summary?.totalPence ?? 0,
      });
    } catch {
      setClearWarning(bookingConfirmationCopy.clearFailed);
    }
  }, [data?.reference, data?.status, summary?.service, summary?.totalPence]);

  const hasSavedCheckout = Boolean(
    draft.statusToken && draft.idempotencyKey && draft.quote && draft.selectedDate && draft.selectedSlot,
  );
  const hasMatchingDraft = Boolean(
    token &&
    draft.statusToken === token &&
    draft.idempotencyKey &&
    draft.quote &&
    draft.selectedDate &&
    draft.selectedSlot,
  );
  const busy = status.isFetching || recovering;

  function checkAgain(): void {
    setTimedOut(false);
    setCheckRound((round) => round + 1);
    void status.refetch();
  }

  async function recoverCheckout(freshPrices: boolean): Promise<void> {
    if (!hasMatchingDraft || busy) return;
    setRecoveryError(null);
    setRecovering(true);
    try {
      // Recheck immediately before navigating: payment may have completed meanwhile.
      const checked = await status.refetch();
      if (checked.error || !checked.data) return;
      const current = checked.data;
      const paymentStatus = current.checkout?.paymentStatus;
      if (current.status === 'CONFIRMED' || paymentStatus === 'PROCESSING' || paymentStatus === 'SUCCEEDED')
        return;
      if (freshPrices) {
        if (!canRefreshCheckout(current)) return;
        draft.setDraft({
          idempotencyKey: null,
          paymentIntentId: null,
          quote: null,
          quotePublicId: null,
          selectedDate: null,
          selectedSlot: null,
          statusToken: null,
        });
        router.push('/book?step=prices');
      } else if (
        current.checkout?.canRetry &&
        current.checkout.holdExpiresAt &&
        Date.parse(current.checkout.holdExpiresAt) > Date.now()
      ) {
        router.push('/book?step=pay');
      }
    } catch {
      setRecoveryError(bookingConfirmationCopy.error.message);
    } finally {
      setRecovering(false);
    }
  }

  if (!hydrated) return <ConfirmationLoading />;
  if (!token)
    return (
      <ConfirmationNotice state="missing">
        {hasSavedCheckout ? (
          <a className="button button-primary" href="/book?step=pay">
            {bookingConfirmationCopy.returnSavedCheckout}
          </a>
        ) : null}
        <a className="button button-secondary" href="/contact">
          {bookingConfirmationCopy.contact}
        </a>
      </ConfirmationNotice>
    );
  if (status.isLoading) return <ConfirmationLoading />;

  const view =
    status.isError || !data
      ? 'error'
      : confirmationState({ data, redirectStatus: params.get('redirect_status'), timedOut });
  if (view !== 'confirmed') {
    const retry =
      hasMatchingDraft &&
      data?.checkout?.canRetry &&
      (view === 'failed' || view === 'canceled' || view === 'pending');
    const reprice = hasMatchingDraft && data && canRefreshCheckout(data);
    return (
      <ConfirmationNotice
        state={view}
        loading={view === 'checking' && !timedOut}
        message={
          view === 'expired' && data?.status === 'PENDING_PAYMENT'
            ? bookingConfirmationCopy.awaitingClosure
            : undefined
        }
      >
        {storageWarning ? <p role="alert">{storageWarning}</p> : null}
        {recoveryError ? <p role="alert">{recoveryError}</p> : null}
        {!hasMatchingDraft &&
        (view === 'failed' || view === 'canceled' || view === 'pending' || view === 'expired') ? (
          <p>{bookingConfirmationCopy.noMatchingDraft}</p>
        ) : null}
        <div className="button-row">
          {retry ? (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => {
                void recoverCheckout(false);
              }}
              type="button"
            >
              {bookingConfirmationCopy.retryPayment}
            </button>
          ) : null}
          {reprice ? (
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => {
                void recoverCheckout(true);
              }}
              type="button"
            >
              {bookingConfirmationCopy.seePrices}
            </button>
          ) : null}
          <button className="button button-secondary" disabled={busy} onClick={checkAgain} type="button">
            {busy ? bookingConfirmationCopy.checkingAgain : bookingConfirmationCopy.checkAgain}
          </button>
          <a className="button button-ghost" href="/contact">
            {bookingConfirmationCopy.contact}
          </a>
        </div>
      </ConfirmationNotice>
    );
  }

  if (!data) return <ConfirmationNotice state="error" />;

  const reference = data.reference;
  if (reference === null) {
    return (
      <ConfirmationNotice state="error">
        <button className="button button-secondary" disabled={busy} onClick={checkAgain} type="button">
          {bookingConfirmationCopy.checkAgain}
        </button>
      </ConfirmationNotice>
    );
  }

  return (
    <section className="booking-page">
      <div className="booking-panel confirmation-card">
        <CheckCircle2 aria-hidden="true" color="#12805C" size={48} />
        <h1>{stripeTestMode ? paymentCopy.testBookingTitle : "You're booked"}</h1>
        <PaymentModeNotice />
        {clearWarning || storageWarning ? <p role="alert">{clearWarning ?? storageWarning}</p> : null}
        <div className="reference-box">
          <span>{reference}</span>
          <button
            className="button button-secondary"
            onClick={() => {
              void navigator.clipboard.writeText(reference);
              setCopied(true);
            }}
            type="button"
          >
            <Copy aria-hidden="true" size={16} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="checkout-summary">
          <div>
            <span>Date</span>
            <strong>{summary?.dateLabel}</strong>
          </div>
          <div>
            <span>Window</span>
            <strong>{summary?.slotLabel}</strong>
          </div>
          <div>
            <span>Route</span>
            <strong>{summary?.routeLabel}</strong>
          </div>
          <div>
            <span>{stripeTestMode ? paymentCopy.testTotal : 'Total paid'}</span>
            <strong>{formatGBP(summary?.totalPence ?? 0)}</strong>
          </div>
        </div>
        <ol className="next-list">
          <li>Confirmation email now.</li>
          <li>We assign your driver and email you their name.</li>
          <li>Reminder the day before.</li>
          <li>Live tracking link on the day.</li>
        </ol>
        <div className="button-row">
          <button
            className="button button-secondary"
            onClick={() => {
              downloadIcs(reference);
            }}
            type="button"
          >
            <Download aria-hidden="true" size={18} />
            Add to calendar
          </button>
          {data.manageUrl ? (
            <a className="button button-primary" href={data.manageUrl}>
              Manage your booking
            </a>
          ) : null}
          <button
            className="button button-secondary"
            onClick={() => {
              const shareUrl = new URL('/book/confirmation', window.location.origin);
              shareUrl.searchParams.set('t', token);
              void navigator.share({ text: `Speedy Van booking ${reference}`, url: shareUrl.toString() });
            }}
            type="button"
          >
            <Share2 aria-hidden="true" size={18} />
            Share details
          </button>
        </div>
      </div>
    </section>
  );
}
