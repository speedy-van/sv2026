import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import distancesData from '../src/content/locations/distances.generated.json' with { type: 'json' };
import locationsData from '../src/content/locations/locations.generated.json' with { type: 'json' };

type CommittedLocation = (typeof locationsData)[number];

const examples = [
  {
    slug: 'paisley',
    path: '/removals/paisley',
    purpose: 'removals',
    councilUrl: 'https://www1.renfrewshire.gov.uk/article/10454/Parking-dispensation',
  },
  {
    slug: 'stornoway',
    path: '/removals/stornoway',
    purpose: 'removals',
    councilUrl: 'https://www.cne-siar.gov.uk/roads-and-travel/traffic-regulation-orders-tro',
  },
  {
    slug: 'portree',
    path: '/removals/portree',
    purpose: 'removals',
    councilUrl: 'https://www.highland.gov.uk/parking',
  },
  {
    slug: 'dunoon',
    path: '/removals/dunoon',
    purpose: 'removals',
    councilUrl: 'https://www.argyll-bute.gov.uk/roads-and-travel/car-parks-and-parking',
  },
  {
    slug: 'glasgow',
    path: '/man-and-van/glasgow',
    purpose: 'man-and-van',
    councilUrl: 'https://www.glasgow.gov.uk/roads',
  },
] as const;

const serviceAnchors = [
  { id: 'man-and-van', href: '/services/man-and-van' },
  { id: 'furniture-removals', href: '/services/furniture-delivery' },
  { id: 'sofa-removals', href: '/services/sofa-removals' },
  { id: 'house-removals', href: '/services/house-removals' },
  { id: 'flat-removals', href: '/services/flat-removals' },
] as const;

function committedLocation(slug: string): CommittedLocation {
  const location = locationsData.find((item) => item.slug === slug);
  if (!location) throw new Error(`Required committed location is missing: ${slug}`);
  return location;
}

async function isolateReadOnlyPage(page: Page): Promise<string[]> {
  const mutations: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' || request.method() === 'HEAD') {
      await route.continue();
      return;
    }
    mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.abort('blockedbyclient');
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//u, (route) => route.abort());
  return mutations;
}

async function expectRecordedJourneys(planning: Locator, location: CommittedLocation): Promise<void> {
  // Read the committed source data directly, without importing the production planning helper.
  const routes = distancesData.cityDistances.filter(
    (route) => route.from === location.slug && route.to !== location.slug,
  );
  const rows = planning.locator('li[data-planning-route]');
  await expect(rows).toHaveCount(routes.length);
  expect(routes.length).toBeGreaterThan(0);

  const displayedDistances: number[] = [];
  for (const destinationSlug of await rows.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-planning-route')),
  )) {
    const route = routes.find((item) => item.to === destinationSlug);
    if (!route)
      throw new Error(
        `Planning displayed an unrecorded route: ${location.slug} to ${String(destinationSlug)}`,
      );
    displayedDistances.push(route.miles);
  }
  expect(displayedDistances).toEqual([...displayedDistances].sort((left, right) => left - right));

  for (const route of routes) {
    const destination = committedLocation(route.to);
    const row = planning.locator(`li[data-planning-route="${route.to}"]`);
    await expect(row).toHaveAttribute('data-ferry', String(route.ferry));
    const link = row.getByRole('link', { name: `${location.name} to ${destination.name}`, exact: true });
    const dedicatedRoute = distancesData.routes.some(
      (candidate) => candidate.from === location.slug && candidate.to === destination.slug,
    );
    await expect(link).toHaveAttribute(
      'href',
      dedicatedRoute ? `/removals/${location.slug}-to-${destination.slug}` : `/removals/${destination.slug}`,
    );

    const facts = await row.locator('p').innerText();
    const miles = facts.match(/([\d,.]+)\s+miles\b/iu)?.[1];
    expect(
      miles,
      `Recorded mileage must be visible for ${location.slug} to ${destination.slug}`,
    ).toBeDefined();
    expect(Number(miles?.replaceAll(',', ''))).toBe(route.miles);
    if (route.ferry) {
      expect(facts).toMatch(/ferry crossing/iu);
      expect(facts).not.toMatch(/\d+\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/iu);
    } else {
      const hours = facts.match(/(\d+)\s*(?:hours?|hrs?|h)\b/iu)?.[1];
      const minutes = facts.match(/(\d+)\s*(?:minutes?|mins?|m)\b/iu)?.[1];
      expect(hours ?? minutes, 'Road routes must show their recorded travel estimate').toBeDefined();
      expect(Number(hours ?? 0) * 60 + Number(minutes ?? 0)).toBe(route.minutes);
      expect(facts).toMatch(/by road/iu);
    }
  }
}

