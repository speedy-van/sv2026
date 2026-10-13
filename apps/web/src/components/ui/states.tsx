import { AlertTriangle, Inbox, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

export function SkeletonCard(): ReactNode {
  return (
    <div aria-label="Loading" aria-live="polite" className="state-card" role="status">
      <div className="skeleton" style={{ width: '42%' }} />
      <div className="skeleton" style={{ marginTop: 14, width: '72%' }} />
      <div className="skeleton skeleton-card" style={{ marginTop: 18 }} />
    </div>
  );
}

export function EmptyState(): ReactNode {
  return (
    <div className="state-card">
      <Inbox aria-hidden="true" color="#6D3BD7" size={28} />
      <h2>No jobs today</h2>
      <p>New bookings will appear here and the phone will ring.</p>
    </div>
  );
}

export function ErrorState(): ReactNode {
  return (
    <div className="state-card" role="alert">
      <AlertTriangle aria-hidden="true" color="#C8102E" size={28} />
      <h2>Something went wrong</h2>
      <p>Try again. If it keeps happening, call us.</p>
      <button className="button button-secondary" type="button">
        <RotateCw aria-hidden="true" size={18} />
        Try again
      </button>
    </div>
  );
}
