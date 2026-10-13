'use client';

import { ContactRequestSchema, ContactResponseSchema } from '@sv/contracts';
import { Send } from 'lucide-react';
import { useState, type ReactNode, type SyntheticEvent } from 'react';

type FormState = 'idle' | 'submitting' | 'sent' | 'error';

export function ContactForm(): ReactNode {
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);

  function formString(data: FormData, key: string): string {
    const value = data.get(key);
    return typeof value === 'string' ? value : '';
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      company: formString(data, 'company'),
      email: formString(data, 'email'),
      message: formString(data, 'message'),
      name: formString(data, 'name'),
      phone: formString(data, 'phone'),
    };
    const parsed = ContactRequestSchema.safeParse(payload);
    if (!parsed.success) {
      setError('Check your details and message, then try again.');
      setState('error');
      return;
    }
    setState('submitting');
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { controller.abort(); }, 10_000);
    let response: Response;
    try {
      response = await fetch('/api/v1/contact', {
        body: JSON.stringify(parsed.data),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });
    } catch {
      setError('We could not send this message. Try again in a moment.');
      setState('error');
      return;
    } finally {
      window.clearTimeout(timeout);
    }
    const body = ContactResponseSchema.safeParse(await response.json().catch(() => null));
    if (!response.ok || !body.success) {
      setError('We could not send this message. Try again in a moment.');
      setState('error');
      return;
    }
    form.reset();
    setState('sent');
  }

  return (
    <form className="contact-form" onSubmit={(event) => { void submit(event); }}>
      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input className="text-input" name="name" required type="text" autoComplete="name" />
        </label>
        <label className="field">
          <span>Email</span>
          <input className="text-input" name="email" required type="email" autoComplete="email" />
        </label>
      </div>
      <label className="field">
        <span>Phone, optional</span>
        <input className="text-input" name="phone" type="tel" autoComplete="tel" />
      </label>
      <label className="field hp-field">
        <span>Company</span>
        <input className="text-input" name="company" tabIndex={-1} type="text" autoComplete="off" />
      </label>
      <label className="field">
        <span>Message</span>
        <textarea className="text-input textarea-input" minLength={10} name="message" required rows={6} />
      </label>
      <button className="button button-primary" disabled={state === 'submitting'} type="submit">
        <Send aria-hidden="true" size={18} />
        {state === 'submitting' ? 'Sending...' : 'Send message'}
      </button>
      <p aria-live="polite" className={state === 'error' ? 'form-status error-text' : 'form-status'}>
        {state === 'sent' ? "Thanks - we'll reply by email." : null}
        {state === 'error' ? error : null}
      </p>
    </form>
  );
}
