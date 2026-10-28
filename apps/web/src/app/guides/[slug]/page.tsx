import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BookingStartCard } from '@/components/booking/booking-start-card';
import { guideDrafts } from '@/content/marketing';
import { createPageMetadata, getSeoSettings } from '@/server/seo';

export function generateStaticParams(): Array<{ slug: string }> {
  return guideDrafts.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideDrafts.find((entry) => entry.slug === slug);
  if (!guide) notFound();
  return createPageMetadata({
    description: `${guide.title} - draft guide for owner review.`,
    follow: false,
    indexable: false,
    path: `/guides/${guide.slug}`,
    settings: await getSeoSettings(),
    title: guide.title,
  });
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }): Promise<ReactNode> {
  const { slug } = await params;
  const guide = guideDrafts.find((entry) => entry.slug === slug);
  if (!guide) notFound();
  return (
    <>
      <section className="section page-hero">
        <div className="container two-column">
          <article className="article-body">
            <p className="draft-banner">Draft - awaiting owner review</p>
            <h1 className="page-title">{guide.title}</h1>
            <p className="field-help">{guide.readingMinutes} min read</p>
            {guide.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </article>
          <BookingStartCard title="Price your move" />
        </div>
      </section>
    </>
  );
}
