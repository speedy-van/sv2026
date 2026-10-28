import type { ReactNode } from 'react';
import { NoPrefetchLink as Link } from '@/components/navigation/no-prefetch-link';
import { getLocalMovePlanning, localMovePlanningCopy } from '@/content/local-move-planning';
import type { LocationPage } from '@/content/locations';

export function LocalMovePlanning({
  location,
  purpose = 'removals',
}: {
  location: LocationPage;
  purpose?: 'removals' | 'man-and-van';
}): ReactNode {
  const planning = getLocalMovePlanning(location, purpose);

  return (
    <section className="section section-muted" data-local-planning id="local-move-planning">
      <div className="container">
        <h2>{planning.heading}</h2>
        <p className="local-planning-lead">{planning.lead}</p>
        <div className="two-column local-planning-grid">
          <div className="table-card">
            <h3>{localMovePlanningCopy.routesHeading}</h3>
            <p>{planning.routeIntro}</p>
            <ul className="local-planning-list">
              {planning.routes.map((route) => (
                <li data-ferry={route.ferry} data-planning-route={route.toSlug} key={route.toSlug}>
                  <Link className="text-link" href={route.href}>
                    {route.label}
                  </Link>
                  <p>{route.distanceText}</p>
                </li>
              ))}
            </ul>
            {planning.routeNote ? <p className="local-planning-note">{planning.routeNote}</p> : null}
          </div>
          <div className="table-card">
            <h3>{localMovePlanningCopy.resourcesHeading}</h3>
            <p>{planning.parkingNote}</p>
            <ul className="local-planning-list">
              {planning.resources.map((resource) => (
                <li key={resource.councilArea}>
                  <a
                    className="text-link"
                    data-council-resource={resource.councilArea}
                    href={resource.href}
                    rel="external"
                  >
                    {resource.label}
                  </a>
                  <p>{resource.purpose}</p>
                  <p className="field-help">{resource.scopeNote}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="article-body">
            <h3>{localMovePlanningCopy.nearbyHeading}</h3>
            <p>{planning.nearbyIntro}</p>
            <ul className="local-planning-list">
              {planning.nearbyPlaces.map((place) => (
                <li key={place.slug}>
                  <Link className="text-link" href={place.href}>
                    {place.name}
                  </Link>
                  <span> · {place.councilArea}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="section-actions">
          <Link className="button button-primary" href={planning.cta.href}>
            {planning.cta.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
