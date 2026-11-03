import type { ReactNode } from 'react';
import { SkeletonCard } from '@/components/ui/states';

export function PageLoading(): ReactNode {
  return (
    <section aria-busy="true" className="section page-loading">
      <div className="container">
        <SkeletonCard />
      </div>
    </section>
  );
}
