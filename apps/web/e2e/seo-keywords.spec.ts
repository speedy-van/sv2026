import { expect, test as base, type Page } from '@playwright/test';
import locationsData from '../src/content/locations/locations.generated.json' with { type: 'json' };
import { searchIntents } from '../src/content/service-search';
import { serviceBySlug } from '../src/content/services';
import { expectA11yClean } from './support/a11y';

const test = base.extend<{ apiMutations: string[] }>({
  apiMutations: [
    async ({ page }, use) => {
      const mutations: string[] = [];
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        if (['GET', 'HEAD'].includes(request.method())) {
          await route.continue();
          return;
        }
        mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
        await route.abort('blockedbyclient');
      });
      await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//u, (route) => route.abort());
      await use(mutations);
      expect(mutations, 'Keyword navigation must not write bookings, payments or other API data').toEqual([]);
    },
    { auto: true },
  ],
});

async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/u);
  const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await rejectCookies.isVisible()) await rejectCookies.click();
}

for (const location of [
  { slug: 'paisley', name: 'Paisley', ferry: false },
  { slug: 'stornoway', name: 'Stornoway', ferry: true },
]) {
  test(`@seo keywords expose five local service sections in ${location.name}`, async ({ page }) => {
    await page.goto(`/removals/${location.slug}`);
    const main = page.locator('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(
      `Removals and man and van in ${location.name}`,
    );
    for (const intent of searchIntents) {
      const section = main.locator(`section[id="${intent.id}"]`);
      await expect(section).toHaveCount(1);
      await expect(section.getByRole('heading', { level: 2 })).toContainText(location.name);
      await expect(section.locator(`a[href="/services/${intent.serviceSlug}"]`)).toHaveCount(1);
    }
    if (location.ferry) {
      await expect(main).toContainText(/ferry/iu);
      await expect(main).toContainText(/quoted individually|manual quote|individual quote/iu);
      await expect(main.locator('[data-booking-card]')).toHaveCount(0);
      await expect(
        main.getByRole('heading', { name: `Example moves in ${location.name}`, exact: true }),
      ).toHaveCount(0);
    }
    await expectA11yClean(page);
  });
}

test('@seo keyword service hubs link every existing location to its owned page or local anchor', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const intent of searchIntents) {
    await page.goto(`/services/${intent.serviceSlug}`);
    const main = page.locator('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
    const hrefs = new Set(
      await main.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    );
    for (const location of locationsData) {
      const expected =
        intent.id === 'man-and-van' && location.tier === '1'
          ? `/man-and-van/${location.slug}`
          : `/removals/${location.slug}#${intent.id}`;
      expect(hrefs.has(expected), `${intent.id}: ${location.slug}`).toBe(true);
    }
  }
});

for (const slug of ['sofa-removals', 'flat-removals'] as const) {
  test(`@seo ${slug} CTA preserves its existing pricing service and variant`, async ({ page }) => {
    const service = serviceBySlug(slug);
    if (!service) throw new Error(`Required landing page missing: ${slug}`);
    await page.addInitScript(() => {
      sessionStorage.removeItem('sv-booking-draft-v1');
    });
    await page.goto(`/services/${slug}`);
    await waitForHydration(page);
    const card = page.locator('main [data-booking-card]');
    await expect(card.getByRole('radio', { name: service.label, exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await card.getByRole('button', { name: 'See my prices', exact: true }).click();
    await expect(page).toHaveURL(/\/book(?:\?|$)/u);
    await expect(page.getByRole('combobox', { name: /^Move type\b/u })).toHaveValue(service.engineKey);
    const saved: unknown = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('sv-booking-draft-v1') ?? 'null') as unknown,
    );
    expect(saved).toMatchObject({
      state: {
        service: service.engineKey,
        variant: service.variantKey,
        pickup: null,
        dropoff: null,
        quote: null,
      },
    });
  });
}