async function expectLocalPlanningContent(page: Page, example: (typeof examples)[number]): Promise<Locator> {
  const location = committedLocation(example.slug);
  const planning = page.locator('#local-move-planning[data-local-planning]');
  await expect(planning).toHaveCount(1);
  await expect(planning.getByRole('heading', { level: 2 })).toHaveText(
    example.purpose === 'man-and-van'
      ? `Plan a small move from ${location.name}`
      : `Plan your collection and delivery in ${location.name}`,
  );
  await expectRecordedJourneys(planning, location);

  const originResource = planning.locator(`a[data-council-resource="${location.council_area}"]`);
  await expect(originResource).toHaveCount(1);
  await expect(originResource).toHaveAttribute('href', example.councilUrl);
  await expect(planning.locator('a[data-council-resource]').first()).toHaveAttribute(
    'data-council-resource',
    location.council_area,
  );
  await expect(originResource).toHaveAccessibleName(/\S/u);
  await expect(planning).toContainText(location.council_area);

  const nearby = planning.locator('.article-body');
  await expect(nearby.locator('li')).toHaveCount(4);
  for (const slug of location.nearestLocations.slice(0, 4)) {
    const place = committedLocation(slug);
    const link = nearby.getByRole('link', { name: place.name, exact: true });
    await expect(link).toHaveAttribute('href', `/removals/${place.slug}`);
    await expect(link.locator('..')).toContainText(place.council_area);
  }
  await expect(nearby).toContainText(/geographically near/iu);
  await expect(nearby).toContainText(/not a ranking of driving times/iu);

  const cta = planning.locator('.section-actions').getByRole('link');
  if (location.ferry === 'NO') {
    await expect(cta).toHaveAttribute('href', '/book');
    await expect(cta).toHaveAccessibleName(`Check prices for your ${location.name} move`);
  } else {
    await expect(cta).toHaveAttribute('href', '/contact');
    await expect(cta).toHaveAccessibleName(`Check a ${location.name} route with the team`);
  }

  if (example.slug === 'stornoway') {
    await expect(planning.locator('.local-planning-note')).toContainText(
      /same island may not need a ferry/iu,
    );
    await expect(planning.locator('.local-planning-note')).toContainText(/individual quote/iu);
    const robots = (await page.locator('meta[name="robots"]').getAttribute('content')) ?? '';
    const directives = robots.toLowerCase().split(/\s*,\s*/u);
    expect(directives).toContain('noindex');
    expect(directives).toContain('follow');
    expect(directives).not.toContain('nofollow');
  }
  if (example.slug === 'portree') {
    await expect(planning.locator('.local-planning-note')).toContainText(
      /island status alone does not mean a ferry/iu,
    );
    await expect(planning.locator('.local-planning-note')).toContainText(/do not include a ferry crossing/iu);
    await expect(planning.locator('li[data-planning-route][data-ferry="true"]')).toHaveCount(0);
  }
  if (example.slug === 'dunoon') {
    await expect(planning.locator('.local-planning-note')).toContainText(/address-based check/iu);
    await expect(planning.locator('.local-planning-note')).toContainText(/another route may differ/iu);
  }
  if (example.purpose === 'man-and-van') {
    await expect(planning.locator('.local-planning-lead')).toContainText(/few items or a room move/iu);
    await expect(page.locator('main a[href="/removals/glasgow#house-removals"]')).toHaveCount(1);
  }
  return planning;
}

async function expectPlanningLayout(page: Page, planning: Locator): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const bounds = await planning.evaluate((element) => {
    const viewportWidth = document.documentElement.clientWidth;
    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      sectionWidth: element.clientWidth,
      sectionScrollWidth: element.scrollWidth,
      links: [...element.querySelectorAll('a[href]')].map((link) => {
        const rect = link.getBoundingClientRect();
        return {
          name: link.textContent.trim() || 'Planning link',
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      }),
    };
  });
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  expect(bounds.sectionScrollWidth).toBeLessThanOrEqual(bounds.sectionWidth + 1);
  for (const link of bounds.links) {
    expect(link.width, `${link.name} touch width`).toBeGreaterThanOrEqual(44);
    expect(link.height, `${link.name} touch height`).toBeGreaterThanOrEqual(44);
    expect(link.left).toBeGreaterThanOrEqual(-1);
    expect(link.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  }
}

for (const example of examples) {
  test(`@seo local planning stays factual and accessible on ${example.path}`, async ({ page }) => {
    const mutations = await isolateReadOnlyPage(page);
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: 932 });
      const response = await page.goto(example.path, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/u);
      const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
      if (await rejectCookies.isVisible()) await rejectCookies.click();
      const planning = await expectLocalPlanningContent(page, example);
      await expectPlanningLayout(page, planning);
      const councilLink = planning.locator('a[data-council-resource]').first();
      await councilLink.focus();
      await expect(councilLink).toBeFocused();
      const results = await new AxeBuilder({ page })
        .include('#local-move-planning')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    }
    expect(mutations, 'Local planning visits must not write API data').toEqual([]);
  });
}

test('@seo local planning, official resources and town service anchors render without JavaScript', async ({
  browser,
}) => {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error('Local planning checks need the configured production URL.');
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 360, height: 932 },
  });
  try {
    const page = await context.newPage();
    const mutations = await isolateReadOnlyPage(page);
    for (const example of examples) {
      const response = await page.goto(example.path, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      const html = (await response?.text()) ?? '';
      expect(html).toContain('data-local-planning');
      expect(html).toContain(example.councilUrl);
      const planning = await expectLocalPlanningContent(page, example);
      await expect(planning.getByRole('heading', { level: 2 })).toBeVisible();
      if (example.purpose === 'removals') {
        const name = committedLocation(example.slug).name;
        for (const intent of serviceAnchors) {
          const section = page.locator(`main section[id="${intent.id}"]`);
          await expect(section).toHaveCount(1);
          await expect(section.getByRole('heading', { level: 2 })).toContainText(name);
          await expect(section.locator(`a[href="${intent.href}"]`)).toHaveCount(1);
        }
      }
    }
    expect(mutations, 'JavaScript-disabled visits must not write API data').toEqual([]);
  } finally {
    await context.close();
  }
});
