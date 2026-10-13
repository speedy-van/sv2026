'use client';

import { Mail } from 'lucide-react';
import { useState, type ReactNode, type SyntheticEvent } from 'react';

const neutralMessage = "If those details match a booking, we've emailed you a link. It can take a minute to arrive.";

export function ManageRequestLinkForm(): ReactNode {
  const [message, setMessage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  function formValue(form: FormData, key: string): string {
    const value = form.get(key);
    return typeof value === 'string' ? value : '';
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage('');
    try {
      await fetch('/manage/request-link', {
        body: JSON.stringify({
          email: formValue(form, 'email'),
          reference: formValue(form, 'reference'),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      setMessage(neutralMessage);
    } catch {
      setMessage(neutralMessage);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="contact-form" onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label htmlFor="manage-email">Email</label>
        <input className="text-input" id="manage-email" name="email" required type="email" />
      </div>
      <div className="field">
        <label htmlFor="manage-reference">Booking reference</label>
        <input className="text-input" id="manage-reference" name="reference" placeholder="SV-XXXXXX" required />
        <span className="field-help">Format hint: SV-XXXXXX. The dash is optional.</span>
      </div>
      <button className="button button-primary" disabled={submitting} type="submit">
        <Mail aria-hidden="true" size={18} />
        {submitting ? 'Sending' : 'Email me a link'}
      </button>
      <p aria-live="polite" className="form-status">{message}</p>
    </form>
  );
}
