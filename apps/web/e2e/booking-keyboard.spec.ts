import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

const suggestions = Array.from({ length: 10 }, (_, index) => ({
  id: `address-${String(index)}`,
  kind: 'address',
  primary: `${String(index + 1)} Test Street`,
  secondary: 'Glasgow, G1 1AA, United Kingdom',
}));

function requestQuery(route: Route): string {
  const body: unknown = route.request().postDataJSON();
  if (!body || typeof body !== 'object' || !('q' in body) || typeof body.q !== 'string') {
    throw new Error('Address search must send a query.');
  }
  return body.q;
}

async function visit(page: Page, path: '/' | '/book'): Promise<{ field: Locator; list: Locator }> {
  await page.goto(path);
  await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled', /^(true|false)$/);
  const reject = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await reject.isVisible()) await reject.click();
  const container = path === '/' ? page.locator('.home-hero [data-booking-card]') : page.locator('.booking-main');
  const field = container.getByRole('combobox', { name: 'From', exact: true });
  const list = container.locator('.address-field').filter({ has: page.getByRole('combobox', { name: 'From', exact: true }) }).getByRole('listbox', { includeHidden: true });
  return { field, list };
}

for (const path of ['/', '/book'] as const) {
  test(`@booking address keyboard opens, closes, scrolls and selects on ${path}`, async ({ page }) => {
    await page.route('**/api/v1/address/suggest', (route) => route.fulfill({ json: { suggestions } }));
    let retrieved = '';
    await page.route('**/api/v1/address/retrieve', async (route) => {
      const body: unknown = route.request().postDataJSON();
      if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string') throw new Error('Missing address ID');
      retrieved = body.id;
      await route.fulfill({ json: { address: {
        line1: '10 Test Street', town: 'Glasgow', postcode: 'G1 1AA',
        label: '10 Test Street, Glasgow, G1 1AA', lat: 55.8642, lng: -4.2518, source: 'MAPBOX', mapboxId: body.id,
      } } });
    });
    const { field, list } = await visit(page, path);
    await field.fill('Glasgow');
    await expect(list).toBeVisible();
    await expect(list).not.toContainText('United Kingdom');
    await field.press('ArrowDown');
    await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await field.press('Escape');
    await expect(field).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toBeHidden();
    await field.press('ArrowUp');
    await expect(list).toBeVisible();
    await expect(list.getByRole('option').last()).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => list.evaluate((node) => {
      const option = node.lastElementChild;
      if (!option) return false;
      return option.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom + 1;
    })).toBe(true);
    await field.press('Enter');
    await expect.poll(() => retrieved).toBe('address-9');
    await expect(page.getByRole('button', { name: 'Change from address', exact: true })).toBeVisible();
  });

  test(`@booking Enter never selects a dismissed address on ${path}`, async ({ page }) => {
    let retrieved = false;
    await page.route('**/api/v1/address/suggest', (route) => route.fulfill({ json: { suggestions } }));
    await page.route('**/api/v1/address/retrieve', async (route) => {
      retrieved = true;
      await route.fulfill({ status: 500, json: { error: { message: 'Unexpected hidden selection' } } });
    });
    const { field, list } = await visit(page, path);
    await field.fill('Glasgow');
    await expect(list).toBeVisible();
    await field.press('Escape');
    await field.press('Enter');
    if (path === '/') await expect(page).toHaveURL(/\/book$/);
    await expect(page.getByRole('button', { name: 'Change from address', exact: true })).toHaveCount(0);
    expect(retrieved).toBe(false);
  });

  test(`@booking stale address responses cannot replace results or reopen after blur on ${path}`, async ({ page }) => {
    const pending = new Map<string, Route>();
    await page.route('**/api/v1/address/suggest', async (route) => {
      const query = requestQuery(route);
      if (query === 'Old' || query === 'Blur') { pending.set(query, route); return; }
      await route.fulfill({ json: { suggestions: [{ ...suggestions[0], id: 'fresh', primary: 'Fresh address' }] } });
    });
    const { field, list } = await visit(page, path);
    await field.fill('Old');
    await expect.poll(() => pending.has('Old')).toBe(true);
    await field.fill('Fresh');
    await expect(list.getByRole('option')).toHaveText('Fresh addressGlasgow, G1 1AA');
    const oldRoute = pending.get('Old');
    if (!oldRoute) throw new Error('Old query did not arrive.');
    const oldResponse = page.waitForResponse((response) => response.request() === oldRoute.request());
    await oldRoute.fulfill({ json: { suggestions } });
    await oldResponse;
    await expect(list.getByRole('option')).toHaveCount(1);
    await expect(list.getByRole('option')).toContainText('Fresh address');
    await field.fill('Blur');
    await expect.poll(() => pending.has('Blur')).toBe(true);
    await field.press('Tab');
    const blurRoute = pending.get('Blur');
    if (!blurRoute) throw new Error('Blur query did not arrive.');
    const blurResponse = page.waitForResponse((response) => response.request() === blurRoute.request());
    await blurRoute.fulfill({ json: { suggestions } });
    await blurResponse;
    await expect(list).toBeHidden();
    await expect(field).toHaveAttribute('aria-expanded', 'false');
  });

  test(`@booking address failures offer a working retry on ${path}`, async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/v1/address/suggest', async (route) => {
      attempts += 1;
      await route.fulfill(attempts === 1
        ? { status: 500, json: { error: { code: 'INTERNAL', message: 'Search unavailable', requestId: 'address-test' } } }
        : { json: { suggestions } });
    });
    const { field, list } = await visit(page, path);
    await field.fill('Glasgow');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(list).toBeVisible();
    expect(attempts).toBe(2);
  });
}
