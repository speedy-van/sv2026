'use client';

import { formatGBP } from '@sv/contracts';
import { CalendarDays, CreditCard, FileText, MapPin, RefreshCw, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface AddressSummary {
  label: string;
  town: string;
  postcode: string;
}

interface ManageActionState {
  canCancel: boolean;
  canReschedule: boolean;
  cancelReason: string;
  rescheduleReason: string;
}

export interface ManageView {
  actions: ManageActionState;
  balancePence: number;
  customerNotes: string | null;
  date: string;
  dateLabel: string;
  dispatchStatus: string;
  driver: { firstName: string | null; vanRegistration: string | null } | null;
  dropoff: AddressSummary | null;
  events: Array<{ at: string; toStage: string | null; type: string }>;
  jobStage: string;
  paidPence: number;
  payments: Array<{ amountPence: number; kind: string; status: string }>;
  pickup: AddressSummary;
  receiptUrl: string;
  reference: string;
  refundedPence: number;
  reviewUrl: string | null;
  routeLabel: string;
  signature: { signedAt: string; signedName: string } | null;
  slot: 'MORNING' | 'AFTERNOON' | 'EVENING';
  slotLabel: string;
  status: string;
  totalPence: number;
  trackUrl: string;
}

interface ReschedulePreview {
  allowed: boolean;
  currentTotalPence: number;
  differencePence: number;
  newTotalPence: number;
}

interface RescheduleResult {
  clientSecret?: string;
  result: 'DONE' | 'PAYMENT_REQUIRED';
}

interface CancelPreview {
  allowed: boolean;
  policySummary: string;
  refundPence: number;
}

async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Request failed with ${String(response.status)}`);
  return await response.json() as T;
}

function differenceCopy(value: number): string {
  if (value > 0) return `You'll pay ${formatGBP(value)} more`;
  if (value < 0) return `We'll refund ${formatGBP(-value)}`;
  return 'Same price';
}

