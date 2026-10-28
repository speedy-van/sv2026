import type { ReactNode } from 'react';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import type { LocationPage } from '@/content/locations';
import { localSearchSections } from '@/content/service-search';

export function LocalSearchServices({ location }: { location: LocationPage }): ReactNode {
  return localSearchSections(location).map((section, index) => (
    <section
      className={`section local-service-section${index % 2 === 0 ? ' section-muted' : ''}`}
      id={section.id}
      key={section.id}
    >
      <div className="container article-body">
        <h2>{section.heading}</h2>
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <Link className="text-link" href={section.serviceHref}>
          {section.serviceLabel}
        </Link>
      </div>
    </section>
  ));
}
