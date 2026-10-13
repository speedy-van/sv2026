import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ReviewForm, type ReviewView } from '@/components/customer/review-form';
import { reviewView } from '@/server/services/customer-self-service';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: 'Review your move',
};

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }): Promise<ReactNode> {
  const { token } = await params;
  const data = await reviewView(decodeURIComponent(token));
  return (
    <section className="section">
      <div className="container two-column">
        <div>
          <h1 className="page-title">Review your move</h1>
          <p className="lead">Reviews are checked before publication. Negative reviews are not filtered out.</p>
        </div>
        <ReviewForm initialData={data as unknown as ReviewView} token={token} />
      </div>
    </section>
  );
}
