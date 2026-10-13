import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TrackingPanel, type TrackingView } from '@/components/customer/tracking-panel';
import { trackingView } from '@/server/services/customer-self-service';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: 'Track your move',
};

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }): Promise<ReactNode> {
  const { token } = await params;
  const data = await trackingView(decodeURIComponent(token));
  return (
    <section className="section">
      <div className="container">
        <TrackingPanel initialData={data as unknown as TrackingView} token={token} />
      </div>
    </section>
  );
}
