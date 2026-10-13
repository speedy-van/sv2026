'use client';

import { Truck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

export interface TrackingView {
  dateLabel: string;
  driverFirstName: string | null;
  jobStage: string;
  liveLocation: { fresh: boolean; lat: number; lng: number; recordedAt: string } | null;
  reference: string;
  reviewUrl: string | null;
  slotLabel: string;
  status: string;
  vanRegistration: string | null;
}

function stageCopy(view: TrackingView): string {
  if (view.status === 'CANCELLED') return 'This booking was cancelled.';
  if (view.status === 'COMPLETED' || view.jobStage === 'COMPLETED') return 'Your move is complete';
  if (view.jobStage === 'EN_ROUTE_TO_PICKUP') return `${view.driverFirstName ?? 'Your driver'} is on the way`;
  if (view.jobStage === 'AT_PICKUP') return 'Your driver has arrived';
  if (view.jobStage === 'LOADING') return 'Loading your things';
  if (view.jobStage === 'EN_ROUTE_TO_DROPOFF') return `${view.driverFirstName ?? 'Your driver'} is on the way to your new place`;
  if (view.jobStage === 'AT_DROPOFF') return 'Arrived at your new place';
  if (view.jobStage === 'UNLOADING') return 'Unloading';
  return `Your move is on ${view.dateLabel}, ${view.slotLabel}. Tracking goes live on the day.`;
}

export function TrackingPanel({ initialData, token }: { initialData: TrackingView; token: string }): ReactNode {
  const [data, setData] = useState(initialData);

  useEffect(() => {
    if (data.status === 'COMPLETED' || data.status === 'CANCELLED') return undefined;
    let stopped = false;
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`/track/${encodeURIComponent(token)}/data`);
        if (response.ok && !stopped) setData(await response.json() as TrackingView);
      } catch {
        return;
      }
    };
    const handle = window.setInterval(() => {
      void poll();
    }, document.hidden ? 60_000 : 10_000);
    return () => {
      stopped = true;
      window.clearInterval(handle);
    };
  }, [data.status, token]);

  return (
    <section className="component-card">
      <Truck aria-hidden="true" color="#6D3BD7" size={28} />
      <span className="status-badge">{data.reference}</span>
      <h1>{stageCopy(data)}</h1>
      <p>{data.driverFirstName ? `Driver: ${data.driverFirstName}` : 'Driver not confirmed yet.'}</p>
      {data.vanRegistration ? <p>Van: {data.vanRegistration}</p> : null}
      {data.liveLocation ? (
        <div className="route-map" role="img" aria-label="Latest driver location">
          <svg viewBox="0 0 400 220" role="presentation">
            <rect width="400" height="220" fill="#0B1F33" />
            <circle cx="200" cy="110" fill="#FFC93C" r="16" />
            <text className="map-city" x="224" y="116">Latest van location</text>
          </svg>
          <p className="field-help">Last updated {new Date(data.liveLocation.recordedAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}{data.liveLocation.fresh ? '' : ' (stale)'}</p>
        </div>
      ) : <p className="field-help">Location is hidden until the driver is en route.</p>}
      {data.reviewUrl ? <a className="button button-primary" href={data.reviewUrl}>Review your move</a> : null}
      <a className="button button-secondary" href="/contact">Contact the office</a>
    </section>
  );
}
