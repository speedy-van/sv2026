import { formatGBP } from '@sv/contracts';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { manageTokenFromCookie } from '@/server/auth/manage-cookie';
import { manageView } from '@/server/services/customer-self-service';
import type { ManageView } from '@/components/customer/manage-dashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: 'Booking receipt',
};

export default async function ReceiptPage(): Promise<ReactNode> {
  const data = await manageView(await manageTokenFromCookie()) as unknown as ManageView;
  return (
    <section className="section">
      <div className="container legal-copy">
        <h1 className="page-title">Receipt</h1>
        <p>Booking reference {data.reference}</p>
        <table className="data-table">
          <tbody>
            <tr><th scope="row">Move</th><td>{data.routeLabel}</td></tr>
            <tr><th scope="row">Date</th><td>{data.dateLabel}, {data.slotLabel}</td></tr>
            <tr><th scope="row">Total</th><td>{formatGBP(data.totalPence)}</td></tr>
            <tr><th scope="row">Paid</th><td>{formatGBP(data.paidPence)}</td></tr>
            <tr><th scope="row">Refunded</th><td>{formatGBP(data.refundedPence)}</td></tr>
          </tbody>
        </table>
        <p className="field-help">Use your browser print command to save or print this receipt.</p>
      </div>
    </section>
  );
}
