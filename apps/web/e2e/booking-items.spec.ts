import { expect, test, type Locator } from '@playwright/test';

async function expectTouchTarget(control: Locator): Promise<void> {
  const bounds = await control.boundingBox();
  if (!bounds) throw new Error('Expected a visible item control.');
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
}

test.use({ reducedMotion: 'reduce' });

test('@booking item search hides room lists and custom items stay editable within contract limits', async ({ page }, testInfo) => {
  const mutations: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/catalogue') {
      await route.fulfill({ json: { items: [], presets: [], categories: [], customSizes: { S: 0.05, M: 0.2, L: 0.5, XL: 1 } } });
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.method());
    await route.fulfill({ status: 404, json: { error: { message: 'Not part of isolated item test.' } } });
  });
  await page.route(/https:\/\/[^/]*stripe\.(?:com|network)\//, (route) => route.abort());
  await page.addInitScript({ content: 'window.Stripe = Object.assign(function () { return null; }, { version: "endive" });' });
  await page.addInitScript(() => {
    const address = {
      line1: '1 Test Street', town: 'Glasgow', postcode: 'G1 1AA',
      label: '1 Test Street, Glasgow G1 1AA', lat: 55.8642, lng: -4.2518, source: 'MANUAL',
    };
    sessionStorage.setItem('sv-booking-draft-v1', JSON.stringify({ version: 1, state: {
      service: 'man-and-van', variant: 'standard', pickup: address, dropoff: address,
      items: [{ kind: 'custom', name: 'Test box', quantity: 1, size: 'M' }],
    } }));
  });
  await page.goto('/book?step=items');
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
  const rejectCookies = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await rejectCookies.isVisible()) await rejectCookies.click();
  await expect(page.getByRole('heading', { name: 'Items', exact: true })).toBeVisible();

  const rooms = page.locator('.inventory-accordion');
  await expect(rooms).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search all items', exact: true });
  await search.fill('sofa');
  await expect(page.getByRole('region', { name: 'Search results', exact: true })).toBeVisible();
  await expect(rooms).toBeHidden();
  const clear = page.getByRole('button', { name: 'Clear search', exact: true });
  await expectTouchTarget(clear);
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(rooms).toBeVisible();

  const ownItemName = page.getByRole('textbox', { name: "Can't find something? Add it as your own item.", exact: true });
  const name = 'a'.repeat(60);
  await ownItemName.fill(`${name}b`);
  await expect(ownItemName).toHaveValue(name);
  await page.getByRole('button', { name: 'Add own item', exact: true }).click();
  const ownItems = page.getByRole('list', { name: 'Your own items', exact: true });
  await expect(ownItems.getByRole('listitem')).toHaveCount(2);
  const remove = ownItems.getByRole('button', { name: `Remove ${name}`, exact: true });
  await page.screenshot({ path: testInfo.outputPath('custom-item.png'), fullPage: true });
  await expectTouchTarget(remove);
  const itemBounds = await ownItems.boundingBox();
  const removeBounds = await remove.boundingBox();
  if (!itemBounds || !removeBounds) throw new Error('Custom item row must have visible bounds.');
  expect(removeBounds.x + removeBounds.width).toBeLessThanOrEqual(itemBounds.x + itemBounds.width + 1);
  expect(removeBounds.x + removeBounds.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  await remove.click({ timeout: 10_000 });
  await expect(ownItems.getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('.booking-summary-count')).toHaveText('1 item selected');
  expect(mutations).toEqual([]);
});
