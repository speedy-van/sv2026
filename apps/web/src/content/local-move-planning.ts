import { getCouncilMovingResource, type CouncilMovingResource } from './council-moving-resources';
import {
  locationsBySlug,
  locationUrl,
  nearestLocations,
  routeUrl,
  routesBySlug,
  type LocationPage,
} from './locations';

export interface LocalPlanningRoute {
  councilArea: string;
  distanceText: string;
  ferry: boolean;
  href: string;
  label: string;
  miles: number;
  minutes: number | null;
  toName: string;
  toSlug: string;
}

export interface LocalPlanningPlace {
  councilArea: string;
  href: string;
  name: string;
  slug: string;
}

export interface LocalMovePlanning {
  cta: { href: string; label: string };
  heading: string;
  lead: string;
  nearbyIntro: string;
  nearbyPlaces: LocalPlanningPlace[];
  parkingNote: string;
  resources: CouncilMovingResource[];
  routeIntro: string;
  routeNote: string | null;
  routes: LocalPlanningRoute[];
}

export const localMovePlanningCopy = {
  ferryRouteLabel: 'Includes a ferry crossing',
  nearbyHeading: 'Nearby places and council areas',
  resourcesHeading: 'Official parking and access information',
  roadRouteLabel: 'Road route',
  routesHeading: 'Compare journeys from this location',
} as const;

const milesFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

function roadDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0) return `${String(remaining)} min`;
  return remaining === 0 ? `${String(hours)} hr` : `${String(hours)} hr ${String(remaining)} min`;
}

function planningRoute(
  location: LocationPage,
  distance: LocationPage['cityDistances'][number],
): LocalPlanningRoute | null {
  const destination = locationsBySlug.get(distance.slug);
  if (!destination || destination.slug === location.slug) return null;
  const dedicatedRoute = routesBySlug.get(`${location.slug}-to-${destination.slug}`);
  const miles = `${milesFormat.format(distance.miles)} miles`;
  return {
    councilArea: destination.councilArea,
    distanceText: distance.ferry
      ? `${miles} on the recorded route, including a ferry crossing; confirm crossing arrangements with the team.`
      : `${miles}, about ${roadDuration(distance.minutes)} by road.`,
    ferry: distance.ferry,
    href: dedicatedRoute ? routeUrl(dedicatedRoute) : locationUrl(destination),
    label: `${location.name} to ${destination.name}`,
    miles: distance.miles,
    minutes: distance.ferry ? null : distance.minutes,
    toName: destination.name,
    toSlug: destination.slug,
  };
}

function localRouteNote(location: LocationPage, routes: readonly LocalPlanningRoute[]): string | null {
  if (location.ferry === 'YES') {
    return `For a move involving ${location.name}, ask the team to check both addresses and any crossing before arranging collection. A journey within the same island may not need a ferry; the recorded comparisons identify crossings for those particular routes. Ferry bookings need an individual quote, including the crossing arrangements.`;
  }
  if (location.ferry === 'CHECK') {
    return `Routes involving ${location.name} need an address-based check. The recorded comparisons${routes.some((route) => route.ferry) ? ' include ferry crossings, but another route may differ' : ' do not establish whether your own journey needs a ferry'}. Confirm the route, access and any crossing with the team before relying on a price or collection time.`;
  }
  if (location.island) {
    return `${location.name} is an island location, but island status alone does not mean a ferry is required. The recorded routes shown here${routes.some((route) => route.ferry) ? ' include a crossing where indicated' : ' do not include a ferry crossing'}. Enter both exact addresses to check your own journey.`;
  }
  return null;
}

export function getLocalMovePlanning(
  location: LocationPage,
  purpose: 'removals' | 'man-and-van' = 'removals',
): LocalMovePlanning {
  // Sorting belongs to this view only: stored route order also drives existing price examples.
  const routes = location.cityDistances
    .map((distance) => planningRoute(location, distance))
    .filter((route): route is LocalPlanningRoute => route !== null)
    .sort((left, right) => left.miles - right.miles);
  const nearbyPlaces = nearestLocations(location, 4).map((nearby) => ({
    councilArea: nearby.councilArea,
    href: locationUrl(nearby),
    name: nearby.name,
    slug: nearby.slug,
  }));
  const councilAreas = [
    ...new Set([location.councilArea, ...routes.map((route) => route.councilArea)]),
  ].slice(0, 3);
  const resources = councilAreas
    .map(getCouncilMovingResource)
    .filter((resource): resource is CouncilMovingResource => resource !== undefined);
  const needsRouteCheck = location.ferry !== 'NO';
  return {
    cta: needsRouteCheck
      ? { href: '/contact', label: `Check a ${location.name} route with the team` }
      : { href: '/book', label: `Check prices for your ${location.name} move` },
    heading:
      purpose === 'man-and-van'
        ? `Plan a small move from ${location.name}`
        : `Plan your collection and delivery in ${location.name}`,
    lead:
      purpose === 'man-and-van'
        ? `Use these recorded journeys from ${location.name} to compare the route for a few items or a room move. Add the actual load, then check pickup and delivery access separately; a short drive can still involve stairs or a long carry.`
        : `Compare the journeys from ${location.name}, then plan how your belongings will leave one property and enter the next. Check floors, usable lift space, doorways and the carry from a legal stopping place at both addresses.`,
    nearbyIntro: `These places are geographically near ${location.name}; they are not a ranking of driving times. Their council areas help you identify the right parking information if your move crosses a council boundary.`,
    nearbyPlaces,
    parkingNote: `The first resource covers ${location.councilArea}; the others cover the compared destination cities. Check the exact street and the proposed loading activity with the relevant council or property contact. Do not assume a resident permit or advisory cones reserve a space for a removal van; confirm any permission needed for private access separately.`,
    resources,
    routeIntro: `Recorded place-to-city route estimates from ${location.name}, ordered by distance. Your full addresses can change the route. Road times are travel estimates, excluding loading, unloading and stops; ferry durations are not presented as driving times.`,
    routeNote: localRouteNote(location, routes),
    routes,
  };
}
