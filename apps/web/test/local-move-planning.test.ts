import { describe, expect, it } from 'vitest';
import { councilMovingResources, getCouncilMovingResource } from '../src/content/council-moving-resources';
import { getLocalMovePlanning } from '../src/content/local-move-planning';
import {
  citySlugs,
  isIndexableLocation,
  locationPages,
  locationsBySlug,
  routeDistanceFor,
  routesBySlug,
  type LocationPage,
} from '../src/content/locations';
import distances from '../src/content/locations/distances.generated.json';

function location(slug: string): LocationPage {
  const result = locationsBySlug.get(slug);
  if (!result) throw new Error(`Required committed location missing: ${slug}`);
  return result;
}

describe('official council moving resources', () => {
  it('covers every committed council exactly once with an official HTTPS resource', () => {
    const committedCouncils = [...new Set(locationPages.map((place) => place.councilArea))].sort();
    expect(councilMovingResources).toHaveLength(32);
    expect(councilMovingResources.map((resource) => resource.councilArea).sort()).toEqual(committedCouncils);
    for (const resource of councilMovingResources) {
      expect(getCouncilMovingResource(resource.councilArea)).toEqual(resource);
      for (const href of [resource.href, ...resource.primarySourceURLs]) {
        const url = new URL(href);
        expect(url.protocol).toBe('https:');
        expect(url.hostname.endsWith('.gov.uk') || url.hostname === 'www.ayrshireroadsalliance.org').toBe(
          true,
        );
      }
      expect(resource.label).toBeTruthy();
      expect(resource.purpose).toBeTruthy();
      expect(resource.scopeNote).toBeTruthy();
      expect(`${resource.purpose} ${resource.scopeNote}`).not.toMatch(/£|\b\d+\s+(?:working\s+)?days?\b/iu);
    }
    expect(getCouncilMovingResource('constructor')).toBeUndefined();
    expect(getCouncilMovingResource('Unknown council')).toBeUndefined();
  });

  it('keeps limited verification and locality-specific procedures distinct from general council guidance', () => {
    const navigationOnly = councilMovingResources.filter(
      (resource) => resource.verificationLevel === 'navigation-only',
    );
    expect(navigationOnly.map((resource) => resource.councilArea).sort()).toEqual([
      'East Renfrewshire',
      'Glasgow City',
      'Perth and Kinross',
    ]);
    expect(getCouncilMovingResource('Aberdeen City')?.verificationLevel).toBe('scriptedCMS');
    expect(getCouncilMovingResource('Perth and Kinross')?.href).toBe(
      'https://www.pkc.gov.uk/article/14738/Parking',
    );
    expect(getCouncilMovingResource('South Ayrshire')?.scopeNote).toContain('named Ayr town-centre streets');
    expect(getCouncilMovingResource('East Ayrshire')?.scopeNote).toContain('Ayr-specific');
    expect(getCouncilMovingResource('North Ayrshire')?.href).toContain('north-ayrshire.gov.uk');
    for (const resource of navigationOnly) {
      expect(`${resource.purpose} ${resource.scopeNote}`).not.toMatch(
        /exempt|free parking|allowed to park|approved|guaranteed/iu,
      );
    }
  });
});

