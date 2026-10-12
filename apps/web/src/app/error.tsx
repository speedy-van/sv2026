'use client';

import type { ReactNode } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): ReactNode {
  return (
    <section className="section">
      <div className="container">
        <div className="state-card" role="alert">
          <h1 className="page-title">Something went wrong on our side.</h1>
          <p className="lead">Try again. If it keeps happening, call us.</p>
          {error.digest ? <p className="field-help">Reference: {error.digest}</p> : null}
          <button className="button button-primary" onClick={reset} type="button">
            Try again
          </button>
        </div>
      </div>
    </section>
  );
}
