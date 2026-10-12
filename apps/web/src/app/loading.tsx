import type { ReactNode } from 'react';
import { SkeletonCard } from '@/components/ui/states';

export default function Loading(): ReactNode {
  return (
    <section className="section">
      <div className="container">
        <SkeletonCard />
      </div>
    </section>
  );
}