describe('data-derived local moving briefs', () => {
  it('projects the 656 existing eligible records from the raw 657 without changing ferry flags or price order', () => {
    expect(distances.cityDistances).toHaveLength(657);
    expect(locationPages.reduce((total, place) => total + place.cityDistances.length, 0)).toBe(656);
    for (const place of locationPages) {
      const expected = distances.cityDistances
        .filter((route) => route.from === place.slug && (citySlugs as readonly string[]).includes(route.to))
        .slice(0, 3);
      expect(place.cityDistances).toEqual(
        expected.map((route) => ({
          ferry: route.ferry,
          miles: route.miles,
          minutes: route.minutes,
          slug: route.to,
        })),
      );
      const first = expected[0];
      if (!first) throw new Error(`Missing price-example route: ${place.slug}`);
      expect(routeDistanceFor(place)).toEqual({ miles: first.miles, minutes: first.minutes });
    }
  });

  it('gives all 221 places only their real routes, four geographic neighbours and distinct origin/destination resources', () => {
    const before = JSON.stringify(locationPages);
    expect(locationPages).toHaveLength(221);
    for (const place of locationPages) {
      const brief = getLocalMovePlanning(place);
      expect(brief.heading).toContain(place.name);
      expect(brief.routes.length).toBeGreaterThanOrEqual(2);
      expect(brief.routes.length).toBeLessThanOrEqual(3);
      expect(new Set(brief.routes.map((route) => route.toSlug)).size).toBe(brief.routes.length);
      expect(brief.routes.map((route) => route.miles)).toEqual(
        brief.routes.map((route) => route.miles).sort((a, b) => a - b),
      );
      for (const route of brief.routes) {
        const committed = distances.cityDistances.find(
          (row) => row.from === place.slug && row.to === route.toSlug,
        );
        if (!committed) throw new Error(`Uncommitted route in brief: ${route.label}`);
        expect(route.toSlug).not.toBe(place.slug);
        expect(route.label).toBe(`${place.name} to ${route.toName}`);
        expect(route.miles).toBe(committed.miles);
        expect(route.ferry).toBe(committed.ferry);
        expect(route.minutes).toBe(committed.ferry ? null : committed.minutes);
        const routeSlug = `${place.slug}-to-${route.toSlug}`;
        expect(route.href).toBe(
          routesBySlug.has(routeSlug) ? `/removals/${routeSlug}` : `/removals/${route.toSlug}`,
        );
      }
      expect(brief.nearbyPlaces.map((nearby) => nearby.slug)).toEqual(place.nearest.slice(0, 4));
      expect(brief.nearbyIntro).toContain('geographically');
      expect(brief.nearbyIntro).toContain('not a ranking of driving times');
      for (const nearby of brief.nearbyPlaces) {
        expect(nearby.councilArea).toBe(locationsBySlug.get(nearby.slug)?.councilArea);
        expect(nearby.href).toBe(`/removals/${nearby.slug}`);
      }
      expect(brief.resources[0]?.councilArea).toBe(place.councilArea);
      expect(brief.resources.map((resource) => resource.councilArea)).toEqual(
        [...new Set([place.councilArea, ...brief.routes.map((route) => route.councilArea)])].slice(0, 3),
      );
    }
    expect(JSON.stringify(locationPages)).toBe(before);
  });

  it('does not invent a third city comparison when only two existing eligible routes remain', () => {
    const twoRoutes = locationPages
      .filter((place) => getLocalMovePlanning(place).routes.length === 2)
      .map((place) => place.slug)
      .sort();
    // Six origins have two raw records; Stirling's third raw destination is Falkirk,
    // which the existing city-only projection excludes. Preserve that projection.
    expect(twoRoutes).toEqual([
      'aberdeen',
      'dundee',
      'dunfermline',
      'edinburgh',
      'inverness',
      'perth',
      'stirling',
    ]);
  });

  it('sorts the Paisley view without changing its price source and gives city links an existing target', () => {
    const paisley = location('paisley');
    expect(paisley.cityDistances[0]?.slug).toBe('dunfermline');
    expect(getLocalMovePlanning(paisley).routes[0]).toMatchObject({
      toSlug: 'glasgow',
      miles: 9.43,
      minutes: 28,
      distanceText: '9.43 miles, about 28 min by road.',
    });
    expect(routeDistanceFor(paisley)).toEqual({ miles: 46.74, minutes: 71 });
    const glasgow = getLocalMovePlanning(location('glasgow'));
    expect(glasgow.routes.find((route) => route.toSlug === 'edinburgh')?.href).toBe(
      '/removals/glasgow-to-edinburgh',
    );
  });

  it('hides ferry durations, qualifies same-island moves, and preserves Dunoon route checks', () => {
    const stornoway = getLocalMovePlanning(location('stornoway'));
    expect(stornoway.cta.href).toBe('/contact');
    expect(stornoway.routeNote).toContain('within the same island may not need a ferry');
    for (const route of stornoway.routes) {
      expect(route.ferry).toBe(true);
      expect(route.minutes).toBeNull();
      expect(route.distanceText).toContain('including a ferry crossing');
      expect(route.distanceText).not.toMatch(/\d+\s*(?:min|hr)\b/iu);
    }
    const dunoon = getLocalMovePlanning(location('dunoon'));
    expect(dunoon.cta.href).toBe('/contact');
    expect(dunoon.routeNote).toContain('address-based check');
    expect(dunoon.routeNote).toContain('another route may differ');
    const portree = getLocalMovePlanning(location('portree'));
    expect(portree.cta.href).toBe('/book');
    expect(portree.routes.every((route) => !route.ferry && route.minutes !== null)).toBe(true);
    expect(portree.routeNote).toContain('island status alone does not mean a ferry is required');
    expect(portree.routeNote).toContain('do not include a ferry crossing');
  });

  it('uses purpose-specific small-move copy without changing notes or staged indexing eligibility', () => {
    const glasgow = location('glasgow');
    const small = getLocalMovePlanning(glasgow, 'man-and-van');
    const home = getLocalMovePlanning(glasgow);
    expect(small.heading).toBe('Plan a small move from Glasgow');
    expect(small.lead).toContain('a few items or a room move');
    expect(small.heading).not.toBe(home.heading);
    expect(small.routes).toEqual(home.routes);
    expect(locationPages.filter((place) => isIndexableLocation(place, false))).toHaveLength(59);
    const tier3 = locationPages.find((place) => place.tier === 3);
    if (!tier3) throw new Error('Committed tier-3 location missing.');
    getLocalMovePlanning(tier3);
    expect(isIndexableLocation(tier3, false)).toBe(false);
    expect(isIndexableLocation(tier3, false, 'reviewed '.repeat(119))).toBe(false);
    expect(isIndexableLocation(tier3, false, 'reviewed '.repeat(120))).toBe(true);
    expect(Object.keys(home)).not.toContain('localNotes');
  });
});