export function ManageDashboard({ initialData }: { initialData: ManageView }): ReactNode {
  const [data, setData] = useState(initialData);
  const [notes, setNotes] = useState(initialData.customerNotes ?? '');
  const [message, setMessage] = useState('');
  const [reschedulePreview, setReschedulePreview] = useState<ReschedulePreview | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(initialData.date);
  const [rescheduleSlot, setRescheduleSlot] = useState<ManageView['slot']>(initialData.slot);
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const next = await jsonFetch<ManageView>('/manage/booking', { method: 'GET' });
    setData(next);
    setNotes(next.customerNotes ?? '');
  }

  async function saveNotes(): Promise<void> {
    setBusy(true);
    setMessage('');
    try {
      await jsonFetch('/manage/booking/notes', {
        body: JSON.stringify({ customerNotes: notes }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      });
      setMessage('Notes saved');
      await refresh();
    } catch {
      setMessage('Notes could not be saved. Call us if it is urgent.');
    } finally {
      setBusy(false);
    }
  }

  async function previewReschedule(): Promise<void> {
    setBusy(true);
    setMessage('');
    try {
      const preview = await jsonFetch<ReschedulePreview>('/manage/booking/reschedule/preview', {
        body: JSON.stringify({ date: rescheduleDate, slot: rescheduleSlot }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      setReschedulePreview(preview);
      setMessage(differenceCopy(preview.differencePence));
    } catch {
      setMessage(data.actions.rescheduleReason || 'This booking cannot be rescheduled online.');
    } finally {
      setBusy(false);
    }
  }

  async function applyReschedule(): Promise<void> {
    if (!reschedulePreview) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await jsonFetch<RescheduleResult>('/manage/booking/reschedule', {
        body: JSON.stringify({
          date: rescheduleDate,
          expectedDifferencePence: reschedulePreview.differencePence,
          idempotencyKey: crypto.randomUUID(),
          slot: rescheduleSlot,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (result.result === 'PAYMENT_REQUIRED' && result.clientSecret) {
        if (result.clientSecret.startsWith('pi_mock_')) {
          await jsonFetch('/api/test/payments/succeed', {
            body: JSON.stringify({ clientSecret: result.clientSecret }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          });
          setMessage('Payment received. Your move is now updated.');
        } else {
          setMessage('Pay difference to confirm the new date.');
        }
      } else {
        setMessage('Your move is now updated.');
      }
      setReschedulePreview(null);
      await refresh();
    } catch {
      setMessage('The new slot could not be confirmed. Please try another slot.');
    } finally {
      setBusy(false);
    }
  }

  async function previewCancel(): Promise<void> {
    setBusy(true);
    setMessage('');
    try {
      const preview = await jsonFetch<CancelPreview>('/manage/booking/cancel/preview', { method: 'POST' });
      setCancelPreview(preview);
      setMessage(preview.allowed ? `Refund: ${formatGBP(preview.refundPence)}` : preview.policySummary);
    } catch {
      setMessage('This booking cannot be cancelled online.');
    } finally {
      setBusy(false);
    }
  }

  async function applyCancel(): Promise<void> {
    if (!cancelPreview) return;
    setBusy(true);
    setMessage('');
    try {
      await jsonFetch('/manage/booking/cancel', {
        body: JSON.stringify({ expectedRefundPence: cancelPreview.refundPence, reason: 'Customer self-service' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      setMessage('Booking cancelled');
      await refresh();
    } catch {
      setMessage('The cancellation could not be completed. Please call us.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="state-grid">
      <section className="component-card">
        <span className="status-badge">{data.status.replaceAll('_', ' ')}</span>
        <h1>{data.reference}</h1>
        <p>{data.dateLabel}, {data.slotLabel}</p>
        <p className="field-help">{data.routeLabel} · {data.dispatchStatus.replaceAll('_', ' ')}</p>
      </section>

      {data.balancePence > 0 ? (
        <section className="component-card">
          <CreditCard aria-hidden="true" color="#6D3BD7" size={24} />
          <h2>{formatGBP(data.balancePence)} to pay</h2>
          <a className="button button-primary" href="#payments">Pay now</a>
        </section>
      ) : null}

      <section className="component-card">
        <MapPin aria-hidden="true" color="#6D3BD7" size={24} />
        <h2>Your move</h2>
        <p><strong>From:</strong> {data.pickup.label}</p>
        {data.dropoff ? <p><strong>To:</strong> {data.dropoff.label}</p> : null}
        <p className="field-help">Job stage: {data.jobStage.replaceAll('_', ' ')}</p>
      </section>

      <section className="component-card">
        <FileText aria-hidden="true" color="#6D3BD7" size={24} />
        <h2>Notes for your driver</h2>
        <label className="field-group" htmlFor="customer-driver-notes">
          <span>Notes</span>
          <textarea id="customer-driver-notes" className="text-input textarea-input" onChange={(event) => { setNotes(event.target.value); }} value={notes} />
        </label>
        <button className="button button-secondary" disabled={busy} onClick={() => void saveNotes()} type="button">Save notes</button>
      </section>

      <section className="component-card">
        <h2>Your driver</h2>
        <p>{data.driver?.firstName ? `Your driver is ${data.driver.firstName}.` : "We'll email you when your driver is confirmed."}</p>
        {data.driver?.vanRegistration ? <p>Van registration: {data.driver.vanRegistration}</p> : null}
      </section>

      <section className="component-card" id="payments">
        <h2>Payments</h2>
        <dl className="breakdown-list">
          <div><dt>Total</dt><dd>{formatGBP(data.totalPence)}</dd></div>
          <div><dt>Paid</dt><dd>{formatGBP(data.paidPence)}</dd></div>
          <div><dt>Refunded</dt><dd>{formatGBP(data.refundedPence)}</dd></div>
        </dl>
        <a className="text-link" href={data.receiptUrl}>Receipt</a>
      </section>

      <section className="component-card">
        <CalendarDays aria-hidden="true" color="#6D3BD7" size={24} />
        <h2>Actions</h2>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="reschedule-date">New date</label>
            <input className="text-input" id="reschedule-date" onChange={(event) => { setRescheduleDate(event.target.value); }} type="date" value={rescheduleDate} />
          </div>
          <div className="field">
            <label htmlFor="reschedule-slot">New window</label>
            <select className="text-input" id="reschedule-slot" onChange={(event) => { setRescheduleSlot(event.target.value as ManageView['slot']); }} value={rescheduleSlot}>
              <option value="MORNING">Morning</option>
              <option value="AFTERNOON">Afternoon</option>
              <option value="EVENING">Evening</option>
            </select>
          </div>
        </div>
        <div className="button-row">
          <button className="button button-secondary" disabled={busy || !data.actions.canReschedule} onClick={() => void previewReschedule()} type="button">
            <RefreshCw aria-hidden="true" size={18} />
            Change date
          </button>
          {reschedulePreview ? <button className="button button-primary" disabled={busy} onClick={() => void applyReschedule()} type="button">Confirm change</button> : null}
        </div>
        {!data.actions.canReschedule ? <p className="field-help">{data.actions.rescheduleReason}</p> : null}
        <div className="button-row">
          <button className="button button-danger" disabled={busy || !data.actions.canCancel} onClick={() => void previewCancel()} type="button">
            <XCircle aria-hidden="true" size={18} />
            Cancel booking
          </button>
          {cancelPreview?.allowed ? <button className="button button-danger" disabled={busy} onClick={() => void applyCancel()} type="button">Cancel my booking</button> : null}
        </div>
        {cancelPreview ? <p>{cancelPreview.policySummary} Refund: {formatGBP(cancelPreview.refundPence)}.</p> : null}
        <div className="button-row">
          <a className="button button-secondary" href={data.trackUrl}>Track your move</a>
          {data.reviewUrl ? <a className="button button-secondary" href={data.reviewUrl}>How did we do?</a> : null}
        </div>
      </section>

      <section className="component-card">
        <h2>Timeline</h2>
        {data.events.length > 0 ? (
          <ol className="next-list">
            {data.events.map((event) => (
              <li key={`${event.at}-${event.toStage ?? event.type}`}>{event.type.replaceAll('_', ' ')} {event.toStage ? `to ${event.toStage.replaceAll('_', ' ')}` : ''}</li>
            ))}
          </ol>
        ) : <p>Booked.</p>}
      </section>

      {data.signature ? (
        <section className="component-card">
          <h2>After the move</h2>
          <p>Signed by {data.signature.signedName}.</p>
        </section>
      ) : null}

      <p aria-live="polite" className="form-status">{message}</p>
    </div>
  );
}
