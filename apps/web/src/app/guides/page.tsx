import type { Metadata } from 'next';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { ReactNode } from 'react';
import { guideDrafts } from '@/content/marketing';

export const metadata: Metadata = {
  alternates: { canonical: '/guides' },
  description: 'Draft moving guides for owner review before publication.',
  robots: { follow: false, index: false },
  title: 'Guides',
};

export default function GuidesPage(): ReactNode {
  return (
    <section className="section page-hero">
      <div className="container">
        <h1 className="page-title">Guides</h1>
        <p className="lead">Starter guide drafts are being reviewed before publication.</p>
        <div className="article-grid">
          {guideDrafts.map((guide) => (
            <Link className="article-card" href={`/guides/${guide.slug}`} key={guide.slug}>
              <strong>{guide.title}</strong>
              <span>{guide.readingMinutes} min read - draft</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
