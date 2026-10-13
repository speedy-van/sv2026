'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { formatGBP } from '@sv/contracts';
import { CreditCard } from 'lucide-react';
import { useState, type ReactNode, type SyntheticEvent } from 'react';

const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const stripePromise = stripeKey ? loadStripe(stripeKey) : null;

export interface PaymentRequestView {
  amountPence: number;
  description: string;
  expired: boolean;
  kind: string;
  paid: boolean;
  reference: string;
  summary: string;
  validUntil: string | null;
}

interface IntentResponse {
  amountPence: number;
  clientSecret: string;
}

async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Request failed with ${String(response.status)}`);
  return await response.json() as T;
}

function StripeConfirmForm({ amountPence, clientSecret, onPaid }: { amountPence: number; clientSecret: string; onPaid: () => void }): ReactNode {
  const elements = useElements();
  const stripe = useStripe();
  const [message, setMessage] = useState('');

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!stripe || !elements) return;
    const submitted = await elements.submit();
    if (submitted.error) {
      setMessage(submitted.error.message ?? 'Check your payment details.');
      return;
    }
    const result = await stripe.confirmPayment({
      clientSecret,
      confirmParams: { return_url: window.location.href },
      elements,
      redirect: 'if_required',
    });
    if (result.error) {
      setMessage(result.error.message ?? 'Payment failed.');
      return;
    }
    setMessage('Payment received - thank you.');
    onPaid();
  }

  return (
    <form className="contact-form" onSubmit={(event) => void submit(event)}>
      <PaymentElement options={{ layout: 'accordion' }} />
      <button className="button button-primary" disabled={!stripe} type="submit">Pay {formatGBP(amountPence)}</button>
      <p aria-live="polite" className="form-status">{message}</p>
    </form>
  );
}

export function PaymentPanel({ initialData, token }: { initialData: PaymentRequestView; token: string }): ReactNode {
  const [data, setData] = useState(initialData);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [processing, setProcessing] = useState(false);

  async function start(): Promise<void> {
    setProcessing(true);
    setMessage('');
    try {
      const intent = await jsonFetch<IntentResponse>(`/pay/${encodeURIComponent(token)}/intent`, { method: 'POST' });
      if (intent.clientSecret.startsWith('pi_mock_')) {
        await jsonFetch('/api/test/payments/succeed', {
          body: JSON.stringify({ clientSecret: intent.clientSecret }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
        setData((current) => ({ ...current, paid: true }));
        setMessage('Payment received - thank you.');
      } else {
        setClientSecret(intent.clientSecret);
      }
    } catch {
      setMessage('This payment could not be started. Call us and we will help.');
    } finally {
      setProcessing(false);
    }
  }

  if (data.expired) {
    return <div className="component-card"><h1>This payment link has expired.</h1><p>Call us and we'll send a new one.</p></div>;
  }
  if (data.paid) {
    return <div className="component-card"><h1>Payment received - thank you</h1><p>{data.reference}</p></div>;
  }

  return (
    <div className="component-card">
      <CreditCard aria-hidden="true" color="#6D3BD7" size={28} />
      <span className="status-badge">{data.reference}</span>
      <h1>{data.description}</h1>
      <p>{data.summary}</p>
      <p className="price-line"><strong>{formatGBP(data.amountPence)}</strong><span>{data.validUntil ? `Price held until ${new Date(data.validUntil).toLocaleString('en-GB')}` : 'Due now'}</span></p>
      <label className="toggle-row">
        <span>I agree to the terms and ask Speedy Van to start services within the cancellation period if needed.</span>
        <input checked={agreed} onChange={(event) => { setAgreed(event.target.checked); }} type="checkbox" />
      </label>
      {clientSecret && stripePromise ? (
        <Elements options={{ clientSecret }} stripe={stripePromise}>
          <StripeConfirmForm amountPence={data.amountPence} clientSecret={clientSecret} onPaid={() => { setData((current) => ({ ...current, paid: true })); }} />
        </Elements>
      ) : (
        <button className="button button-primary" disabled={!agreed || processing} onClick={() => void start()} type="button">
          {processing ? 'Processing' : `Pay ${formatGBP(data.amountPence)}`}
        </button>
      )}
      <p aria-live="polite" className="form-status">{message}</p>
    </div>
  );
}
