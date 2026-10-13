import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ManageDashboard, type ManageView } from '@/components/customer/manage-dashboard';
import { ManageRequestLinkForm } from '@/components/customer/manage-request-link-form';
import { manageTokenFromCookie } from '@/server/auth/manage-cookie';
import { manageView } from '@/server/services/customer-self-service';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  description: 'Manage your Speedy Van booking.',
  robots: { follow: false, index: false },
  title: 'Manage your booking',
};

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ expired?: string }> }): Promise<ReactNode> {
  const params = await searchParams;
  try {
    const token = await manageTokenFromCookie();
    const data = await manageView(token);
    return (
      <section className="section">
        <div className="container">
          <h1 className="page-title">Manage your booking</h1>
          <ManageDashboard initialData={data as unknown as ManageView} />
        </div>
      </section>
    );
  } catch {
    return (
      <section className="section">
        <div className="container two-column">
          <div>
            <h1 className="page-title">Manage your booking</h1>
            <p className="lead">Enter your email and booking reference. We'll email you a secure link.</p>
            {params.expired ? <p className="booking-alert booking-alert-warning">That link has expired. Enter your details to get a new one.</p> : null}
          </div>
          <ManageRequestLinkForm />
        </div>
      </section>
    );
  }
}
