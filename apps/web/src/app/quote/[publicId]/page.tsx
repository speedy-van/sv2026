import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: 'Resume your quote',
};

export default async function QuoteResumePage({ params }: { params: Promise<{ publicId: string }> }): Promise<ReactNode> {
  const { publicId } = await params;
  return (
    <section className="section">
      <div className="container state-card">
        <h1>Resume your quote</h1>
        <p className="lead">Continue with your saved Speedy Van quote. If prices have expired, we will refresh them before you pay.</p>
        <Link className="button button-primary" href={`/book?step=prices&quote=${encodeURIComponent(publicId)}`}>
          Continue quote
        </Link>
      </div>
    </section>
  );
}
