import type { ReactNode } from 'react';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { localSearchTarget } from '@/content/keyword-targets';
import { citySlugs, locationPages, locationsBySlug, regionLabels, regions } from '@/content/locations';
import { getServiceSearchContent, searchIntents } from '@/content/service-search';

export function ServiceSearchCoverage({ serviceSlug }: { serviceSlug: string }): ReactNode {
  const intent = searchIntents.find((item) => item.serviceSlug === serviceSlug);
  const content = getServiceSearchContent(serviceSlug);
  if (!intent || !content) return null;

  return (
    <section className="section section-muted" id="service-coverage">
      <div className="container">
        <h2>{content.coverageHeading}</h2>
        <p className="lead">{content.coverageLead}</p>
        <div className="city-links">
          {citySlugs.map((slug) => {
            const city = locationsBySlug.get(slug);
            return city ? (
              <Link href={localSearchTarget(intent.id, city)} key={slug}>
                {intent.label} in {city.name}
              </Link>
            ) : null;
          })}
        </div>
        <div className="accordion-list service-coverage-regions">
          {regions.map((region) => (
            <details className="accordion-item" key={region.slug}>
              <summary>{regionLabels[region.slug]}</summary>
              <div className="city-links service-coverage-towns">
                {locationPages
                  .filter((location) => location.region === region.slug)
                  .sort((left, right) => left.name.localeCompare(right.name, 'en-GB'))
                  .map((location) => (
                    <Link href={localSearchTarget(intent.id, location)} key={location.slug}>
                      {intent.label} in {location.name}
                    </Link>
                  ))}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
