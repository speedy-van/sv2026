import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getReviewSummary } from '@/server/marketing';

export const metadata: Metadata = {
  alternates: { canonical: '/reviews' },
  description: 'Verified Speedy Van booking reviews and review policy.',
  title: 'Reviews',
};

export default async function ReviewsPage(): Promise<ReactNode> {
  const summary = await getReviewSummary();
  return (
    <>
      <section className="section page-hero">
        <div className="container">
          <h1 className="page-title">Reviews</h1>
          {summary.count > 0 ? (
            <p className="lead">{summary.average?.toFixed(1)} average from {summary.count} verified booking reviews.</p>
          ) : (
            <p className="lead">Published reviews will appear here after completed bookings are reviewed.</p>
          )}
        </div>
      </section>
      <section className="section section-muted">
        <div className="container">
          <h2>How we collect reviews</h2>
          <p className="lead">Every review comes from a customer who completed a booking. We publish all reviews except ones that break the moderation rules, such as abuse or personal details.</p>
          {summary.reviews.length > 0 ? (
            <div className="review-grid">
              {summary.reviews.map((review) => (
                <article className="review-card" key={`${review.displayName}-${review.date}`}>
                  <strong>{review.displayName}</strong>
                  <p>{review.comment}</p>
                  <small>{review.rating}/5 - {review.town ? `${review.town} - ` : ''}{review.date} - Verified booking</small>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-note">No published reviews yet.</p>
          )}
        </div>
      </section>
    </>
  );
}
