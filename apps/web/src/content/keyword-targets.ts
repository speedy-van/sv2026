import type { LocationPage } from './locations';
import type { SearchIntentId } from './service-search';

export function localSearchTarget(intent: SearchIntentId, location: LocationPage): string {
  // Tier 1 is the eight cities in the committed Scotland location dataset.
  if (intent === 'man-and-van' && location.tier === 1) return `/man-and-van/${location.slug}`;
  return `/removals/${location.slug}#${intent}`;
}
