import { expect, test, type Locator, type Page } from '@playwright/test';

async function isolatePage(page: Page): Promise<string[]> {
  const mutations: string[] = [];
  // Logo coverage needs no API data; never allow a browser request to mutate local data.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
    await route.fulfill({ status: 404, json: { error: { message: 'API requests are isolated in logo tests.' } } });
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//, (route) => route.abort());
  return mutations;
}

async function visitHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
  const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click();
    await expect(page.getByRole('region', { name: 'Cookie preferences', exact: true })).toBeHidden();
  }
}

async function expectLogoLoaded(logo: Locator): Promise<void> {
  await logo.scrollIntoViewIfNeeded();
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAccessibleName('Speedy Van home');
  await expect(logo).toHaveAttribute('href', '/');
  await expect(logo.getByText('Speedy Van', { exact: true })).toBeVisible();
  const image = logo.locator('img.logo-badge-image');
  await expect(image).toHaveCount(1);
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('alt', '');
  await expect.poll(async () => image.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) return false;
    return element.complete && element.naturalWidth > 0 && element.naturalHeight > 0;
  })).toBe(true);
  const box = await logo.boundingBox();
  if (!box) throw new Error('Logo home link must have a visible box.');
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

async function expectHeaderFits(page: Page, viewportWidth: number): Promise<void> {
  const header = page.locator('.site-header');
  const box = await header.boundingBox();
  if (!box) throw new Error('Site header must have a visible box.');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
  const sizing = await header.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(sizing.scroll).toBeLessThanOrEqual(sizing.client + 1);
  const logoBox = await header.locator('.header-inner > .logo').boundingBox();
  if (!logoBox) throw new Error('Header logo must have a visible box.');
  expect(logoBox.x).toBeGreaterThanOrEqual(box.x);
  expect(logoBox.x + logoBox.width).toBeLessThanOrEqual(box.x + box.width);
}

async function logoAnimations(logo: Locator): Promise<Array<{ name: string; iterations: string }>> {
  return logo.evaluate((element) => {
    const badge = element.querySelector('.logo-badge');
    const image = element.querySelector('.logo-badge-image');
    if (!badge || !image) throw new Error('Shared logo must render its badge and image.');
    return [
      getComputedStyle(badge),
      getComputedStyle(image),
      getComputedStyle(badge, '::before'),
      getComputedStyle(badge, '::after'),
    ].map((style) => ({ name: style.animationName, iterations: style.animationIterationCount }));
  });
}

async function expectMotionDisabled(logo: Locator): Promise<void> {
  for (const animation of await logoAnimations(logo)) expect(animation.name).toBe('none');
}

test.use({ reducedMotion: 'no-preference' });

for (const width of [360, 1440]) {
  test(`@foundation shared badge loads in header and footer without overflow at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const mutations = await isolatePage(page);
    await visitHome(page);
    const headerLogo = page.locator('.header-inner > .logo');
    await expectLogoLoaded(headerLogo);
    await expectHeaderFits(page, width);
    const intro = (await logoAnimations(headerLogo)).filter((animation) => animation.name !== 'none');
    expect(intro.length).toBeGreaterThan(0);
    for (const animation of intro) expect(animation.iterations).not.toContain('infinite');

    await expectLogoLoaded(page.locator('footer.footer .logo'));
    await page.evaluate(() => { window.scrollTo(0, 0); });
    if (width === 360) {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      const menu = page.getByRole('dialog', { name: 'Navigation menu', exact: true });
      await expect(menu).toBeVisible();
      await expectLogoLoaded(menu.getByRole('link', { name: 'Speedy Van home', exact: true }));
      await menu.getByRole('button', { name: 'Close menu', exact: true }).click();
      await expect(menu).toBeHidden();
    }
    await expectHeaderFits(page, width);
    expect(mutations).toEqual([]);
  });
}

test('@foundation reduced motion disables badge, image and shine animations during hover and focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mutations = await isolatePage(page);
  await visitHome(page);
  for (const logo of [page.locator('.header-inner > .logo'), page.locator('footer.footer .logo')]) {
    await expectLogoLoaded(logo);
    await expectMotionDisabled(logo);
    await logo.hover();
    await expectMotionDisabled(logo);
    await page.keyboard.press('Tab');
    await logo.focus();
    await expect(logo).toBeFocused();
    await expectMotionDisabled(logo);
  }
  expect(mutations).toEqual([]);
});
