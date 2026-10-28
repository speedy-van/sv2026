import { describe, expect, it } from 'vitest';
import {
  groupLocationsByCouncil,
  regionalCoverageLead,
  routesFromLocations,
} from '../src/content/area-coverage';
import { locationPages, regionLocations, regions, routePages } from '../src/content/locations';

describe('area coverage navigation', () => {
  it('lists every committed location exactly once under its actual council', () => {
    const groups = groupLocationsByCouncil(locationPages);
    const listed = groups.flatMap((group) => group.locations);
    expect(groups).toHaveLength(32);
    expect(listed).toHaveLength(221);
    expect(new Set(listed.map((location) => location.slug)).size).toBe(221);
    expect(
      groups
        .find((group) => group.councilArea === 'Renfrewshire')
        ?.locations.map((location) => location.slug),
    ).toContain('paisley');
    for (const group of groups) {
      expect(group.locations.every((location) => location.councilArea === group.councilArea)).toBe(true);
      expect(group.locations.map((location) => location.name)).toEqual(
        group.locations
          .map((location) => location.name)
          .sort((left, right) => left.localeCompare(right, 'en-GB')),
      );
    }
  });

  it('keeps directional route links in the departure region and covers all 26 routes', () => {
    const allDepartures = regions.flatMap((region) => {
      const locations = regionLocations(region.slug);
      const departures = routesFromLocations(locations, routePages);
      for (const route of departures) {
        expect(
          locations.some((location) => location.slug === route.fromSlug),
          route.slug,
        ).toBe(true);
      }
      return departures;
    });
    expect(allDepartures).toHaveLength(26);
    expect(new Set(allDepartures.map((route) => route.slug)).size).toBe(26);
    const glasgowRoutes = routesFromLocations(regionLocations('glasgow-and-clyde'), routePages);
    expect(glasgowRoutes.some((route) => route.slug === 'glasgow-to-edinburgh')).toBe(true);
    expect(glasgowRoutes.some((route) => route.slug === 'edinburgh-to-glasgow')).toBe(false);
  });

  it('uses named council coverage in region copy without public rollout tiers', () => {
    const groups = groupLocationsByCouncil(regionLocations('glasgow-and-clyde'));
    const lead = regionalCoverageLead(
      'Glasgow and Clyde',
      groups.map((group) => group.councilArea),
    );
    expect(lead).toContain('Glasgow City');
    expect(lead).toContain('Renfrewshire');
    expect(lead).not.toMatch(/Tier \d|undefined|null/);
  });
});
