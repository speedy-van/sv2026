import { expect, test } from '@playwright/test';
import distancesData from '../src/content/locations/distances.generated.json' with { type: 'json' };
import { cityMarketingLinks } from '../src/content/marketing';
import { serviceContent } from '../src/content/services';
import { expectA11yClean } from './support/a11y';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    if (['GET', 'HEAD'].includes(route.request().method())) {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
    throw new Error(`SEO navigation must not mutate data: ${route.request().method()}`);
  });
});

test('@seo repairs make every removal route and city service reachable from the areas hub', async ({
  page,
}) => {
  await page.goto('/areas');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Areas we cover');
  const main = page.locator('main');
  for (const route of distancesData.routes) {
    await expect(main.locator(`a[href="/removals/${route.from}-to-${route.to}"]`)).toHaveCount(1);
  }
  for (const { href } of cityMarketingLinks) {
    const city = href.replace('/removals/', '');
    await expect(main.locator(`a[href="/man-and-van/${city}"]`)).toHaveCount(1);
  }
  await expect(main).toContainText('moves that need a ferry crossing are quoted individually');
  await expectA11yClean(page);
});

test('@seo repairs show real council coverage and contextual departure links on regional hubs', async ({
  page,
}) => {
  await page.goto('/areas/glasgow-and-clyde');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Glasgow City', exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Renfrewshire', exact: true })).toBeVisible();
  await expect(main.getByText(/Tier \d+ coverage page/)).toHaveCount(0);
  await expect(main.locator('a[href="/removals/glasgow-to-edinburgh"]')).toHaveCount(1);
  await expect(main.locator('a[href="/removals/edinburgh-to-glasgow"]')).toHaveCount(0);
  await main.locator('a[href="/removals/glasgow-to-edinburgh"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Glasgow to Edinburgh removals');
  await expectA11yClean(page);
});

test('@seo specialist service pages preserve the advertised service and variant in the booking wizard', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const specialists = serviceContent.filter(
    (service) => !['house-removals', 'man-and-van', 'furniture'].includes(service.engineKey),
  );
  for (const service of specialists) {
    await page.goto(`/services/${service.slug}`);
    await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
    const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
    if (await rejectCookies.isVisible()) await rejectCookies.click();
    const card = page.locator('main [data-booking-card]');
    await expect(card.getByRole('radio', { name: service.label, exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await card.getByRole('button', { name: 'See my prices', exact: true }).click();
    await expect(page.getByRole('combobox', { name: /^Move type\b/ })).toHaveValue(service.engineKey);
    if (['student', 'office', 'storage', 'piano'].includes(service.engineKey)) {
      await expect(page.getByRole('combobox', { name: 'Size or type', exact: true })).toHaveValue(service.variantKey);
    }
    const saved = await page.evaluate(() => {
      const draft: unknown = JSON.parse(sessionStorage.getItem('sv-booking-draft-v1') ?? 'null');
      return draft;
    });
    expect(saved).toMatchObject({ state: { service: service.engineKey, variant: service.variantKey } });
  }
});
