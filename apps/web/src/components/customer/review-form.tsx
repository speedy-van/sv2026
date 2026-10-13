'use client';

import { Star } from 'lucide-react';
import { useState, type ReactNode, type SyntheticEvent } from 'react';

export interface ReviewView {
  alreadyReviewed: boolean;
  displayName: string;
  googleBusinessProfileUrl: string | null;
  reference: string;
  town: string;
}

export function ReviewForm({ initialData, token }: { initialData: ReviewView; token: string }): ReactNode {
  const [done, setDone] = useState(initialData.alreadyReviewed);
  const [rating, setRating] = useState(5);
  const [message, setMessage] = useState(done ? "You've already reviewed this move. Thank you." : '');

  function formValue(form: FormData, key: string): string {
    const value = form.get(key);
    return typeof value === 'string' ? value : '';
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/review/${encodeURIComponent(token)}/submit`, {
      body: JSON.stringify({
        comment: formValue(form, 'comment'),
        displayName: formValue(form, 'displayName'),
        rating,
        town: formValue(form, 'town'),
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (response.status === 409) {
      setDone(true);
      setMessage("You've already reviewed this move. Thank you.");
      return;
    }
    if (response.ok) {
      setDone(true);
      setMessage('Thank you for your review.');
      return;
    }
    setMessage('We could not save your review. Please try again.');
  }

  return (
    <form className="contact-form" onSubmit={(event) => void submit(event)}>
      <span className="status-badge">{initialData.reference}</span>
      <h1>How did we do?</h1>
      {done ? <p>{message}</p> : (
        <>
          <fieldset className="choice-grid compact">
            <legend className="field-help">Rating</legend>
            {[1, 2, 3, 4, 5].map((value) => (
              <label className={rating === value ? 'choice-card selected' : 'choice-card'} key={value}>
                <input checked={rating === value} className="sr-only" name="rating" onChange={() => { setRating(value); }} type="radio" value={value} />
                <Star aria-hidden="true" fill="#FFC93C" size={20} />
                {value} {value === 1 ? 'star - poor' : value === 5 ? 'stars - excellent' : 'stars'}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="review-comment">Comment</label>
            <textarea className="text-input textarea-input" id="review-comment" maxLength={1000} name="comment" />
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="review-name">Display name</label>
              <input className="text-input" defaultValue={initialData.displayName} id="review-name" maxLength={40} name="displayName" required />
            </div>
            <div className="field">
              <label htmlFor="review-town">Town</label>
              <input className="text-input" defaultValue={initialData.town} id="review-town" name="town" />
            </div>
          </div>
          <p className="field-help">Your review may appear on our website with your first name, last initial and town.</p>
          <button className="button button-primary" type="submit">Submit review</button>
        </>
      )}
      {done && initialData.googleBusinessProfileUrl ? <a className="button button-secondary" href={initialData.googleBusinessProfileUrl}>Review us on Google</a> : null}
      <p aria-live="polite" className="form-status">{message}</p>
    </form>
  );
}
