import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PaymentPanel, type PaymentRequestView } from '@/components/customer/payment-panel';
import { payRequestView } from '@/server/services/customer-self-service';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: 'Pay Speedy Van',
};

export default async function PayPage({ params }: { params: Promise<{ token: string }> }): Promise<ReactNode> {
  const { token } = await params;
  try {
    const data = await payRequestView(decodeURIComponent(token));
    return (
      <section className="section">
        <div className="container two-column">
          <div>
            <h1 className="page-title">Pay securely</h1>
            <p className="lead">Payments are processed by Stripe. We never see your card number.</p>
          </div>
          <PaymentPanel initialData={data as unknown as PaymentRequestView} token={token} />
        </div>
      </section>
    );
  } catch {
    return (
      <section className="section">
        <div className="container">
          <div className="component-card">
            <h1>This payment link has expired.</h1>
            <p>Call us and we'll send a new one.</p>
          </div>
        </div>
      </section>
    );
  }
}
